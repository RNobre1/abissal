/**
 * Tests for Poisson CDF approximation helpers (dist-helpers.ts).
 *
 * Poisson distribution: events happen at known average rate (mean), independently.
 * P(X <= k) = CDF; P(X > k) = 1 - CDF(k).
 *
 * Reference values computed via scipy.stats.poisson:
 *   poisson.pmf/cdf(k, mu)
 */
import { describe, it, expect } from "vitest";
import { poissonProbOver, poissonProbUnder } from "./dist-helpers";

describe("poissonProbOver", () => {
  it("P(X > 2.5 | mean=3.0) ≈ 0.353 (reference: 1 - Poisson.CDF(2, 3))", () => {
    // CDF(2, 3) = P(X<=2) = e^-3 * (1 + 3 + 4.5) = 0.4232
    // P(X > 2.5) = P(X >= 3) = 1 - P(X <= 2) ≈ 0.5768
    // Actually: P(X > 2.5) is same as P(X >= 3) since integer counts
    // scipy: 1 - poisson.cdf(2, 3) = 0.5768
    const p = poissonProbOver(3.0, 2.5);
    expect(p).toBeCloseTo(0.5768, 3);
  });

  it("P(X > 9.5 | mean=8.2) ≈ known reference value", () => {
    // scipy: 1 - poisson.cdf(9, 8.2) = 0.3085
    const p = poissonProbOver(8.2, 9.5);
    expect(p).toBeCloseTo(0.3085, 2);
  });

  it("P(X > 0 | mean=5) ≈ 1 - e^-5 ≈ 0.9933", () => {
    const p = poissonProbOver(5.0, 0.0);
    expect(p).toBeCloseTo(1 - Math.exp(-5), 4);
  });

  it("P(X > 100 | mean=5) ≈ 0 (tail far from mean)", () => {
    const p = poissonProbOver(5.0, 100.0);
    expect(p).toBeLessThan(0.00001);
  });

  it("clamps mean ≤ 0 to epsilon (returns near 0 for threshold > 0)", () => {
    const p = poissonProbOver(0, 2.5);
    expect(p).toBeLessThan(0.001);
  });

  it("clamps output to [0, 1]", () => {
    const p1 = poissonProbOver(100.0, 0.5);
    const p2 = poissonProbOver(0.001, 50.0);
    expect(p1).toBeLessThanOrEqual(1.0);
    expect(p2).toBeGreaterThanOrEqual(0.0);
  });

  it("P(X > 4.5 | mean=5.2) corners cards scenario", () => {
    // scipy: 1 - poisson.cdf(4, 5.2) = 0.5939
    const p = poissonProbOver(5.2, 4.5);
    expect(p).toBeCloseTo(0.5939, 2);
  });

  it("P(X > 9.5 | mean=10.5) corners scenario", () => {
    // scipy: 1 - poisson.cdf(9, 10.5) = 0.6029
    const p = poissonProbOver(10.5, 9.5);
    expect(p).toBeCloseTo(0.6029, 2);
  });
});

describe("poissonProbUnder", () => {
  it("poissonProbUnder + poissonProbOver = 1 for exact .5 thresholds", () => {
    // For half-integer thresholds, over+under = 1 exactly (no mass at .5)
    const mean = 8.5;
    const threshold = 9.5;
    const pOver = poissonProbOver(mean, threshold);
    const pUnder = poissonProbUnder(mean, threshold);
    expect(pOver + pUnder).toBeCloseTo(1.0, 6);
  });

  it("P(X < 9.5 | mean=8.2) = 1 - P(X > 9.5 | mean=8.2)", () => {
    const mean = 8.2;
    const threshold = 9.5;
    expect(poissonProbUnder(mean, threshold)).toBeCloseTo(
      1 - poissonProbOver(mean, threshold),
      6
    );
  });

  it("P(X < 4.5 | mean=3.5) > 0.5 (most mass below 4.5 when mean=3.5)", () => {
    // scipy: poisson.cdf(4, 3.5) = 0.7254 → P(X <= 4) when threshold=4.5
    const p = poissonProbUnder(3.5, 4.5);
    expect(p).toBeCloseTo(0.7254, 2);
  });
});
