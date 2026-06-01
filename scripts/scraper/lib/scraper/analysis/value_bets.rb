# frozen_string_literal: true

module AdamStats
  module Scraper
    module Analysis
      # Lógica pura do "caça-valor" próprio (sim calibrada × odd) + guardrails
      # da calibração. NÃO faz I/O — recebe agregados e devolve classificação.
      #
      # Princípio do fade (pedido do Pilot): um mercado onde a IA erra de forma
      # consistente é tão informativo quanto um que ela acerta — basta apostar no
      # inverso. Então um lado SEM histórico próprio cujo OPOSTO é :avoid vira
      # :trust_inverse (ex.: over25-over não tem reco, mas over25-under acerta 6%
      # ⇒ apostar over é confiável).
      module ValueBets
        module_function

        # edge calibrado de uma perna.
        def edge(prob, odd)
          return nil if prob.nil? || odd.nil? || odd <= 1 || prob <= 0

          prob * odd - 1.0
        end

        # Oposto binário de (market, side) p/ inferência de fade. nil quando não
        # há oposto binário (ex.: 1x2 é 3-way).
        def opposite(market, side)
          m = market.to_s
          s = side.to_s
          return ['over25', s == 'under' ? 'over' : 'under'] if m == 'over25'
          return ['btts', %w[nao no].include?(s) ? 'sim' : 'nao'] if m == 'btts'

          %w[corners sot cards].each do |fam|
            return ["#{fam}-over", s] if m == "#{fam}-under"
            return ["#{fam}-under", s] if m == "#{fam}-over"
          end
          nil
        end

        # Classifica uma linha resolvida pelo ROI/amostra.
        #   :avoid  — backing esse lado perde histórico (roi < -0.10, n>=min_n)
        #   :trust  — backing esse lado ganha (roi > +0.10, n>=min_n)
        #   :weak   — neutro / amostra pequena
        def classify_row(n, roi, min_n: 8)
          return :weak if n < min_n || roi.nil?
          return :avoid if roi < -0.10
          return :trust if roi > 0.10

          :weak
        end

        # rows: Array<{ 'market'=>, 'side'=>, 'n'=>, 'roi'=> }> (recos resolvidas).
        # Retorna Hash "market|side" => { n:, roi:, klass: }, JÁ com a inferência
        # de fade aplicada aos lados sem histórico próprio.
        def classify(rows, min_n: 8)
          own = {}
          rows.each do |r|
            key = "#{r['market']}|#{r['side']}"
            own[key] = {
              n: r['n'].to_i, roi: (r['roi'] ? r['roi'].to_f : nil),
              klass: classify_row(r['n'].to_i, r['roi']&.to_f, min_n: min_n)
            }
          end
          own
        end

        # Classe efetiva de uma perna candidata (market, side), consultando o
        # histórico próprio e, na ausência, o oposto (fade).
        def klass_for(market, side, classified)
          own = classified["#{market}|#{side}"]
          # Histórico próprio DECISIVO (:trust/:avoid) vence. Se ausente ou só
          # :weak (amostra pequena), o sinal do oposto (fade, geralmente n maior)
          # prevalece.
          return own[:klass] if own && own[:klass] != :weak

          opp = opposite(market, side)
          if opp && (o = classified["#{opp[0]}|#{opp[1]}"])
            return :trust_inverse if o[:klass] == :avoid
            return :avoid_inverse if o[:klass] == :trust
          end
          own ? own[:klass] : :unknown
        end

        # Uma perna candidata deve entrar no bilhete?
        # Bloqueia o que o histórico condena (:avoid) e o inverso de um mercado
        # confiável (:avoid_inverse). Permite trust / trust_inverse / weak /
        # unknown (estes com cautela — Claude julga via skill).
        def allowed?(klass)
          ![:avoid, :avoid_inverse].include?(klass)
        end
      end
    end
  end
end
