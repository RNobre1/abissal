import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reader for the `ai_recommendations` table (migration 0022).
 *
 * Scalar-only / Worker constraint (B12/B14/outage 1101): every `.select(...)`
 * literal in this file is statically scanned by
 * `lib/fixtures/repository-payload-guard.test.ts` (globs every
 * `lib/**\/*repository*.ts`). It must NOT reference the heavy `detail_json`
 * blob in any form. `ai_recommendations` does not itself store `detail_json`,
 * but the convention is enforced uniformly across every repository reader.
 *
 * Defensive shape mirrors `lib/fixtures/simulation-repository.ts`:
 * - every failure path (table absent, transient client error, malformed row)
 *   degrades to `null` (single) or `[]` (list) instead of throwing;
 * - `red_flags` jsonb is coerced through `asArray` so non-array values become
 *   `[]` without crashing the page.
 *
 * Spec: docs/superpowers/specs/2026-05-24-ai-recomendador-design.md §4, §7.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any> | any;

export type AiVerdict = "bet" | "skip";
export type AiConfidence = "alto" | "medio" | "baixo";

/**
 * Confidence weights for the dashboard "oportunidades IA" ranking
 * (spec §7.3). Used to compute `edge_pct * weight` for sorting candidates by
 * expected value adjusted for the model's self-reported confidence.
 */
const CONFIDENCE_WEIGHTS: Record<AiConfidence, number> = {
  alto: 1.0,
  medio: 0.7,
  baixo: 0.4,
};

/**
 * Exact column list - inlined into the `.select(...)` call below so the
 * static payload guard can see the literal. Scalars + the small jsonb
 * `red_flags` array (which IS the data itself, not a heavy blob).
 */
const COLUMNS =
  "id, created_at, fixture_id, home_team, away_team, league, " +
  "kickoff_utc, reco_version, prompt_version, llm_model, verdict, " +
  "market, side, prob_estimated, prob_calibrated, edge_pct, " +
  "odd_captured, kelly_pre, units_final, reduction_reason, confidence, " +
  "summary_line, reasoning_full, red_flags, cost_usd, league_calibrated";

export interface AiRecommendationDTO {
  id: number;
  created_at: string | null;
  fixture_id: number | null;
  home_team: string;
  away_team: string;
  league: string | null;
  kickoff_utc: string | null;
  reco_version: string | null;
  prompt_version: string | null;
  llm_model: string | null;
  verdict: AiVerdict;
  market: string | null;
  side: string | null;
  prob_estimated: number | null;
  prob_calibrated: number | null;
  edge_pct: number | null;
  odd_captured: number | null;
  kelly_pre: number | null;
  units_final: number | null;
  reduction_reason: string | null;
  confidence: AiConfidence | null;
  summary_line: string | null;
  reasoning_full: string | null;
  red_flags: string[];
  cost_usd: number | null;
  league_calibrated: boolean;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    // Supabase returns numeric columns as strings via PostgREST sometimes.
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return v.length > 0 ? v : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function asVerdict(v: unknown): AiVerdict {
  return v === "skip" ? "skip" : "bet";
}

function asConfidence(v: unknown): AiConfidence | null {
  if (v === "alto" || v === "medio" || v === "baixo") return v;
  return null;
}

function mapRow(row: Record<string, unknown>): AiRecommendationDTO {
  return {
    id: Number(row.id),
    created_at: str(row.created_at),
    fixture_id: row.fixture_id == null ? null : Number(row.fixture_id),
    home_team: String(row.home_team ?? ""),
    away_team: String(row.away_team ?? ""),
    league: str(row.league),
    kickoff_utc: str(row.kickoff_utc),
    reco_version: str(row.reco_version),
    prompt_version: str(row.prompt_version),
    llm_model: str(row.llm_model),
    verdict: asVerdict(row.verdict),
    market: str(row.market),
    side: str(row.side),
    prob_estimated: num(row.prob_estimated),
    prob_calibrated: num(row.prob_calibrated),
    edge_pct: num(row.edge_pct),
    odd_captured: num(row.odd_captured),
    kelly_pre: num(row.kelly_pre),
    units_final: num(row.units_final),
    reduction_reason: str(row.reduction_reason),
    confidence: asConfidence(row.confidence),
    summary_line: str(row.summary_line),
    reasoning_full: str(row.reasoning_full),
    red_flags: asStringArray(row.red_flags),
    cost_usd: num(row.cost_usd),
    league_calibrated: row.league_calibrated === true,
  };
}

/**
 * Returns the latest recommendation for a given fixture (by the choistats
 * numeric id stored in `ai_recommendations.fixture_id`). Picks the most
 * recent `created_at` so re-runs of the recommender don't shadow each other.
 *
 * Never throws: table-missing / transient error / null row all degrade to
 * `null` so the fixture page renders the "pedir analise IA" call-to-action
 * instead of crashing.
 */
export async function getRecommendationForFixture(
  fixtureId: number,
  supabase: AnySupabase,
): Promise<AiRecommendationDTO | null> {
  try {
    const { data, error } = await supabase
      .from("ai_recommendations")
      .select(COLUMNS)
      .eq("fixture_id", fixtureId)
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return mapRow(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * Returns the top N "bet" recommendations whose kickoff is still in the
 * future, ordered by `edge_pct * confidence_weight` descending.
 *
 * We over-fetch (limit * 3) and re-rank in memory because Postgres can't
 * trivially apply the case-based weight in a single ORDER BY without an
 * extra computed column. Cap is small (default 5) so this is cheap.
 *
 * Never throws: table-missing / transient error / no rows all degrade to
 * `[]` so the dashboard renders a graceful empty state.
 */
export async function fetchTopOpportunities(
  supabase: AnySupabase,
  limit: number = 5,
): Promise<AiRecommendationDTO[]> {
  try {
    const overFetch = Math.max(limit * 3, limit);
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("ai_recommendations")
      .select(COLUMNS)
      .eq("verdict", "bet")
      .gt("kickoff_utc", nowIso)
      .order("kickoff_utc", { ascending: true, nullsFirst: false })
      .limit(overFetch);
    if (error || !data || !Array.isArray(data)) return [];

    const dtos = (data as Array<Record<string, unknown>>).map(mapRow);
    const scored = dtos.map((dto) => ({
      dto,
      score:
        (dto.edge_pct ?? 0) *
        CONFIDENCE_WEIGHTS[dto.confidence ?? "baixo"],
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.dto);
  } catch {
    return [];
  }
}
