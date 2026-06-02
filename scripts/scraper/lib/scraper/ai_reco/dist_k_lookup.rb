require 'json'

module AdamStats
  module Scraper
    module AiReco
      # Carrega os fatores de calibração de DISTRIBUIÇÃO ativos (model_calibration,
      # métricas 'corners-dist'/'cards-dist'/'sot-dist') e os expõe como
      # Hash<String stat → Float k>, onde k = meanActual / meanPred.
      #
      # POR QUE EXISTE (docs/tasks/calibracao-distribuicao): a sim SUBESTIMA o
      # total de corners/cards/sot (k≈1.06/1.13/1.07). A isotônica por-linha só
      # cobre 3 linhas; o `k` corrige a MÉDIA do Poisson e serve de fallback pras
      # linhas sem curva (cold-start de nova model_version). Ordem de prioridade
      # no EdgeCalculator: curva isotônica → k → raw.
      #
      # Armazenamento: cada linha *-dist guarda `pairs = [[meanPred, meanActual]]`
      # (uma âncora [x,y] self-describing). k = y / x.
      #
      # Porta Ruby de lib/ai-reco/dist-k-repository.ts — comportamento idêntico,
      # mudanças sincronizadas. Degrada gracioso pra {} (nunca quebra o batch).
      module DistKLookup
        QUERY = <<~SQL.freeze
          SELECT metric, pairs
          FROM model_calibration
          WHERE model_version = $1 AND effective_until IS NULL
        SQL

        SUFFIX = '-dist'.freeze
        STATS = %w[corners cards sot goals].freeze

        module_function

        # Carrega os fatores ativos p/ um model_version → Hash<stat → k>.
        # model_version vazio/nil → {} (short-circuit). Erro de DB → {}.
        def load(conn, model_version)
          return {} if model_version.nil? || model_version.to_s.strip.empty?

          rows = conn.exec_params(QUERY, [model_version])
          out = {}
          rows.each do |row|
            metric = row['metric'].to_s
            next unless metric.end_with?(SUFFIX)

            stat = metric[0...-SUFFIX.length]
            next unless STATS.include?(stat)

            k = k_from_pairs(row['pairs'])
            out[stat] = k unless k.nil?
          end
          out
        rescue StandardError
          {}
        end

        # Extrai k = meanActual / meanPred do pairs ([[meanPred, meanActual]]).
        # Retorna nil se malformado ou meanPred <= 0.
        def k_from_pairs(raw)
          arr = raw.is_a?(String) ? JSON.parse(raw) : raw
          return nil unless arr.is_a?(Array) && arr[0].is_a?(Array) && arr[0].length >= 2

          mean_pred = arr[0][0]
          mean_actual = arr[0][1]
          return nil unless mean_pred.is_a?(Numeric) && mean_actual.is_a?(Numeric)
          return nil unless mean_pred.to_f > 0

          mean_actual.to_f / mean_pred.to_f
        rescue JSON::ParserError, StandardError
          nil
        end
      end
    end
  end
end
