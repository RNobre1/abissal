require 'json'

module AdamStats
  module Scraper
    module AiReco
      # Carrega os fatores de TEMPERATURA ativos (model_calibration, métricas
      # '1x2-temp' / 'over25-temp' / 'btts-temp') como Hash<String market → Float T>.
      #
      # POR QUE EXISTE (lição B45): a sim ESTICA as probabilidades — subconfiante
      # nas caudas baixas, superconfiante nas altas. Um T por mercado corrige
      # esse viés monotônico. Promovido depois de vencer a arena (n=7290,
      # p<.001). Ordem no EdgeCalculator: curva isotônica → T → raw.
      #
      # Armazenamento: cada linha *-temp guarda `pairs = [[1, T]]` — mesma
      # convenção self-describing do `-dist` (o parâmetro é a razão y/x).
      #
      # Porta Ruby de lib/ai-reco/temp-repository.ts — comportamento idêntico,
      # mudanças sincronizadas. Degrada gracioso pra {} (nunca quebra o batch).
      module TempLookup
        QUERY = <<~SQL.freeze
          SELECT metric, pairs
          FROM model_calibration
          WHERE model_version = $1 AND effective_until IS NULL
        SQL

        SUFFIX = '-temp'.freeze
        # Só mercados PRINCIPAIS. corners/cards/sot são corrigidos pelo `k`
        # de distribuição (B32) — o T não se aplica lá.
        MARKETS = %w[1x2 over25 btts].freeze

        module_function

        def load(conn, model_version)
          return {} if model_version.nil? || model_version.to_s.strip.empty?

          rows = conn.exec_params(QUERY, [model_version])
          out = {}
          rows.each do |row|
            metric = row['metric'].to_s
            next unless metric.end_with?(SUFFIX)

            market = metric[0...-SUFFIX.length]
            next unless MARKETS.include?(market)

            t = t_from_pairs(row['pairs'])
            out[market] = t unless t.nil?
          end
          out
        rescue StandardError
          {}
        end

        # Extrai T de `pairs` ([[1, T]]). nil se malformado, não-numérico,
        # T <= 0 ou x <= 0.
        def t_from_pairs(raw)
          arr = raw.is_a?(String) ? JSON.parse(raw) : raw
          return nil unless arr.is_a?(Array) && arr[0].is_a?(Array) && arr[0].length >= 2

          x = arr[0][0]
          y = arr[0][1]
          return nil unless x.is_a?(Numeric) && y.is_a?(Numeric)
          return nil unless x.to_f.positive? && y.to_f.positive?

          y.to_f / x.to_f
        rescue JSON::ParserError, StandardError
          nil
        end
      end
    end
  end
end
