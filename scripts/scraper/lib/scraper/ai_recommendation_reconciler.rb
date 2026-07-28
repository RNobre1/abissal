require 'time'
require_relative 'db'
require_relative 'choistats_api_client'
require_relative 'ft_actuals'

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
        actuals = FtActuals.from_widget(widget, fixture_api_id)

        if actuals.nil?
          # jogo ainda não FT (ou sem gols)
          stale ? mark_stale(conn, row, stats) : (stats[:pending] += 1)
          return
        end

        home_goals = actuals[:home_goals]
        away_goals = actuals[:away_goals]

        if row['verdict'] == 'skip'
          mark_resolved_skip(conn, row['id'].to_i, home_goals, away_goals)
          stats[:resolved] += 1
          return
        end

        won = bet_won?(row, actuals)

        # won == nil => mercado secundário (corners/sot/cards) sem stat disponível
        # ainda. NÃO marcamos derrota — fica pending pra próxima rodada (ou
        # unresolvable se já passou MAX_ATTEMPTS_DAYS). Evita o false-loss que
        # poluía os mercados secundários (bug 2026-05-28).
        if won.nil?
          stale ? mark_stale(conn, row, stats) : (stats[:pending] += 1)
          return
        end

        # Bet sem odd utilizável: mesmo caminho do tri-state acima. Sem odd não
        # existe PL confiável, e gradar assim mesmo já custou caro uma vez
        # (vitória virando -units via odd 0.0 no compute_pl).
        unless valid_odd?(row)
          @logger.call(
            "[ai-reco-reconciler] reco #{row['id']} tem odd_captured inválida " \
            "(#{row['odd_captured'].inspect}) — irresolvível, PL não computado"
          )
          stale ? mark_stale(conn, row, stats) : (stats[:pending] += 1)
          return
        end

        pl = compute_pl(row, won)
        mark_resolved_bet(conn, row['id'].to_i, home_goals, away_goals, won, pl)
        stats[:resolved] += 1
      end

      def mark_stale(conn, row, stats)
        mark_unresolvable(conn, row['id'].to_i)
        stats[:unresolvable] += 1
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

      # Odd decimal válida é sempre > 1.0 (1.0 = stake de volta, 0 lucro).
      # `odd_captured` NULL/0/<=1 significa que o runner persistiu a bet sem
      # casar market+side com nenhum candidate — não dá pra computar PL.
      # Tratamos como irresolvível nos DOIS casos (won e lost): resolver só as
      # derrotas (onde o PL é -units independente da odd) enviesaria o ROI pra
      # baixo, e ROI é a métrica que dirige as decisões do projeto.
      def valid_odd?(row)
        odd = row['odd_captured']
        !odd.nil? && odd.to_f > 1.0
      end

      # Avalia se a aposta (market, side) foi vencedora dado os actuals.
      # Retorna true/false; ou nil quando o stat secundário necessário ainda
      # não está disponível (caller mantém pending em vez de marcar derrota).
      # Mercados E SIDES não reconhecidos -> nil (defensivo: não inventa
      # derrota nem vitória). O side entrou no contrato tri-state em 28/07:
      # antes, ternário gradava qualquer side não-canônico do LLM ('yes',
      # typo) como se a aposta fosse no lado OPOSTO.
      def bet_won?(row, actuals)
        market = row['market'].to_s
        side   = row['side'].to_s
        hg = actuals[:home_goals]
        ag = actuals[:away_goals]

        case market
        when '1x2'
          case side
          when 'home' then hg > ag
          when 'draw' then hg == ag
          when 'away' then ag > hg
          end
        when 'over25'
          case side
          when 'over'  then (hg + ag) > 2
          when 'under' then (hg + ag) <= 2
          end
        when 'btts'
          both = hg >= 1 && ag >= 1
          case side
          when 'sim' then both
          when 'nao' then !both
          end
        when 'corners-over', 'corners-under'
          over_under(actuals[:home_corners], actuals[:away_corners], market, side)
        when 'sot-over', 'sot-under'
          over_under(actuals[:home_sot], actuals[:away_sot], market, side)
        when 'cards-over', 'cards-under'
          over_under(actuals[:home_cards], actuals[:away_cards], market, side)
        end
      end

      # Over/under genérico p/ mercados de total (corners/sot/cards).
      # side = linha × 10 (e.g. '85' => 8.5). nil se o stat não veio.
      def over_under(home_val, away_val, market, side)
        return nil if home_val.nil? || away_val.nil?

        total = home_val + away_val
        line  = side.to_f / 10.0
        market.end_with?('-over') ? total > line : total < line
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
