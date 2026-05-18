require_relative 'db'
require_relative 'choistats_api_client'

module AdamStats
  module Scraper
    # Reconcilia predições pendentes em `ai_predictions` com o resultado real do
    # jogo via choistats API. Roda após o scrape, antes da purga.
    #
    # Responsabilidades:
    #   - Seleciona linhas com status='pending' e kickoff_utc < now (jogo já ocorreu)
    #   - Para cada linha, busca o widget recent_results via ChoistatsApiClient
    #   - Se o jogo estiver concluído (status=FT e goals presentes), preenche
    #     actual_home_goals, actual_away_goals, correct_winner, correct_over_under,
    #     actual_resolved_at e seta status='resolved'
    #   - Se o placar não estiver disponível e kickoff_utc > MAX_ATTEMPTS_DAYS atrás,
    #     seta status='unresolvable'
    #   - Idempotente: linhas resolved nunca são selecionadas (filtro no SELECT)
    #   - Seguro: erro de rede por linha é capturado → warning + skip; não derruba
    #     o pipeline
    class PredictionReconciler
      MAX_ATTEMPTS_DAYS = 4

      def initialize(
        db_conn: nil,
        client: nil,
        logger: ->(m) { warn m }
      )
        @db_conn = db_conn
        @client  = client || ChoistatsApiClient.new
        @logger  = logger
      end

      # Executa a reconciliação. Retorna { resolved:, pending:, unresolvable: }.
      def run
        stats = { resolved: 0, pending: 0, unresolvable: 0 }

        with_connection do |conn|
          pending_rows = select_pending(conn)

          pending_rows.each do |row|
            begin
              reconcile_row(conn, row, stats)
            rescue StandardError => e
              @logger.call("[reconciler] warn: skip row id=#{row['id']} — #{e.class}: #{e.message}")
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
          "SELECT id, home_team, away_team, kickoff_utc, fixture_id, " \
          "       pred_winner, pred_over_under " \
          "FROM ai_predictions " \
          "WHERE status = 'pending' " \
          "  AND kickoff_utc IS NOT NULL " \
          "  AND kickoff_utc < now() " \
          "ORDER BY kickoff_utc ASC",
          []
        ).to_a
      end

      def reconcile_row(conn, row, stats)
        fixture_api_id = row['fixture_id']&.to_i
        return if fixture_api_id.nil? || fixture_api_id.zero?

        kickoff = Time.parse(row['kickoff_utc'])
        stale   = (Time.now.utc - kickoff) > MAX_ATTEMPTS_DAYS * 86_400

        widget = @client.fetch_widget(:recent_results, fixture_id: fixture_api_id)
        fixture_data = widget&.dig('fixture') || {}
        status = fixture_data['status']

        home_goals = fixture_data['homeGoalsFt']
        away_goals = fixture_data['awayGoalsFt']

        if status == 'FT' && !home_goals.nil? && !away_goals.nil?
          home_goals = home_goals.to_i
          away_goals = away_goals.to_i

          correct_winner   = score_winner(row['pred_winner'], home_goals, away_goals)
          correct_ou       = score_over_under(row['pred_over_under'], home_goals, away_goals)

          conn.exec_params(
            "UPDATE ai_predictions SET " \
            "  actual_home_goals   = $1, " \
            "  actual_away_goals   = $2, " \
            "  actual_resolved_at  = now(), " \
            "  correct_winner      = $3, " \
            "  correct_over_under  = $4, " \
            "  status              = $5 " \
            "WHERE id = $6",
            [home_goals, away_goals, correct_winner, correct_ou, 'resolved', row['id'].to_i]
          )
          stats[:resolved] += 1
        elsif stale
          conn.exec_params(
            "UPDATE ai_predictions SET status = $1 WHERE id = $2",
            ['unresolvable', row['id'].to_i]
          )
          stats[:unresolvable] += 1
        else
          stats[:pending] += 1
        end
      end

      def score_winner(pred_winner, home_goals, away_goals)
        actual = if home_goals > away_goals
                   'home'
                 elsif home_goals < away_goals
                   'away'
                 else
                   'draw'
                 end
        pred_winner == actual
      end

      def score_over_under(pred_ou, home_goals, away_goals)
        total  = home_goals + away_goals
        actual = total > 2.5 ? 'over' : 'under'
        pred_ou == actual
      end
    end
  end
end
