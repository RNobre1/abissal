module AdamStats
  module Scraper
    module AiReco
      # Pure Ruby port do lib/ai-reco/edge-calculator.ts.
      # Specs paralelos: edge_calculator_spec.rb (Ruby) + edge-calculator.test.ts (TS).
      # Comportamento idêntico — mudanças devem ser sincronizadas.
      #
      # Pra cada mercado relevante (1x2/over25/btts), calcula:
      #   prob_blended = α · prob_calibrado + (1 − α) · prob_market_devigged
      #   edge_pct     = (prob_blended * odd - 1) * 100
      #   kelly fracionado (¼ Kelly) = ((prob*odd - 1) / (odd - 1)) / 4
      #   kelly_units = kelly_fracionado * (bankroll / 100)   [1 unit = 1% bankroll]
      #
      # Blending sim × mercado (v1 universal, default α=1.0 retrocompat):
      #   - α=1.0 → sim puro (status quo histórico).
      #   - α=0.5 → 50/50 com mercado devigado (atenua edges absurdos em ligas
      #     sem league_parameters calibrados, ex: Kolding IF 114%).
      #   - α=0.0 → 100% mercado → edge ≈ -vig sempre.
      #
      # TODO v2 (Wave 3+): α aprendido por liga via fit em fixture_simulations
      #   resolvidas (regressão ROI vs α). Atualmente usamos universal pelo
      #   simulador (sem dataset histórico por liga calibrado pra aprender α).
      #
      # Spec §3 Camada 1 + §5 (IA-2 Recomendador design).
      module EdgeCalculator
        DEFAULT_KELLY_FRACTION = 0.25
        DEFAULT_BLEND_ALPHA = 1.0

        module_function

        # @param sim [Hash] symbol keys: :p_home, :p_draw, :p_away, :p_over_25, :p_btts
        # @param odds [Hash] symbol keys: :home, :draw, :away, :over25, :under25, :btts_sim, :btts_nao
        # @param bankroll [Numeric] em unidades monetárias absolutas (1 unit = bankroll/100)
        # @param isotonic_lookup [Hash<String, Proc>, nil] map "metric-side" → fn(p) → p_calibrado
        # @param kelly_fraction [Numeric] default 0.25 (¼ Kelly)
        # @param blend_alpha [Numeric] 0..1; default 1.0. < 1.0 ativa blending sim × mercado.
        # @return [Array<Hash>] candidatos ordenados por edge_pct desc
        def build(sim, odds, bankroll,
                  isotonic_lookup: nil,
                  kelly_fraction: DEFAULT_KELLY_FRACTION,
                  blend_alpha: DEFAULT_BLEND_ALPHA)
          alpha = clamp_alpha(blend_alpha)
          out = []

          # 1X2 — devig conjunto dos 3 inversos
          one_x2_devig = alpha < 1.0 ? devig_proportional([odds[:home], odds[:draw], odds[:away]]) : nil
          one_x2 = [
            { side: 'home', prob: sim[:p_home], odd: odds[:home], metric_key: '1x2-home', mp: one_x2_devig && one_x2_devig[0] },
            { side: 'draw', prob: sim[:p_draw], odd: odds[:draw], metric_key: '1x2-draw', mp: one_x2_devig && one_x2_devig[1] },
            { side: 'away', prob: sim[:p_away], odd: odds[:away], metric_key: '1x2-away', mp: one_x2_devig && one_x2_devig[2] }
          ]
          one_x2.each do |t|
            next unless finite?(t[:prob]) && finite?(t[:odd])

            cal = calibrate(t[:metric_key], t[:prob], isotonic_lookup)
            blended = blend(cal, t[:mp], alpha)
            out << build_candidate('1x2', t[:side], t[:prob], cal, t[:mp], blended,
                                   t[:odd], bankroll, kelly_fraction, alpha)
          end

          # OVER/UNDER 2.5 — devig do par (over, under)
          ou_devig = alpha < 1.0 ? devig_proportional([odds[:over25], odds[:under25]]) : nil
          if finite?(sim[:p_over_25])
            cal_over = calibrate('over25', sim[:p_over_25], isotonic_lookup)
            cal_under = 1.0 - cal_over
            if finite?(odds[:over25])
              mp = ou_devig && ou_devig[0]
              blended = blend(cal_over, mp, alpha)
              out << build_candidate('over25', 'over', sim[:p_over_25], cal_over, mp, blended,
                                     odds[:over25], bankroll, kelly_fraction, alpha)
            end
            if finite?(odds[:under25])
              mp = ou_devig && ou_devig[1]
              blended = blend(cal_under, mp, alpha)
              out << build_candidate('over25', 'under', 1.0 - sim[:p_over_25], cal_under, mp, blended,
                                     odds[:under25], bankroll, kelly_fraction, alpha)
            end
          end

          # BTTS (sem isotônica por enquanto)
          btts_devig = alpha < 1.0 ? devig_proportional([odds[:btts_sim], odds[:btts_nao]]) : nil
          if finite?(sim[:p_btts])
            sim_p = sim[:p_btts]
            nao_p = 1.0 - sim_p
            if finite?(odds[:btts_sim])
              mp = btts_devig && btts_devig[0]
              blended = blend(sim_p, mp, alpha)
              out << build_candidate('btts', 'sim', sim_p, sim_p, mp, blended,
                                     odds[:btts_sim], bankroll, kelly_fraction, alpha)
            end
            if finite?(odds[:btts_nao])
              mp = btts_devig && btts_devig[1]
              blended = blend(nao_p, mp, alpha)
              out << build_candidate('btts', 'nao', nao_p, nao_p, mp, blended,
                                     odds[:btts_nao], bankroll, kelly_fraction, alpha)
            end
          end

          out.sort_by { |c| -c[:edge_pct] }
        end

        # Devig proporcional: probs_i = (1/odd_i) / sum(1/odd_j).
        # Inputs inválidos (nil/NaN/odd<=1) viram nil no output, mas a normalização
        # ignora esses inversos no denominador (output dos válidos soma 1.0).
        #
        # @param odds [Array<Numeric|nil>]
        # @return [Array<Float|nil>]
        def devig_proportional(odds)
          invs = odds.map { |o| (o.is_a?(Numeric) && o > 1) ? (1.0 / o) : nil }
          sum = invs.compact.sum
          return invs.map { nil } if sum <= 0

          invs.map { |v| v.nil? ? nil : v / sum }
        end

        def finite?(x)
          x.is_a?(Numeric) && x.respond_to?(:finite?) ? x.finite? : x.is_a?(Numeric)
        end

        def calibrate(metric_key, prob, lookup)
          return prob unless lookup.is_a?(Hash)

          fn = lookup[metric_key] || lookup[metric_key.to_sym]
          return prob unless fn.respond_to?(:call)

          out = fn.call(prob)
          return prob unless out.is_a?(Numeric) && (!out.respond_to?(:finite?) || out.finite?)

          [[out, 0.0].max, 1.0].min
        end

        def clamp_alpha(a)
          return DEFAULT_BLEND_ALPHA unless a.is_a?(Numeric) && a.finite?
          return 0.0 if a < 0
          return 1.0 if a > 1

          a.to_f
        end

        def blend(prob_cal, prob_market, alpha)
          return prob_cal if alpha >= 1.0
          return prob_cal unless prob_market.is_a?(Numeric) && prob_market.finite?

          alpha * prob_cal + (1.0 - alpha) * prob_market
        end

        def build_candidate(market, side, prob_est, prob_cal, prob_market, prob_blended,
                            odd, bankroll, fraction, alpha)
          edge = (prob_blended * odd - 1.0) * 100.0
          units = kelly_units(prob_blended, odd, bankroll, fraction)
          result = {
            market: market, side: side,
            prob_estimated: prob_est, prob_calibrated: prob_cal,
            odd: odd, edge_pct: edge, kelly_units: units
          }
          if alpha < 1.0
            result[:prob_market] = prob_market
            result[:prob_blended] = prob_blended
          end
          result
        end

        def kelly_units(prob, odd, bankroll, fraction)
          b = odd - 1.0
          return 0 if b <= 0

          q = 1.0 - prob
          f = (prob * b - q) / b
          return 0 if f <= 0

          (f * fraction * bankroll) / 100.0
        end
      end
    end
  end
end
