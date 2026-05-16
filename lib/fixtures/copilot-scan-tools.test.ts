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

describe("computeFixtureSignals", () => {
  it("computes all 7 signal groups from a full detail_json", () => {
    const s = computeFixtureSignals(baseRow(FULL_DETAIL));
    expect(s.cards?.referee_avg_booking).toBe(48);
    expect(typeof s.cards?.home_avg_cards).toBe("number");
    expect(s.cards?.badge_cartao_alto).toBe(true);
    expect(s.goals_over?.home_over25_pct).toBeCloseTo(0.5);
    expect(typeof s.goals_over?.avg_total_goals).toBe("number");
    expect(s.btts?.home_btts_pct).toBeCloseTo(0.5);
    expect(s.first_half?.home_fh_goal_pct).toBeCloseTo(0.5);
    expect(s.form?.home).toEqual({ w: 3, d: 1, l: 1, pts_recent: 10 });
    expect(s.form?.away).toEqual({ w: 1, d: 2, l: 2, pts_recent: 5 });
    expect(s.form?.home_streak).toBe("Over 2.5 nos últimos 6");
    expect(s.form?.away_streak).toBeNull();
    expect(s.h2h).toEqual({ games: 2, avg_goals: 2.5 });
    expect(s.odds?.categories.length).toBeGreaterThan(0);
    expect(s.odds?.match_favorite).toBe("Home");
    expect(s.odds?.adamchoi_pred).toBe("Over 2.5 Goals");
  });

  it("omits groups whose source section is absent (never throws)", () => {
    const s = computeFixtureSignals(baseRow({}));
    expect(s.cards?.referee_avg_booking).toBeNull();
    expect(s.form?.home).toBeNull();
    expect(s.h2h).toEqual({ games: 0, avg_goals: 0 });
    expect(s.odds?.match_favorite).toBeNull();
    expect(s.odds?.adamchoi_pred).toBeNull();
  });
});
