/**
 * Tests for CRPS (Continuous Ranked Probability Score) implementation.
 *
 * Reference: Gneiting & Raftery (2007), eq. 4
 * Hersbach (2000) closed-form for empirical CDF via samples.
 *
 * Since sim_stats stores only p10/p50/p90 percentiles (not raw samples),
 * the implementation uses interpolated 3-point CDF representation.
 */
import { describe, it, expect } from "vitest";
import {
  crpsFromPercentiles,
  crpsFromSamples,
  crpsThreePoint,
  type PercentileSummary,
} from "../crps";

describe("crpsFromSamples — empirical CDF form", () => {
  /**
   * When all samples equal the observed value, CRPS = 0 (perfect forecast).
   */
  it("returns 0 when samples are all equal to observed", () => {
    const samples = [3, 3, 3, 3, 3];
    expect(crpsFromSamples(samples, 3)).toBeCloseTo(0, 6);
  });

  /**
   * Closed-form Hersbach (2000):
   * CRPS(F, y) = E|X - y| - E|X - X'| / 2
   * For samples = [1, 2, 3, 4, 5] (uniform discrete), y = 3:
   * E|X - y| = (|1-3| + |2-3| + |3-3| + |4-3| + |5-3|) / 5 = (2+1+0+1+2)/5 = 6/5 = 1.2
   * E|X - X'| / 2 = (sum_i sum_j |x_i - x_j|) / (2 * N^2)
   *               = (2*(1+2+3+4 + 1+2+3 + 1+2 + 1)) / (2*25)
   *               = computed below
   * Pairwise |x_i - x_j| for [1,2,3,4,5]:
   * Total sum = 2*(1+2+3+4 + 1+2+3 + 1+2 + 1) = 2*(10+6+3+1) = 2*20 = 40
   * E|X - X'| / 2 = 40 / (2 * 25) = 40/50 = 0.8
   * CRPS = 1.2 - 0.8 = 0.4
   */
  it("computes correct CRPS for uniform discrete distribution [1,2,3,4,5], y=3", () => {
    const samples = [1, 2, 3, 4, 5];
    expect(crpsFromSamples(samples, 3)).toBeCloseTo(0.4, 6);
  });

  /**
   * For a deterministic forecast at x=a, CRPS = |a - y|.
   * Samples = [5, 5, 5], y = 2:
   * CRPS = |5 - 2| - 0 = 3
   */
  it("CRPS equals |mean - y| for a degenerate (point-mass) distribution", () => {
    const samples = [5, 5, 5];
    expect(crpsFromSamples(samples, 2)).toBeCloseTo(3, 6);
  });

  /**
   * Symmetry: CRPS(F, y) doesn't change sign based on whether y is above/below center.
   * For [1,2,3,4,5], CRPS(y=1) should equal CRPS(y=5) by symmetry.
   */
  it("is symmetric: CRPS([1..5], 1) == CRPS([1..5], 5)", () => {
    const samples = [1, 2, 3, 4, 5];
    const c1 = crpsFromSamples(samples, 1);
    const c5 = crpsFromSamples(samples, 5);
    expect(c1).toBeCloseTo(c5, 6);
  });

  /**
   * Wider distribution has higher CRPS for same observed value.
   * narrow: [3,3,3,3,3], y=3 → CRPS=0
   * wide: [1,2,3,4,5], y=3 → CRPS=0.4
   */
  it("wider distribution has higher CRPS", () => {
    const narrow = crpsFromSamples([3, 3, 3, 3, 3], 3);
    const wide = crpsFromSamples([1, 2, 3, 4, 5], 3);
    expect(wide).toBeGreaterThan(narrow);
  });

  /**
   * Non-negative: CRPS is always >= 0.
   */
  it("returns non-negative value", () => {
    const samples = [2, 4, 6, 8, 10];
    expect(crpsFromSamples(samples, 15)).toBeGreaterThanOrEqual(0);
    expect(crpsFromSamples(samples, 0)).toBeGreaterThanOrEqual(0);
    expect(crpsFromSamples(samples, 6)).toBeGreaterThanOrEqual(0);
  });

  /**
   * Empty samples edge case: returns 0 (no information).
   */
  it("returns 0 for empty samples array", () => {
    expect(crpsFromSamples([], 5)).toBe(0);
  });

  /**
   * Single sample: CRPS = |sample - y|.
   * samples = [4], y = 7 → CRPS = 3
   */
  it("single sample: CRPS = |sample - y|", () => {
    expect(crpsFromSamples([4], 7)).toBeCloseTo(3, 6);
  });
});

describe("crpsThreePoint — from p10/p50/p90 via linear interpolation", () => {
  /**
   * When p10=p50=p90=y, CRPS ≈ 0 (degenerate perfect).
   */
  it("returns near 0 when all percentiles equal the observed", () => {
    expect(crpsThreePoint({ p10: 5, p50: 5, p90: 5 }, 5)).toBeCloseTo(0, 3);
  });

  /**
   * Sharp distribution concentrated around y should score better than
   * a wide diffuse distribution.
   */
  it("sharp distribution scores better than wide for same observation", () => {
    const narrow: PercentileSummary = { p10: 4, p50: 5, p90: 6 };
    const wide: PercentileSummary = { p10: 1, p50: 5, p90: 9 };
    const crpsNarrow = crpsThreePoint(narrow, 5);
    const crpsWide = crpsThreePoint(wide, 5);
    expect(crpsNarrow).toBeLessThan(crpsWide);
  });

  /**
   * When observation is outside the distribution range, CRPS increases.
   */
  it("returns larger score when observation is far outside distribution", () => {
    const dist: PercentileSummary = { p10: 3, p50: 5, p90: 7 };
    const inside = crpsThreePoint(dist, 5);
    const outside = crpsThreePoint(dist, 20);
    expect(outside).toBeGreaterThan(inside);
  });

  /**
   * Non-negative property.
   */
  it("always returns non-negative value", () => {
    const dist: PercentileSummary = { p10: 2, p50: 4, p90: 8 };
    expect(crpsThreePoint(dist, 0)).toBeGreaterThanOrEqual(0);
    expect(crpsThreePoint(dist, 4)).toBeGreaterThanOrEqual(0);
    expect(crpsThreePoint(dist, 100)).toBeGreaterThanOrEqual(0);
  });
});

describe("crpsFromPercentiles — p10/p50/p90 shortcut", () => {
  it("delegates correctly to crpsThreePoint", () => {
    const p: PercentileSummary = { p10: 3, p50: 6, p90: 9 };
    expect(crpsFromPercentiles(p, 6)).toBe(crpsThreePoint(p, 6));
  });

  it("handles null/missing fields gracefully by returning null", () => {
    // When sim_stats doesn't have percentile data (e.g. metric not simulated)
    expect(crpsFromPercentiles(null, 6)).toBeNull();
    expect(crpsFromPercentiles(undefined, 6)).toBeNull();
    expect(crpsFromPercentiles({ p10: null, p50: 5, p90: 9 } as unknown as PercentileSummary, 6)).toBeNull();
  });
});
