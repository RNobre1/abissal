require_relative '../db'
require_relative 'api_football_client'
require_relative 'league_ids'
require_relative 'statistics_parser'
require_relative 'fixture_resolver'

module AdamStats
  module Scraper
    module Actuals
      # Reconcilia fixture_simulations com actuals de corners/cards/SOT via
      # API-Football (Wave R, ADR-009).
      #
      # Roda após SimulationReconciler e AiRecommendationReconciler no pipeline
      # do orchestrator. Non-fatal: erros por linha são capturados; falha global
      # é isolada no rescue do orchestrator.
      #
      # Pré-condição: migration 0036 aplicada (actual_data_source, actuals_fixture_mapping).
      #
      # Seleção de linhas pending:
      #   - actual_home_goals IS NOT NULL (jogo já teve gols reconciliados)
      #   - actual_corners_home IS NULL (ainda sem actuals secundários)
      #   - actual_data_source IS NULL (não tentado antes — ou forçar re-run
      #     com actual_data_source = 'retry' numa manutenção futura)
      #   - kickoff_utc < now() - 3h (jogo definitivamente encerrado)
      #   - kickoff_utc > now() - 14d (sem sentido reconciliar histórico antigo
      #     que não vai mais afetar calibração da rodada atual)
      #
      # Quota guard: checa /status antes do batch. Se reqs restantes < 5, aborta.
      class Reconciler
        QUOTA_SAFETY_MARGIN = 5    # Reqs mínimos restantes para processar
        MAX_AGE_DAYS        = 14   # Fixtures mais antigas que isso são ignoradas

        def initialize(
          db_conn: nil,
          client: nil,
          resolver: nil,
          logger: ->(m) { warn m }
        )
          @db_conn  = db_conn
          @client   = client   # nil = usa env var para construir
          @resolver = resolver # nil = constrói com @client
          @logger   = logger
        end

        # Executa a reconciliação.
        # Retorna hash com contadores:
        #   { resolved:, mapping_failed:, stats_failed:, quota_exhausted:,
        #     unsupported_league:, skipped: (se no_key) }
        def run
          stats = {
            resolved:            0,
            mapping_failed:      0,
            stats_failed:        0,
            quota_exhausted:     0,
            unsupported_league:  0
          }

          # Sem chave → skip silencioso
          unless client_available?
            return { skipped: 'no_key' }
          end

          with_connection do |conn|
            # Quota guard
            remaining = @client.quota_remaining
            if remaining < QUOTA_SAFETY_MARGIN
              @logger.call("[actuals-reconciler] quota insuficiente: #{remaining} reqs restantes — abortando")
              stats[:quota_exhausted] += 1
              return stats
            end

            resolver = @resolver || FixtureResolver.new(
              client:  @client,
              db_conn: conn,
              logger:  @logger
            )

            pending_rows = select_pending(conn)
            @logger.call("[actuals-reconciler] #{pending_rows.size} fixtures pendentes")

            pending_rows.each do |row|
              break if stats[:quota_exhausted] > 0

              begin
                process_row(conn, row, resolver, stats)
              rescue ApiFootballClient::QuotaExhaustedError => e
                @logger.call("[actuals-reconciler] quota esgotada em id=#{row['id']}: #{e.message}")
                stats[:quota_exhausted] += 1
                break
              rescue StandardError => e
                @logger.call(
                  "[actuals-reconciler] warn: skip row id=#{row['id']} — #{e.class}: #{e.message}"
                )
              end
            end
          end

          stats
        end

        private

        def client_available?
          if @client.nil?
            key = ENV['API_FOOTBALL_KEY']
            return false if key.nil? || key.strip.empty?

            @client = ApiFootballClient.new(
              key:    key,
              logger: @logger
            )
          end
          true
        end

        def with_connection
          if @db_conn
            yield @db_conn
          else
            AdamStats::Scraper::DB.with_connection { |c| yield c }
          end
        end

        def select_pending(conn)
          # `country` não existe em `fixture_simulations` — vive em `fixtures`
          # (adicionada em 0029_actuals_secondary apenas pra tabela fixtures).
          # Lookup via subquery: fixtures.source_url contém o choistats fixture id
          # no path `/fixture/{id}`, então casa com fs.fixture_id::text.
          conn.exec_params(
            "SELECT fs.id, fs.fixture_id, fs.home_team, fs.away_team, " \
            "       fs.kickoff_utc, fs.league, " \
            "       (SELECT f.country FROM fixtures f " \
            "          WHERE f.source_url LIKE '%/fixture/' || fs.fixture_id::text " \
            "          LIMIT 1) AS country " \
            "FROM fixture_simulations fs " \
            "WHERE fs.actual_home_goals IS NOT NULL " \
            "  AND fs.actual_corners_home IS NULL " \
            "  AND fs.actual_data_source IS NULL " \
            "  AND fs.kickoff_utc < now() - INTERVAL '3 hours' " \
            "  AND fs.kickoff_utc > now() - INTERVAL '#{MAX_AGE_DAYS} days' " \
            "ORDER BY fs.kickoff_utc ASC",
            []
          ).to_a
        end

        def process_row(conn, row, resolver, stats)
          # Checa se liga está mapeada
          af_league_id = Actuals.league_id_for(
            league:  row['league'],
            country: row['country']
          )

          unless af_league_id
            @logger.call(
              "[actuals-reconciler] unsupported_league: " \
              "league='#{row['league']}' country='#{row['country']}' id=#{row['id']}"
            )
            mark_unresolvable(conn, row, 'unresolvable-unsupported_league')
            stats[:unsupported_league] += 1
            return
          end

          # Resolve choistats_id → api_football_id
          af_fixture_id = resolver.resolve(row, af_league_id)
          unless af_fixture_id
            mark_unresolvable(conn, row, 'unresolvable-mapping_failed')
            stats[:mapping_failed] += 1
            return
          end

          # Busca estatísticas
          stats_response = @client.fixture_statistics(fixture_id: af_fixture_id)
          parsed = StatisticsParser.parse(
            stats_response,
            home: row['home_team'],
            away: row['away_team']
          )

          if parsed.nil?
            mark_unresolvable(conn, row, 'unresolvable-stats_unavailable')
            stats[:stats_failed] += 1
            return
          end

          update_actuals(conn, row, parsed)
          stats[:resolved] += 1
        end

        def update_actuals(conn, row, parsed)
          conn.exec_params(
            "UPDATE fixture_simulations SET " \
            "  actual_sot_home     = $1, " \
            "  actual_sot_away     = $2, " \
            "  actual_corners_home = $3, " \
            "  actual_corners_away = $4, " \
            "  actual_cards_home   = $5, " \
            "  actual_cards_away   = $6, " \
            "  actual_data_source  = $7 " \
            "WHERE id = $8",
            [
              parsed.dig(:home, :sot),
              parsed.dig(:away, :sot),
              parsed.dig(:home, :corners),
              parsed.dig(:away, :corners),
              parsed.dig(:home, :cards),
              parsed.dig(:away, :cards),
              'api-football',
              row['id'].to_i
            ]
          )
        end

        def mark_unresolvable(conn, row, source)
          conn.exec_params(
            "UPDATE fixture_simulations SET actual_data_source = $1 WHERE id = $2",
            [source, row['id'].to_i]
          )
        end
      end
    end
  end
end
