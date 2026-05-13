import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  deriveTeamRecord,
  deriveRecentMatchStats,
  deriveSplits1h2h,
  deriveStreakIndex,
  derivePlayerRankings,
  deriveOddsCategories,
  deriveDistributions,
  deriveRadarAxes,
} from "./derive";
import type { DetailJson, NormalizedRecentMatch } from "./detail-json-types";

// ─── Fixture loader ─────────────────────────────────────────────────────

function loadFixture(name: string): DetailJson {
  const p = path.resolve(__dirname, "../../../tests/fixtures/detail-json", name);
  return JSON.parse(fs.readFileSync(p, "utf-8")) as DetailJson;
}

const epl = loadFixture("epl-chelsea-tottenham.json");
const serieB = loadFixture("brazil-serieB-noref.json");
const ligaMx = loadFixture("liga-mx-with-predictions.json");

// ─── deriveTeamRecord ───────────────────────────────────────────────────

describe("deriveTeamRecord", () => {
  it("returns null for null", () => {
    expect(deriveTeamRecord(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(deriveTeamRecord(undefined)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(deriveTeamRecord("nope")).toBeNull();
    expect(deriveTeamRecord(42)).toBeNull();
    expect(deriveTeamRecord([])).toBeNull();
  });

  it("parses EPL home side (Chelsea home + overall)", () => {
    const derived = deriveTeamRecord(epl.team_record.home);
    expect(derived).not.toBeNull();
    expect(derived!.split).toEqual(
      expect.objectContaining({
        type: "Home",
        played: 18,
        won: 6,
        draw: 5,
        lost: 7,
        points: 23,
        points_per_game: 1.3,
        position: 14,
      }),
    );
    expect(derived!.overall).toEqual(
      expect.objectContaining({ type: "All" }),
    );
  });

  it("parses EPL away side (Tottenham away + overall)", () => {
    const derived = deriveTeamRecord(epl.team_record.away);
    expect(derived).not.toBeNull();
    expect(derived!.split.type).toBe("Away");
    expect(derived!.overall.type).toBe("All");
  });

  it("reverts form array oldest→newest into newest-first", () => {
    // EPL Chelsea home split form raw = ["D","L","L","L","L"] (oldest first)
    const derived = deriveTeamRecord(epl.team_record.home)!;
    const rawForm = (epl.team_record.home as { home: { form: string[] } }).home
      .form;
    expect(derived.split.form).toEqual([...rawForm].reverse());
  });

  it("parses position ordinals: 9th → 9, 22nd → 22, 1st → 1, 3rd → 3", () => {
    const make = (position: string) => ({
      home: {
        type: "Home",
        played: 1,
        won: 1,
        draw: 0,
        lost: 0,
        goals_for: 1,
        goals_against: 0,
        goal_diff: 1,
        points: 3,
        points_per_game: 3,
        position,
        form: ["W"],
      },
      overall: {
        type: "All",
        played: 1,
        won: 1,
        draw: 0,
        lost: 0,
        goals_for: 1,
        goals_against: 0,
        goal_diff: 1,
        points: 3,
        points_per_game: 3,
        position,
        form: ["W"],
      },
    });
    expect(deriveTeamRecord(make("9th"))!.split.position).toBe(9);
    expect(deriveTeamRecord(make("22nd"))!.split.position).toBe(22);
    expect(deriveTeamRecord(make("1st"))!.split.position).toBe(1);
    expect(deriveTeamRecord(make("3rd"))!.split.position).toBe(3);
    expect(deriveTeamRecord(make("nonsense"))!.split.position).toBeNull();
  });

  it("returns position=null when raw position is missing", () => {
    const input = {
      home: { played: 5, form: [] },
      overall: { played: 5, form: [] },
    };
    const derived = deriveTeamRecord(input)!;
    expect(derived.split.position).toBeNull();
    expect(derived.overall.position).toBeNull();
  });

  it("handles split with no form array gracefully", () => {
    const input = {
      home: { played: 0 },
      overall: { played: 0 },
    };
    const derived = deriveTeamRecord(input)!;
    expect(derived.split.form).toEqual([]);
  });

  it("returns null when neither split nor overall exists", () => {
    expect(deriveTeamRecord({})).toBeNull();
  });

  it("uses away split when present (instead of home)", () => {
    const input = {
      away: { type: "Away", played: 3, form: ["W", "L"] },
      overall: { type: "All", played: 6 },
    };
    const derived = deriveTeamRecord(input)!;
    expect(derived.split.type).toBe("Away");
    expect(derived.split.played).toBe(3);
  });
});

// ─── deriveRecentMatchStats ─────────────────────────────────────────────

describe("deriveRecentMatchStats", () => {
  it("returns [] for null/undefined", () => {
    expect(deriveRecentMatchStats(null, [], "X")).toEqual([]);
    expect(deriveRecentMatchStats(undefined, [], "X")).toEqual([]);
  });

  it("returns [] for empty array input", () => {
    expect(deriveRecentMatchStats([], [], "X")).toEqual([]);
  });

  it("normalizes up to 10 home matches for Chelsea", () => {
    const home = epl.recent_matches.home;
    const out = deriveRecentMatchStats(home, [], "Chelsea");
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.length).toBeLessThanOrEqual(10);
  });

  it("marks is_home correctly from home_team field", () => {
    const fakeMatches = [
      {
        id: 1,
        date_iso: "2026-01-01",
        status: "FT",
        home_team: "Chelsea",
        away_team: "Liverpool",
        homeGoalsFt: 2,
        awayGoalsFt: 1,
        homeGoalsHt: 1,
        awayGoalsHt: 0,
        homeCorners: 5,
        awayCorners: 3,
        homeYellows: 1,
        awayYellows: 2,
        homeReds: 0,
        awayReds: 0,
        homeBookingPoints: 10,
        awayBookingPoints: 20,
        homeShotsOnTarget: 4,
        awayShotsOnTarget: 2,
        homeTotalShots: 12,
        awayTotalShots: 8,
        homeFouls: 9,
        awayFouls: 7,
        homeOffsides: 1,
        awayOffsides: 0,
        homeTackles: 18,
        awayTackles: 14,
        homeCorners1h: 2,
        awayCorners1h: 1,
        homeCorners2h: 3,
        awayCorners2h: 2,
        homeYellowReds: 0,
        awayYellowReds: 0,
        league: "X",
        result: "W",
        htResult: "W",
      },
    ];
    const out = deriveRecentMatchStats(fakeMatches, [], "Chelsea");
    expect(out[0].is_home).toBe(true);
    const out2 = deriveRecentMatchStats(fakeMatches, [], "Liverpool");
    expect(out2[0].is_home).toBe(false);
  });

  it("preserves 1H and 2H goals splits", () => {
    const m = {
      id: 9,
      date_iso: "2026-02-01",
      status: "FT",
      home_team: "T",
      away_team: "U",
      homeGoalsHt: 1,
      awayGoalsHt: 0,
      homeGoalsFt: 3,
      awayGoalsFt: 1,
    };
    const out = deriveRecentMatchStats([m], [], "T");
    expect(out[0].goals_1h_for).toBe(1); // T was home, scored 1 1H
    expect(out[0].goals_1h_against).toBe(0);
    expect(out[0].goals_2h_for).toBe(2); // 3 - 1 = 2
    expect(out[0].goals_2h_against).toBe(1); // 1 - 0
  });

  it("preserves corners 1H/2H splits", () => {
    const m = {
      id: 10,
      date_iso: "2026-02-01",
      status: "FT",
      home_team: "T",
      away_team: "U",
      homeCorners1h: 2,
      homeCorners2h: 4,
      awayCorners1h: 1,
      awayCorners2h: 3,
    };
    const out = deriveRecentMatchStats([m], [], "T");
    expect(out[0].corners_1h_for).toBe(2);
    expect(out[0].corners_2h_for).toBe(4);
    expect(out[0].corners_1h_against).toBe(1);
    expect(out[0].corners_2h_against).toBe(3);
  });

  it("filters status !== FT silently", () => {
    const matches = [
      { id: 1, status: "FT", home_team: "T", away_team: "U" },
      { id: 2, status: "POSTPONED", home_team: "T", away_team: "V" },
      { id: 3, status: "Sched", home_team: "T", away_team: "W" },
    ];
    const out = deriveRecentMatchStats(matches, [], "T");
    expect(out.length).toBe(1);
    expect(out[0].id).toBe(1);
  });

  it("accepts {home, away} buckets and merges by perspective team", () => {
    // when raw is a recent_matches object with home/away buckets,
    // we should pick the bucket matching the perspectiveTeam side
    const home = [
      {
        id: 1,
        status: "FT",
        home_team: "Chelsea",
        away_team: "X",
        homeGoalsFt: 1,
        awayGoalsFt: 0,
      },
    ];
    const out = deriveRecentMatchStats(home, [], "Chelsea");
    expect(out[0].opponent).toBe("X");
  });

  it("handles null homeCorners1h gracefully (older H2H rows)", () => {
    const m = {
      id: 1,
      status: "FT",
      home_team: "T",
      away_team: "U",
      homeCorners1h: null,
      homeCorners2h: null,
    };
    const out = deriveRecentMatchStats([m], [], "T");
    expect(out[0].corners_1h_for).toBeNull();
  });
});

// ─── deriveSplits1h2h ───────────────────────────────────────────────────

describe("deriveSplits1h2h", () => {
  it("returns zero-filled averages for empty input", () => {
    const out = deriveSplits1h2h([]);
    expect(out.goals_1h_avg).toBe(0);
    expect(out.goals_2h_avg).toBe(0);
    expect(out.corners_1h_avg).toBe(0);
    expect(out.corners_2h_avg).toBe(0);
    expect(out.cards_1h_avg).toBe(0);
    expect(out.cards_2h_avg).toBe(0);
    expect(out.sot_for_avg).toBe(0);
  });

  it("computes 1H vs 2H goals averages correctly", () => {
    const normalized: NormalizedRecentMatch[] = [
      {
        id: 1,
        date_iso: "2026-01-01",
        opponent: "X",
        is_home: true,
        result: null,
        goals_1h_for: 1,
        goals_2h_for: 2,
        goals_1h_against: 0,
        goals_2h_against: 1,
        goals_ft_for: 3,
        goals_ft_against: 1,
        corners_1h_for: 2,
        corners_2h_for: 4,
        corners_1h_against: 1,
        corners_2h_against: 3,
        corners_for: 6,
        corners_against: 4,
        cards_1h_for: 0,
        cards_2h_for: 1,
        cards_1h_against: 1,
        cards_2h_against: 2,
        cards_for: 1,
        cards_against: 3,
        sot_for: 5,
        sot_against: 3,
        shots_for: 12,
        shots_against: 8,
        booking_points_for: 10,
        booking_points_against: 20,
        fouls_for: 9,
        fouls_against: 7,
        offsides_for: 1,
        offsides_against: 0,
      },
      {
        id: 2,
        date_iso: "2026-01-08",
        opponent: "Y",
        is_home: false,
        result: null,
        goals_1h_for: 0,
        goals_2h_for: 1,
        goals_1h_against: 1,
        goals_2h_against: 1,
        goals_ft_for: 1,
        goals_ft_against: 2,
        corners_1h_for: 1,
        corners_2h_for: 2,
        corners_1h_against: 3,
        corners_2h_against: 4,
        corners_for: 3,
        corners_against: 7,
        cards_1h_for: 2,
        cards_2h_for: 0,
        cards_1h_against: 0,
        cards_2h_against: 1,
        cards_for: 2,
        cards_against: 1,
        sot_for: 3,
        sot_against: 6,
        shots_for: 8,
        shots_against: 14,
        booking_points_for: 20,
        booking_points_against: 10,
        fouls_for: 10,
        fouls_against: 11,
        offsides_for: 2,
        offsides_against: 1,
      },
    ];
    const out = deriveSplits1h2h(normalized);
    expect(out.goals_1h_avg).toBeCloseTo(0.5, 5); // (1+0)/2
    expect(out.goals_2h_avg).toBeCloseTo(1.5, 5); // (2+1)/2
    expect(out.corners_1h_avg).toBeCloseTo(1.5, 5);
    expect(out.corners_2h_avg).toBeCloseTo(3.0, 5);
    expect(out.cards_1h_avg).toBeCloseTo(1.0, 5);
    expect(out.cards_2h_avg).toBeCloseTo(0.5, 5);
    expect(out.sot_for_avg).toBeCloseTo(4.0, 5);
  });

  it("treats nulls as zero when averaging", () => {
    const normalized: NormalizedRecentMatch[] = [
      {
        id: 1,
        date_iso: "x",
        opponent: "y",
        is_home: true,
        result: null,
        goals_1h_for: null,
        goals_2h_for: null,
        goals_1h_against: null,
        goals_2h_against: null,
        goals_ft_for: null,
        goals_ft_against: null,
        corners_1h_for: null,
        corners_2h_for: null,
        corners_1h_against: null,
        corners_2h_against: null,
        corners_for: null,
        corners_against: null,
        cards_1h_for: null,
        cards_2h_for: null,
        cards_1h_against: null,
        cards_2h_against: null,
        cards_for: null,
        cards_against: null,
        sot_for: null,
        sot_against: null,
        shots_for: null,
        shots_against: null,
        booking_points_for: null,
        booking_points_against: null,
        fouls_for: null,
        fouls_against: null,
        offsides_for: null,
        offsides_against: null,
      },
    ];
    const out = deriveSplits1h2h(normalized);
    expect(out.goals_1h_avg).toBe(0);
    expect(out.corners_1h_avg).toBe(0);
  });
});

// ─── deriveStreakIndex ──────────────────────────────────────────────────

describe("deriveStreakIndex", () => {
  it("returns empty index for null", () => {
    const out = deriveStreakIndex(null);
    expect(out.by_group).toEqual({});
    expect(out.all).toEqual([]);
  });

  it("returns empty index for empty array", () => {
    const out = deriveStreakIndex([]);
    expect(out.all).toEqual([]);
  });

  it("sorts streaks by overall_perc DESC within each group", () => {
    const streaks = [
      { group: "Goals", stat_type: "Over 1.5", overall_perc: 50, desc: "x" },
      { group: "Goals", stat_type: "Over 2.5", overall_perc: 80, desc: "y" },
      { group: "Goals", stat_type: "Over 0.5", overall_perc: 95, desc: "z" },
    ];
    const out = deriveStreakIndex(streaks);
    expect(out.by_group.Goals?.map((s) => s.overall_perc)).toEqual([
      95, 80, 50,
    ]);
  });

  it("groups all 10 known streak.group values from EPL fixture", () => {
    const out = deriveStreakIndex(epl.streaks.home);
    const expected = [
      "Result",
      "BTTS",
      "Goals",
      "Half",
      "Cards",
      "Booking Points",
      "Corners",
      "Shots",
      "Fouls",
      "Offsides",
    ];
    for (const g of expected) expect(out.by_group[g]?.length).toBeGreaterThan(0);
  });

  it("preserves the global sorted list", () => {
    const streaks = [
      { group: "G1", overall_perc: 10 },
      { group: "G2", overall_perc: 90 },
      { group: "G1", overall_perc: 50 },
    ];
    const out = deriveStreakIndex(streaks);
    expect(out.all.map((s) => s.overall_perc)).toEqual([90, 50, 10]);
  });

  it("ignores streaks without group key (treats as 'Other')", () => {
    const streaks = [{ overall_perc: 70 }];
    const out = deriveStreakIndex(streaks);
    expect(out.by_group.Other ?? out.all).toHaveLength(1);
  });
});

// ─── derivePlayerRankings ───────────────────────────────────────────────

describe("derivePlayerRankings", () => {
  it("returns [] for null", () => {
    expect(derivePlayerRankings(null, "goals")).toEqual([]);
  });

  it("returns [] for empty top_players", () => {
    expect(derivePlayerRankings([], "goals")).toEqual([]);
  });

  it("ranks players by goals DESC by default", () => {
    const players = [
      { name: "A", goals: 5 },
      { name: "B", goals: 10 },
      { name: "C", goals: 2 },
    ];
    const out = derivePlayerRankings(players, "goals");
    expect(out.map((p) => p.name)).toEqual(["B", "A", "C"]);
  });

  it("ranks by cards using yellows + reds * 2", () => {
    const players = [
      { name: "A", yellows: 3, reds: 0 }, // 3
      { name: "B", yellows: 1, reds: 2 }, // 5
      { name: "C", yellows: 5, reds: 0 }, // 5 (tie)
    ];
    const out = derivePlayerRankings(players, "cards");
    // B and C tied at 5; A at 3 is last
    expect(out[2].name).toBe("A");
    expect(out[0].card_score).toBe(5);
  });

  it("ranks by first_cards DESC", () => {
    const players = [
      { name: "A", first_cards: 1 },
      { name: "B", first_cards: 4 },
      { name: "C", first_cards: 0 },
    ];
    const out = derivePlayerRankings(players, "first_cards");
    expect(out[0].name).toBe("B");
    expect(out[2].name).toBe("C");
  });

  it("ranks by sot (shots on target) DESC", () => {
    const players = [
      { name: "A", shots_on_target: 10 },
      { name: "B", shots_on_target: 30 },
    ];
    const out = derivePlayerRankings(players, "sot");
    expect(out[0].name).toBe("B");
  });

  it("ranks by assists DESC", () => {
    const players = [
      { name: "A", assists: 3 },
      { name: "B", assists: 7 },
    ];
    const out = derivePlayerRankings(players, "assists");
    expect(out[0].name).toBe("B");
  });

  it("works on EPL fixture Chelsea side", () => {
    const players = epl.player_stats.home.top_players;
    const out = derivePlayerRankings(players, "goals");
    expect(out.length).toBeGreaterThan(0);
    // sorted DESC
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].goals!).toBeGreaterThanOrEqual(out[i].goals ?? 0);
    }
  });
});

// ─── deriveOddsCategories ───────────────────────────────────────────────

describe("deriveOddsCategories", () => {
  it("returns empty map for null/undefined", () => {
    expect(deriveOddsCategories(null)).toEqual({});
    expect(deriveOddsCategories(undefined)).toEqual({});
  });

  it("returns empty map for empty odds_summary", () => {
    expect(deriveOddsCategories({})).toEqual({});
  });

  it("groups EPL 39 markets into 6 categories", () => {
    const out = deriveOddsCategories(epl.odds_summary);
    const cats = Object.keys(out);
    // expect at least match, halves, teams, corners, cards, player-props
    expect(cats).toEqual(
      expect.arrayContaining(["match", "halves", "teams", "corners", "cards", "player-props"]),
    );
  });

  it("classifies Result under 'match'", () => {
    const out = deriveOddsCategories({
      Result: { Home: { decimal_odds: 1.5, bookmaker: "X" } },
    });
    expect(out.match?.map((m) => m.market)).toContain("Result");
  });

  it("classifies 'First Half Result' under 'halves'", () => {
    const out = deriveOddsCategories({
      "First Half Result": { Home: { decimal_odds: 2.5, bookmaker: "X" } },
    });
    expect(out.halves?.map((m) => m.market)).toContain("First Half Result");
  });

  it("classifies 'Total Corners' under 'corners'", () => {
    const out = deriveOddsCategories({
      "Total Corners": { "Over 9.5": { decimal_odds: 1.85, bookmaker: "X" } },
    });
    expect(out.corners?.map((m) => m.market)).toContain("Total Corners");
  });

  it("classifies 'Total Cards' under 'cards'", () => {
    const out = deriveOddsCategories({
      "Total Cards": { "Over 4.5": { decimal_odds: 2.0, bookmaker: "X" } },
    });
    expect(out.cards?.map((m) => m.market)).toContain("Total Cards");
  });

  it("classifies 'Player to score anytime' under 'player-props'", () => {
    const out = deriveOddsCategories({
      "Player to score anytime": {
        Estevão: { decimal_odds: 4.5, bookmaker: "X" },
      },
    });
    expect(out["player-props"]?.map((m) => m.market)).toContain(
      "Player to score anytime",
    );
  });

  it("classifies 'Team Goals Overs/Unders' under 'teams'", () => {
    const out = deriveOddsCategories({
      "Team Goals Overs/Unders": {
        "Chelsea Over 1.5": { decimal_odds: 1.9, bookmaker: "X" },
      },
    });
    expect(out.teams?.map((m) => m.market)).toContain("Team Goals Overs/Unders");
  });

  it("puts unknown market in 'other' bucket", () => {
    const out = deriveOddsCategories({
      "Some Random Future Market": {
        Foo: { decimal_odds: 5, bookmaker: "X" },
      },
    });
    expect(out.other?.map((m) => m.market)).toContain(
      "Some Random Future Market",
    );
  });

  it("preserves outcomes within each market entry", () => {
    const out = deriveOddsCategories({
      Result: {
        Home: { decimal_odds: 1.5, bookmaker: "X" },
        Draw: { decimal_odds: 4, bookmaker: "X" },
      },
    });
    const market = out.match?.find((m) => m.market === "Result");
    expect(market?.outcomes.length).toBe(2);
  });
});

// ─── deriveDistributions ────────────────────────────────────────────────

describe("deriveDistributions", () => {
  it("returns zeros for empty input", () => {
    const out = deriveDistributions([]);
    expect(out.goals_ft_for.min).toBe(0);
    expect(out.goals_ft_for.max).toBe(0);
  });

  it("computes min/q1/median/q3/max from goals_ft_for", () => {
    const matches: NormalizedRecentMatch[] = makeMatches([1, 2, 3, 4, 5]);
    const out = deriveDistributions(matches);
    expect(out.goals_ft_for.min).toBe(1);
    expect(out.goals_ft_for.max).toBe(5);
    expect(out.goals_ft_for.median).toBe(3);
  });

  it("computes for corners_for", () => {
    const matches: NormalizedRecentMatch[] = makeMatches([], [4, 5, 6, 7, 8]);
    const out = deriveDistributions(matches);
    expect(out.corners_for.min).toBe(4);
    expect(out.corners_for.max).toBe(8);
  });

  it("handles single-match degenerate distribution", () => {
    const out = deriveDistributions(makeMatches([2]));
    expect(out.goals_ft_for.min).toBe(2);
    expect(out.goals_ft_for.max).toBe(2);
    expect(out.goals_ft_for.median).toBe(2);
    expect(out.goals_ft_for.q1).toBe(2);
    expect(out.goals_ft_for.q3).toBe(2);
  });

  it("treats nulls as zeros when populating series", () => {
    const matches = makeMatches([1, null as unknown as number, 3]);
    const out = deriveDistributions(matches);
    expect(out.goals_ft_for.min).toBe(0); // null treated as 0
    expect(out.goals_ft_for.max).toBe(3);
  });
});

// helper for distribution tests
function makeMatches(goals: number[], corners: number[] = []): NormalizedRecentMatch[] {
  const n = Math.max(goals.length, corners.length);
  const out: NormalizedRecentMatch[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: i,
      date_iso: "2026-01-01",
      opponent: "x",
      is_home: true,
      result: null,
      goals_1h_for: 0,
      goals_2h_for: 0,
      goals_1h_against: 0,
      goals_2h_against: 0,
      goals_ft_for: goals[i] ?? 0,
      goals_ft_against: 0,
      corners_1h_for: 0,
      corners_2h_for: 0,
      corners_1h_against: 0,
      corners_2h_against: 0,
      corners_for: corners[i] ?? 0,
      corners_against: 0,
      cards_1h_for: 0,
      cards_2h_for: 0,
      cards_1h_against: 0,
      cards_2h_against: 0,
      cards_for: 0,
      cards_against: 0,
      sot_for: 0,
      sot_against: 0,
      shots_for: 0,
      shots_against: 0,
      booking_points_for: 0,
      booking_points_against: 0,
      fouls_for: 0,
      fouls_against: 0,
      offsides_for: 0,
      offsides_against: 0,
    });
  }
  return out;
}

// ─── deriveRadarAxes ────────────────────────────────────────────────────

describe("deriveRadarAxes", () => {
  it("returns 6 axes for both sides", () => {
    const home = makeMatches([2, 3, 1, 2, 3], [5, 6, 4, 5, 6]);
    const away = makeMatches([1, 1, 0, 2, 1], [3, 4, 2, 3, 4]);
    const out = deriveRadarAxes(home, away);
    expect(out.axes).toHaveLength(6);
    const labels = out.axes.map((a) => a.key);
    expect(labels).toEqual(
      expect.arrayContaining([
        "goals_per_game",
        "goals_conceded",
        "sot",
        "booking_points",
        "corners",
        "fouls",
      ]),
    );
  });

  it("includes home and away values per axis", () => {
    const home = makeMatches([2, 2]);
    const away = makeMatches([0, 0]);
    const out = deriveRadarAxes(home, away);
    for (const axis of out.axes) {
      expect(typeof axis.home).toBe("number");
      expect(typeof axis.away).toBe("number");
    }
  });

  it("returns zeroed axes when both sides are empty", () => {
    const out = deriveRadarAxes([], []);
    expect(out.axes).toHaveLength(6);
    for (const axis of out.axes) {
      expect(axis.home).toBe(0);
      expect(axis.away).toBe(0);
    }
  });

  it("normalizes values to a max of 1 per axis (relative scale)", () => {
    const home = makeMatches([10, 10, 10]);
    const away = makeMatches([5, 5, 5]);
    const out = deriveRadarAxes(home, away);
    // goals_per_game axis: home=10, away=5; normalized: home=1.0, away=0.5
    const gpg = out.axes.find((a) => a.key === "goals_per_game")!;
    expect(gpg.home_norm).toBeCloseTo(1, 3);
    expect(gpg.away_norm).toBeCloseTo(0.5, 3);
  });

  it("clamps norm to 0 when raw max is 0", () => {
    const out = deriveRadarAxes([], []);
    for (const axis of out.axes) {
      expect(axis.home_norm).toBe(0);
      expect(axis.away_norm).toBe(0);
    }
  });
});

// ─── End-to-end fixture smoke tests ─────────────────────────────────────

describe("Real fixture smoke", () => {
  it("EPL fixture has referee_record populated and 39 odds markets", () => {
    expect(epl.referee_record).not.toBeNull();
    expect(Object.keys(epl.odds_summary).length).toBeGreaterThanOrEqual(30);
  });

  it("Brazil Serie B fixture lacks referee_record and odds_summary", () => {
    expect(serieB.referee_record).toBeNull();
    expect(Object.keys(serieB.odds_summary ?? {}).length).toBe(0);
  });

  it("Liga MX fixture has populated predictions", () => {
    expect((ligaMx.predictions ?? []).length).toBeGreaterThan(0);
  });

  it("deriveOddsCategories on Brazil Serie B yields empty", () => {
    expect(deriveOddsCategories(serieB.odds_summary)).toEqual({});
  });

  it("deriveStreakIndex on Liga MX is non-empty", () => {
    const out = deriveStreakIndex(ligaMx.streaks.home);
    expect(out.all.length).toBeGreaterThan(0);
  });
});
