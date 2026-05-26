module AdamStats
  module Scraper
    module AiReco
      # Poisson CDF helpers for secondary-market probability approximation.
      #
      # WHY POISSON: Goals, corners, cards, and shots on target are count data
      # that follow Poisson distributions reasonably well. Given the mean from
      # sim_stats (p50 used as approximation), we compute P(X > threshold) and
      # P(X <= threshold) via the Poisson CDF.
      #
      # LIMITATION (V1): p50 is a median, not a mean. For symmetric distributions
      # they coincide; for Poisson (slightly right-skewed), median ≈ floor(mean + 1/3).
      # The error is typically < 5% for means in the 3-15 range (corners/cards/SOT).
      # V2 should use the actual sample distribution from Monte Carlo runs.
      #
      # Algorithm: log-space accumulation to avoid overflow for large lambda.
      #   P(X = 0) = e^-lambda
      #   P(X = i) = P(X = i-1) * lambda / i
      #   P(X > threshold) = 1 - P(X <= floor(threshold))
      module DistHelpers
        MAX_ITER = 200
        EPSILON  = 1e-9

        module_function

        # Computes P(X > threshold | Poisson(mean)).
        # @param mean [Numeric] expected value (λ). Clamped to [EPSILON, ∞).
        # @param threshold [Numeric] line. Non-integer safe (floor applied).
        # @return [Float] probability in [0, 1].
        def poisson_prob_over(mean, threshold)
          return 0.0 unless mean.is_a?(Numeric) && threshold.is_a?(Numeric)

          lambda = [mean.to_f, EPSILON].max
          k = threshold.to_f.floor
          cdf = poisson_cdf(lambda, k)
          [[1.0 - cdf, 0.0].max, 1.0].min
        end

        # Computes P(X <= threshold | Poisson(mean)).
        # @param mean [Numeric] expected value.
        # @param threshold [Numeric] line.
        # @return [Float] probability in [0, 1].
        def poisson_prob_under(mean, threshold)
          return 0.0 unless mean.is_a?(Numeric) && threshold.is_a?(Numeric)

          lambda = [mean.to_f, EPSILON].max
          k = threshold.to_f.floor
          [[poisson_cdf(lambda, k), 0.0].max, 1.0].min
        end

        # Poisson CDF: P(X <= k | lambda). Log-space accumulation.
        def poisson_cdf(lambda, k)
          return 0.0 if k < 0

          # logP(X=0) = -lambda; P(X=i) = P(X=i-1) * lambda / i
          log_p = -lambda
          cdf = Math.exp(log_p)
          ([k, MAX_ITER].min).times do |i|
            next_i = i + 1
            log_p += Math.log(lambda) - Math.log(next_i)
            cdf += Math.exp(log_p)
          end
          [cdf, 1.0].min
        end
      end
    end
  end
end
