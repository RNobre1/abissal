module AdamStats
  module Scraper
    module AiReco
      # Pure Ruby port do lib/ai-reco/edge-calculator.ts.
      # Specs paralelos: edge_calculator_spec.rb (Ruby) + edge-calculator.test.ts (TS).
      # Comportamento idêntico — mudanças devem ser sincronizadas.
      #
      # Pra cada mercado relevante (1x2/over25/btts), calcula:
      #   edge_pct = (prob_calibrado * odd - 1) * 100
      #   kelly fracionado (¼ Kelly) = ((prob*odd - 1) / (odd - 1)) / 4
      #   kelly_units = kelly_fracionado * (bankroll / 100)   [1 unit = 1% bankroll]
      #
      # Spec §3 Camada 1 + §5 (IA-2 Recomendador design).
      module EdgeCalculator
        DEFAULT_KELLY_FRACTION = 0.25

        module_function

        # @param sim [Hash] symbol keys: :p_home, :p_draw, :p_away, :p_over_25, :p_btts
        # @param odds [Hash] symbol keys: :home, :draw, :away, :over25, :under25, :btts_sim, :btts_nao
        # @param bankroll [Numeric] em unidades monetárias absolutas (1 unit = bankroll/100)
        # @param isotonic_lookup [Hash<String, Proc>, nil] map "metric-side" → fn(p) → p_calibrado
        # @param kelly_fraction [Numeric] default 0.25 (¼ Kelly)
        # @return [Array<Hash>] candidatos ordenados por edge_pct desc
        def build(sim, odds, bankroll, isotonic_lookup: nil, kelly_fraction: DEFAULT_KELLY_FRACTION)
          out = []

          # 1X2
          one_x2 = [
            { side: 'home', prob: sim[:p_home], odd: odds[:home], metric_key: '1x2-home' },
            { side: 'draw', prob: sim[:p_draw], odd: odds[:draw], metric_key: '1x2-draw' },
            { side: 'away', prob: sim[:p_away], odd: odds[:away], metric_key: '1x2-away' }
          ]
          one_x2.each do |t|
            next unless finite?(t[:prob]) && finite?(t[:odd])

            cal = calibrate(t[:metric_key], t[:prob], isotonic_lookup)
            out << build_candidate('1x2', t[:side], t[:prob], cal, t[:odd], bankroll, kelly_fraction)
          end

          # OVER/UNDER 2.5
          if finite?(sim[:p_over_25])
            cal_over = calibrate('over25', sim[:p_over_25], isotonic_lookup)
            cal_under = 1.0 - cal_over
            if finite?(odds[:over25])
              out << build_candidate('over25', 'over', sim[:p_over_25], cal_over,
                                     odds[:over25], bankroll, kelly_fraction)
            end
            if finite?(odds[:under25])
              out << build_candidate('over25', 'under', 1.0 - sim[:p_over_25], cal_under,
                                     odds[:under25], bankroll, kelly_fraction)
            end
          end

          # BTTS (sem isotônica por enquanto — não há curva treinada pra btts)
          if finite?(sim[:p_btts])
            sim_p = sim[:p_btts]
            nao_p = 1.0 - sim_p
            if finite?(odds[:btts_sim])
              out << build_candidate('btts', 'sim', sim_p, sim_p,
                                     odds[:btts_sim], bankroll, kelly_fraction)
            end
            if finite?(odds[:btts_nao])
              out << build_candidate('btts', 'nao', nao_p, nao_p,
                                     odds[:btts_nao], bankroll, kelly_fraction)
            end
          end

          out.sort_by { |c| -c[:edge_pct] }
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

        def build_candidate(market, side, prob_est, prob_cal, odd, bankroll, fraction)
          edge = (prob_cal * odd - 1.0) * 100.0
          units = kelly_units(prob_cal, odd, bankroll, fraction)
          {
            market: market, side: side,
            prob_estimated: prob_est, prob_calibrated: prob_cal,
            odd: odd, edge_pct: edge, kelly_units: units
          }
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
