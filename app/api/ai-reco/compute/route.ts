import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildEdgeTable,
  type EdgeCandidate,
  type OddsInput,
  type SimInput,
} from "@/lib/ai-reco/edge-calculator";
import {
  buildPrompt,
  PROMPT_VERSION,
  type PromptCandidate,
  type PromptContext,
} from "@/lib/ai-reco/prompts";
import {
  runRecommender,
  type AiDecision,
} from "@/lib/ai-reco/recommender";
import { computeCostUsd } from "@/lib/ai-reco/pricing";
import { getDistK } from "@/lib/ai-reco/dist-k-repository";
import { getTemperature } from "@/lib/ai-reco/temp-repository";
import { applyIsotonic } from "@/lib/calibracao/isotonic";
import { getFixtureSimulation } from "@/lib/fixtures/simulation-repository";
import { parseChoistatsId } from "@/lib/fixtures/choistats-id";
import { isAiEnabled } from "@/lib/settings/ai-toggle";

/**
 * POST /api/ai-reco/compute — on-demand AI recommendation for a single fixture.
 *
 * Used by the per-fixture "[ pedir análise IA ]" button. Mirrors the daily
 * Ruby pipeline (`AiRecommenderRunner`) but runs synchronously against a
 * single fixture id and returns the decision inline for immediate render.
 *
 * Flow:
 *   1. Validate body { fixtureId: positive integer }.
 *   2. Load fixture (id, league, source_url, kickoff_utc, detail_json, teams).
 *      404 if missing.
 *   3. Load fixture_simulations via `getFixtureSimulation` — same reader the
 *      `/fixtures/[id]` page uses (handles calibration application). 400 if
 *      missing or no odds in detail_json.
 *   4. Determine bankroll (defensive DB query → ENV → 1000 fallback).
 *   5. Load active isotonic curves via `getActiveCurves(model_version)` and
 *      build the lookup map passed into `buildEdgeTable`.
 *   6. Detect league_calibrated via `league_parameters` (effective row).
 *   7. Build edge table, filter `edge_pct >= 10` (v3 — 2026-05-25 noite,
 *      walk-forward sem leakage: D10 ficou 1º no ranking WF).
 *   8. If no candidates → persist `verdict='skip'` and return 200 (no IA call).
 *   9. Else → buildPrompt → runRecommender → persist both `llm_request_logs`
 *      and `ai_recommendations` rows.
 *  10. Return { decision, reco_id, logId, costUsd, latencyMs }.
 *
 * Auth: session gate via `createClient().auth.getUser()` → 401 if missing.
 * Admin client used only after the gate passes (same pattern as all gated routes).
 *
 * Spec: docs/superpowers/specs/2026-05-24-ai-recomendador-design.md §4.3
 *       docs/superpowers/plans/2026-05-24-ai-recomendador-plan.md Wave 3
 */

export const maxDuration = 100;

const RECO_VERSION = "reco-v1";
const ROUTE_LABEL = "ai-reco-on-demand";
/**
 * Threshold mínimo de edge_pct (após blending) pra virar bet candidate.
 * Histórico:
 *   v1 (2026-05-25 manhã): 5.0
 *   v2 (2026-05-25 tarde): 20.0 — backtest de 30d mostrou
 *     `D20 (edge≥20%) ROI +14.4%` vs `A (edge≥5%) ROI +8.1%`.
 *     Combinado com blending α=0.5 (H): ROI projetado +18.66%.
 *   v3 (2026-05-25 noite): 10.0 — walk-forward sem leakage demoliu in-sample.
 *     D10 ficou 1º no ranking walk-forward (ROI -13.12%, melhor entre todos).
 *     D20 ficou 4º. Reverter pra D10 é a config menos ruim dos dados reais.
 *     Ref: docs/superpowers/specs/2026-05-25-backtest-walk-forward.md
 * Espelha `EDGE_THRESHOLD` do Ruby runner.
 */
const EDGE_THRESHOLD_PCT = 10.0;
const DEFAULT_BANKROLL = 1000.0;
/**
 * Blending sim × mercado (v1 universal — 2026-05-25).
 * Histórico:
 *   v1 (2026-05-25 tarde): 0.5 — backtest in-sample H (D20+α=0.5) ROI +18.66%.
 *   v2 (2026-05-25 noite): 0.3 — R6 walk-forward: α=0.5 cenários (F,H,G)
 *     caíram pra fundo no ranking WF. Cenários conservadores (α→1.0) menos ruins.
 *     0.3 é compromisso: atenua edges absurdos sem amplificar sim tanto quanto 0.5.
 * Sincronizar com `DEFAULT_BLEND_ALPHA` em
 * `scripts/scraper/lib/scraper/ai_recommender_runner.rb`.
 * Override via ENV AI_RECO_BLEND_ALPHA (0..1). Override por liga é TODO v2.
 */
const DEFAULT_BLEND_ALPHA = 0.3;

const bodySchema = z.object({
  fixtureId: z.number().int().positive(),
  /**
   * force=true: bypass edge gate, pick best candidate (even below threshold),
   * call the LLM and persist with forced=true. These recos are excluded from
   * all calibration metrics (B19-class). Default: false / absent.
   */
  force: z.boolean().optional().default(false),
});

interface FixtureLookupRow {
  id: number;
  home_team: string;
  away_team: string;
  league: string | null;
  source_url: string | null;
  kickoff_utc: string | null;
  detail_json: Record<string, unknown> | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

export async function POST(request: Request): Promise<Response> {
  // ---------------------------------------------------------------------------
  // 1. Body validation
  // ---------------------------------------------------------------------------
  let parsed: z.infer<typeof bodySchema>;
  try {
    const raw = await request.json();
    parsed = bodySchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      { error: "invalid request body", details: String(err) },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // 1b. Auth gate -- expensive LLM call; only the authenticated user can trigger
  // ---------------------------------------------------------------------------
  try {
    const serverClient = (await createClient()) as AnySupabase;
    const { data: { user } = { user: null } } = await serverClient.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { fixtureId, force } = parsed;
  // Choistats id (derivado de source_url) é o identificador usado em
  // ai_recommendations.fixture_id e fixture_simulations.fixture_id (id-space
  // do scraper). `fixtureId` do body é a PK da tabela fixtures (rota Next.js).
  // Vamos derivar choistatsId depois do lookup pra usar nos INSERTs.
  let choistatsId: number | null = null;

  // ---------------------------------------------------------------------------
  // 2. Admin client + fixture lookup
  // ---------------------------------------------------------------------------
  const supabase = createAdminClient() as AnySupabase;

  // 2a. Kill switch global de IA (app_settings.ai_enabled). Quando desligado,
  // nenhuma chamada LLM é feita — 503 pra a UI tratar ("IA desativada"). Evita
  // gastar/errar quando os créditos do OpenRouter acabaram (default: ligado).
  if (!(await isAiEnabled(supabase))) {
    return NextResponse.json(
      { error: "IA desativada globalmente", ai_disabled: true },
      { status: 503 },
    );
  }

  let fixture: FixtureLookupRow | null = null;
  try {
    const { data, error } = await supabase
      .from("fixtures")
      .select("id, home_team, away_team, league, source_url, kickoff_utc, detail_json")
      .eq("id", fixtureId)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: "database error", details: error.message },
        { status: 500 },
      );
    }
    fixture = data as FixtureLookupRow | null;
  } catch (err) {
    return NextResponse.json(
      { error: "fixture lookup failed", details: String(err) },
      { status: 500 },
    );
  }

  if (!fixture) {
    return NextResponse.json({ error: "fixture not found" }, { status: 404 });
  }

  // Derivar choistats id do source_url via shared utility.
  choistatsId = parseChoistatsId(fixture.source_url);

  // ---------------------------------------------------------------------------
  // 3. Simulation + odds extraction
  // ---------------------------------------------------------------------------
  const sim = await getFixtureSimulation(
    {
      sourceUrl: fixture.source_url,
      homeTeam: fixture.home_team,
      awayTeam: fixture.away_team,
      kickoffUtc: fixture.kickoff_utc,
    },
    supabase,
  );

  if (!sim) {
    return NextResponse.json(
      { error: "sim missing for this fixture" },
      { status: 400 },
    );
  }

  const odds = extractOdds(fixture.detail_json, fixture.home_team, fixture.away_team);
  if (!odds) {
    return NextResponse.json(
      { error: "odds missing in detail_json.odds_summary" },
      { status: 400 },
    );
  }

  const simInput: SimInput = {
    p_home: sim.p_home,
    p_draw: sim.p_draw,
    p_away: sim.p_away,
    p_over_25: sim.p_over_25,
    p_btts: sim.p_btts,
  };

  // ---------------------------------------------------------------------------
  // 4. Bankroll (defensive query → env → fallback)
  // ---------------------------------------------------------------------------
  const bankroll = await loadBankroll(supabase);

  // ---------------------------------------------------------------------------
  // 5. Isotonic lookup from active curves
  // ---------------------------------------------------------------------------
  const isotonicLookup = await buildIsotonicLookup(sim.model_version, supabase);
  // Calibração de distribuição (corners/cards/sot): fallback do Poisson cru nas
  // linhas sem curva isotônica. Prioridade no buildEdgeTable: curva → k → raw.
  const distK = await getDistK(sim.model_version ?? "", supabase);
  // Temperature scaling (B45): mesma correção que o batch Ruby aplica.
  const temperature = await getTemperature(sim.model_version ?? "", supabase);

  // ---------------------------------------------------------------------------
  // 6. League calibrated detection
  // ---------------------------------------------------------------------------
  const leagueCalibrated = await isLeagueCalibrated(fixture.league, supabase);

  // ---------------------------------------------------------------------------
  // 7. Edge table + candidate filter
  // ---------------------------------------------------------------------------
  const envAlpha = Number(process.env.AI_RECO_BLEND_ALPHA);
  const blendAlpha =
    Number.isFinite(envAlpha) && envAlpha >= 0 && envAlpha <= 1
      ? envAlpha
      : DEFAULT_BLEND_ALPHA;
  const allCandidates = buildEdgeTable(simInput, odds, bankroll, {
    isotonicLookup,
    blendAlpha,
    distK,
    temperature,
  });
  const betCandidates = allCandidates.filter(
    (c) => c.edge_pct >= EDGE_THRESHOLD_PCT,
  );

  // ---------------------------------------------------------------------------
  // 8. Skip path — no IA call needed (unless force=true)
  //
  // force=true: bypass edge gate. Pick the candidate with the highest edge_pct
  // (even if negative/zero) and proceed to LLM. Reco persisted with forced=true.
  // These recos are excluded from all calibration metrics (B19-class concern).
  // ---------------------------------------------------------------------------
  // Track whether this request is truly "forced" (gate bypassed).
  // Only true when force=true AND no candidate passed the natural gate.
  let isForced = false;

  if (betCandidates.length === 0) {
    if (!force) {
      // Normal skip — no LLM call, persist skip with forced=false.
      const recoId = await persistSkip({
        supabase,
        fixture,
        choistatsId,
        allCandidates,
        leagueCalibrated,
      });

      const skipDecision: AiDecision = {
        verdict: "skip",
        confidence: "baixo",
        reasoning: "Nenhum mercado com valor; skip.",
        summary_line: "Nenhum candidato com edge >= 10%",
        red_flags: [],
      };

      return NextResponse.json(
        {
          decision: skipDecision,
          reco_id: recoId,
          logId: null,
          costUsd: 0,
          latencyMs: 0,
        },
        { status: 200 },
      );
    }

    // force=true: pick the best available candidate (highest edge_pct).
    // Sort descending by edge_pct and use the top one as the forced candidate.
    const sortedByEdge = [...allCandidates].sort(
      (a, b) => b.edge_pct - a.edge_pct,
    );
    const forcedCandidate = sortedByEdge[0];
    // If there are truly zero candidates (no odds at all), fall through to skip.
    if (!forcedCandidate) {
      const recoId = await persistSkip({
        supabase,
        fixture,
        choistatsId,
        allCandidates,
        leagueCalibrated,
      });
      const skipDecision: AiDecision = {
        verdict: "skip",
        confidence: "baixo",
        reasoning: "Nenhum mercado disponível para análise forçada.",
        summary_line: "Sem candidatos",
        red_flags: [],
      };
      return NextResponse.json(
        { decision: skipDecision, reco_id: recoId, logId: null, costUsd: 0, latencyMs: 0 },
        { status: 200 },
      );
    }
    // Replace betCandidates with the single forced candidate for the LLM path.
    betCandidates.push(forcedCandidate);
    // We entered the force bypass — mark this reco as forced.
    isForced = true;
  }

  // ---------------------------------------------------------------------------
  // 9. IA call — requires OPENROUTER_API_KEY
  // ---------------------------------------------------------------------------
  if (!env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not configured" },
      { status: 503 },
    );
  }

  // On-demand path uses AI_RECO_MODEL_ONDEMAND. 2026-05-25 (decisão de
  // produto): revertido pra `deepseek/deepseek-r1` (mesmo modelo do batch
  // noturno) por consistência. Trade-off conhecido: latência síncrona ~40s
  // p50 (R1 reasoning). UI mostra spinner "analisando — pode levar até 1
  // min" pra setar expectativa.
  const model = env.AI_RECO_MODEL_ONDEMAND;

  const promptCandidates: PromptCandidate[] = betCandidates.map((c) => ({
    market: c.market,
    side: c.side,
    prob_calibrated: c.prob_calibrated,
    edge_pct: c.edge_pct,
    kelly_units: c.kelly_units,
    odd: c.odd,
  }));

  const promptContext = buildPromptContext({
    detailJson: fixture.detail_json,
    simStats: sim.sim_stats as Record<string, unknown> | null,
    topScorelines: sim.top_scorelines,
    homeTeam: fixture.home_team,
    awayTeam: fixture.away_team,
  });

  const prompt = buildPrompt({
    league: fixture.league,
    league_calibrated: leagueCalibrated,
    home_team: fixture.home_team,
    away_team: fixture.away_team,
    kickoff_utc: fixture.kickoff_utc,
    referee: extractReferee(fixture.detail_json),
    candidates: promptCandidates,
    context: promptContext,
  });

  const result = await runRecommender(prompt, {
    model,
    apiKey: env.OPENROUTER_API_KEY,
    leagueCalibrated,
  });

  // OpenRouter failed (HTTP error, parse error, etc) — still log + persist a
  // skip-style recommendation so the audit trail is complete, then 502.
  if (!result.ok || !result.decision) {
    const costFail = computeCostUsd(
      result.modelReturned || model,
      result.usage?.prompt_tokens ?? 0,
      result.usage?.completion_tokens ?? 0,
    );
    const logIdFail = await insertLlmLog({
      supabase,
      route: ROUTE_LABEL,
      fixtureId,
      model,
      latencyMs: result.latencyMs ?? null,
      usage: result.usage,
      cost: costFail,
      promptSnapshot: { system: prompt.system, user: prompt.user },
      responseRaw: result.rawContent ?? null,
      error: result.error ?? "unknown",
    });

    return NextResponse.json(
      {
        error: result.error ?? "OpenRouter failed",
        logId: logIdFail,
      },
      { status: 502 },
    );
  }

  const decision = result.decision;
  const cost = computeCostUsd(
    result.modelReturned || model,
    result.usage?.prompt_tokens ?? 0,
    result.usage?.completion_tokens ?? 0,
  );

  const logId = await insertLlmLog({
    supabase,
    route: ROUTE_LABEL,
    fixtureId: choistatsId ?? fixtureId,
    model,
    latencyMs: result.latencyMs ?? null,
    usage: result.usage,
    cost,
    promptSnapshot: { system: prompt.system, user: prompt.user },
    responseRaw: result.rawContent ?? null,
    error: null,
  });

  const recoId = await insertReco({
    supabase,
    fixture,
    choistatsId,
    allCandidates,
    leagueCalibrated,
    decision,
    model,
    logId,
    cost,
    forced: isForced,
  });

  return NextResponse.json(
    {
      decision,
      reco_id: recoId,
      logId,
      costUsd: cost,
      latencyMs: result.latencyMs ?? 0,
    },
    { status: 200 },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the 7 markets do `detail_json.odds_summary`.
 *
 * Shape REAL do choistats (verificado empiricamente 2026-05-24):
 *   odds_summary:
 *     "Result":   { "<home_team_name>", "Draw", "<away_team_name>" }
 *     "BTTS":     { "Yes", "No" }
 *     "Match Goals Overs/Unders": { "Over 2.5", "Under 2.5", ... }
 *   Cada valor: { "bookmaker": "X", "decimal_odds": Float }
 *
 * Espelha `AiRecommenderRunner#extract_odds` (Ruby) pós-fix do mesmo bug
 * (commit 099c863). Lição B15 + repete em Lição "shape REAL do producer".
 *
 * Returns `null` when detail_json is missing/malformed ou todos markets vazios.
 */
function extractOdds(
  detailJson: Record<string, unknown> | null,
  homeTeam: string,
  awayTeam: string,
): OddsInput | null {
  if (!detailJson || typeof detailJson !== "object") return null;
  const oddsRootRaw =
    (detailJson as Record<string, unknown>).odds_summary ??
    (detailJson as Record<string, unknown>).odds;
  if (!oddsRootRaw || typeof oddsRootRaw !== "object") return null;
  const oddsRoot = oddsRootRaw as Record<string, unknown>;

  const resultMarket = (oddsRoot["Result"] ?? {}) as Record<string, unknown>;
  const bttsMarket = (oddsRoot["BTTS"] ?? {}) as Record<string, unknown>;
  const mgMarket = (oddsRoot["Match Goals Overs/Unders"] ?? {}) as Record<string, unknown>;

  const out: OddsInput = {
    home:     digDecimal(resultMarket, homeTeam),
    draw:     digDecimal(resultMarket, "Draw"),
    away:     digDecimal(resultMarket, awayTeam),
    over25:   digDecimal(mgMarket, "Over 2.5"),
    under25:  digDecimal(mgMarket, "Under 2.5"),
    btts_sim: digDecimal(bttsMarket, "Yes"),
    btts_nao: digDecimal(bttsMarket, "No"),
  };

  const allMissing = Object.values(out).every((v) => v == null);
  return allMissing ? null : out;
}

/** Field is `decimal_odds` (not `average`). Tolerant: returns null on miss. */
function digDecimal(
  marketNode: Record<string, unknown>,
  key: string,
): number | null {
  const node = marketNode[key];
  if (!node || typeof node !== "object") return null;
  const v = (node as Record<string, unknown>).decimal_odds;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function extractReferee(detailJson: Record<string, unknown> | null): string | null {
  if (!detailJson || typeof detailJson !== "object") return null;
  const referee = (detailJson as Record<string, unknown>).referee;
  if (referee && typeof referee === "object") {
    const name = (referee as Record<string, unknown>).name;
    if (typeof name === "string") return name;
  }
  const refRecord = (detailJson as Record<string, unknown>).referee_record;
  if (refRecord && typeof refRecord === "object") {
    const name = (refRecord as Record<string, unknown>).name;
    if (typeof name === "string") return name;
  }
  return null;
}

/**
 * Builds the recent-form / h2h / stats context block fed to the prompt.
 * Mirrors `AiRecommenderRunner#build_context` (Ruby).
 */
function buildPromptContext(args: {
  detailJson: Record<string, unknown> | null;
  simStats: Record<string, unknown> | null;
  topScorelines: Array<{ score: string; prob: number }> | null;
  homeTeam: string;
  awayTeam: string;
}): PromptContext {
  const detail = (args.detailJson ?? {}) as Record<string, unknown>;
  const simStats = (args.simStats ?? {}) as Record<string, unknown>;
  const recent = (detail.recent_matches ?? {}) as Record<string, unknown>;
  const h2h = detail.h2h;
  void args.homeTeam;
  void args.awayTeam;

  return {
    top_scorelines: Array.isArray(args.topScorelines)
      ? args.topScorelines.slice(0, 5)
      : [],
    sim_stats_home: statsSummary(simStats.home),
    sim_stats_away: statsSummary(simStats.away),
    recent_home: summarizeRecent(recent.home),
    recent_away: summarizeRecent(recent.away),
    h2h: summarizeH2h(h2h),
  };
}

function statsSummary(teamStats: unknown): Record<string, number> {
  if (!teamStats || typeof teamStats !== "object") return {};
  const out: Record<string, number> = {};
  for (const key of ["goals", "corners", "sot", "cards"]) {
    const node = (teamStats as Record<string, unknown>)[key];
    let val: unknown = node;
    if (node && typeof node === "object") {
      val =
        (node as Record<string, unknown>).p50 ??
        (node as Record<string, unknown>).mean;
    }
    if (typeof val === "number" && Number.isFinite(val)) {
      out[key] = Number(val.toFixed(2));
    }
  }
  return out;
}

function summarizeRecent(arr: unknown): string {
  if (!Array.isArray(arr) || arr.length === 0) return "—";
  return arr
    .slice(0, 5)
    .map((m) => {
      const row = m as Record<string, unknown>;
      const result =
        (row.result as string | undefined) ??
        ((row.outcome as Record<string, unknown> | undefined)?.result as string | undefined) ??
        "?";
      const hg = row.home_goals ?? "?";
      const ag = row.away_goals ?? "?";
      return `${result} (${hg}-${ag})`;
    })
    .join(", ");
}

function summarizeH2h(h2h: unknown): string {
  if (!Array.isArray(h2h) || h2h.length === 0) return "—";
  return h2h
    .slice(0, 3)
    .map((m) => {
      const row = m as Record<string, unknown>;
      return `${row.home_team ?? "?"} ${row.home_goals ?? "?"}-${row.away_goals ?? "?"} ${row.away_team ?? "?"}`;
    })
    .join("; ");
}

/**
 * Tries to read the latest bankroll from a `banca_snapshots` view (if
 * exposed). If the table/view does not exist, the supabase mock errors out,
 * or the row is missing, falls back to ENV `AI_RECO_BANKROLL` and then to
 * `DEFAULT_BANKROLL` (1000). Never throws.
 */
async function loadBankroll(supabase: AnySupabase): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("banca_snapshots")
      .select("current_balance")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      const cb = (data as Record<string, unknown>).current_balance;
      if (typeof cb === "number" && Number.isFinite(cb) && cb > 0) {
        return cb;
      }
      const b = (data as Record<string, unknown>).balance;
      if (typeof b === "number" && Number.isFinite(b) && b > 0) {
        return b;
      }
    }
  } catch {
    // table missing or transient — degrade
  }
  const envBankroll = Number(process.env.AI_RECO_BANKROLL);
  if (Number.isFinite(envBankroll) && envBankroll > 0) return envBankroll;
  return DEFAULT_BANKROLL;
}

/**
 * Converts the `ActiveCurves` DTO into the `isotonicLookup` shape that
 * `buildEdgeTable` consumes ('1x2-home', '1x2-draw', '1x2-away', 'over25').
 */
// Fix 2/3: lê TODAS as curvas ativas de model_calibration por metric (genérico),
// não só os 4 slots tipados — pega over25-under/btts/btts-nao e os secundários
// (corners/cards/sot) sem precisar estender o DTO. Espelha o Ruby
// AiReco::IsotonicLookup.load. Keyed por metric string (igual ao calibrate()).
async function buildIsotonicLookup(
  modelVersion: string | null,
  supabase: AnySupabase,
): Promise<Partial<Record<string, (p: number) => number>>> {
  if (!modelVersion) return {};
  const { data, error } = await supabase
    .from("model_calibration")
    .select("metric, pairs")
    .eq("model_version", modelVersion)
    .is("effective_until", null);
  if (error || !data) return {};
  const lookup: Partial<Record<string, (p: number) => number>> = {};
  for (const row of data as Array<{ metric: string | null; pairs: unknown }>) {
    const metric = String(row.metric ?? "");
    // '*-dist' são fatores de distribuição (getDistK), não curvas isotônicas.
    if (metric.endsWith("-dist")) continue;
    const pairs = asPairs(row.pairs);
    if (!metric || pairs.length === 0) continue;
    lookup[metric] = (p: number) => applyIsotonic(pairs, p);
  }
  return lookup;
}

/** jsonb `pairs` → Array<[number,number]> validado; [] se inválido. */
function asPairs(raw: unknown): Array<[number, number]> {
  if (!Array.isArray(raw)) return [];
  const out: Array<[number, number]> = [];
  for (const p of raw) {
    if (
      Array.isArray(p) &&
      p.length >= 2 &&
      typeof p[0] === "number" &&
      typeof p[1] === "number"
    ) {
      out.push([p[0], p[1]]);
    }
  }
  return out;
}

/**
 * `effective_until IS NULL` row in `league_parameters` for the given league
 * means the engine has fit a per-league parameter set — used as the
 * "calibrated league" gate that determines the 2.0u vs 0.5u units cap.
 */
async function isLeagueCalibrated(
  league: string | null,
  supabase: AnySupabase,
): Promise<boolean> {
  if (!league) return false;
  try {
    const { data, error } = await supabase
      .from("league_parameters")
      .select("league")
      .eq("league", league)
      .is("effective_until", null)
      .limit(1)
      .maybeSingle();
    if (!error && data) return true;
  } catch {
    // missing table / transient → not calibrated (safer default: 0.5u cap)
  }
  return false;
}

async function insertLlmLog(args: {
  supabase: AnySupabase;
  route: string;
  fixtureId: number;
  model: string;
  latencyMs: number | null;
  usage:
    | { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    | undefined;
  cost: number;
  promptSnapshot: { system: string; user: string };
  responseRaw: string | null;
  error: string | null;
}): Promise<number | null> {
  try {
    const { data, error } = await args.supabase
      .from("llm_request_logs")
      .insert({
        route: args.route,
        fixture_id: args.fixtureId,
        model: args.model,
        latency_ms: args.latencyMs,
        prompt_tokens: args.usage?.prompt_tokens ?? null,
        completion_tokens: args.usage?.completion_tokens ?? null,
        total_tokens: args.usage?.total_tokens ?? null,
        cost_usd: args.cost,
        prompt_version: PROMPT_VERSION,
        prompt_snapshot: args.promptSnapshot,
        response_raw: args.responseRaw,
        error: args.error,
      })
      .select("id")
      .single();
    if (error || !data) return null;
    const id = (data as Record<string, unknown>).id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

async function persistSkip(args: {
  supabase: AnySupabase;
  fixture: FixtureLookupRow;
  choistatsId: number | null;
  allCandidates: EdgeCandidate[];
  leagueCalibrated: boolean;
}): Promise<number | null> {
  try {
    const { data, error } = await args.supabase
      .from("ai_recommendations")
      .insert({
        fixture_id: args.choistatsId ?? args.fixture.id,
        home_team: args.fixture.home_team,
        away_team: args.fixture.away_team,
        league: args.fixture.league,
        kickoff_utc: args.fixture.kickoff_utc,
        reco_version: RECO_VERSION,
        prompt_version: PROMPT_VERSION,
        llm_model: "(no-llm-call)",
        llm_log_id: null,
        edge_table_snapshot: args.allCandidates,
        league_calibrated: args.leagueCalibrated,
        verdict: "skip",
        market: null,
        side: null,
        prob_estimated: null,
        prob_calibrated: null,
        edge_pct: null,
        odd_captured: null,
        kelly_pre: null,
        units_final: null,
        reduction_reason: null,
        confidence: "baixo",
        summary_line: "Nenhum candidato com edge >= 10%",
        reasoning_full: "Nenhum mercado com valor; skip.",
        red_flags: [],
        cost_usd: 0,
        forced: false,
      })
      .select("id")
      .single();
    if (error || !data) return null;
    const id = (data as Record<string, unknown>).id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

async function insertReco(args: {
  supabase: AnySupabase;
  fixture: FixtureLookupRow;
  choistatsId: number | null;
  allCandidates: EdgeCandidate[];
  leagueCalibrated: boolean;
  decision: AiDecision;
  model: string;
  logId: number | null;
  cost: number;
  /** True when the reco was forced below the edge threshold. Excluded from calibration. */
  forced?: boolean;
}): Promise<number | null> {
  const d = args.decision;
  const chosen =
    d.verdict === "bet"
      ? args.allCandidates.find(
          (c) => c.market === d.market && c.side === d.side,
        ) ?? null
      : null;

  try {
    const { data, error } = await args.supabase
      .from("ai_recommendations")
      .insert({
        fixture_id: args.choistatsId ?? args.fixture.id,
        home_team: args.fixture.home_team,
        away_team: args.fixture.away_team,
        league: args.fixture.league,
        kickoff_utc: args.fixture.kickoff_utc,
        reco_version: RECO_VERSION,
        prompt_version: PROMPT_VERSION,
        llm_model: args.model,
        llm_log_id: args.logId,
        edge_table_snapshot: args.allCandidates,
        league_calibrated: args.leagueCalibrated,
        verdict: d.verdict,
        market: d.market ?? null,
        side: d.side ?? null,
        prob_estimated: d.prob_estimated ?? null,
        prob_calibrated: chosen?.prob_calibrated ?? null,
        edge_pct: chosen?.edge_pct ?? null,
        odd_captured: chosen?.odd ?? null,
        kelly_pre: d.kelly_pre ?? chosen?.kelly_units ?? null,
        units_final: d.units_final ?? 0,
        reduction_reason: d.reduction_reason ?? null,
        confidence: d.confidence ?? "medio",
        summary_line: d.summary_line ?? null,
        reasoning_full: d.reasoning ?? null,
        red_flags: d.red_flags ?? [],
        cost_usd: args.cost,
        forced: args.forced === true,
      })
      .select("id")
      .single();
    if (error || !data) return null;
    const id = (data as Record<string, unknown>).id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}
