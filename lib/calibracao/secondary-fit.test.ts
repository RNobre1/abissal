/**
 * Tests for secondary-market isotonic fit helpers.
 * Covers: key naming, pred (Poisson p50-sum), observed, complement, gating.
 */
import { describe, it, expect } from "vitest";
import {
  secondaryMetricKey,
  secondaryPred,
  secondaryObserved,
  SECONDARY_MARKETS,
  type SecondaryActuals,
} from "./secondary-fit";

// ── Key naming ──────────────────────────────────────────────────────────────

describe("secondaryMetricKey", () => {
  it("corners over 8.5 → corners-over-85", () => {
    expect(secondaryMetricKey("corners", "over", "85")).toBe("corners-over-85");
  });
  it("corners under 8.5 → corners-under-85", () => {
    expect(secondaryMetricKey("corners", "under", "85")).toBe("corners-under-85");
  });
  it("cards over 4.5 → cards-over-45", () => {
    expect(secondaryMetricKey("cards", "over", "45")).toBe("cards-over-45");
  });
  it("sot under 7.5 → sot-under-75", () => {
    expect(secondaryMetricKey("sot", "under", "75")).toBe("sot-under-75");
  });
  it("sot over 10.5 → sot-over-105", () => {
    expect(secondaryMetricKey("sot", "over", "105")).toBe("sot-over-105");
  });
  it("sot under 9.5 → sot-under-95", () => {
    expect(secondaryMetricKey("sot", "under", "95")).toBe("sot-under-95");
  });
});

// ── Prediction via Poisson ───────────────────────────────────────────────────

describe("secondaryPred", () => {
  it("over: P(X > 9.5 | λ=10) > 0.5 for mean > threshold", () => {
    // mean=10, line=9.5 → roughly 0.54
    const p = secondaryPred(10, 9.5, "over");
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(1);
  });

  it("under: P(X <= 9.5 | λ=10) is complement of over", () => {
    const pOver = secondaryPred(10, 9.5, "over");
    const pUnder = secondaryPred(10, 9.5, "under");
    expect(pOver + pUnder).toBeCloseTo(1, 8);
  });

  it("over + under = 1 for all secondary half-integer lines", () => {
    const lines = [3.5, 4.5, 5.5, 7.5, 8.5, 9.5, 10.5];
    for (const line of lines) {
      const mean = line;
      const pO = secondaryPred(mean, line, "over");
      const pU = secondaryPred(mean, line, "under");
      expect(pO + pU).toBeCloseTo(1, 8);
    }
  });

  it("returns finite number for valid inputs", () => {
    expect(Number.isFinite(secondaryPred(8, 8.5, "over"))).toBe(true);
    expect(Number.isFinite(secondaryPred(8, 8.5, "under"))).toBe(true);
  });

  it("returns 0 for non-finite mean", () => {
    expect(secondaryPred(NaN, 8.5, "over")).toBe(0);
    expect(secondaryPred(Infinity, 8.5, "under")).toBe(0);
  });
});

// ── Observed outcome ─────────────────────────────────────────────────────────

describe("secondaryObserved", () => {
  const baseActuals: SecondaryActuals = {
    actual_corners_home: 5,
    actual_corners_away: 6,
    actual_cards_home: 2,
    actual_cards_away: 3,
    actual_sot_home: 4,
    actual_sot_away: 5,
  };

  it("corners over 8.5: total 11 > 8.5 → 1", () => {
    expect(secondaryObserved("corners", 8.5, "over", baseActuals)).toBe(1);
  });

  it("corners under 8.5: total 11 <= 8.5 → 0", () => {
    expect(secondaryObserved("corners", 8.5, "under", baseActuals)).toBe(0);
  });

  it("cards over 4.5: total 5 > 4.5 → 1", () => {
    expect(secondaryObserved("cards", 4.5, "over", baseActuals)).toBe(1);
  });

  it("cards under 3.5: total 5 <= 3.5 → 0", () => {
    expect(secondaryObserved("cards", 3.5, "under", baseActuals)).toBe(0);
  });

  it("sot over 9.5: total 9 <= 9.5 → 0", () => {
    expect(secondaryObserved("sot", 9.5, "over", baseActuals)).toBe(0);
  });

  it("sot under 9.5: total 9 <= 9.5 → 1", () => {
    expect(secondaryObserved("sot", 9.5, "under", baseActuals)).toBe(1);
  });

  it("returns null when any actual is null", () => {
    const partial: SecondaryActuals = {
      ...baseActuals,
      actual_corners_home: null,
    };
    expect(secondaryObserved("corners", 8.5, "over", partial)).toBeNull();
  });

  it("returns null when both actuals are null", () => {
    const none: SecondaryActuals = {
      actual_corners_home: null,
      actual_corners_away: null,
      actual_cards_home: null,
      actual_cards_away: null,
      actual_sot_home: null,
      actual_sot_away: null,
    };
    expect(secondaryObserved("corners", 8.5, "over", none)).toBeNull();
  });

  it("over + under observed are complement (sum=1)", () => {
    const o = secondaryObserved("corners", 8.5, "over", baseActuals);
    const u = secondaryObserved("corners", 8.5, "under", baseActuals);
    expect(o).not.toBeNull();
    expect(u).not.toBeNull();
    expect((o as number) + (u as number)).toBe(1);
  });
});

// ── SECONDARY_MARKETS definition ─────────────────────────────────────────────

describe("SECONDARY_MARKETS", () => {
  it("contains exactly 3 stats", () => {
    const stats = [...new Set(SECONDARY_MARKETS.map((m) => m.stat))];
    expect(stats).toEqual(expect.arrayContaining(["corners", "cards", "sot"]));
    expect(stats).toHaveLength(3);
  });

  it("corners has labels 85/95/105", () => {
    const cornerLabels = SECONDARY_MARKETS.filter((m) => m.stat === "corners").map(
      (m) => m.label,
    );
    expect(cornerLabels).toEqual(expect.arrayContaining(["85", "95", "105"]));
  });

  it("cards has labels 35/45/55", () => {
    const cardLabels = SECONDARY_MARKETS.filter((m) => m.stat === "cards").map(
      (m) => m.label,
    );
    expect(cardLabels).toEqual(expect.arrayContaining(["35", "45", "55"]));
  });

  it("sot has labels 75/95/105", () => {
    const sotLabels = SECONDARY_MARKETS.filter((m) => m.stat === "sot").map(
      (m) => m.label,
    );
    expect(sotLabels).toEqual(expect.arrayContaining(["75", "95", "105"]));
  });

  it("label matches line*10 as integer string", () => {
    for (const m of SECONDARY_MARKETS) {
      const expected = String(Math.round(m.line * 10));
      expect(m.label).toBe(expected);
    }
  });
});
