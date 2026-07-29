/**
 * Tests for secondary calibration metrics (BTTS Brier + Count CRPS).
 *
 * Wave G: extends sim-reliability.ts with:
 * - bttsBrier: Brier score over BTTS (both-teams-to-score) forecasts
 * - cornersCrps: CRPS for corners_total distribution vs actual
 * - cardsCrps: CRPS for cards_total distribution vs actual
 * - sotCrps: CRPS for shots-on-target total distribution vs actual
 */
import { describe, it, expect } from "vitest";
import {
  bttsBrier,
  cornersCrps,
  cardsCrps,
  sotCrps,
  type ResolvedSimRowSecondary,
} from "../sim-reliability";

// Helpers to build test rows

function makeRow(overrides: Partial<ResolvedSimRowSecondary> = {}): ResolvedSimRowSecondary {
  return {
    league: "Premier League",
    p_home: 0.5,
    p_draw: 0.25,
    p_away: 0.25,
    p_over_25: 0.6,
    p_btts: 0.55,
    market_anchor: null,
    actual_home_goals: 2,
    actual_away_goals: 1,
    actual_resolved_at: "2026-05-20T12:00:00Z",
    actual_btts: true,
    actual_corners_home: 6,
    actual_corners_away: 4,
    actual_cards_home: 2,
    actual_cards_away: 1,
    actual_sot_home: 5,
    actual_sot_away: 3,
    sim_stats: {
      home: {
        corners: { p10: 3, p50: 5, p90: 8 },
        cards: { p10: 0, p50: 2, p90: 4 },
        sot: { p10: 2, p50: 4, p90: 7 },
      },
      away: {
        corners: { p10: 2, p50: 4, p90: 7 },
        cards: { p10: 0, p50: 1, p90: 3 },
        sot: { p10: 1, p50: 3, p90: 6 },
      },
    },
    ...overrides,
  };
}

// ── BTTS Brier ────────────────────────────────────────────────────────────────

describe("bttsBrier", () => {
  it("returns null when no rows have usable p_btts + actual data", () => {
    // Row 1: p_btts null → skipped
    // Row 2: actual_btts null AND goals null → fallback also fails → skipped
    const rows = [
      makeRow({ p_btts: null }),
      makeRow({ actual_btts: null, actual_home_goals: null, actual_away_goals: null }),
    ];
    expect(bttsBrier(rows)).toBeNull();
  });

  it("perfect forecast (p_btts=1, actual_btts=true) → Brier=0", () => {
    const rows = [makeRow({ p_btts: 1.0, actual_btts: true })];
    expect(bttsBrier(rows)).toBeCloseTo(0, 6);
  });

  it("worst forecast (p_btts=0, actual_btts=true) → Brier=1", () => {
    const rows = [makeRow({ p_btts: 0, actual_btts: true })];
    expect(bttsBrier(rows)).toBeCloseTo(1, 6);
  });

  it("random forecast (p_btts=0.5) → Brier=0.25 for any outcome", () => {
    const rows = [
      makeRow({ p_btts: 0.5, actual_btts: true }),
      makeRow({ p_btts: 0.5, actual_btts: false }),
    ];
    // Each contributes (0.5)^2=0.25; average=0.25
    expect(bttsBrier(rows)).toBeCloseTo(0.25, 6);
  });

  it("skips rows with null p_btts", () => {
    const rows = [
      makeRow({ p_btts: null, actual_btts: true }),
      makeRow({ p_btts: 1.0, actual_btts: true }),
    ];
    expect(bttsBrier(rows)).toBeCloseTo(0, 6);
  });

  it("skips rows with null actual_btts", () => {
    const rows = [
      makeRow({ p_btts: 0.5, actual_btts: null }),
      makeRow({ p_btts: 0.5, actual_btts: true }),
    ];
    // Only second row contributes: (0.5-1)^2 = 0.25
    expect(bttsBrier(rows)).toBeCloseTo(0.25, 6);
  });

  it("derives actual_btts from goals when actual_btts is null but goals are available", () => {
    // Fallback: compute BTTS from goals if column is null
    const rows = [
      makeRow({ p_btts: 0.9, actual_btts: null, actual_home_goals: 2, actual_away_goals: 1 }),
    ];
    // BTTS = true (both > 0), Brier = (0.9-1)^2 = 0.01
    expect(bttsBrier(rows)).toBeCloseTo(0.01, 6);
  });

  it("single good calibration → Brier < 0.1", () => {
    const rows = [
      makeRow({ p_btts: 0.8, actual_btts: true }),
      makeRow({ p_btts: 0.7, actual_btts: true }),
      makeRow({ p_btts: 0.3, actual_btts: false }),
    ];
    const score = bttsBrier(rows);
    expect(score).not.toBeNull();
    expect(score!).toBeLessThan(0.1);
  });
});

// ── Corner CRPS ───────────────────────────────────────────────────────────────

describe("cornersCrps", () => {
  it("returns null when no rows have actual corners", () => {
    const rows = [makeRow({ actual_corners_home: null, actual_corners_away: null })];
    expect(cornersCrps(rows)).toBeNull();
  });

  it("returns null when no rows have sim_stats corners", () => {
    const rows = [makeRow({ sim_stats: null })];
    expect(cornersCrps(rows)).toBeNull();
  });

  it("returns a non-negative number when data is available", () => {
    const rows = [makeRow()];
    const result = cornersCrps(rows);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(0);
  });

  it("lower CRPS when sim_stats centers on the actual value", () => {
    // Row where sim_stats is centered on actual (corners_total=10, actual=10)
    const goodRow = makeRow({
      sim_stats: {
        home: { corners: { p10: 4, p50: 5, p90: 7 } },
        away: { corners: { p10: 4, p50: 5, p90: 7 } },
      },
      actual_corners_home: 5,
      actual_corners_away: 5,
    });
    // Row where sim_stats is far off (expects ~20 corners, actual=10)
    const badRow = makeRow({
      sim_stats: {
        home: { corners: { p10: 8, p50: 10, p90: 13 } },
        away: { corners: { p10: 8, p50: 10, p90: 13 } },
      },
      actual_corners_home: 5,
      actual_corners_away: 5,
    });
    expect(cornersCrps([goodRow])!).toBeLessThan(cornersCrps([badRow])!);
  });

  it("skips rows missing actual corner data", () => {
    const rows = [
      makeRow({ actual_corners_home: null }),
      makeRow({ actual_corners_home: 5, actual_corners_away: 4 }),
    ];
    // Only second row contributes; result should be a number
    expect(cornersCrps(rows)).not.toBeNull();
  });
});

// ── Cards CRPS ────────────────────────────────────────────────────────────────

describe("cardsCrps", () => {
  it("returns null when no rows have actual card data", () => {
    const rows = [makeRow({ actual_cards_home: null, actual_cards_away: null })];
    expect(cardsCrps(rows)).toBeNull();
  });

  it("returns non-negative for valid rows", () => {
    const result = cardsCrps([makeRow()]);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(0);
  });

  it("scores better when distribution centers on actual", () => {
    const goodRow = makeRow({
      sim_stats: {
        home: { cards: { p10: 1, p50: 2, p90: 3 } },
        away: { cards: { p10: 1, p50: 1, p90: 2 } },
      },
      actual_cards_home: 2,
      actual_cards_away: 1,
    });
    const badRow = makeRow({
      sim_stats: {
        home: { cards: { p10: 5, p50: 7, p90: 10 } },
        away: { cards: { p10: 5, p50: 7, p90: 10 } },
      },
      actual_cards_home: 2,
      actual_cards_away: 1,
    });
    expect(cardsCrps([goodRow])!).toBeLessThan(cardsCrps([badRow])!);
  });
});

// ── SOT CRPS ─────────────────────────────────────────────────────────────────

describe("sotCrps", () => {
  it("returns null when no rows have actual SOT data", () => {
    const rows = [makeRow({ actual_sot_home: null, actual_sot_away: null })];
    expect(sotCrps(rows)).toBeNull();
  });

  it("returns non-negative for valid rows", () => {
    const result = sotCrps([makeRow()]);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(0);
  });

  it("scores better when distribution centers on actual SOT", () => {
    const goodRow = makeRow({
      sim_stats: {
        home: { sot: { p10: 3, p50: 5, p90: 8 } },
        away: { sot: { p10: 2, p50: 3, p90: 5 } },
      },
      actual_sot_home: 5,
      actual_sot_away: 3,
    });
    const badRow = makeRow({
      sim_stats: {
        home: { sot: { p10: 10, p50: 15, p90: 20 } },
        away: { sot: { p10: 10, p50: 15, p90: 20 } },
      },
      actual_sot_home: 5,
      actual_sot_away: 3,
    });
    expect(sotCrps([goodRow])!).toBeLessThan(sotCrps([badRow])!);
  });
});

// ── Integration: multiple rows ────────────────────────────────────────────────

describe("secondary metrics — multiple rows", () => {
  it("averages CRPS across rows", () => {
    const rows = [makeRow(), makeRow(), makeRow()];
    const singleScore = cornersCrps([makeRow()])!;
    const multiScore = cornersCrps(rows)!;
    expect(multiScore).toBeCloseTo(singleScore, 5);
  });

  it("filters out rows with missing actual data gracefully", () => {
    const rows = [
      makeRow({ actual_corners_home: null }),
      makeRow({ actual_corners_home: 5 }),
    ];
    // Only 1 row contributes; should not throw
    expect(() => cornersCrps(rows)).not.toThrow();
  });
});
