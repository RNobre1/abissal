require_relative 'db'
require_relative 'choistats_api_client'

module AdamStats
  module Scraper
    # Irmão de `prediction_reconciler.rb`, mas para a tabela
    # `fixture_simulations` (migration 0018). Reconcilia simulações pré-jogo
    # pendentes com o resultado real do jogo via choistats API. Roda após o
    # scrape, antes da purga.
    #
    # Responsabilidades:
    #   - Seleciona linhas com status='pending' e kickoff_utc < now (jogo já
    #     ocorreu). NUNCA toca linhas 'unsimulable' (nunca foram simuláveis) —
    #     o filtro do SELECT já as exclui.
    #   - Para cada linha, busca o widget recent_results via ChoistatsApiClient
    #   - Se FT e goals presentes, preenche actual_home_goals,
    #     actual_away_goals, actual_resolved_at, correct_winner (argmax de
    #     p_home/p_draw/p_away vs vencedor real), correct_over_under
    #     (p_over_25 >= 0.5 ⇒ over previsto, vs total real > 2.5) e seta
    #     status='resolved'
    #   - Se sem placar e kickoff_utc > MAX_ATTEMPTS_DAYS atrás → 'unresolvable'
    #   - Idempotente: linhas resolved/unsimulable nunca são selecionadas
    #   - Seguro: erro por linha é capturado → warning + skip; não derruba o
    #     pipeline
    class SimulationReconciler
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
              @logger.call("[sim-reconciler] warn: skip row id=#{row['id']} — #{e.class}: #{e.message}")
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
          "       p_home, p_draw, p_away, p_over_25 " \
          "FROM fixture_simulations " \
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

        # Rows sem fixture_id não podem ser resolvidas via API choistats.
        # Aplicamos apenas o branch de envelhecimento: stale → unresolvable,
        # caso contrário mantemos pending para tentativas futuras.
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

          correct_winner = score_winner(row, home_goals, away_goals)
          correct_ou     = score_over_under(row, home_goals, away_goals)

          conn.exec_params(
            "UPDATE fixture_simulations SET " \
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
          mark_unresolvable(conn, row['id'].to_i)
          stats[:unresolvable] += 1
        else
          stats[:pending] += 1
        end
      end

      def mark_unresolvable(conn, id)
        conn.exec_params(
          "UPDATE fixture_simulations SET status = $1 WHERE id = $2",
          ['unresolvable', id]
        )
      end

      # argmax de p_home/p_draw/p_away → vencedor previsto, comparado ao real.
      def score_winner(row, home_goals, away_goals)
        ph = row['p_home'].to_f
        pd = row['p_draw'].to_f
        pa = row['p_away'].to_f

        predicted = if ph >= pd && ph >= pa
                      'home'
                    elsif pa >= pd && pa >= ph
                      'away'
                    else
                      'draw'
                    end

        actual = if home_goals > away_goals
                   'home'
                 elsif home_goals < away_goals
                   'away'
                 else
                   'draw'
                 end

        predicted == actual
      end

      # p_over_25 >= 0.5 ⇒ over previsto; comparado ao total real > 2.5.
      def score_over_under(row, home_goals, away_goals)
        predicted = row['p_over_25'].to_f >= 0.5 ? 'over' : 'under'
        actual    = (home_goals + away_goals) > 2.5 ? 'over' : 'under'
        predicted == actual
      end
    end
  end
end
