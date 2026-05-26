/**
 * TDD — compute.ts: computeOddCombined, computePotentialReturn, detectConflicts
 *
 * RED phase: these tests define the contract before any implementation.
 */
import { describe, it, expect } from "vitest";
import {
  computeOddCombined,
  computePotentialReturn,
  detectConflicts,
  type SlipLeg,
} from "../compute";

// ── helpers ──────────────────────────────────────────────────────────────────
function makeLeg(overrides: Partial<SlipLeg> = {}): SlipLeg {
  return {
    id: 1,
    slip_id: 1,
    fixture_id: 100,
    home_team: "Liverpool",
    away_team: "Chelsea",
    market: "1x2",
    side: "home",
    odd_taken: 2.0,
    league: "Premier League",
    kickoff_utc: null,
    created_at: "2026-05-26T12:00:00Z",
    ai_recommendation_id: null,
    sport_id: null,
    market_id: null,
    ...overrides,
  };
}

// ── computeOddCombined ───────────────────────────────────────────────────────
describe("computeOddCombined", () => {
  it("returns 1 for empty legs array", () => {
    expect(computeOddCombined([])).toBe(1);
  });

  it("returns the single odd for a single leg", () => {
    expect(computeOddCombined([makeLeg({ odd_taken: 2.5 })])).toBe(2.5);
  });

  it("multiplies odds for 2 legs", () => {
    const legs = [makeLeg({ odd_taken: 2.0 }), makeLeg({ odd_taken: 3.0 })];
    expect(computeOddCombined(legs)).toBeCloseTo(6.0, 4);
  });

  it("multiplies odds for 3 legs correctly", () => {
    const legs = [
      makeLeg({ odd_taken: 2.0 }),
      makeLeg({ odd_taken: 1.5 }),
      makeLeg({ odd_taken: 3.0 }),
    ];
    expect(computeOddCombined(legs)).toBeCloseTo(9.0, 4);
  });

  it("rounds result to 4 decimal places", () => {
    const legs = [makeLeg({ odd_taken: 1.3 }), makeLeg({ odd_taken: 1.7 })];
    const result = computeOddCombined(legs);
    expect(result).toBeCloseTo(2.21, 4);
  });
});

// ── computePotentialReturn ───────────────────────────────────────────────────
describe("computePotentialReturn", () => {
  it("returns 0 when stake is 0", () => {
    expect(computePotentialReturn(0, 5.0)).toBe(0);
  });

  it("returns 0 when oddCombined is 0", () => {
    expect(computePotentialReturn(100, 0)).toBe(0);
  });

  it("computes stake × oddCombined correctly", () => {
    expect(computePotentialReturn(50, 4.0)).toBeCloseTo(200.0, 2);
  });

  it("rounds to 2 decimal places", () => {
    expect(computePotentialReturn(33.33, 3.0)).toBeCloseTo(99.99, 2);
  });
});

// ── detectConflicts ──────────────────────────────────────────────────────────
describe("detectConflicts", () => {
  it("returns empty array for 2 different fixtures", () => {
    const legs = [
      makeLeg({ fixture_id: 100, market: "1x2", side: "home" }),
      makeLeg({ fixture_id: 200, market: "1x2", side: "home" }),
    ];
    expect(detectConflicts(legs)).toHaveLength(0);
  });

  it("detects duplicate same fixture+market+side", () => {
    const legs = [
      makeLeg({ fixture_id: 100, market: "1x2", side: "home" }),
      makeLeg({ fixture_id: 100, market: "1x2", side: "home", id: 2 }),
    ];
    const conflicts = detectConflicts(legs);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]?.type).toBe("duplicate");
  });

  it("detects conflicting sides in same fixture+market (home + draw)", () => {
    const legs = [
      makeLeg({ fixture_id: 100, market: "1x2", side: "home" }),
      makeLeg({ fixture_id: 100, market: "1x2", side: "draw", id: 2 }),
    ];
    const conflicts = detectConflicts(legs);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]?.type).toBe("conflicting_sides");
  });

  it("does NOT conflict different markets in same fixture", () => {
    const legs = [
      makeLeg({ fixture_id: 100, market: "1x2", side: "home" }),
      makeLeg({ fixture_id: 100, market: "btts", side: "yes", id: 2 }),
    ];
    expect(detectConflicts(legs)).toHaveLength(0);
  });

  it("detects past kickoff (ko_utc already passed)", () => {
    const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
    const legs = [
      makeLeg({ fixture_id: 100, kickoff_utc: pastDate }),
    ];
    const conflicts = detectConflicts(legs);
    expect(conflicts.some((c) => c.type === "past_kickoff")).toBe(true);
  });

  it("does NOT flag future kickoff", () => {
    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
    const legs = [
      makeLeg({ fixture_id: 100, kickoff_utc: futureDate }),
    ];
    expect(detectConflicts(legs).some((c) => c.type === "past_kickoff")).toBe(false);
  });
});
