module AdamStats
  module Scraper
    module Simulation
      # SecondaryStats — Negative Binomial sampler for overdispersed secondary
      # match stats (corners, cards, SOT, ...) per spec §6.2. Implemented as a
      # Gamma-Poisson mixture: λ ~ Gamma(r, μ/r); k ~ Poisson(λ).
      # ⇒ E[k] = μ, Var[k] = μ + μ²/r  (overdispersed: Var > mean).
      #
      # `dispersion` is the NB size parameter r (estimated from the ~19
      # per-match values via .dispersion_from). nil/zero ⇒ falls back to a
      # plain Poisson(μ) draw (still valid, no overdispersion).
      #
      # All randomness flows through a caller-supplied seeded `Random` ⇒
      # deterministic given a fixed seed.
      module SecondaryStats
        module_function

        def sample(rng, mean, dispersion)
          mu = mean.to_f
          return 0 if mu <= 0

          r = dispersion.to_f if dispersion
          if r.nil? || r <= 0
            poisson(rng, mu)
          else
            lam = gamma(rng, r, mu / r)
            poisson(rng, lam)
          end
        end

        # Estimate the NB size r from observed per-match values using the
        # method of moments: Var = μ + μ²/r ⇒ r = μ² / (Var − μ).
        # Returns nil when the sample is empty or NOT overdispersed (Var ≤ μ).
        def dispersion_from(values)
          vals = Array(values).map { |v| coerce_float(v) }.compact
          return nil if vals.size < 2

          n = vals.size.to_f
          mu = vals.sum / n
          var = vals.sum { |x| (x - mu)**2 } / n
          return nil if mu <= 0 || var <= mu

          (mu**2) / (var - mu)
        end

        # Explicit narrow rescue (project idiom — matches rates.rb / runner.rb /
        # player_allocation.rb) instead of a bare `Float(v) rescue nil`, which
        # would swallow every StandardError, not just bad-input coercion.
        def coerce_float(v)
          Float(v)
        rescue ArgumentError, TypeError
          nil
        end
        private_class_method :coerce_float

        # Knuth's algorithm for small λ; transformed-rejection-ish guard for
        # large λ via a normal approximation (kept simple, deterministic).
        def poisson(rng, lambda)
          return 0 if lambda <= 0

          if lambda < 30
            l = Math.exp(-lambda)
            k = 0
            p = 1.0
            loop do
              k += 1
              p *= rng.rand
              break if p <= l
            end
            k - 1
          else
            # Normal approximation for large means (corners/SOT rarely here).
            val = (gaussian(rng) * Math.sqrt(lambda) + lambda).round
            val.negative? ? 0 : val
          end
        end
        private_class_method :poisson

        # Marsaglia-Tsang gamma sampler (shape k, scale theta), seeded rng.
        def gamma(rng, shape, scale)
          return 0.0 if shape <= 0 || scale <= 0

          if shape < 1
            u = rng.rand
            return gamma(rng, shape + 1, scale) * (u**(1.0 / shape))
          end

          d = shape - (1.0 / 3.0)
          c = 1.0 / Math.sqrt(9 * d)
          loop do
            x = gaussian(rng)
            v = (1 + c * x)**3
            next if v <= 0

            u = rng.rand
            if u < 1 - 0.0331 * (x**4) ||
               Math.log(u) < 0.5 * x**2 + d * (1 - v + Math.log(v))
              return d * v * scale
            end
          end
        end
        private_class_method :gamma

        # Box-Muller standard normal from a seeded rng.
        def gaussian(rng)
          u1 = rng.rand
          u1 = Float::MIN if u1 <= 0
          u2 = rng.rand
          Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math::PI * u2)
        end
        private_class_method :gaussian
      end
    end
  end
end
