#!/usr/bin/env tsx
/**
 * scripts/briefing/generate-daily.ts — F4 "Abissal Daily"
 *
 * Gera o briefing matinal: um parágrafo diário (LLM via OpenRouter,
 * OPENROUTER_MODEL, default deepseek/deepseek-v3.2) que conecta os dados do
 * dia — recos verdict=bet, contagem de skips, quantas apostas caíram em liga
 * não-calibrada e o acerto histórico por mercado (market-accuracy sobre as
 * simulações reconciliadas). Persiste em `app_settings` (key `daily_briefing`,
 * upsert via service_role); o card <BriefingDoDia /> do /painel lê de lá.
 *
 * Roda no cron `ai-reco.yml`, DEPOIS do alerta Telegram. O step tem
 * `continue-on-error: true` — uma falha aqui não pode derrubar o job (as
 * chamadas R1 e o alerta já aconteceram); por isso o script PODE sair com
 * código ≠ 0 em erro real (fica visível na annotation do Actions).
 *
 * Kill switch: `app_settings.ai_enabled === false` ⇒ exit 0 SEM gerar
 * (não é erro — mesmo padrão de lib/settings/ai-toggle.ts).
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY
 * (obrigatórias — ausência é misconfiguração e sai 1); OPENROUTER_MODEL
 * (opcional). Núcleo puro (prompt + parse + shape do value) em
 * lib/briefing/compose.ts — testado sem I/O.
 */
import { createClient } from "@supabase/supabase-js";
import {
  DAILY_BRIEFING_KEY,
  composeBriefingPrompt,
  parseBriefingText,
  buildBriefingValue,
  brtDateIso,
  type BriefingAccuracy,
  type BriefingBet,
} from "../../lib/briefing/compose";
import { isAiEnabled } from "../../lib/settings/ai-toggle";
import { recordLlmRequest } from "../../lib/llm-logs";
import {
  marketAccuracies,
  MIN_LEAGUE_CALLS,
  type AccuracyRow,
} from "../../lib/calibracao/market-accuracy";
import { computeCostUsd } from "../../lib/ai-reco/pricing";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v3.2";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[briefing] Supabase env missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(1);
}
if (!OPENROUTER_API_KEY) {
  console.error("[briefing] OPENROUTER_API_KEY missing");
  process.exit(1);
}

/** Início do dia BRT (UTC-3 fixo) como ISO UTC + rótulo dd/mm. */
function startOfTodayBrt(): { startIso: string; label: string } {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 3600 * 1000);
  const y = brt.getUTCFullYear();
  const m = brt.getUTCMonth();
  const d = brt.getUTCDate();
  const startUtc = new Date(Date.UTC(y, m, d, 3, 0, 0));
  const label = `${String(d).padStart(2, "0")}/${String(m + 1).padStart(2, "0")}`;
  return { startIso: startUtc.toISOString(), label };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = ReturnType<typeof createClient<any, any, any>>;

/**
 * Resumo compacto do acerto por mercado: agrega TODAS as simulações
 * reconciliadas recentes (tier global) e mantém só mercados com amostra
 * decente (MIN_LEAGUE_CALLS). Falha ⇒ [] — o briefing sai sem a seção.
 */
async function fetchAccuracySummary(supabase: Admin): Promise<BriefingAccuracy[]> {
  try {
    const { data, error } = await supabase
      .from("fixture_simulations")
      .select(
        "league, sim_stats, p_home, p_draw, p_away, p_over_25, p_btts, " +
          "actual_home_goals, actual_away_goals, actual_corners_home, " +
          "actual_corners_away, actual_cards_home, actual_cards_away, " +
          "actual_sot_home, actual_sot_away, actual_btts, correct_winner",
      )
      .not("actual_home_goals", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error || !Array.isArray(data)) return [];
    const accs = marketAccuracies(data as unknown as AccuracyRow[], {
      tier: "global",
    });
    return accs
      .filter((a) => a.calls >= MIN_LEAGUE_CALLS)
      .map((a) => ({
        label: a.label,
        rate: a.rate,
        baseRate: a.baseRate,
        calls: a.calls,
      }));
  } catch (err) {
    console.error("[briefing] market accuracy falhou (segue sem):", err instanceof Error ? err.message : err);
    return [];
  }
}

async function main(): Promise<void> {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // Kill switch global de IA — desligado ⇒ sair limpo, sem gerar (não é erro).
  if (!(await isAiEnabled(supabase))) {
    console.log("[briefing] ai_enabled=false — briefing pulado (kill switch).");
    return;
  }

  const { startIso, label } = startOfTodayBrt();

  const { data: betRows, error: betErr } = await supabase
    .from("ai_recommendations")
    .select(
      "home_team, away_team, league, market, side, edge_pct, odd_captured, units_final, confidence, league_calibrated",
    )
    .eq("verdict", "bet")
    .gte("created_at", startIso)
    .order("edge_pct", { ascending: false })
    // Teto defensivo: num dia anômalo (ex.: dedup quebrado, B53 — razão
    // 2,12 recos/fixture) o prompt inflaria silenciosamente.
    .limit(30);
  if (betErr) {
    console.error("[briefing] query de bets falhou:", betErr.message);
    process.exit(1);
  }

  const { count: skipCount, error: skipErr } = await supabase
    .from("ai_recommendations")
    .select("id", { count: "exact", head: true })
    .eq("verdict", "skip")
    .gte("created_at", startIso);
  if (skipErr) {
    console.error("[briefing] query de skips falhou:", skipErr.message);
    process.exit(1);
  }

  const bets: BriefingBet[] = (betRows ?? []).map((r) => ({
    homeTeam: String(r.home_team ?? ""),
    awayTeam: String(r.away_team ?? ""),
    league: r.league ?? null,
    market: r.market ?? null,
    side: r.side ?? null,
    edgePct: typeof r.edge_pct === "number" ? r.edge_pct : r.edge_pct != null ? Number(r.edge_pct) : null,
    oddCaptured: typeof r.odd_captured === "number" ? r.odd_captured : r.odd_captured != null ? Number(r.odd_captured) : null,
    unitsFinal: typeof r.units_final === "number" ? r.units_final : r.units_final != null ? Number(r.units_final) : null,
    confidence: r.confidence ?? null,
    leagueCalibrated: r.league_calibrated === true,
  }));

  const accuracies = await fetchAccuracySummary(supabase);
  const prompt = composeBriefingPrompt({
    dateLabel: label,
    bets,
    skipCount: skipCount ?? 0,
    accuracies,
  });

  const t0 = Date.now();
  const resp = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://abissal.rnobre.dev",
      "X-Title": "Abissal",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      max_tokens: 800,
      temperature: 0.4,
    }),
  });
  const latencyMs = Date.now() - t0;

  if (!resp.ok) {
    const body = await resp.text().catch(() => "<no body>");
    await recordLlmRequest(supabase, {
      route: "briefing",
      model: MODEL,
      latency_ms: latencyMs,
      error: `HTTP ${resp.status}: ${body.slice(0, 300)}`,
    });
    console.error(`[briefing] OpenRouter HTTP ${resp.status}: ${body.slice(0, 500)}`);
    process.exit(1);
  }

  const body = await resp.json();
  const rawContent: string = body?.choices?.[0]?.message?.content ?? "";
  const usage = body?.usage ?? {};
  const promptTokens = Number(usage.prompt_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? 0);

  const text = parseBriefingText(rawContent);

  await recordLlmRequest(supabase, {
    route: "briefing",
    model: MODEL,
    latency_ms: latencyMs,
    prompt_tokens: promptTokens || null,
    completion_tokens: completionTokens || null,
    total_tokens: Number(usage.total_tokens ?? 0) || null,
    cost_usd: computeCostUsd(MODEL, promptTokens, completionTokens) || null,
    error: text ? null : "briefing parse failed (empty/short/garbled)",
  });

  if (!text) {
    console.error("[briefing] resposta inutilizável do LLM:", rawContent.slice(0, 300));
    process.exit(1);
  }

  const value = buildBriefingValue({
    date: brtDateIso(),
    text,
    model: MODEL,
    nBets: bets.length,
    nSkips: skipCount ?? 0,
  });

  const { error: upsertErr } = await supabase.from("app_settings").upsert(
    {
      key: DAILY_BRIEFING_KEY,
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (upsertErr) {
    console.error("[briefing] upsert em app_settings falhou:", upsertErr.message);
    process.exit(1);
  }

  console.log(
    `[briefing] gerado (${label}): ${bets.length} bet(s), ${skipCount ?? 0} skip(s), ` +
      `${text.split(/\s+/).length} palavras, ${latencyMs}ms.`,
  );
}

main().catch((err) => {
  console.error("[briefing] erro inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
