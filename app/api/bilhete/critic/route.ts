import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildEdgeTable,
  type SimInput,
} from "@/lib/ai-reco/edge-calculator";
import {
  buildIsotonicLookup,
  isLeagueCalibrated,
} from "@/lib/ai-reco/calibration-context";
import { getDistK, type DistKMap } from "@/lib/ai-reco/dist-k-repository";
import { getTemperature } from "@/lib/ai-reco/temp-repository";
import { computeCostUsd } from "@/lib/ai-reco/pricing";
import { recordLlmRequest } from "@/lib/llm-logs";
import {
  getFixtureSimulation,
  type FixtureSimulationDTO,
} from "@/lib/fixtures/simulation-repository";
import { countTotalMean } from "@/lib/calibracao/market-accuracy";
import { getLeaguePerformance } from "@/lib/calibracao/league-accuracy-repository";
import { isAiEnabled } from "@/lib/settings/ai-toggle";
import {
  accuracyLineFor,
  buildCriticPrompt,
  buildLegOdds,
  normalizeLegMarket,
  parseCriticResponse,
  type CriticLegContext,
  type CriticLegModel,
} from "@/lib/bilhete/critic";

/**
 * POST /api/bilhete/critic — F2 "Advogado do diabo do bilhete".
 *
 * Recebe as pernas do bilhete (com a odd que o usuário TOMOU) e devolve uma
 * crítica da IA fundamentada na NOSSA simulação calibrada + histórico real de
 * acerto por mercado: veredicto por perna (ok/atencao/fuga) + veredicto do
 * bilhete (summary, correlações, comentário de EV).
 *
 * Contexto por perna COM fixture no banco:
 *   fixtures (escalares, NUNCA detail_json — B12/B14) → getFixtureSimulation
 *   → prob calibrada via a MESMA fiação do /api/ai-reco/compute
 *   (buildEdgeTable + isotônica + dist_k + temperature, extraída pra
 *   `lib/ai-reco/calibration-context.ts`) contra a odd informada
 *   → histórico do mercado via getLeaguePerformance (market-accuracy).
 * Perna sem fixture/sim/mapeamento entra no prompt como "sem dados do modelo"
 * e a IA critica qualitativamente.
 *
 * Modelo: OPENROUTER_MODEL (v3.2 rápido — crítica é hot path de UX, não o
 * reasoning R1 do recomendador). Toda chamada loga em `llm_request_logs`
 * com route='bilhete-critic' (await — fire-and-forget morre no Worker CF).
 *
 * Auth obrigatória; kill switch global (`app_settings.ai_enabled`) → 503.
 */
export const maxDuration = 120;

const MODEL_ROUTE = "bilhete-critic" as const;
/** Bankroll neutro: só afeta kelly_units, que o crítico não usa. */
const NEUTRAL_BANKROLL = 1000;
const MAX_LEGS = 20;

const legSchema = z.object({
  fixtureId: z.number().int().positive().nullish(),
  home: z.string().min(1),
  away: z.string().min(1),
  market: z.string().min(1),
  side: z.string().min(1),
  odd: z.number().finite().gt(1),
});

const bodySchema = z.object({
  legs: z.array(legSchema).min(1).max(MAX_LEGS),
  stakeTotal: z.number().positive().finite().nullish(),
  oddCombined: z.number().positive().finite().nullish(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

interface FixtureLookupRow {
  id: number;
  home_team: string;
  away_team: string;
  league: string | null;
  source_url: string | null;
  kickoff_utc: string | null;
}

/** Cache por model_version dentro do request (bilhete pode ter N pernas). */
interface VersionCalibration {
  lookup: Partial<Record<string, (p: number) => number>>;
  distK: DistKMap;
  temperature: Partial<Record<"1x2" | "over25" | "btts", number>>;
}

export async function POST(request: Request): Promise<Response> {
  // 1. Body -------------------------------------------------------------------
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid request body", details: String(err) },
      { status: 400 },
    );
  }

  // 2. Auth gate --------------------------------------------------------------
  try {
    const serverClient = (await createClient()) as AnySupabase;
    const { data: { user } = { user: null } } = await serverClient.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient() as AnySupabase;

  // 3. Kill switch global de IA ----------------------------------------------
  if (!(await isAiEnabled(supabase))) {
    return NextResponse.json(
      { error: "IA desativada globalmente", ai_disabled: true },
      { status: 503 },
    );
  }

  if (!env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not configured" },
      { status: 503 },
    );
  }

  // 4. Contexto por perna -----------------------------------------------------
  const versionCache = new Map<string, VersionCalibration>();
  const legContexts: CriticLegContext[] = [];

  for (const leg of parsed.legs) {
    let model: CriticLegModel | null = null;
    try {
      if (leg.fixtureId) {
        model = await buildLegModel(leg, supabase, versionCache);
      }
    } catch {
      // Contexto do modelo é best-effort: falha vira "sem dados do modelo",
      // nunca derruba a crítica inteira.
      model = null;
    }
    legContexts.push({
      home: leg.home,
      away: leg.away,
      market: leg.market,
      side: leg.side,
      odd: leg.odd,
      model,
    });
  }

  // 5. Prompt + chamada LLM ---------------------------------------------------
  const prompt = buildCriticPrompt({
    legs: legContexts,
    stakeTotal: parsed.stakeTotal ?? null,
    oddCombined: parsed.oddCombined ?? null,
  });

  const model = env.OPENROUTER_MODEL;
  const t0 = Date.now();

  let resp: Response;
  try {
    resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://abissal.rnobre.dev",
        "X-Title": "Abissal",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });
  } catch (err) {
    const latencyMs = Date.now() - t0;
    await recordLlmRequest(supabase, {
      route: MODEL_ROUTE,
      model,
      latency_ms: latencyMs,
      error: `fetch threw: ${err instanceof Error ? err.message : String(err)}`,
    });
    return NextResponse.json(
      { error: "Falha ao chamar a IA — tente de novo." },
      { status: 502 },
    );
  }

  const latencyMs = Date.now() - t0;

  if (!resp.ok) {
    const text = await resp.text().catch(() => "<no body>");
    await recordLlmRequest(supabase, {
      route: MODEL_ROUTE,
      model,
      latency_ms: latencyMs,
      error: `OpenRouter HTTP ${resp.status}: ${text.slice(0, 500)}`,
    });
    return NextResponse.json(
      { error: `OpenRouter HTTP ${resp.status}` },
      { status: 502 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }
  const rawContent: string = body?.choices?.[0]?.message?.content ?? "";
  const usage = body?.usage ?? {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  const modelReturned: string = body?.model || model;
  const costUsd = computeCostUsd(
    modelReturned,
    usage.prompt_tokens ?? 0,
    usage.completion_tokens ?? 0,
  );

  const result = parseCriticResponse(rawContent, parsed.legs.length);

  await recordLlmRequest(supabase, {
    route: MODEL_ROUTE,
    model,
    latency_ms: latencyMs,
    prompt_tokens: usage.prompt_tokens ?? null,
    completion_tokens: usage.completion_tokens ?? null,
    total_tokens: usage.total_tokens ?? null,
    cost_usd: costUsd,
    error: result
      ? null
      : "invalid critic JSON from LLM (schema mismatch or leg count)",
  });

  if (!result) {
    return NextResponse.json(
      { error: "Resposta da IA inválida — tente de novo." },
      { status: 502 },
    );
  }

  // 6. Merge veredicto + contexto computado ----------------------------------
  const legs = result.legs.map((verdict, i) => {
    const ctx = legContexts[i];
    return {
      verdict: verdict.verdict,
      why: verdict.why,
      home: ctx.home,
      away: ctx.away,
      market: ctx.market,
      side: ctx.side,
      odd: ctx.odd,
      has_model_data: ctx.model !== null,
      prob_calibrated: ctx.model?.probCalibrated ?? null,
      edge_pct: ctx.model?.edgePct ?? null,
      league_calibrated: ctx.model?.leagueCalibrated ?? null,
    };
  });

  return NextResponse.json(
    { legs, overall: result.overall, latencyMs, costUsd, model },
    { status: 200 },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Monta o contexto do NOSSO modelo pra uma perna: sim + prob calibrada (mesma
 * fiação do compute: isotônica + dist_k + temperature via buildEdgeTable) +
 * edge vs a odd informada + histórico real do mercado. `null` quando falta
 * fixture/sim/mapeamento de mercado.
 */
async function buildLegModel(
  leg: z.infer<typeof legSchema>,
  supabase: AnySupabase,
  versionCache: Map<string, VersionCalibration>,
): Promise<CriticLegModel | null> {
  const { data, error } = await supabase
    .from("fixtures")
    .select("id, home_team, away_team, league, source_url, kickoff_utc")
    .eq("id", leg.fixtureId)
    .maybeSingle();
  if (error || !data) return null;
  const fixture = data as FixtureLookupRow;

  const sim = await getFixtureSimulation(
    {
      sourceUrl: fixture.source_url,
      homeTeam: fixture.home_team,
      awayTeam: fixture.away_team,
      kickoffUtc: fixture.kickoff_utc,
    },
    supabase,
  );
  if (!sim) return null;

  const normalized = normalizeLegMarket(leg.market, leg.side);
  if (!normalized) return null;

  const cal = await getVersionCalibration(sim.model_version, supabase, versionCache);
  const leagueCalibrated = await isLeagueCalibrated(fixture.league, supabase);

  const candidates = buildEdgeTable(
    simInputFromDTO(sim),
    buildLegOdds(normalized, leg.odd),
    NEUTRAL_BANKROLL,
    {
      isotonicLookup: cal.lookup,
      distK: cal.distK,
      temperature: cal.temperature,
      // Sem blending: só há a odd do usuário, não o mercado completo pra
      // devigar — o edge honesto aqui é prob calibrada × odd − 1.
    },
  );
  const candidate = candidates.find(
    (c) => c.market === normalized.market && c.side === normalized.side,
  );

  let accuracyLine: string | null = null;
  try {
    const perf = await getLeaguePerformance(
      fixture.league,
      sim.model_version,
      supabase,
      cal.distK,
    );
    accuracyLine = perf ? accuracyLineFor(perf.markets, normalized.market) : null;
  } catch {
    accuracyLine = null;
  }

  return {
    probCalibrated: candidate?.prob_calibrated ?? null,
    edgePct: candidate?.edge_pct ?? null,
    leagueCalibrated,
    league: fixture.league,
    accuracyLine,
  };
}

async function getVersionCalibration(
  modelVersion: string | null,
  supabase: AnySupabase,
  cache: Map<string, VersionCalibration>,
): Promise<VersionCalibration> {
  const key = modelVersion ?? "";
  const cached = cache.get(key);
  if (cached) return cached;
  const [lookup, distK, temperature] = await Promise.all([
    buildIsotonicLookup(modelVersion, supabase),
    getDistK(key, supabase),
    getTemperature(key, supabase),
  ]);
  const entry: VersionCalibration = { lookup, distK, temperature };
  cache.set(key, entry);
  return entry;
}

/**
 * SimInput do edge-calculator a partir do DTO: mercados principais + médias
 * de total dos secundários derivadas de `sim_stats` via `countTotalMean`
 * (a MESMA conversão do painel de acerto — fonte única, market-accuracy.ts).
 */
function simInputFromDTO(sim: FixtureSimulationDTO): SimInput {
  return {
    p_home: sim.p_home,
    p_draw: sim.p_draw,
    p_away: sim.p_away,
    p_over_25: sim.p_over_25,
    p_btts: sim.p_btts,
    sim_corners_total_mean: countTotalMean(sim.sim_stats, "corners"),
    sim_cards_total_mean: countTotalMean(sim.sim_stats, "cards"),
    sim_sot_total_mean: countTotalMean(sim.sim_stats, "sot"),
  };
}
