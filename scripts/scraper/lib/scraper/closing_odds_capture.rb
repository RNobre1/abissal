require 'json'
require_relative 'db'
require_relative 'choistats_api_client'

module AdamStats
  module Scraper
    # Captura closing odds via Choistats API e persiste em `closing_odds`.
    # Roda 4x/dia (cron 15/17/19/21 UTC) — cada execução reprocessa todas as
    # recos `verdict='bet'` cujo kickoff_utc cai na janela `[now+5min, now+4h]`.
    # Não há filtro de "já capturado": cada onda sobrescreve a captura anterior
    # via upsert (last-write-wins). Resultado: a odd de fechamento mais próxima
    # do KO é sempre a que persiste em `closing_odds`, corrigindo o CLV.
    #
    # CLV (Closing Line Value) = `(odd_taken / odd_close - 1) * 100`. A
    # `odd_taken` vive em `ai_recommendations.odd_captured` (gravada ~07h
    # BRT, na hora da reco); a `odd_close` vem daqui — re-capturada a cada onda
    # até o KO, com a última captura (mais perto do kick-off) prevalecendo.
    #
    # Spec: tarefa A1 (CLV tracking).
    class ClosingOddsCapture
      SOURCE = 'choistats'.freeze

      # Recos elegíveis: verdict='bet', kickoff_utc dentro da janela
      # `[now+5min, now+4h]`. SEM filtro de "já tem closing_odd" — cada onda
      # do cron reprocessa as recos elegíveis (last-write-wins). Limit deixa
      # folga pra 4-5 ondas/dia.
      ELIGIBLE_QUERY = <<~SQL.freeze
        SELECT r.id, r.fixture_id, r.home_team, r.away_team, r.market, r.side
        FROM ai_recommendations r
        WHERE r.verdict = 'bet'
          AND r.fixture_id IS NOT NULL
          AND r.kickoff_utc BETWEEN now() + INTERVAL '5 minutes'
                                AND now() + INTERVAL '4 hours'
        ORDER BY r.kickoff_utc ASC
        LIMIT 100
      SQL

      # Upsert last-write-wins: a captura mais próxima do KO prevalece.
      # O contrato de 1 linha por (fixture_id, market, side, source) se mantém.
      INSERT_SQL = <<~SQL.freeze
        INSERT INTO closing_odds
          (fixture_id, market, side, odd_close, source, ai_recommendation_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (fixture_id, market, side, source) DO UPDATE SET
          odd_close            = EXCLUDED.odd_close,
          captured_at          = now(),
          ai_recommendation_id = EXCLUDED.ai_recommendation_id
      SQL

      def initialize(conn: nil, client: nil, logger: ->(m) { warn m })
        @conn = conn
        @client = client
        @logger = logger
      end

      def run
        with_connection do |conn|
          recos = conn.query(ELIGIBLE_QUERY).to_a
          @logger.call("[closing-odds] elegíveis: #{recos.length} recos")

          recos.each do |row|
            begin
              process_reco(conn, row)
            rescue StandardError => e
              @logger.call("[closing-odds] fixture=#{row['fixture_id']} reco=#{row['id']} falhou: #{e.class}: #{e.message}")
            end
          end
        end
      end

      private

      def with_connection
        if @conn
          yield @conn
        else
          AdamStats::Scraper::DB.with_connection { |c| yield c }
        end
      end

      def client
        @client ||= ChoistatsApiClient.new
      end

      def process_reco(conn, row)
        fixture_id = row['fixture_id'].to_i
        return if fixture_id.zero?

        payload = client.fetch_widget(:odds, fixture_id: fixture_id)
        unless payload.is_a?(Array)
          @logger.call("[closing-odds] fixture=#{fixture_id}: sem odds (payload #{payload.class})")
          return
        end

        snapshots = parse_odds(payload, home_team: row['home_team'], away_team: row['away_team'])
        if snapshots.empty?
          @logger.call("[closing-odds] fixture=#{fixture_id}: payload sem markets reconhecidos")
          return
        end

        inserted = 0
        snapshots.each do |snap|
          conn.exec_params(INSERT_SQL, [
            fixture_id,
            snap[:market],
            snap[:side],
            snap[:odd_close],
            SOURCE,
            row['id'].to_i
          ])
          inserted += 1
        end
        @logger.call("[closing-odds] fixture=#{fixture_id}: #{inserted} odds capturadas")
      end

      # Converte o payload Choistats em snapshots `{ market, side, odd_close }`
      # nos 3 mercados monitorados: 1x2 (home/draw/away), over25 (over/under)
      # e btts (sim/nao). Tolerante a market ausente, odds inválidas
      # (decimalOdds <= 0), e nomes de time que não casam (1x2-home/away).
      def parse_odds(payload, home_team:, away_team:)
        markets = index_markets(payload)
        out = []

        result = markets['Result']
        if result.is_a?(Hash)
          add_snapshot(out, '1x2', 'home', dig_decimal(result, home_team))
          add_snapshot(out, '1x2', 'draw', dig_decimal(result, 'Draw'))
          add_snapshot(out, '1x2', 'away', dig_decimal(result, away_team))
        end

        mg = markets['Match Goals Overs/Unders']
        if mg.is_a?(Hash)
          add_snapshot(out, 'over25', 'over',  dig_decimal(mg, 'Over 2.5'))
          add_snapshot(out, 'over25', 'under', dig_decimal(mg, 'Under 2.5'))
        end

        btts = markets['BTTS']
        if btts.is_a?(Hash)
          add_snapshot(out, 'btts', 'sim', dig_decimal(btts, 'Yes'))
          add_snapshot(out, 'btts', 'nao', dig_decimal(btts, 'No'))
        end

        out
      end

      def index_markets(payload)
        payload.each_with_object({}) do |entry, acc|
          next unless entry.is_a?(Hash)
          name = entry.dig('market', 'name')
          acc[name] = entry['outcomes'] if name && entry['outcomes'].is_a?(Hash)
        end
      end

      def dig_decimal(market_node, key)
        return nil unless market_node.is_a?(Hash) && key
        node = market_node[key]
        return nil unless node.is_a?(Hash)
        v = node['decimalOdds']
        v.respond_to?(:to_f) ? v.to_f : nil
      end

      def add_snapshot(out, market, side, odd)
        return if odd.nil? || odd.to_f <= 0
        out << { market: market, side: side, odd_close: odd.to_f }
      end
    end
  end
end
