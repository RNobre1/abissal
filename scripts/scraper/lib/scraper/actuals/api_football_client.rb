require 'faraday'
require 'json'

module AdamStats
  module Scraper
    module Actuals
      # Thin Faraday wrapper para a API-Football v3 (api-sports.io).
      #
      # Auth: header `x-apisports-key` (direto para api-sports.io;
      # não usa RapidAPI headers).
      #
      # Rate limiting:
      # - Per-minute throttle: HTTP 429 com `retry-after` header (segundos).
      #   Levanta RateLimitError — caller decide se retenta ou pula.
      # - Daily quota: HTTP 200 com `errors.requests` contendo "limit".
      #   Levanta QuotaExhaustedError.
      # - Margem de segurança: usar quota_remaining; abortar se < 5.
      #
      # Smoke test 2026-05-26: chave 29439b225e54f8e70fb2bb74b36e3ff3
      # confirmou endpoints /status, /fixtures, /fixtures/statistics.
      class ApiFootballClient
        BASE_URL = ENV.fetch('API_FOOTBALL_BASE_URL', 'https://v3.football.api-sports.io').freeze

        # Erros distintos para tratamento diferenciado pelo reconciler
        class ApiFootballError < StandardError; end
        class QuotaExhaustedError < ApiFootballError; end
        class RateLimitError < ApiFootballError; end

        def initialize(key:, logger: ->(m) { warn m })
          raise ArgumentError, 'API_FOOTBALL_KEY is required — set env var before instantiating' if key.nil?

          @key    = key
          @logger = logger
          @conn   = build_connection
        end

        # GET /status — retorna response hash com account + requests
        def status
          body = get('/status')
          body.dig('response')
        end

        # Requests restantes (limit_day - current). 1 request para /status.
        def quota_remaining
          s = status
          limit   = s&.dig('requests', 'limit_day').to_i
          current = s&.dig('requests', 'current').to_i
          limit - current
        end

        # GET /fixtures?date=YYYY-MM-DD&league=ID&season=YYYY
        # Retorna array de fixtures da resposta.
        def fixtures_by_date(date:, league:, season:)
          body = get('/fixtures', date: date.to_s, league: league.to_s, season: season.to_s)
          body.fetch('response', [])
        end

        # GET /fixtures/statistics?fixture=ID
        # Retorna array de {team, statistics[]} por time.
        def fixture_statistics(fixture_id:)
          body = get('/fixtures/statistics', fixture: fixture_id.to_s)
          body.fetch('response', [])
        end

        private

        def build_connection
          Faraday.new(BASE_URL) do |f|
            f.request  :url_encoded
            f.headers['x-apisports-key'] = @key
            f.headers['Accept']          = 'application/json'
          end
        end

        def get(path, params = {})
          response = @conn.get(path, params)
          body = parse_body(response.body)
          handle_response!(response.status, response.headers, body)
          body
        end

        def parse_body(raw)
          return raw if raw.is_a?(Hash)
          return {} if raw.nil? || raw.empty?

          JSON.parse(raw)
        rescue JSON::ParserError
          {}
        end

        def handle_response!(status, headers, body)
          if status == 429
            raise RateLimitError,
                  "API-Football rate limited (per-minute). retry-after: #{headers['retry-after']}s"
          end

          if status >= 400
            raise ApiFootballError,
                  "API-Football HTTP #{status}: #{body.inspect}"
          end

          # Quota diária esgotada (HTTP 200 mas com errors)
          errors = body.is_a?(Hash) ? body.fetch('errors', nil) : nil
          if errors && !errors.empty?
            error_str = errors.to_s.downcase
            if error_str.include?('limit') || error_str.include?('quota') ||
               error_str.include?('requests')
              raise QuotaExhaustedError, "API-Football daily quota exhausted: #{errors}"
            end
          end
        end
      end
    end
  end
end
