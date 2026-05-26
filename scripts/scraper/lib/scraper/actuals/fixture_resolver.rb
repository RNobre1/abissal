require 'date'
require 'time'
require_relative 'statistics_parser'

module AdamStats
  module Scraper
    module Actuals
      # Resolve choistats_fixture_id → api_football_fixture_id.
      #
      # Estratégia:
      # 1. Lookup no cache (actuals_fixture_mapping) — 0 reqs.
      # 2. Cache miss: discovery via GET /fixtures?date+league+season — 1 req.
      #    Filtra response por home_team match (exact após normalização).
      #    Único match → cacheia + retorna.
      #    Zero ou múltiplos → loga + retorna nil.
      #
      # Normalização de nomes: StatisticsParser.normalize (downcase + strip).
      class FixtureResolver
        def initialize(client:, db_conn:, logger: ->(m) { warn m })
          @client  = client
          @db_conn = db_conn
          @logger  = logger
        end

        # Retorna Integer api_football_fixture_id ou nil se não resolvível.
        # af_league_id: Integer league id na API-Football.
        def resolve(row, af_league_id)
          choistats_id = row['fixture_id'].to_i

          # 1. Cache hit
          cached = lookup_cache(choistats_id)
          return cached if cached

          # 2. Discovery via API
          kickoff_date = kickoff_date_for(row)
          season       = season_for(row)

          begin
            fixtures = @client.fixtures_by_date(
              date:   kickoff_date,
              league: af_league_id,
              season: season
            )
          rescue StandardError => e
            @logger.call("[resolver] API error for choistats_id=#{choistats_id}: #{e.class}: #{e.message}")
            return nil
          end

          home_norm = StatisticsParser.normalize(row['home_team'])
          away_norm = StatisticsParser.normalize(row['away_team'])

          matches = fixtures.select do |f|
            api_home = StatisticsParser.normalize(f.dig('teams', 'home', 'name'))
            api_away = StatisticsParser.normalize(f.dig('teams', 'away', 'name'))
            api_home == home_norm && api_away == away_norm
          end

          if matches.size == 1
            af_id = matches.first.dig('fixture', 'id').to_i
            cache_mapping(choistats_id, af_id, row['league'])
            af_id
          elsif matches.empty?
            @logger.call(
              "[resolver] unresolvable: no match for choistats_id=#{choistats_id} " \
              "(#{row['home_team']} vs #{row['away_team']}, date=#{kickoff_date}, " \
              "league_id=#{af_league_id})"
            )
            nil
          else
            ids = matches.map { |f| f.dig('fixture', 'id') }.inspect
            @logger.call(
              "[resolver] unresolvable: ambiguous matches #{ids} for choistats_id=#{choistats_id} " \
              "(#{row['home_team']} vs #{row['away_team']})"
            )
            nil
          end
        end

        # Extrai o ano da temporada a partir do kickoff_utc.
        # Para ligas com temporada = ano calendário (Brasileirão, MLS, etc.)
        # e ligas europeias que neste contexto são identificadas pelo ano de início.
        def season_for(row)
          Time.parse(row['kickoff_utc']).utc.year
        rescue StandardError
          Time.now.utc.year
        end

        private

        def lookup_cache(choistats_id)
          result = @db_conn.exec_params(
            'SELECT api_football_fixture_id FROM actuals_fixture_mapping ' \
            'WHERE choistats_fixture_id = $1 LIMIT 1',
            [choistats_id]
          ).to_a

          return nil if result.empty?
          result.first['api_football_fixture_id'].to_i
        end

        def cache_mapping(choistats_id, af_fixture_id, league)
          @db_conn.exec_params(
            'INSERT INTO actuals_fixture_mapping ' \
            '  (choistats_fixture_id, api_football_fixture_id, league) ' \
            'VALUES ($1, $2, $3) ' \
            'ON CONFLICT (choistats_fixture_id) DO NOTHING',
            [choistats_id, af_fixture_id, league]
          )
        rescue StandardError => e
          # Cache insert failure é non-fatal — próxima rodada vai re-resolver
          @logger.call("[resolver] cache insert failed for #{choistats_id}: #{e.message}")
        end

        def kickoff_date_for(row)
          Time.parse(row['kickoff_utc']).utc.strftime('%Y-%m-%d')
        rescue StandardError
          Date.today.to_s
        end
      end
    end
  end
end
