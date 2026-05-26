/**
 * TDD — computeDefaultStake
 *
 * Regra (Wave B fix #1): quando `units_final` é non-null, a stake sugerida
 * é `units_final × (bankroll × units_per_bankroll / 100)`.
 * Fallback: se bankroll ou units_per_bankroll ausentes → 1% × bankroll_default
 * (100 BRL = 1 unit de 1000 BRL de banca default).
 */
import { describe, it, expect } from "vitest";
import { computeDefaultStake, DEFAULT_BANKROLL } from "./stake-calculator";

describe("computeDefaultStake", () => {
  describe("com units_final null → retorna 0", () => {
    it("retorna 0 quando units_final é null", () => {
      expect(computeDefaultStake(null, null)).toBe(0);
    });

    it("retorna 0 quando units_final é null mesmo com bankroll settings", () => {
      expect(
        computeDefaultStake(null, {
          bankroll: 1000,
          units_per_bankroll: 2,
        }),
      ).toBe(0);
    });
  });

  describe("com units_final 0 → retorna 0", () => {
    it("retorna 0 quando units_final é 0", () => {
      expect(computeDefaultStake(0, null)).toBe(0);
    });
  });

  describe("com settings null → usa banca default e 1% por unit", () => {
    it("units_final=1.5, settings=null → 1.5 × (DEFAULT_BANKROLL × 0.01)", () => {
      const expected = 1.5 * (DEFAULT_BANKROLL * 0.01);
      expect(computeDefaultStake(1.5, null)).toBeCloseTo(expected, 5);
    });

    it("units_final=1.0, settings=null → 1.0 × DEFAULT_BANKROLL * 0.01", () => {
      const expected = 1.0 * (DEFAULT_BANKROLL * 0.01);
      expect(computeDefaultStake(1.0, null)).toBeCloseTo(expected, 5);
    });
  });

  describe("com settings presentes → usa banca e units_per_bankroll reais", () => {
    it("units_final=1.5, bankroll=2000, units_per_bankroll=2 → 1.5 × (2000 × 0.02) = 60", () => {
      expect(
        computeDefaultStake(1.5, { bankroll: 2000, units_per_bankroll: 2 }),
      ).toBeCloseTo(60, 5);
    });

    it("units_final=0.5, bankroll=5000, units_per_bankroll=1 → 0.5 × 50 = 25", () => {
      expect(
        computeDefaultStake(0.5, { bankroll: 5000, units_per_bankroll: 1 }),
      ).toBeCloseTo(25, 5);
    });

    it("bankroll=0 → cai no fallback (DEFAULT_BANKROLL)", () => {
      // bankroll=0 é inválido; cai no fallback
      const expected = 1.5 * (DEFAULT_BANKROLL * 0.01);
      expect(
        computeDefaultStake(1.5, { bankroll: 0, units_per_bankroll: 2 }),
      ).toBeCloseTo(expected, 5);
    });

    it("units_per_bankroll=0 → cai no fallback (1% por unit)", () => {
      // units_per_bankroll=0 é inválido; cai no fallback
      const expected = 1.5 * (DEFAULT_BANKROLL * 0.01);
      expect(
        computeDefaultStake(1.5, { bankroll: 2000, units_per_bankroll: 0 }),
      ).toBeCloseTo(expected, 5);
    });
  });
});
