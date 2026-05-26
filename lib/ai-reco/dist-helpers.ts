/**
 * Poisson CDF helpers for secondary-market probability approximation.
 *
 * WHY POISSON: Goals, corners, cards, and shots on target are count data that
 * follow Poisson distributions reasonably well. Given p50 from sim_stats as
 * the "mean", we approximate P(X > threshold) via the Poisson CDF complement.
 *
 * LIMITATION (V1): p50 is a median, not a mean. For symmetric distributions
 * they coincide; for Poisson (slightly right-skewed), median ≈ floor(mean + 1/3).
 * The error is typically < 5% for means in the 3-15 range (corners/cards/SOT).
 * V2 should use the actual sample distribution from Monte Carlo runs.
 *
 * Algorithm: compute Poisson CDF via the regularized incomplete gamma function.
 * We use a direct series expansion for efficiency (no external deps).
 *
 * Formula:
 *   P(X = k | mean) = e^-mean * mean^k / k!
 *   P(X <= k) = sum_{i=0}^{k} P(X = i)
 *   P(X > threshold) = P(X >= ceil(threshold + epsilon)) = 1 - P(X <= floor(threshold))
 *
 * For half-integer thresholds (e.g. 9.5), floor(9.5) = 9, so:
 *   P(X > 9.5) = P(X >= 10) = 1 - P(X <= 9)
 */

const MAX_ITER = 200;

/**
 * Computes P(X > threshold | Poisson(mean)).
 * Threshold is treated continuously: P(X > 9.5) = P(X >= 10).
 *
 * @param mean - Expected value (rate parameter λ). Clamped to [1e-9, ∞).
 * @param threshold - Line to exceed. Non-integer safe (uses floor).
 * @returns Probability in [0, 1].
 */
export function poissonProbOver(mean: number, threshold: number): number {
  if (!Number.isFinite(mean) || !Number.isFinite(threshold)) return 0;
  const lambda = Math.max(mean, 1e-9);
  const k = Math.floor(threshold);
  // P(X > threshold) = 1 - P(X <= k) = 1 - CDF(k)
  const cdf = poissonCDF(lambda, k);
  return Math.min(1, Math.max(0, 1 - cdf));
}

/**
 * Computes P(X < threshold | Poisson(mean)).
 * For half-integer thresholds this is the complement of poissonProbOver.
 *
 * @param mean - Expected value (rate parameter λ).
 * @param threshold - Line. P(X < 9.5) = P(X <= 9) = CDF(9).
 * @returns Probability in [0, 1].
 */
export function poissonProbUnder(mean: number, threshold: number): number {
  if (!Number.isFinite(mean) || !Number.isFinite(threshold)) return 0;
  const lambda = Math.max(mean, 1e-9);
  const k = Math.floor(threshold);
  return Math.min(1, Math.max(0, poissonCDF(lambda, k)));
}

/**
 * Poisson CDF: P(X <= k | lambda).
 * Uses log-space accumulation to avoid overflow for large lambda.
 */
function poissonCDF(lambda: number, k: number): number {
  if (k < 0) return 0;
  // accumulate log probabilities: logP(X=i) = -lambda + i*log(lambda) - logFactorial(i)
  let logP = -lambda; // log P(X=0)
  let cdf = Math.exp(logP);
  for (let i = 1; i <= k && i < MAX_ITER; i++) {
    logP += Math.log(lambda) - Math.log(i);
    cdf += Math.exp(logP);
  }
  return Math.min(1, cdf);
}
