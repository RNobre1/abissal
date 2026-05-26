/**
 * CRPS — Continuous Ranked Probability Score
 *
 * Measures the accuracy of a probabilistic forecast against an observed scalar.
 * Lower is better; 0 = perfect forecast.
 *
 * Reference: Gneiting & Raftery (2007), "Strictly Proper Scoring Rules,
 * Prediction, and Estimation", JASA, eq. 4.
 *
 * Implementation uses the Hersbach (2000) closed-form for empirical CDF:
 *   CRPS(F, y) = E|X - y| - (1/2) * E|X - X'|
 * where X, X' are i.i.d. draws from the forecast distribution F.
 *
 * Since sim_stats stores only p10/p50/p90 (not raw samples), a 3-point
 * interpolated CDF form is provided via crpsThreePoint / crpsFromPercentiles.
 */

export interface PercentileSummary {
  p10: number | null;
  p50: number | null;
  p90: number | null;
}

/**
 * Compute CRPS from raw Monte Carlo samples.
 *
 * Uses the Hersbach (2000) energy-form:
 *   CRPS = E|X - y| - (1/2) E|X - X'|
 *
 * The second term is computed efficiently via:
 *   E|X - X'| / 2 = sum_i sum_j |x_i - x_j| / (2 * N^2)
 *
 * Time complexity: O(N log N) via sorted pairwise sum identity:
 *   sum_j |x_i - x_j| (sorted) = x_i * (2i - N) - sum_{j<i} x_j + sum_{j>i} x_j
 *
 * @param samples - Array of forecast samples (e.g., Monte Carlo draws)
 * @param observed - The observed scalar value
 * @returns CRPS score (0 = perfect, higher = worse)
 */
export function crpsFromSamples(samples: number[], observed: number): number {
  if (samples.length === 0) return 0;

  const n = samples.length;

  // E|X - y|
  const eMeanY =
    samples.reduce((acc, x) => acc + Math.abs(x - observed), 0) / n;

  // (1/2) E|X - X'| via efficient sorted form: O(N log N)
  const sorted = [...samples].sort((a, b) => a - b);
  let pairwiseSum = 0;
  let cumSum = 0;
  for (let i = 0; i < n; i++) {
    // sum_j |x_i - x_j| for sorted array:
    // = x_i * i - cumSum  (for j < i)
    // + (totalSum - cumSum - x_i) - x_i * (n - i - 1)  (for j > i)
    // Simplified: x_i * (2i + 1 - n) - 2 * cumSum + totalSuffix
    // Even simpler: accumulate directly
    pairwiseSum += sorted[i] * i - cumSum;
    cumSum += sorted[i];
  }
  // pairwiseSum already captures the upper triangle sum_i<j |x_i - x_j|
  // since sorted: |x_j - x_i| = x_j - x_i for j > i.
  // Full E|X - X'| = 2 * pairwiseSum / N^2
  const eHalfPairwise = pairwiseSum / (n * n);

  return eMeanY - eHalfPairwise;
}

/**
 * Compute CRPS from a 3-point summary (p10, p50, p90) using a piecewise-linear
 * CDF approximation.
 *
 * The forecast CDF F is modeled as:
 *   - 0 for x < p10
 *   - linear from 0.10 to 0.50 between p10 and p50
 *   - linear from 0.50 to 0.90 between p50 and p90
 *   - 1 for x > p90 (approximation: tails beyond p90 are capped)
 *
 * The approximation adds a Gaussian tail beyond p10/p90 to avoid the
 * hard-cutoff artifact, but for simplicity we extend with:
 *   - linear 0 to 0.10 from (p10 - spread) to p10
 *   - linear 0.90 to 1.0 from p90 to (p90 + spread)
 * where spread = (p90 - p10) / 2 (heuristic symmetric tail).
 *
 * CRPS = integral_-inf^+inf (F(x) - 1[x>=y])^2 dx
 * evaluated numerically on a grid.
 *
 * @param pct - p10/p50/p90 percentile summary
 * @param observed - The observed scalar value
 * @returns CRPS score
 */
export function crpsThreePoint(pct: PercentileSummary, observed: number): number {
  return crpsThreePointClean(pct, observed);
}

/**
 * Clean implementation of crpsThreePoint using explicit integral partitioning.
 */
function crpsThreePointClean(pct: PercentileSummary, observed: number): number {
  const { p10, p50, p90 } = pct;
  if (p10 == null || p50 == null || p90 == null) return 0;

  if (p10 === p50 && p50 === p90) {
    return Math.abs(p10 - observed);
  }

  const spread = Math.max((p90 - p10) / 2, 1e-9);
  const segments: Array<[number, number, number, number]> = [
    // [xa, fa, xb, fb]
    [p10 - spread, 0.0, p10, 0.1],
    [p10, 0.1, p50, 0.5],
    [p50, 0.5, p90, 0.9],
    [p90, 0.9, p90 + spread, 1.0],
  ];

  let crps = 0.0;

  // Before first segment: F=0, H varies
  // [−∞, p10-spread]: F=0
  //   if observed < p10-spread: H=0 → integrand 0
  //   if observed >= p10-spread: H steps to 1 at x=observed (which is beyond this region)
  // Since we can't integrate to -inf, we handle: F=0 from -inf to first x.
  // integral of (0 - H)^2 from -inf to x0 = 0 if observed >= x0 (H=1 in [x0..observed])
  //   = integral from x0 to observed of 1^2 dx? No: -inf to x0, H=0 since x<observed (if observed>x0).
  // Actually if observed > first_x = p10-spread, then in [-inf, first_x], H=0, F=0 → 0.
  // After last segment: F=1 from p90+spread to +inf.
  // if observed <= p90+spread: H=1 in [observed, p90+spread] already handled in segments.
  //   if observed < p90+spread: nothing after x4
  // if observed > p90+spread: integral of (1-0)^2 = 1 per unit from p90+spread to observed.

  for (const [xa, fa, xb, fb] of segments) {
    crps += integrateSquaredDiff(xa, fa, xb, fb, observed);
  }

  // Tail: F=0 before p10-spread, H=0 before observed.
  // If observed < p10-spread: integral of (0-1)^2 from observed to p10-spread.
  const x0 = p10 - spread;
  if (observed < x0) {
    crps += x0 - observed; // integral of 1^2 dx
  }

  // Tail: F=1 after p90+spread.
  const x4 = p90 + spread;
  if (observed > x4) {
    crps += observed - x4; // integral of (1-0)^2 dx from x4 to observed
  }

  return crps;
}

/**
 * Integrate (F(x) - H(x >= y))^2 dx over [xa, xb]
 * where F is linear from fa to fb, and H is Heaviside step at y=observed.
 */
function integrateSquaredDiff(
  xa: number,
  fa: number,
  xb: number,
  fb: number,
  observed: number,
): number {
  const dx = xb - xa;
  if (dx <= 0) return 0;

  // If y <= xa: H=1 throughout [xa, xb]
  // If y >= xb: H=0 throughout [xa, xb]
  // Otherwise: split at y

  if (observed <= xa) {
    // H=1, integrate (F(x) - 1)^2 dx
    return integrateLinearSquared(xa, fa, xb, fb, 1.0);
  } else if (observed >= xb) {
    // H=0, integrate (F(x) - 0)^2 dx
    return integrateLinearSquared(xa, fa, xb, fb, 0.0);
  } else {
    // Split: [xa, observed] with H=0, [observed, xb] with H=1
    // F at observed via linear interpolation
    const t = (observed - xa) / dx;
    const fMid = fa + t * (fb - fa);
    const left = integrateLinearSquared(xa, fa, observed, fMid, 0.0);
    const right = integrateLinearSquared(observed, fMid, xb, fb, 1.0);
    return left + right;
  }
}

/**
 * Integral of (F(x) - h)^2 dx from xa to xb
 * where F(x) = fa + (x-xa)/(xb-xa) * (fb-fa) is linear.
 *
 * Let u = F(x)-h, linear from (fa-h) to (fb-h).
 * Integral of u^2 dx = (dx/3) * (ua^2 + ua*ub + ub^2)
 * (Gauss quadrature for linear function squared).
 */
function integrateLinearSquared(
  xa: number,
  fa: number,
  xb: number,
  fb: number,
  h: number,
): number {
  const dx = xb - xa;
  if (dx <= 0) return 0;
  const ua = fa - h;
  const ub = fb - h;
  return (dx / 3.0) * (ua * ua + ua * ub + ub * ub);
}

/**
 * Compute CRPS from a PercentileSummary (p10/p50/p90).
 * Returns null if the summary is missing or incomplete.
 *
 * @param pct - percentile summary (may be null/undefined)
 * @param observed - observed scalar value
 * @returns CRPS score, or null if pct is invalid
 */
export function crpsFromPercentiles(
  pct: PercentileSummary | null | undefined,
  observed: number,
): number | null {
  if (!pct) return null;
  if (pct.p10 == null || pct.p50 == null || pct.p90 == null) return null;
  return crpsThreePoint(pct, observed);
}
