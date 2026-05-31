require 'json'

module AdamStats
  module Scraper
    module AiReco
      # Carrega as curvas isotônicas ativas (model_calibration) e as expõe como
      # Hash<String metric → Proc> no formato que EdgeCalculator#calibrate espera.
      #
      # POR QUE EXISTE (lição B25): o batch (ai_recommender_runner) chamava
      # EdgeCalculator.build SEM isotonic_lookup → as recos do cron rodavam com
      # probabilidade CRUA (overconfident), ignorando as curvas que o
      # calibracao-weekly fita. Este módulo é a fiação que faltava.
      #
      # Porta Ruby do caminho TS (lib/calibracao/active-curves-repository.ts +
      # isotonic.ts#applyIsotonic) — comportamento idêntico; mudanças sincronizadas.
      module IsotonicLookup
        QUERY = <<~SQL.freeze
          SELECT metric, pairs
          FROM model_calibration
          WHERE model_version = $1 AND effective_until IS NULL
        SQL

        module_function

        # Proc que aplica a curva num ponto x: clamp nas bordas + interpolação
        # linear (busca binária). Curva vazia/inválida → identidade.
        def interpolator(pairs)
          curve = normalize_pairs(pairs)
          return ->(x) { x } if curve.empty?

          lambda do |x|
            return curve.first[1] if x <= curve.first[0]
            return curve.last[1] if x >= curve.last[0]

            lo = 0
            hi = curve.length - 1
            while hi - lo > 1
              mid = (lo + hi) / 2
              if curve[mid][0] <= x
                lo = mid
              else
                hi = mid
              end
            end
            x0, y0 = curve[lo]
            x1, y1 = curve[hi]
            return y0 if x1 == x0

            t = (x - x0) / (x1 - x0)
            y0 + t * (y1 - y0)
          end
        end

        # Carrega as curvas ativas p/ um model_version → Hash<metric → Proc>.
        # Degrada gracioso: model_version vazio ou erro de DB → {} (o batch segue
        # sem calibração, nunca quebra).
        def load(conn, model_version)
          return {} if model_version.nil? || model_version.to_s.strip.empty?

          rows = conn.exec_params(QUERY, [model_version])
          lookup = {}
          rows.each do |row|
            metric = row['metric']
            curve = normalize_pairs(row['pairs'])
            next if metric.nil? || metric.to_s.empty? || curve.empty?

            lookup[metric] = interpolator(curve)
          end
          lookup
        rescue StandardError
          {}
        end

        # jsonb pode vir como String (texto JSON) ou já como Array. Retorna
        # array de [x,y] numéricos ordenado por x; [] se inválido.
        def normalize_pairs(raw)
          arr = raw.is_a?(String) ? JSON.parse(raw) : raw
          return [] unless arr.is_a?(Array)

          arr.filter_map { |p|
            next unless p.is_a?(Array) && p.length >= 2 &&
                        p[0].is_a?(Numeric) && p[1].is_a?(Numeric)

            [p[0].to_f, p[1].to_f]
          }.sort_by { |pair| pair[0] }
        rescue JSON::ParserError, StandardError
          []
        end
      end
    end
  end
end
