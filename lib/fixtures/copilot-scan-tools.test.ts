import { describe, it, expect } from "vitest";
import { computeFixtureSignals, type FixtureRowLite } from "./copilot-scan-tools";

function rmMatch(o: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: 1, date: 0, date_iso: "2026-05-01", status: "FT", league: "L",
    home_team: "Alpha", away_team: "Z", result: "W", htResult: "W",
    homeGoalsFt: 2, awayGoalsFt: 1, homeGoalsHt: 1, awayGoalsHt: 0,
    homeYellows: 2, awayYellows: 3, homeReds: 0, awayReds: 0,
    homeYellowReds: 0, awayYellowReds: 0, homeBookingPoints: 20,
    awayBookingPoints: 30, homeTotalShots: 10, awayTotalShots: 8,
    homeShotsOnTarget: 5, awayShotsOnTarget: 3, homeCorners: 6,
    awayCorners: 4, homeCorners1h: 3, awayCorners1h: 2, homeCorners2h: 3,
    awayCorners2h: 2, homeFouls: 10, awayFouls: 11, homeOffsides: 1,
    awayOffsides: 2, homeTackles: 15, awayTackles: 14, ...o,
  };
}

const FULL_DETAIL = {
  team_record: {
    home: { type: "Home", played: 5, won: 3, draw: 1, lost: 1 },
    away: { type: "Away", played: 5, won: 1, draw: 2, lost: 2 },
  },
  recent_matches: {
    home: [rmMatch({}), rmMatch({ homeGoalsFt: 0, awayGoalsFt: 0, homeGoalsHt: 0, awayGoalsHt: 0 })],
    away: [rmMatch({ home_team: "Beta", away_team: "Alpha", homeGoalsFt: 1, awayGoalsFt: 2 })],
  },
  streaks: {
    home: [{ desc: "Over 2.5 nos últimos 6", group: "Goals", overall_perc: 80 }],
    away: [],
  },
  referee_record: { name: "Ref", completed: 10, fixtures_count: 10, avg_total_booking_points: 48, avg_home_booking_points: 24, avg_away_booking_points: 24, total_yellow_reds: 1 },
  odds_summary: { "Match Result": { Home: { bookmaker: "bk", decimal_odds: 1.8 }, Draw: { bookmaker: "bk", decimal_odds: 3.4 }, Away: { bookmaker: "bk", decimal_odds: 4.5 } } },
  predictions: [
    { stat_type: "Over 2.5 Goals", chance: 0.72, chance_team: null, best_odds: 1.7, best_odds_bookmaker: "bk", home_stats: [], away_stats: [] },
    { stat_type: "Win", chance: 0.55, chance_team: "Alpha", best_odds: 1.8, best_odds_bookmaker: "bk", home_stats: [], away_stats: [] },
  ],
  h2h: [
    { ...rmMatch({}), homeGoalsFt: 2, awayGoalsFt: 2 },
    { ...rmMatch({}), homeGoalsFt: 1, awayGoalsFt: 0 },
  ],
};

function baseRow(detail: unknown): FixtureRowLite {
  return {
    id: 7, match_date: "2026-05-16", ko_time: "20:00", home_team: "Alpha",
    away_team: "Beta", league: "Serie A", country: "brazil",
    source_url: null, kickoff_utc: "2026-05-16T23:00:00Z", detail_json: detail,
  };
}

import { scanFixtures } from "./copilot-scan-tools";
import type { ScanFixturesArgs } from "./copilot-scan-tools";

function buildAdmin(rows: unknown[]) {
  return {
    from(table: string) {
      if (table !== "fixtures") throw new Error(`unexpected table: ${table}`);
      const chain = {
        select() { return chain; },
        or() { return chain; },
        order() { return chain; },
        then(resolve: (v: { data: unknown[]; error: null }) => void) {
          resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
  };
}

describe("scanFixtures — core", () => {
  it("returns one entry per fixture with detail, excluding null-detail rows", async () => {
    const rows = [
      baseRow(FULL_DETAIL),
      { ...baseRow(null), id: 8 },
      { ...baseRow(FULL_DETAIL), id: 9, league: "Premier League", country: "england" },
    ];
    const res = await scanFixtures({ date: "2026-05-16" }, buildAdmin(rows));
    expect(res.date).toBe("2026-05-16");
    expect(res.total).toBe(2);
    expect(res.fixtures.map((f) => f.id).sort()).toEqual([7, 9]);
    expect(res.fixtures[0]).toMatchObject({ home_team: "Alpha", away_team: "Beta" });
    expect(res.fixtures[0].signals.cards.referee_avg_booking).toBe(48);
  });

  it("applies coarse league_substr / country pre-filters", async () => {
    const rows = [
      baseRow(FULL_DETAIL),
      { ...baseRow(FULL_DETAIL), id: 9, league: "Premier League", country: "england" },
    ];
    const r1 = await scanFixtures({ country: "england" }, buildAdmin(rows));
    expect(r1.fixtures.map((f) => f.id)).toEqual([9]);
    const r2 = await scanFixtures({ league_substr: "serie" }, buildAdmin(rows));
    expect(r2.fixtures.map((f) => f.id)).toEqual([7]);
  });
});

describe("scanFixtures — filter/sort/projection/limit", () => {
  const rows = [
    { ...baseRow(FULL_DETAIL), id: 1 },
    { ...baseRow({ ...FULL_DETAIL, referee_record: { ...FULL_DETAIL.referee_record, avg_total_booking_points: 20 } }), id: 2 },
  ];

  it("filters server-side by dotted field with gte", async () => {
    const args: ScanFixturesArgs = { filters: [{ field: "cards.referee_avg_booking", op: "gte", value: 40 }] };
    const res = await scanFixtures(args, buildAdmin(rows));
    expect(res.fixtures.map((f) => f.id)).toEqual([1]);
    expect(res.total).toBe(1);
  });

  it("sorts by dotted field desc and respects limit", async () => {
    const res = await scanFixtures({ sort: { field: "cards.referee_avg_booking", dir: "desc" }, limit: 1 }, buildAdmin(rows));
    expect(res.fixtures.map((f) => f.id)).toEqual([1]);
    expect(res.total).toBe(2);
  });

  it("projects only requested signal groups", async () => {
    const res = await scanFixtures({ signals: ["cards"] }, buildAdmin(rows));
    expect(Object.keys(res.fixtures[0].signals)).toEqual(["cards"]);
  });

  it("returns { error } for an unknown filter field", async () => {
    const res = await scanFixtures({ filters: [{ field: "nope.bad", op: "eq", value: 1 }] }, buildAdmin(rows));
    expect(res.error).toMatch(/campo inválido/);
  });

  it("filters with lte", async () => {
    const res = await scanFixtures({ filters: [{ field: "cards.referee_avg_booking", op: "lte", value: 25 }] }, buildAdmin(rows));
    expect(res.fixtures.map((f) => f.id)).toEqual([2]);
  });

  it("sorts asc", async () => {
    const res = await scanFixtures({ sort: { field: "cards.referee_avg_booking", dir: "asc" } }, buildAdmin(rows));
    expect(res.fixtures.map((f) => f.id)).toEqual([2, 1]);
  });

  it("returns { error } for an unknown sort field (no filters)", async () => {
    const res = await scanFixtures({ sort: { field: "bogus.x", dir: "desc" } }, buildAdmin(rows));
    expect(res.error).toMatch(/campo inválido/);
  });

  it("falls back to all signal groups when the requested group is unknown", async () => {
    const res = await scanFixtures({ signals: ["does_not_exist"] }, buildAdmin(rows));
    expect(Object.keys(res.fixtures[0].signals).sort()).toEqual(
      ["btts", "cards", "first_half", "form", "goals_over", "h2h", "odds"],
    );
  });
});

describe("computeFixtureSignals", () => {
  it("computes all 7 signal groups from a full detail_json", () => {
    const s = computeFixtureSignals(baseRow(FULL_DETAIL));
    expect(s.cards.referee_avg_booking).toBe(48);
    expect(typeof s.cards.home_avg_cards).toBe("number");
    expect(s.cards.badge_cartao_alto).toBe(true);
    expect(s.goals_over.home_over25_pct).toBeCloseTo(0.5);
    expect(s.goals_over.home_avg_total_goals).toBeCloseTo(1.5);
    expect(s.goals_over.away_avg_total_goals).toBeCloseTo(3);
    expect(s.btts.home_btts_pct).toBeCloseTo(0.5);
    expect(s.first_half.home_fh_goal_pct).toBeCloseTo(0.5);
    expect(s.form.home).toEqual({ w: 3, d: 1, l: 1, pts_recent: 10 });
    expect(s.form.away).toEqual({ w: 1, d: 2, l: 2, pts_recent: 5 });
    expect(s.form.home_streak).toBe("Over 2.5 nos últimos 6");
    expect(s.form.away_streak).toBeNull();
    expect(s.h2h).toEqual({ games: 2, avg_goals: 2.5 });
    expect(s.odds.categories.length).toBeGreaterThan(0);
    expect(s.odds.match_favorite).toBe("Home");
    expect(s.odds.adamchoi_pred).toBe("Over 2.5 Goals");
  });

  it("returns null inner values when source sections are absent (never throws)", () => {
    const s = computeFixtureSignals(baseRow({}));
    expect(s.cards.referee_avg_booking).toBeNull();
    expect(s.form.home).toBeNull();
    expect(s.h2h).toEqual({ games: 0, avg_goals: 0 });
    expect(s.odds.match_favorite).toBeNull();
    expect(s.odds.adamchoi_pred).toBeNull();
  });
});

import { SCAN_FIXTURES_TOOL, scanResultSummary } from "./copilot-scan-tools";
import { inspectFixture, INSPECT_FIXTURE_TOOL } from "./copilot-scan-tools";

function buildAdminById(byId: Record<number, unknown>) {
  return {
    from(table: string) {
      if (table !== "fixtures") throw new Error("unexpected table");
      let wanted: number | null = null;
      const chain = {
        select() { return chain; },
        eq(_col: string, id: number) { wanted = id; return chain; },
        maybeSingle() {
          const row = wanted !== null ? byId[wanted] ?? null : null;
          return Promise.resolve({ data: row, error: null });
        },
      };
      return chain;
    },
  };
}

describe("SCAN_FIXTURES_TOOL + summary", () => {
  it("exposes a function schema named scan_fixtures with the expected args", () => {
    expect(SCAN_FIXTURES_TOOL.function.name).toBe("scan_fixtures");
    const props = SCAN_FIXTURES_TOOL.function.parameters.properties as Record<string, unknown>;
    for (const k of ["date", "league_substr", "country", "filters", "sort", "signals", "limit"]) {
      expect(props[k]).toBeDefined();
    }
  });

  it("enumerates the symmetric goals_over fields (no avg_total_goals) in the description", () => {
    const desc = SCAN_FIXTURES_TOOL.function.description;
    expect(desc).toContain("goals_over.home_avg_total_goals");
    expect(desc).toContain("goals_over.away_avg_total_goals");
    expect(desc).not.toContain("goals_over.avg_total_goals");
  });

  it("summarizes a scan result compactly", () => {
    expect(scanResultSummary({ date: "2026-05-16", total: 12, fixtures: [{}, {}] })).toBe(
      "scan_fixtures: 2/12 (2026-05-16)",
    );
    expect(scanResultSummary({ error: "campo inválido: x" })).toBe("error: campo inválido: x");
  });

  it("returns String(result) for non-object input (parity with summarizeFixtureToolResult)", () => {
    expect(scanResultSummary(null)).toBe("null");
    expect(scanResultSummary(undefined)).toBe("undefined");
  });
});

describe("inspectFixture", () => {
  const admin = buildAdminById({
    7: { id: 7, home_team: "Alpha", away_team: "Beta", detail_json: FULL_DETAIL },
  });

  it("delegates to an A tool over the fixture's detail_json", async () => {
    const res = await inspectFixture({ fixture_id: 7, tool: "get_referee", tool_args: {} }, admin);
    expect((res as Record<string, unknown>).name).toBe("Ref");
  });

  it("returns { error } for a missing fixture", async () => {
    const res = await inspectFixture({ fixture_id: 999, tool: "get_referee" }, admin);
    expect((res as { error?: string }).error).toMatch(/não encontr/);
  });

  it("returns { error } when the fixture has no detail_json", async () => {
    const a2 = buildAdminById({ 8: { id: 8, home_team: "X", away_team: "Y", detail_json: null } });
    const res = await inspectFixture({ fixture_id: 8, tool: "get_referee" }, a2);
    expect((res as { error?: string }).error).toMatch(/sem detail/);
  });

  it("exposes a schema named inspect_fixture enumerating the 12 A tools", () => {
    expect(INSPECT_FIXTURE_TOOL.function.name).toBe("inspect_fixture");
    const toolProp = (INSPECT_FIXTURE_TOOL.function.parameters.properties as Record<string, { enum?: string[] }>).tool;
    expect(toolProp.enum).toContain("get_insights");
    expect(toolProp.enum?.length).toBe(12);
  });

  it("returns { error } when fixture_id is not a number", async () => {
    const res = await inspectFixture({ fixture_id: "7" as unknown as number, tool: "get_referee" }, admin);
    expect((res as { error?: string }).error).toMatch(/fixture_id obrigatório/);
  });
});
