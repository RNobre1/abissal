module AdamStats
  module Scraper
    module AiReco
      # Temperature scaling para probabilidades.
      #
      # POR QUE EXISTE (lição B45): medido sobre 3.508 jogos resolvidos, a
      # simulação ESTICA as probabilidades — subconfiante nas caudas baixas,
      # superconfiante nas altas, com a mesma assinatura em todo mercado
      # (1x2-home: previsto ~25% → real 30%; previsto ~85% → real 72%). Viés
      # sistemático e monotônico é exatamente o que UM parâmetro corrige.
      #
      # Promovido em 28/07 depois de vencer a arena como challenger:
      # n=7290, meanDelta +0.0121, IC95 [+0.0085, +0.0160] (não cruza zero),
      # p<.001, vencendo nos três mercados separadamente.
      #
      # Ordem de prioridade no EdgeCalculator: curva isotônica → T → raw.
      # A isotônica foi fitada SOBRE probs raw, então aplicar T antes mudaria
      # a entrada que ela aprendeu.
      #
      # Porta Ruby de lib/calibracao/temperature.ts — comportamento idêntico,
      # mudanças sincronizadas (o batch noturno roda aqui, o on-demand no TS).
      module Temperature
        # Fora desse intervalo a probabilidade deixa de ser informativa (B43).
        EPS = 1e-6

        module_function

        # T utilizável: numérico, finito, positivo e != 1 (identidade).
        def usable?(t)
          return false unless t.is_a?(Numeric)

          f = t.to_f
          return false unless f.finite?
          return false if f <= 0

          f != 1.0
        end

        # p' = p^(1/T) / ( p^(1/T) + (1-p)^(1/T) )
        #
        # T = 1 → identidade. T > 1 → achata em direção a 0.5. T < 1 → estica.
        # Monotônica (preserva ordenação), ponto fixo em 0.5, nunca devolve
        # 0 nem 1. `nil` entra, `nil` sai.
        def apply(p, t)
          return nil unless p.is_a?(Numeric)
          return p.to_f unless usable?(t)

          clamped = [[p.to_f, EPS].max, 1.0 - EPS].min
          inv = 1.0 / t.to_f
          a = clamped**inv
          b = (1.0 - clamped)**inv
          denom = a + b
          return clamped unless denom.finite? && denom.positive?

          [[a / denom, EPS].max, 1.0 - EPS].min
        end

        # Versão multi-classe (1x2: home/draw/away).
        #
        #   p'_i = p_i^(1/T) / Σ_j p_j^(1/T)
        #
        # Generaliza a binária (com 2 classes as duas coincidem). Sempre devolve
        # vetor que soma 1 — inclusive quando a entrada não soma (renormaliza)
        # ou é degenerada (uma classe em 1.0).
        def apply_vector(probs, t)
          return [] if probs.nil? || probs.empty?

          n = probs.length
          safe = probs.map do |p|
            p.is_a?(Numeric) && p.to_f.positive? ? [p.to_f, EPS].max : EPS
          end
          inv = usable?(t) ? 1.0 / t.to_f : 1.0

          powered = safe.map { |p| p**inv }
          total = powered.sum
          return Array.new(n, 1.0 / n) unless total.finite? && total.positive?

          powered.map { |v| v / total }
        end
      end
    end
  end
end
