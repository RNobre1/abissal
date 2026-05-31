/**
 * Tests: forced recos EXCLUDED from all calibration aggregations.
 *
 * Lição B19 class: injecting sub-threshold bets into calibration data poisons
 * metrics. Forced recos must be invisible to ROI/Brier/by-league/by-confidence/
 * by-market/by-market-line.
 */

import { describe, expect, it } from "vitest";
import {
  summarizeAiRecoRoi,
  brierAiReco,
  groupAiRecoByLeague,
  groupAiRecoByConfidence,
  groupAiRecoByMarket,
  groupAiRecoByMarketLine,
  type AiRecoRow,
} from "./ai-reco-metrics";

// A resolved, won bet row — normal
function normalBet(over: Partial<AiRecoRow> = {}): AiRecoRow {
  return {
    id: 1,
    league: "Premier League",
    market: "1x2",
    side: "home",
    status: "resolved",
    verdict: "bet",
    confidence: "alto",
    prob_estimated: 0.65,
    prob_calibrated: 0.63,
    units_final: 1.0,
    bet_won: true,
    pl_units: 1.1,
    ...over,
  };
}

// Same row but forced=true
function forcedBet(over: Partial<AiRecoRow> = {}): AiRecoRow {
  return normalBet({ ...over, forced: true });
}

// ── summarizeAiRecoRoi ────────────────────────────────────────────────────────

describe("summarizeAiRecoRoi — excludes forced rows", () => {
  it("counts 0 bets when only forced rows exist", () => {
    const result = summarizeAiRecoRoi([forcedBet()]);
    expect(result.betCount).toBe(0);
    expect(result.resolvedCount).toBe(0);
    expect(result.totalPl).toBe(0);
    expect(result.roiPerUnit).toBeNull();
  });

  it("excludes forced rows from mixed set, counts only normal", () => {
    const result = summarizeAiRecoRoi([normalBet(), forcedBet({ id: 2 })]);
    expect(result.betCount).toBe(1);
    expect(result.won).toBe(1);
    expect(result.totalPl).toBeCloseTo(1.1);
  });

  it("normal rows still counted when forced=false or forced undefined", () => {
    const withFalseFalse = normalBet({ forced: false });
    const withUndefined = normalBet();
    delete (withUndefined as Partial<AiRecoRow>).forced;
    const result = summarizeAiRecoRoi([withFalseFalse, withUndefined]);
    expect(result.betCount).toBe(2);
  });
});

// ── brierAiReco ───────────────────────────────────────────────────────────────

describe("brierAiReco — excludes forced rows", () => {
  it("n=0 when only forced rows", () => {
    const result = brierAiReco([forcedBet()]);
    expect(result.n).toBe(0);
    expect(result.brier).toBeNull();
  });

  it("excludes forced from mixed set — only normal contributes to n", () => {
    const result = brierAiReco([normalBet(), forcedBet({ id: 2 })]);
    expect(result.n).toBe(1);
  });
});

// ── groupAiRecoByLeague ───────────────────────────────────────────────────────

describe("groupAiRecoByLeague — excludes forced rows", () => {
  it("returns empty when only forced rows", () => {
    const result = groupAiRecoByLeague([forcedBet()]);
    expect(result).toHaveLength(0);
  });

  it("forced rows do not inflate total/bets counts", () => {
    const result = groupAiRecoByLeague([normalBet(), forcedBet({ id: 2 })]);
    expect(result).toHaveLength(1);
    expect(result[0].total).toBe(1);
    expect(result[0].bets).toBe(1);
  });
});

// ── groupAiRecoByConfidence ───────────────────────────────────────────────────

describe("groupAiRecoByConfidence — excludes forced rows", () => {
  it("returns empty when only forced rows", () => {
    const result = groupAiRecoByConfidence([forcedBet()]);
    expect(result).toHaveLength(0);
  });

  it("forced rows excluded from confidence bucket totals", () => {
    const result = groupAiRecoByConfidence([normalBet(), forcedBet({ id: 2 })]);
    const alto = result.find((r) => r.confidence === "alto");
    expect(alto?.total).toBe(1);
    expect(alto?.bets).toBe(1);
  });
});

// ── groupAiRecoByMarket ───────────────────────────────────────────────────────

describe("groupAiRecoByMarket — excludes forced rows", () => {
  it("returns empty when only forced rows", () => {
    const result = groupAiRecoByMarket([forcedBet()]);
    expect(result).toHaveLength(0);
  });

  it("forced rows excluded from market totals", () => {
    const result = groupAiRecoByMarket([normalBet(), forcedBet({ id: 2 })]);
    const market1x2 = result.find((r) => r.market === "1x2");
    expect(market1x2?.total).toBe(1);
  });
});

// ── groupAiRecoByMarketLine ───────────────────────────────────────────────────

describe("groupAiRecoByMarketLine — excludes forced rows", () => {
  it("returns empty when only forced rows", () => {
    const result = groupAiRecoByMarketLine([forcedBet()]);
    expect(result).toHaveLength(0);
  });

  it("forced rows excluded from line totals", () => {
    const result = groupAiRecoByMarketLine([normalBet(), forcedBet({ id: 2 })]);
    const line = result.find((r) => r.market === "1x2-home");
    expect(line?.total).toBe(1);
  });
});
