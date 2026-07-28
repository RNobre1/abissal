require_relative 'dist_helpers'

module AdamStats
  module Scraper
    module AiReco
      # Pure Ruby port do lib/ai-reco/edge-calculator.ts.
      # Specs paralelos: edge_calculator_spec.rb (Ruby) + edge-calculator.test.ts (TS).
      # Comportamento idêntico — mudanças devem ser sincronizadas.
      #
      # Wave O+E (2026-05-26): adicionados mercados secundários corners/cards/SOT
      # usando Poisson CDF aproximação (DistHelpers).
      #
      # Pra cada mercado relevante (1x2/over25/btts/corners/cards/sot), calcula:
      #   prob_blended = α · prob_calibrado + (1 − α) · prob_market_devigged
      #   edge_pct     = (prob_blended * odd - 1) * 100
      #   kelly fracionado (⅛ Kelly) = ((prob*odd - 1) / (odd - 1)) / 8
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
        # R2 walk-forward (2026-05-25 noite): ¼ Kelly → ⅛ Kelly
        DEFAULT_KELLY_FRACTION = 0.125
        DEFAULT_BLEND_ALPHA = 1.0

        module_function

        # @param sim [Hash] symbol keys: :p_home, :p_draw, :p_away, :p_over_25, :p_btts
        # @param odds [Hash] symbol keys: :home, :draw, :away, :over25, :under25, :btts_sim, :btts_nao
        # @param bankroll [Numeric] em unidades monetárias absolutas (1 unit = bankroll/100)
        # @param isotonic_lookup [Hash<String, Proc>, nil] map "metric-side" → fn(p) → p_calibrado
        # @param kelly_fraction [Numeric] default 0.125 (⅛ Kelly; R2 walk-forward: ¼→⅛)
        # @param blend_alpha [Numeric] 0..1; default 1.0. < 1.0 ativa blending sim × mercado.
        # @return [Array<Hash>] candidatos ordenados por edge_pct desc
        def build(sim, odds, bankroll,
                  isotonic_lookup: nil,
                  kelly_fraction: DEFAULT_KELLY_FRACTION,
                  blend_alpha: DEFAULT_BLEND_ALPHA,
                  dist_k: {})
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
            # Fix 2/3: o under tem curva PRÓPRIA ('over25-under') porque a
            # calibração é assimétrica (over ~ok, under era 1/18 na IA). Sem a
            # curva, fallback pra 1 − cal_over (comportamento pré-Fix2).
            raw_under = 1.0 - sim[:p_over_25]
            cal_under = has_curve?(isotonic_lookup, 'over25-under') ?
                          calibrate('over25-under', raw_under, isotonic_lookup) :
                          (1.0 - cal_over)
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

          # BTTS — Fix 2/3: agora calibrado ('btts' sim / 'btts-nao'). Sem curva,
          # cai no raw (sim) e em 1 − cal_sim (nao) — preserva comportamento.
          btts_devig = alpha < 1.0 ? devig_proportional([odds[:btts_sim], odds[:btts_nao]]) : nil
          if finite?(sim[:p_btts])
            sim_p = sim[:p_btts]
            nao_p = 1.0 - sim_p
            cal_sim = calibrate('btts', sim_p, isotonic_lookup)
            cal_nao = has_curve?(isotonic_lookup, 'btts-nao') ?
                        calibrate('btts-nao', nao_p, isotonic_lookup) :
                        (1.0 - cal_sim)
            if finite?(odds[:btts_sim])
              mp = btts_devig && btts_devig[0]
              blended = blend(cal_sim, mp, alpha)
              out << build_candidate('btts', 'sim', sim_p, cal_sim, mp, blended,
                                     odds[:btts_sim], bankroll, kelly_fraction, alpha)
            end
            if finite?(odds[:btts_nao])
              mp = btts_devig && btts_devig[1]
              blended = blend(cal_nao, mp, alpha)
              out << build_candidate('btts', 'nao', nao_p, cal_nao, mp, blended,
                                     odds[:btts_nao], bankroll, kelly_fraction, alpha)
            end
          end

          # ── Wave O+E: CORNERS (Poisson approx from sim_corners_total_mean) ──────────
          # V1: mean used as Poisson mean. V2 TODO: proper CDF from MC samples.
          if finite?(sim[:sim_corners_total_mean])
            mean = sim[:sim_corners_total_mean].to_f
            [
              [8.5, :corners_over_85, :corners_under_85, '85'],
              [9.5, :corners_over_95, :corners_under_95, '95'],
              [10.5, :corners_over_105, :corners_under_105, '105']
            ].each do |line, over_key, under_key, side_lbl|
              if finite?(odds[over_key])
                p = DistHelpers.poisson_prob_over(mean, line)
                corners_devig = finite?(odds[under_key]) ? devig_proportional([odds[over_key], odds[under_key]]) : nil
                mp = corners_devig && corners_devig[0]
                cal = secondary_calibrate("corners-over-#{side_lbl}", p, 'corners', :over, line, mean, isotonic_lookup, dist_k)
                blended = blend(cal, mp, alpha)
                out << build_candidate('corners-over', side_lbl, p, cal, mp, blended,
                                       odds[over_key], bankroll, kelly_fraction, alpha)
              end
              if finite?(odds[under_key])
                p = DistHelpers.poisson_prob_under(mean, line)
                corners_devig = finite?(odds[over_key]) ? devig_proportional([odds[over_key], odds[under_key]]) : nil
                mp = corners_devig && corners_devig[1]
                cal = secondary_calibrate("corners-under-#{side_lbl}", p, 'corners', :under, line, mean, isotonic_lookup, dist_k)
                blended = blend(cal, mp, alpha)
                out << build_candidate('corners-under', side_lbl, p, cal, mp, blended,
                                       odds[under_key], bankroll, kelly_fraction, alpha)
              end
            end
          end

          # ── Wave O+E: CARDS (Poisson approx from sim_cards_total_mean) ──────────
          if finite?(sim[:sim_cards_total_mean])
            mean = sim[:sim_cards_total_mean].to_f
            [
              [3.5, :cards_over_35, :cards_under_35, '35'],
              [4.5, :cards_over_45, :cards_under_45, '45'],
              [5.5, :cards_over_55, :cards_under_55, '55']
            ].each do |line, over_key, under_key, side_lbl|
              if finite?(odds[over_key])
                p = DistHelpers.poisson_prob_over(mean, line)
                cards_devig = finite?(odds[under_key]) ? devig_proportional([odds[over_key], odds[under_key]]) : nil
                mp = cards_devig && cards_devig[0]
                cal = secondary_calibrate("cards-over-#{side_lbl}", p, 'cards', :over, line, mean, isotonic_lookup, dist_k)
                blended = blend(cal, mp, alpha)
                out << build_candidate('cards-over', side_lbl, p, cal, mp, blended,
                                       odds[over_key], bankroll, kelly_fraction, alpha)
              end
              if finite?(odds[under_key])
                p = DistHelpers.poisson_prob_under(mean, line)
                cards_devig = finite?(odds[over_key]) ? devig_proportional([odds[over_key], odds[under_key]]) : nil
                mp = cards_devig && cards_devig[1]
                cal = secondary_calibrate("cards-under-#{side_lbl}", p, 'cards', :under, line, mean, isotonic_lookup, dist_k)
                blended = blend(cal, mp, alpha)
                out << build_candidate('cards-under', side_lbl, p, cal, mp, blended,
                                       odds[under_key], bankroll, kelly_fraction, alpha)
              end
            end
          end

          # ── Wave O+E: SHOTS ON TARGET (Poisson approx from sim_sot_total_mean) ─
          if finite?(sim[:sim_sot_total_mean])
            mean = sim[:sim_sot_total_mean].to_f
            [
              [7.5, :sot_over_75, :sot_under_75, '75'],
              [9.5, :sot_over_95, :sot_under_95, '95'],
              [10.5, :sot_over_105, :sot_under_105, '105']
            ].each do |line, over_key, under_key, side_lbl|
              if finite?(odds[over_key])
                p = DistHelpers.poisson_prob_over(mean, line)
                sot_devig = finite?(odds[under_key]) ? devig_proportional([odds[over_key], odds[under_key]]) : nil
                mp = sot_devig && sot_devig[0]
                cal = secondary_calibrate("sot-over-#{side_lbl}", p, 'sot', :over, line, mean, isotonic_lookup, dist_k)
                blended = blend(cal, mp, alpha)
                out << build_candidate('sot-over', side_lbl, p, cal, mp, blended,
                                       odds[over_key], bankroll, kelly_fraction, alpha)
              end
              if finite?(odds[under_key])
                p = DistHelpers.poisson_prob_under(mean, line)
                sot_devig = finite?(odds[over_key]) ? devig_proportional([odds[over_key], odds[under_key]]) : nil
                mp = sot_devig && sot_devig[1]
                cal = secondary_calibrate("sot-under-#{side_lbl}", p, 'sot', :under, line, mean, isotonic_lookup, dist_k)
                blended = blend(cal, mp, alpha)
                out << build_candidate('sot-under', side_lbl, p, cal, mp, blended,
                                       odds[under_key], bankroll, kelly_fraction, alpha)
              end
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

        # True quando existe curva própria pra metric_key no lookup (usado pra
        # decidir entre curva independente do lado vs fallback complementar).
        def has_curve?(lookup, metric_key)
          return false unless lookup.is_a?(Hash)

          fn = lookup[metric_key] || lookup[metric_key.to_sym]
          fn.respond_to?(:call)
        end

        # Calibração de um mercado SECUNDÁRIO (corners/cards/sot), ordem de
        # prioridade: curva isotônica → k de distribuição → raw.
        #   - curva existe  → isotônica(prob raw) [comportamento atual preservado]
        #   - sem curva + k → Poisson recomputado com a média escalada (mean·k)
        #   - sem curva nem k → raw (prob inalterada)
        # O `k` é o fallback que conserta o Poisson cru (overconfiante) em linhas
        # sem isotônica — ex.: cold-start de nova model_version. Ver
        # docs/tasks/calibracao-distribuicao + lição B31.
        def secondary_calibrate(metric_key, raw_prob, stat, side, line, base_mean, lookup, dist_k)
          return calibrate(metric_key, raw_prob, lookup) if has_curve?(lookup, metric_key)

          k = positive_k(dist_k, stat)
          return raw_prob unless k

          m = base_mean.to_f * k
          side == :over ? DistHelpers.poisson_prob_over(m, line) : DistHelpers.poisson_prob_under(m, line)
        end

        # Extrai o k positivo finito do dist_k pra um stat (aceita key String ou
        # Symbol). nil quando ausente/inválido/<=0 → caller cai no raw.
        def positive_k(dist_k, stat)
          return nil unless dist_k.is_a?(Hash)

          v = dist_k[stat] || dist_k[stat.to_sym]
          (v.is_a?(Numeric) && v.respond_to?(:finite?) && v.finite? && v > 0) ? v.to_f : nil
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
          prob_est = clamp_prob(prob_est)
          prob_cal = clamp_prob(prob_cal)
          prob_blended = clamp_prob(prob_blended)

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

        # Probabilidade nunca é 0 nem 1.
        #
        # O Monte Carlo de 10k rodadas devolve 1.0 quando nenhuma simulação
        # cruzou a linha, e o modelo trata isso como certeza — mas a incerteza
        # de MODELO (forma da distribuição, escalação, arbitragem, tempo) é
        # ordens de grandeza maior que a de amostragem do MC. Um p=1.0 num
        # mercado de contagem é sempre artefato, nunca conhecimento.
        #
        # Dois danos concretos: (a) infla o edge e o Kelly na direção errada;
        # (b) quebra métricas logarítmicas — se o jogo sai do outro lado,
        # log-loss = ∞ e contamina a calibração inteira (a arena usa log-loss
        # como árbitro, B34).
        #
        # O teto NÃO substitui calibração — mercados de contagem em liga
        # sem curva seguem overconfiantes (B31). É guarda-corpo, não conserto.
        PROB_CEILING = 0.99
        PROB_FLOOR = 0.01

        def clamp_prob(p)
          return p unless p.is_a?(Numeric) && p.finite?

          [[p, PROB_FLOOR].max, PROB_CEILING].min
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
