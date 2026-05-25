import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
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
import {
  getActiveCurves,
  type ActiveCurves,
} from "@/lib/calibracao/active-curves-repository";
import { applyIsotonic } from "@/lib/calibracao/isotonic";
import { getFixtureSimulation } from "@/lib/fixtures/simulation-repository";

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
 *   7. Build edge table, filter `edge_pct >= 5`.
 *   8. If no candidates → persist `verdict='skip'` and return 200 (no IA call).
 *   9. Else → buildPrompt → runRecommender → persist both `llm_request_logs`
 *      and `ai_recommendations` rows.
 *  10. Return { decision, reco_id, logId, costUsd, latencyMs }.
 *
 * Auth: matches sibling routes (`/api/fixtures/[id]/refresh`) —
 * service-role admin client, no per-request session gate (single-user app).
 *
 * Spec: docs/superpowers/specs/2026-05-24-ai-recomendador-design.md §4.3
 *       docs/superpowers/plans/2026-05-24-ai-recomendador-plan.md Wave 3
 */

export const maxDuration = 100;

const RECO_VERSION = "reco-v1";
const ROUTE_LABEL = "ai-reco-on-demand";
const EDGE_THRESHOLD_PCT = 5.0;
const DEFAULT_BANKROLL = 1000.0;

const bodySchema = z.object({
  fixtureId: z.number().int().positive(),
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
  const { fixtureId } = parsed;

  // ---------------------------------------------------------------------------
  // 2. Admin client + fixture lookup
  // ---------------------------------------------------------------------------
  const supabase = createAdminClient() as AnySupabase;

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
      { error: "sim or odds missing" },
      { status: 400 },
    );
  }

  const odds = extractOdds(fixture.detail_json);
  if (!odds) {
    return NextResponse.json(
      { error: "sim or odds missing" },
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

  // ---------------------------------------------------------------------------
  // 6. League calibrated detection
  // ---------------------------------------------------------------------------
  const leagueCalibrated = await isLeagueCalibrated(fixture.league, supabase);

  // ---------------------------------------------------------------------------
  // 7. Edge table + candidate filter
  // ---------------------------------------------------------------------------
  const allCandidates = buildEdgeTable(simInput, odds, bankroll, {
    isotonicLookup,
  });
  const betCandidates = allCandidates.filter(
    (c) => c.edge_pct >= EDGE_THRESHOLD_PCT,
  );

  // ---------------------------------------------------------------------------
  // 8. Skip path — no IA call needed
  // ---------------------------------------------------------------------------
  if (betCandidates.length === 0) {
    const recoId = await persistSkip({
      supabase,
      fixture,
      allCandidates,
      leagueCalibrated,
    });

    const skipDecision: AiDecision = {
      verdict: "skip",
      confidence: "baixo",
      reasoning: "Nenhum mercado com valor; skip.",
      summary_line: "Nenhum candidato com edge >= 5%",
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

  // ---------------------------------------------------------------------------
  // 9. IA call — requires OPENROUTER_API_KEY
  // ---------------------------------------------------------------------------
  if (!env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not configured" },
      { status: 503 },
    );
  }

  const model = env.OPENROUTER_MODEL || "deepseek/deepseek-r1";

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
    fixtureId,
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
    allCandidates,
    leagueCalibrated,
    decision,
    model,
    logId,
    cost,
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
 * Extracts the 7 markets (1X2, OVER_UNDER_2_5, BTTS) from `detail_json.odds`.
 * Mirrors `AiRecommenderRunner#extract_odds` (Ruby). Returns `null` when
 * `detail_json` is missing/malformed or no markets are present.
 */
function extractOdds(detailJson: Record<string, unknown> | null): OddsInput | null {
  if (!detailJson || typeof detailJson !== "object") return null;
  const oddsRootRaw =
    (detailJson as Record<string, unknown>).odds ??
    (detailJson as Record<string, unknown>).odds_summary;
  if (!oddsRootRaw || typeof oddsRootRaw !== "object") return null;
  const oddsRoot = oddsRootRaw as Record<string, Record<string, Record<string, unknown>>>;

  const out: OddsInput = {
    home: digAvg(oddsRoot, "1X2", "1"),
    draw: digAvg(oddsRoot, "1X2", "X"),
    away: digAvg(oddsRoot, "1X2", "2"),
    over25: digAvg(oddsRoot, "OVER_UNDER_2_5", "OVER"),
    under25: digAvg(oddsRoot, "OVER_UNDER_2_5", "UNDER"),
    btts_sim: digAvg(oddsRoot, "BTTS", "YES"),
    btts_nao: digAvg(oddsRoot, "BTTS", "NO"),
  };

  const allMissing = Object.values(out).every((v) => v == null);
  return allMissing ? null : out;
}

function digAvg(
  root: Record<string, Record<string, Record<string, unknown>>>,
  market: string,
  side: string,
): number | null {
  const node = root[market]?.[side];
  if (!node || typeof node !== "object") return null;
  const v = (node as Record<string, unknown>).average;
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
async function buildIsotonicLookup(
  modelVersion: string | null,
  supabase: AnySupabase,
): Promise<Partial<Record<string, (p: number) => number>>> {
  if (!modelVersion) return {};
  const { curves } = await getActiveCurves(modelVersion, supabase);
  const lookup: Partial<Record<string, (p: number) => number>> = {};
  if (curves.oneX2Home) {
    lookup["1x2-home"] = (p: number) =>
      applyIsotonic(curves.oneX2Home as Array<[number, number]>, p);
  }
  if (curves.draw) {
    lookup["1x2-draw"] = (p: number) =>
      applyIsotonic(curves.draw as Array<[number, number]>, p);
  }
  if (curves.away) {
    lookup["1x2-away"] = (p: number) =>
      applyIsotonic(curves.away as Array<[number, number]>, p);
  }
  if (curves.over25) {
    lookup["over25"] = (p: number) =>
      applyIsotonic(curves.over25 as Array<[number, number]>, p);
  }
  void (null as unknown as ActiveCurves);
  return lookup;
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
  allCandidates: EdgeCandidate[];
  leagueCalibrated: boolean;
}): Promise<number | null> {
  try {
    const { data, error } = await args.supabase
      .from("ai_recommendations")
      .insert({
        fixture_id: args.fixture.id,
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
        summary_line: "Nenhum candidato com edge >= 5%",
        reasoning_full: "Nenhum mercado com valor; skip.",
        red_flags: [],
        cost_usd: 0,
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
  allCandidates: EdgeCandidate[];
  leagueCalibrated: boolean;
  decision: AiDecision;
  model: string;
  logId: number | null;
  cost: number;
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
        fixture_id: args.fixture.id,
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
