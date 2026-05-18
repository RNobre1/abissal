import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reader for the `fixture_simulations` table (migration 0018, created by T2
 * in parallel — this module MOCKS records of that exact shape).
 *
 * Scalar-only / Worker constraint (B12/B14/outage 1101): the Cloudflare
 * Worker isolate crashes (Error 1101) when a query pulls the heavy
 * `fixtures.detail_json` blob. `fixture_simulations` is a SEPARATE table
 * whose jsonb fields (`top_scorelines`, `sim_stats`, `market_anchor`,
 * `player_events`) ARE the small pre-computed simulation result itself —
 * selecting them is fine and intentional. What is forbidden is ever
 * referencing `detail_json`. The static guard (T5,
 * `repository-payload-guard.test.ts`) will scan this file's `.select(...)`
 * literal — it must contain no `detail_json` token at all.
 *
 * Defensive like `lib/fixtures/repository.ts`: every failure path
 * (table/migration absent, transient error, malformed row) degrades to
 * `null` instead of crashing the stats page.
 */

/**
 * Exact column list — scalars + the small jsonb simulation-result fields.
 * Inlined into the `.select(...)` call below so the static payload guard
 * (T5) can see the literal; it must never contain `detail_json`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any> | any;

export interface SimScoreline {
  score: string;
  prob: number;
}

/** Per-metric scalar summary (p10/p50/p90) per team/half. */
export type SimStatMetric = Record<string, number>;
export type SimTeamStats = Record<string, SimStatMetric>;
export interface SimStats {
  home: SimTeamStats;
  away: SimTeamStats;
}

export interface SimPlayerEvent {
  id?: string | number;
  name: string;
  p_goal: number;
  expected_goals: number;
  p_card: number;
  p_sot: number;
  provavel_titular: boolean;
  confidence: "baixo" | "médio" | "alto" | string;
}

export type SimMarketAnchor = Record<string, unknown>;

export type SimStatus =
  | "simulated"
  | "unsimulable"
  | "pending"
  | "resolved"
  | string;

export interface FixtureSimulationDTO {
  id: number;
  created_at: string | null;
  fixture_id: number | null;
  home_team: string;
  away_team: string;
  league: string | null;
  kickoff_utc: string | null;
  model_version: string | null;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  p_btts: number | null;
  p_over_25: number | null;
  top_scorelines: SimScoreline[];
  sim_stats: SimStats | null;
  per_half_available: boolean;
  market_anchor: SimMarketAnchor | null;
  player_events: SimPlayerEvent[];
  status: SimStatus;
  actual_home_goals: number | null;
  actual_away_goals: number | null;
  correct_winner: boolean | null;
  correct_over_under: boolean | null;
  actual_resolved_at: string | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function mapRow(row: Record<string, unknown>): FixtureSimulationDTO {
  return {
    id: Number(row.id),
    created_at: (row.created_at as string | null) ?? null,
    fixture_id:
      row.fixture_id == null ? null : Number(row.fixture_id),
    home_team: String(row.home_team ?? ""),
    away_team: String(row.away_team ?? ""),
    league: (row.league as string | null) ?? null,
    kickoff_utc: (row.kickoff_utc as string | null) ?? null,
    model_version: (row.model_version as string | null) ?? null,
    p_home: num(row.p_home),
    p_draw: num(row.p_draw),
    p_away: num(row.p_away),
    p_btts: num(row.p_btts),
    p_over_25: num(row.p_over_25),
    top_scorelines: asArray<SimScoreline>(row.top_scorelines),
    sim_stats:
      row.sim_stats && typeof row.sim_stats === "object"
        ? (row.sim_stats as SimStats)
        : null,
    per_half_available: row.per_half_available === true,
    market_anchor:
      row.market_anchor && typeof row.market_anchor === "object"
        ? (row.market_anchor as SimMarketAnchor)
        : null,
    player_events: asArray<SimPlayerEvent>(row.player_events),
    status: String(row.status ?? "pending"),
    actual_home_goals: num(row.actual_home_goals),
    actual_away_goals: num(row.actual_away_goals),
    correct_winner:
      typeof row.correct_winner === "boolean" ? row.correct_winner : null,
    correct_over_under:
      typeof row.correct_over_under === "boolean"
        ? row.correct_over_under
        : null,
    actual_resolved_at: (row.actual_resolved_at as string | null) ?? null,
  };
}

/**
 * Fetches the pre-computed simulation for a fixture. Returns `null` (never
 * throws) when there is no row, the query errors, or the table/migration is
 * not yet applied — the dashboard treats `null` as "simulação indisponível".
 */
export async function getFixtureSimulation(
  fixtureId: number,
  supabase: AnySupabase,
): Promise<FixtureSimulationDTO | null> {
  try {
    const { data, error } = await supabase
      .from("fixture_simulations")
      .select(
        "id, created_at, fixture_id, home_team, away_team, league, " +
          "kickoff_utc, model_version, p_home, p_draw, p_away, p_btts, " +
          "p_over_25, top_scorelines, sim_stats, per_half_available, " +
          "market_anchor, player_events, status, actual_home_goals, " +
          "actual_away_goals, correct_winner, correct_over_under, " +
          "actual_resolved_at",
      )
      .eq("fixture_id", fixtureId)
      .maybeSingle();

    if (error || !data) return null;
    return mapRow(data as Record<string, unknown>);
  } catch {
    // Table/migration absent or transient client error → graceful null.
    return null;
  }
}
