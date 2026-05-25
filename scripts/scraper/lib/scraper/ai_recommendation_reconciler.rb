require 'time'
require_relative 'db'
require_relative 'choistats_api_client'

module AdamStats
  module Scraper
    # Reconciler do IA-2 Recomendador. Irmao de simulation_reconciler.rb e
    # prediction_reconciler.rb, mas para a tabela ai_recommendations
    # (migration 0022). Reconcilia recomendacoes de aposta pre-jogo
    # pendentes com o resultado real do jogo via choistats API. Roda apos
    # o scrape, antes da purga.
    #
    # Responsabilidades:
    #   - Seleciona linhas com status='pending' e kickoff_utc < now (jogo
    #     ja ocorreu). NUNCA toca linhas resolved/unresolvable.
    #   - Para cada linha, busca o widget recent_results via ChoistatsApiClient
    #   - Se FT e goals presentes:
    #       - verdict='skip' -> resolved com actual_*_goals preenchidos,
    #         bet_won/pl_units = NULL (nao houve aposta)
    #       - verdict='bet'  -> avalia por (market, side) qual o resultado:
    #           1x2-home : home_goals > away_goals
    #           1x2-draw : home_goals == away_goals
    #           1x2-away : home_goals < away_goals
    #           over25-over  : home_goals + away_goals > 2
    #           over25-under : home_goals + away_goals <= 2
    #           btts-sim     : home_goals >= 1 && away_goals >= 1
    #           btts-nao     : home_goals == 0 || away_goals == 0
    #         PL: won ? (odd_captured - 1) * units_final : -units_final
    #   - Se sem placar e kickoff_utc > MAX_ATTEMPTS_DAYS atras -> 'unresolvable'
    #   - Idempotente: linhas resolved/unresolvable nunca sao selecionadas
    #   - Seguro: erro por linha capturado -> warning + skip; nao derruba pipeline
    class AiRecommendationReconciler
      MAX_ATTEMPTS_DAYS = 4

      def initialize(db_conn: nil, client: nil, logger: ->(m) { warn m })
        @db_conn = db_conn
        @client  = client || ChoistatsApiClient.new
        @logger  = logger
      end

      # Executa a reconciliacao. Retorna { resolved:, pending:, unresolvable: }.
      def run
        stats = { resolved: 0, pending: 0, unresolvable: 0 }

        with_connection do |conn|
          pending_rows = select_pending(conn)

          pending_rows.each do |row|
            begin
              reconcile_row(conn, row, stats)
            rescue StandardError => e
              @logger.call("[ai-reco-reconciler] warn: skip row id=#{row['id']} — #{e.class}: #{e.message}")
            end
          end
        end

        stats
      end

      private

      def with_connection
        if @db_conn
          yield @db_conn
        else
          AdamStats::Scraper::DB.with_connection { |c| yield c }
        end
      end

      def select_pending(conn)
        conn.exec_params(
          "SELECT id, fixture_id, kickoff_utc, verdict, market, side, " \
          "       odd_captured, units_final " \
          "FROM ai_recommendations " \
          "WHERE status = 'pending' " \
          "  AND kickoff_utc IS NOT NULL " \
          "  AND kickoff_utc < now() " \
          "ORDER BY kickoff_utc ASC",
          []
        ).to_a
      end

      def reconcile_row(conn, row, stats)
        fixture_api_id = row['fixture_id']&.to_i
        no_api_id      = fixture_api_id.nil? || fixture_api_id.zero?

        kickoff = Time.parse(row['kickoff_utc'])
        stale   = (Time.now.utc - kickoff) > MAX_ATTEMPTS_DAYS * 86_400

        # Rows sem fixture_id nao podem ser resolvidas via API choistats.
        if no_api_id
          if stale
            mark_unresolvable(conn, row['id'].to_i)
            stats[:unresolvable] += 1
          else
            stats[:pending] += 1
          end
          return
        end

        widget = @client.fetch_widget(:recent_results, fixture_id: fixture_api_id)
        fixture_data = widget&.dig('fixture') || {}
        status = fixture_data['status']

        home_goals = fixture_data['homeGoalsFt']
        away_goals = fixture_data['awayGoalsFt']

        if status == 'FT' && !home_goals.nil? && !away_goals.nil?
          home_goals = home_goals.to_i
          away_goals = away_goals.to_i

          verdict = row['verdict']
          if verdict == 'skip'
            mark_resolved_skip(conn, row['id'].to_i, home_goals, away_goals)
          else
            won = bet_won?(row, home_goals, away_goals)
            pl  = compute_pl(row, won)
            mark_resolved_bet(conn, row['id'].to_i, home_goals, away_goals, won, pl)
          end
          stats[:resolved] += 1
        elsif stale
          mark_unresolvable(conn, row['id'].to_i)
          stats[:unresolvable] += 1
        else
          stats[:pending] += 1
        end
      end

      def mark_unresolvable(conn, id)
        conn.exec_params(
          "UPDATE ai_recommendations SET status = $1 WHERE id = $2",
          ['unresolvable', id]
        )
      end

      def mark_resolved_skip(conn, id, home_goals, away_goals)
        # verdict=skip: nao houve aposta, entao bet_won e pl_units ficam NULL.
        # Preenchemos actual_*_goals + actual_resolved_at + status='resolved'.
        # Ordem dos params casa com positional placeholders abaixo.
        conn.exec_params(
          "UPDATE ai_recommendations SET " \
          "  actual_home_goals  = $1, " \
          "  actual_away_goals  = $2, " \
          "  actual_resolved_at = now(), " \
          "  bet_won            = $3, " \
          "  pl_units           = $4, " \
          "  status             = $5 " \
          "WHERE id = $6",
          [home_goals, away_goals, nil, nil, 'resolved', id]
        )
      end

      def mark_resolved_bet(conn, id, home_goals, away_goals, won, pl)
        conn.exec_params(
          "UPDATE ai_recommendations SET " \
          "  actual_home_goals  = $1, " \
          "  actual_away_goals  = $2, " \
          "  actual_resolved_at = now(), " \
          "  bet_won            = $3, " \
          "  pl_units           = $4, " \
          "  status             = $5 " \
          "WHERE id = $6",
          [home_goals, away_goals, won, pl, 'resolved', id]
        )
      end

      # Avalia se a aposta (market, side) foi vencedora dado o placar real.
      # Mercados nao reconhecidos -> false (defensivo).
      def bet_won?(row, home_goals, away_goals)
        market = row['market'].to_s
        side   = row['side'].to_s
        total  = home_goals + away_goals

        case "#{market}-#{side}"
        when '1x2-home'      then home_goals > away_goals
        when '1x2-draw'      then home_goals == away_goals
        when '1x2-away'      then away_goals > home_goals
        when 'over25-over'   then total > 2
        when 'over25-under'  then total <= 2
        when 'btts-sim'      then home_goals >= 1 && away_goals >= 1
        when 'btts-nao'      then home_goals.zero? || away_goals.zero?
        else                      false
        end
      end

      # PL em units:
      #   won  -> (odd - 1) * units
      #   lost -> -units
      def compute_pl(row, won)
        odd   = row['odd_captured'].to_f
        units = row['units_final'].to_f
        return 0.0 if units.zero?

        won ? (odd - 1.0) * units : -units
      end
    end
  end
end
