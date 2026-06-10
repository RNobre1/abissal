/**
 * GET /api/calibracao/secondary-metrics
 *
 * Returns secondary calibration metrics for fixture simulations:
 * - btts_brier: Brier score for BTTS forecasts (p_btts vs actual_btts)
 * - corners_crps: Mean CRPS for corners distribution (null until data available)
 * - cards_crps: Mean CRPS for cards distribution (null until data available)
 * - sot_crps: Mean CRPS for shots-on-target distribution (null until data available)
 * - n: total resolved simulations used
 * - n_btts: simulations with BTTS data
 * - n_secondary: simulations with secondary actuals (corners/cards/SOT)
 *
 * NOTE: corners_crps, cards_crps, sot_crps will be null until the choistats
 * reconciler finds a data source for per-fixture match stats. The actual_corners_*,
 * actual_cards_*, actual_sot_* columns are wired but unfilled.
 *
 * Auth: requires an authenticated Supabase session (401 otherwise). The DB
 * query uses the admin client (service-role) after the session gate passes.
 * fixture_simulations has service_role-only RLS on writes; reads here are via
 * the admin bypass because the route is server-only and behind the auth gate.
 * Consumers are the /calibracao panels — all behind login, zero functional impact.
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  bttsBrier,
  cornersCrps,
  cardsCrps,
  sotCrps,
  type ResolvedSimRowSecondary,
} from "@/lib/calibracao/sim-reliability";
import { NextResponse } from "next/server";

// Always fresh — calibration changes after each scrape+reconcile run.
export const dynamic = "force-dynamic";

interface SecondaryMetricsRow {
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  p_over_25: number | null;
  p_btts: number | null;
  market_anchor: unknown;
  league: string | null;
  actual_home_goals: number | null;
  actual_away_goals: number | null;
  actual_resolved_at: string | null;
  actual_btts: boolean | null;
  actual_corners_home: number | null;
  actual_corners_away: number | null;
  actual_cards_home: number | null;
  actual_cards_away: number | null;
  actual_sot_home: number | null;
  actual_sot_away: number | null;
  sim_stats: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

export async function GET(): Promise<NextResponse> {
  // ---------------------------------------------------------------------------
  // Auth gate — consumers are the /calibracao panels, all behind login.
  // Mirrors the pattern in /api/ai-reco/compute and /api/ai-reco/feedback.
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

  try {
    const supabase = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = supabase as unknown as { from: (t: string) => any };

    const { data, error } = await client
      .from("fixture_simulations")
      .select(
        "p_home, p_draw, p_away, p_over_25, p_btts, market_anchor, league, " +
        "actual_home_goals, actual_away_goals, actual_resolved_at, " +
        "actual_btts, actual_corners_home, actual_corners_away, " +
        "actual_cards_home, actual_cards_away, " +
        "actual_sot_home, actual_sot_away, sim_stats",
      )
      .eq("status", "resolved")
      .order("actual_resolved_at", { ascending: false })
      .limit(5000);

    if (error) {
      console.error("[secondary-metrics] query failed:", error);
      return NextResponse.json({ error: "DB query failed" }, { status: 500 });
    }

    const rows = (data ?? []) as SecondaryMetricsRow[];

    // Cast to ResolvedSimRowSecondary (compatible shape)
    const typedRows = rows as unknown as ResolvedSimRowSecondary[];

    const btts = bttsBrier(typedRows);
    const corners = cornersCrps(typedRows);
    const cards = cardsCrps(typedRows);
    const sot = sotCrps(typedRows);

    const nBtts = rows.filter(
      (r) => r.p_btts != null && (r.actual_btts != null || (r.actual_home_goals != null && r.actual_away_goals != null)),
    ).length;

    const nSecondary = rows.filter(
      (r) => r.actual_corners_home != null || r.actual_sot_home != null || r.actual_cards_home != null,
    ).length;

    return NextResponse.json({
      n: rows.length,
      n_btts: nBtts,
      n_secondary: nSecondary,
      btts_brier: btts,
      corners_crps: corners,
      cards_crps: cards,
      sot_crps: sot,
      data_availability: {
        btts: "available — derived from goals (homeGoalsFt/awayGoalsFt)",
        corners: "blocked — choistats recent-results widget does not expose corners for reconciled fixture",
        cards: "blocked — same as corners",
        sot: "blocked — same as corners",
        note: "See CLAUDE.md Lesson Wave G 2026-05-25 for investigation details",
      },
    });
  } catch (err) {
    console.error("[secondary-metrics] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
