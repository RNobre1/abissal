# frozen_string_literal: true

require_relative 'prediction_reconciler'
require_relative 'simulation_reconciler'
require_relative 'ai_recommendation_reconciler'

module AdamStats
  module Scraper
    # Fase de reconciliação EXTRAÍDA do orchestrator (Lição B56, 03/08).
    #
    # Por que existe: a reconciliação vivia só no fim do pipeline de coleta —
    # quando o scrape estourou o timeout dois dias seguidos (02-03/08), o
    # GitHub cancelou o job e a cauda morreu junto: fim de semana inteiro sem
    # actuals, calibração do v8 perdeu o gate de temperature por 6 jogos.
    # A coleta pode falhar; a reconciliação do que JÁ está persistido não pode
    # falhar junto. Esta classe é invocada:
    #   - pelo orchestrator (caminho normal, pós-persist);
    #   - por bin/run_reconcilers (job de resgate `reconcile-rescue` do
    #     scrape-daily.yml, que roda sempre que o job de coleta não terminar
    #     `success`).
    #
    # Semântica preservada do orchestrator: cada reconciler é isolado — falha
    # de um vira log e `nil` no resultado, nunca derruba os seguintes.
    class ReconciliationJob
      RECONCILERS = [
        PredictionReconciler,
        SimulationReconciler,
        AiRecommendationReconciler,
      ].freeze

      def initialize(logger: ->(m) { warn m })
        @logger = logger
      end

      # @return [Hash<String, Hash|nil>] stats por reconciler (nil = falhou)
      def run
        RECONCILERS.each_with_object({}) do |klass, results|
          key = klass.name.split('::').last
          begin
            results[key] = klass.new(logger: @logger).run
            @logger.call("[reconcile] #{key}: #{results[key].inspect}")
          rescue StandardError => e
            results[key] = nil
            @logger.call("[reconcile] #{key} failed (isolado): #{e.class}: #{e.message}")
          end
        end
      end
    end
  end
end
