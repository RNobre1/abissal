import { describe, expect, it } from "vitest";
import {
  formatClosureMessage,
  buildDailySummary,
  type DailySummaryInput,
} from "@/lib/telegram/closure-message";

describe("formatClosureMessage", () => {
  it("formats message with all data", () => {
    const msg = formatClosureMessage({
      wins: 2,
      losses: 1,
      plUnits: 1.2,
      aiAccuracyPct: 67,
      clvPct: -0.3,
      date: "25/05",
    });
    expect(msg).toContain("📊");
    expect(msg).toContain("2W-1L");
    expect(msg).toContain("+1,20u");
    expect(msg).toContain("IA acertou 67%");
    expect(msg).toContain("CLV");
  });

  it("handles zero bets gracefully", () => {
    const msg = formatClosureMessage({
      wins: 0,
      losses: 0,
      plUnits: 0,
      aiAccuracyPct: null,
      clvPct: null,
      date: "25/05",
    });
    expect(msg).toContain("0W-0L");
    expect(msg).not.toContain("NaN");
    expect(msg).not.toContain("undefined");
  });

  it("formats negative P/L", () => {
    const msg = formatClosureMessage({
      wins: 0,
      losses: 3,
      plUnits: -2.5,
      aiAccuracyPct: 33,
      clvPct: 1.1,
      date: "25/05",
    });
    expect(msg).toContain("-2,50u");
    expect(msg).toContain("0W-3L");
  });

  it("omits CLV line when clvPct is null", () => {
    const msg = formatClosureMessage({
      wins: 1,
      losses: 0,
      plUnits: 1.0,
      aiAccuracyPct: 100,
      clvPct: null,
      date: "25/05",
    });
    expect(msg).not.toContain("CLV");
  });

  it("omits AI accuracy line when aiAccuracyPct is null", () => {
    const msg = formatClosureMessage({
      wins: 1,
      losses: 0,
      plUnits: 1.0,
      aiAccuracyPct: null,
      clvPct: null,
      date: "25/05",
    });
    expect(msg).not.toContain("IA acertou");
  });
});

describe("buildDailySummary", () => {
  it("aggregates bets resolved today", () => {
    const bets: DailySummaryInput["bets"] = [
      { status: "won", pl_units: 1.2 },
      { status: "won", pl_units: 0.8 },
      { status: "lost", pl_units: -1.0 },
    ];
    const recos: DailySummaryInput["recos"] = [
      { resolved: true, correct: true },
      { resolved: true, correct: false },
      { resolved: true, correct: true },
    ];
    const result = buildDailySummary({ bets, recos });
    expect(result.wins).toBe(2);
    expect(result.losses).toBe(1);
    expect(result.plUnits).toBeCloseTo(1.0, 5);
    expect(result.aiAccuracyPct).toBeCloseTo(66.67, 1);
  });

  it("returns null accuracy when no resolved recos", () => {
    const result = buildDailySummary({
      bets: [{ status: "won", pl_units: 1.0 }],
      recos: [],
    });
    expect(result.aiAccuracyPct).toBeNull();
  });

  it("handles empty bets", () => {
    const result = buildDailySummary({ bets: [], recos: [] });
    expect(result.wins).toBe(0);
    expect(result.losses).toBe(0);
    expect(result.plUnits).toBe(0);
  });
});
