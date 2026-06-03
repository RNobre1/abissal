require 'json'
require_relative 'db'
require_relative 'healthcheck'
require_relative 'global_config'
require_relative 'ai_recommender_runner'

module AdamStats
  module Scraper
    # Job standalone do recomendador IA-2 (Parte B — 2026-05-29).
    #
    # DESACOPLADO do scrape (orchestrator): roda no SEU PRÓPRIO workflow
    # (.github/workflows/ai-reco.yml), num cron logo após o scrape-daily, com
    # timeout folgado. Motivo (Lição B20): a inferência LLM lenta (~p95 195s/chamada)
    # inflava o runtime e estourava o `timeout-minutes` do scrape, truncando a
    # coleta. Separando, um dia ruim de R1 jamais derruba o scrape — e a IA-2 roda
    # completa no tempo dela. A paralelização (AI_RECO_CONCURRENCY) já corta o
    # tempo de ~50min pra ~10-15min; o desacoplamento é a segunda camada de
    # robustez.
    #
    # Encapsula o que antes vivia inline no orchestrator: roda o AiRecommenderRunner,
    # detecta silent-death (0 recos com fixtures pendentes ⇒ algo quebrou — B18) e
    # faz seu próprio ciclo de healthcheck (HEALTHCHECKS_AI_RECO_URL):
    #   start  → no início
    #   success → no fim, se rodou OK
    #   fail   → em silent-death OU exceção global
    class AiRecommenderJob
      # Limiar do silent-death: 0 recos criadas + mais que isto de fixtures
      # elegíveis ⇒ falha silenciosa (ENV vazia, OpenRouter 401, panic — B18).
      SILENT_DEATH_MIN_PENDING = 10

      # Espelha o WHERE do FIXTURES_QUERY do runner (fixtures que SERIAM elegíveis).
      ELIGIBLE_COUNT_SQL = <<~SQL.freeze
        SELECT COUNT(*) AS n FROM fixture_simulations
        WHERE kickoff_utc > now()
          AND kickoff_utc < now() + INTERVAL '48 hours'
          AND status = 'pending'
          AND fixture_id IS NOT NULL
      SQL

      def initialize(logger: ->(m) { warn m },
                     runner: nil,
                     healthcheck: Healthcheck,
                     hc_url: ENV['HEALTHCHECKS_AI_RECO_URL'],
                     eligible_counter: nil,
                     ai_enabled_check: nil)
        @logger = logger
        @runner = runner
        @healthcheck = healthcheck
        @hc_url = hc_url.to_s.strip
        # Injetável nos testes (lambda -> Integer). Em produção: conta via DB.
        @eligible_counter = eligible_counter
        # Injetável nos testes (lambda -> Bool). Em produção: lê app_settings via DB.
        @ai_enabled_check = ai_enabled_check
      end

      # Retorna um Hash com o resumo da rodada (também logado como FINAL JSON-line).
      # NUNCA levanta: erro global do runner é capturado e tratado como
      # silent-death (ping /fail), pra não derrubar o workflow sem sinal.
      def run
        ping(:start)

        # Kill switch global de IA (app_settings.ai_enabled). Quando desligado, o
        # recomendador é pulado SEM rodar o runner nem disparar silent-death — é
        # um desligamento INTENCIONAL (créditos OpenRouter zerados / sem jogos),
        # não uma falha. Por isso pinga :success (mantém o healthcheck verde).
        unless ai_enabled?
          @logger.call('[ai-reco-job] IA desabilitada globalmente (app_settings.ai_enabled=false) — pulando recomendador.')
          ping(:success)
          final = {
            ai_reco_at: now_iso8601,
            recommendations_created: 0,
            errors: 0,
            fixtures_pending_for_reco: 0,
            ai_reco_silent_death: false,
            ai_disabled: true
          }
          @logger.call("[ai-reco-job] FINAL: #{final.to_json}")
          return final
        end

        reco_stats = { inserted_recos: 0, errors: 0 }
        begin
          result = runner.run
          reco_stats = result if result.is_a?(Hash)
        rescue StandardError => e
          @logger.call("[ai-reco-job] runner failed: #{e.class}: #{e.message}")
        end

        silent_death, pending = detect_silent_death(reco_stats)
        ping(silent_death ? :failure : :success)

        final = {
          ai_reco_at: now_iso8601,
          recommendations_created: reco_stats[:inserted_recos].to_i,
          errors: reco_stats[:errors].to_i,
          fixtures_pending_for_reco: pending,
          ai_reco_silent_death: silent_death
        }
        @logger.call("[ai-reco-job] FINAL: #{final.to_json}")
        final
      end

      private

      # Lê o kill switch global. Injetável nos testes; em produção lê
      # app_settings via DB. Default LIGADO em qualquer erro (graceful).
      def ai_enabled?
        return @ai_enabled_check.call if @ai_enabled_check

        DB.with_connection { |conn| GlobalConfig.ai_enabled?(conn, logger: @logger) }
      rescue StandardError => e
        @logger.call("[ai-reco-job] checagem de kill switch falhou (assumindo LIGADO): #{e.class}: #{e.message}")
        true
      end

      def runner
        @runner ||= AiRecommenderRunner.new(logger: @logger)
      end

      # [silent_death(Bool), pending(Integer)].
      def detect_silent_death(reco_stats)
        return [false, 0] unless reco_stats[:inserted_recos].to_i.zero?

        pending = count_eligible
        if pending > SILENT_DEATH_MIN_PENDING
          @logger.call("[ai-reco-job] SILENT DEATH: 0 recos criadas com #{pending} " \
                       'fixtures pending sim. Pingando healthchecks /fail.')
          return [true, pending]
        end
        [false, pending]
      end

      def count_eligible
        return @eligible_counter.call.to_i if @eligible_counter

        DB.with_connection do |conn|
          row = conn.query(ELIGIBLE_COUNT_SQL).first
          row ? row['n'].to_i : 0
        end
      rescue StandardError => e
        # Defensivo: COUNT falhou ⇒ devolve 0 (silent-death não dispara falso
        # positivo). Erros de DB já são logados pelo runner/workflow.
        @logger.call("[ai-reco-job] count_eligible failed: #{e.class}: #{e.message}")
        0
      end

      def ping(kind)
        return if @hc_url.empty?

        case kind
        when :start   then @healthcheck.ping_start(@hc_url)
        when :success then @healthcheck.ping_success(@hc_url)
        when :failure then @healthcheck.ping_failure(@hc_url)
        end
      end

      # Time.now.utc.iso8601 isolado pra facilitar stub em teste, se preciso.
      def now_iso8601
        require 'time'
        Time.now.utc.iso8601
      end
    end
  end
end
