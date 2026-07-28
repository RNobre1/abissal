require_relative 'match_detail'

module AdamStats
  module Scraper
    # Mescla as respostas dos widgets do choistats (recent-results, team-records,
    # chances, odds) com a MatchDetail base parseada do HTML estatístico.
    module WidgetMerger
      RECENT_MATCH_FIELDS = %w[
        id date result htResult status
        homeGoalsFt awayGoalsFt homeGoalsHt awayGoalsHt
        homeCorners awayCorners
        homeCorners1h awayCorners1h homeCorners2h awayCorners2h
        homeYellows awayYellows homeReds awayReds
        homeYellowReds awayYellowReds
        homeBookingPoints awayBookingPoints
        homeTotalShots awayTotalShots homeShotsOnTarget awayShotsOnTarget
        homeFouls awayFouls homeOffsides awayOffsides homeTackles awayTackles
        homeGoalKicks awayGoalKicks homeThrowIns awayThrowIns
      ].freeze

      module_function

      TOP_PLAYERS_LIMIT = 11

      PLAYER_STAT_FIELDS = {
        played: 'played', started: 'started', subs: 'subs',
        minutes: 'minutes', goals: 'goals', assists: 'assists',
        yellows: 'yellows', reds: 'reds',
        total_shots: 'totalShots', shots_on_target: 'shotsOnTarget',
        fouls_committed: 'foulsCommitted', fouls_drawn: 'foulsDrawn',
        offsides: 'offsides', tackles: 'tackles',
        first_goals: 'firstGoals', first_cards: 'firstCards',
        goals_1h: 'goals1h', goals_2h: 'goals2h',
        cards_1h: 'cards1h', cards_2h: 'cards2h',
        injured: 'injured'
      }.freeze

      AGGREGATE_FIELDS = %i[
        minutes goals assists yellows reds
        total_shots shots_on_target fouls_committed fouls_drawn
        offsides tackles goals_1h goals_2h cards_1h cards_2h
      ].freeze

      def merge(detail, widgets)
        widgets ||= {}
        team_records_data = widgets[:team_records] || widgets['team_records']
        recents = widgets[:recent_results] || widgets['recent_results']
        chances = widgets[:chances] || widgets['chances']
        odds = widgets[:odds] || widgets['odds']
        players = widgets[:players] || widgets['players']
        referee_fixtures = widgets[:referee_fixtures] || widgets['referee_fixtures']

        detail.with(
          team_record: build_team_record(team_records_data),
          recent_matches: build_recent_matches(recents),
          h2h: build_h2h(recents),
          streaks: build_streaks(recents),
          predictions: build_predictions(chances),
          odds_summary: build_odds_summary(odds),
          player_stats: build_player_stats(players),
          referee_record: build_referee_record(referee_fixtures),
          # Fundação Simulação — novos campos (itens 1-6)
          avgs: build_avgs(recents),
          recent_all: build_recent_all(recents),
          standings: build_standings(team_records_data),
          odds_devigged: build_odds_devigged(odds),
          player_extra: build_player_extra(players)
        )
      end

      def build_team_record(data)
        return MatchDetail.empty.team_record unless data.is_a?(Hash)

        {
          home: {
            overall: simplify_record(data['homeTeamOverallRecord']),
            home: simplify_record(data['homeTeamHomeRecord'])
          },
          away: {
            overall: simplify_record(data['awayTeamOverallRecord']),
            away: simplify_record(data['awayTeamAwayRecord'])
          }
        }
      end

      def simplify_record(rec)
        return nil unless rec.is_a?(Hash)

        {
          type: rec['type'],
          position: rec['position'],
          played: rec['played'],
          won: rec['won'],
          draw: rec['draw'],
          lost: rec['lost'],
          goals_for: rec['goalsFor'],
          goals_against: rec['goalsAg'],
          goal_diff: rec['goalDiff'],
          points: rec['points'],
          points_per_game: rec['pointsPerGame'],
          form: rec['form']
        }
      end

      def build_recent_matches(data)
        empty = { home: [], away: [] }
        return empty unless data.is_a?(Hash)

        {
          home: extract_matches(data['recentHomeResults']),
          away: extract_matches(data['recentAwayResults'])
        }
      end

      def build_h2h(data)
        return [] unless data.is_a?(Hash)

        extract_matches(data['headToHead'])
      end

      def extract_matches(matches)
        return [] unless matches.is_a?(Array)

        matches.map do |m|
          out = RECENT_MATCH_FIELDS.each_with_object({}) { |f, acc| acc[f] = m[f] }
          out['date_iso'] = epoch_to_iso(m['date'])
          out['home_team'] = m.dig('homeTeam', 'name')
          out['away_team'] = m.dig('awayTeam', 'name')
          out['league'] = m.dig('league', 'name')
          out
        end
      end

      def epoch_to_iso(epoch_ms)
        return nil unless epoch_ms.is_a?(Numeric)

        Time.at(epoch_ms / 1000).utc.strftime('%Y-%m-%d')
      end

      def build_streaks(data)
        return { home: [], away: [] } unless data.is_a?(Hash) && data['quickStats'].is_a?(Array)

        home = []
        away = []
        data['quickStats'].each do |group|
          group_name = group['groupName']
          (group['quickStats'] || []).each do |entry|
            home_stat = entry['homeTeamQuickStat']
            away_stat = entry['awayTeamQuickStat']
            home << flatten_streak(home_stat, group_name) if home_stat
            away << flatten_streak(away_stat, group_name) if away_stat
          end
        end
        { home: home, away: away }
      end

      def flatten_streak(stat, group_name)
        return nil unless stat.is_a?(Hash)

        {
          group: group_name,
          stat_type: stat['statType'],
          desc: stat['statDesc'],
          line: stat['line'],
          colour: stat['colour'],
          overall_count: stat['overallCount'],
          overall_fixtures: stat['overallFixtureCount'],
          overall_streak: stat['overallStreak'],
          overall_perc: stat['overallPerc'],
          home_count: stat['homeCount'],
          home_fixtures: stat['homeFixtureCount'],
          home_streak: stat['homeStreak'],
          home_perc: stat['homePerc'],
          away_count: stat['awayCount'],
          away_fixtures: stat['awayFixtureCount'],
          away_streak: stat['awayStreak'],
          away_perc: stat['awayPerc']
        }
      end

      def build_predictions(data)
        return [] unless data.is_a?(Array) && data.first.is_a?(Hash)

        chances = data.first['chances'] || []
        chances.map do |c|
          {
            stat_type: c['statType'],
            chance: c['chance'],
            chance_team: c['chanceTeam'],
            home_stats: extract_stat_texts(c['homeStats']),
            away_stats: extract_stat_texts(c['awayStats']),
            best_odds: c.dig('fixtureOdds', 'decimalOdds'),
            best_odds_bookmaker: c.dig('fixtureOdds', 'bookmaker')
          }
        end
      end

      def extract_stat_texts(stats)
        return [] unless stats.is_a?(Array)

        stats.map { |s| strip_html(s['stat']) }.compact
      end

      def strip_html(text)
        return nil if text.nil?

        text.gsub(/<[^>]+>/, '').gsub(/\s+/, ' ').strip
      end

      def build_referee_record(fixtures)
        return nil unless fixtures.is_a?(Array) && fixtures.any?

        name = fixtures.first.dig('referee', 'name')
        completed = fixtures.select { |f| f['status'] && f['status'] != 'NS' }
        record = {
          name: name,
          fixtures_count: fixtures.length,
          completed: completed.length,
          avg_total_booking_points: nil,
          avg_home_booking_points: nil,
          avg_away_booking_points: nil,
          total_yellow_reds: nil
        }

        if completed.any?
          n = completed.length.to_f
          home_bp = completed.sum { |f| (f['homeBookingPoints'] || 0).to_i }
          away_bp = completed.sum { |f| (f['awayBookingPoints'] || 0).to_i }
          home_yr = completed.sum { |f| (f['homeYellowReds'] || 0).to_i }
          away_yr = completed.sum { |f| (f['awayYellowReds'] || 0).to_i }
          record[:avg_home_booking_points] = (home_bp / n).round(2)
          record[:avg_away_booking_points] = (away_bp / n).round(2)
          record[:avg_total_booking_points] = ((home_bp + away_bp) / n).round(2)
          record[:total_yellow_reds] = home_yr + away_yr

          record.merge!(card_profile(completed))
          record.merge!(foul_profile(completed))
        end

        record
      end

      # Linhas de over/under de cartões que o painel e o edge-calculator usam.
      CARD_LINES = [2.5, 3.5, 4.5, 5.5, 6.5].freeze

      # Perfil de CARTÕES do árbitro a partir da contagem por lado.
      #
      # Booking points (amarelo=10, vermelho=25) é uma métrica composta: dois
      # árbitros com a mesma média de BP podem ter distribuições de cartões
      # completamente diferentes, e é a distribuição que decide um over/under.
      # Aqui extraímos a contagem real, o split casa/fora, a frequência de
      # "2+ por time" e a dispersão empírica.
      #
      # Retorna todos os campos como `nil` quando o payload não traz
      # `homeYellows`/`awayYellows` — nunca 0, que o consumidor leria como
      # "árbitro que não dá cartão" (mesmo contrato tri-state da Lição B19).
      def card_profile(completed)
        empty = {
          avg_home_cards: nil, avg_away_cards: nil, avg_total_cards: nil,
          pct_home_2plus_cards: nil, pct_away_2plus_cards: nil,
          pct_both_2plus_cards: nil, cards_over_pct: nil, cards_dispersion: nil
        }
        with_cards = completed.select { |f| f.key?('homeYellows') && f.key?('awayYellows') }
        return empty if with_cards.empty?

        n = with_cards.length.to_f
        home = with_cards.map { |f| (f['homeYellows'] || 0).to_i + (f['homeReds'] || 0).to_i }
        away = with_cards.map { |f| (f['awayYellows'] || 0).to_i + (f['awayReds'] || 0).to_i }
        totals = home.zip(away).map { |h, a| h + a }

        mean = totals.sum / n
        variance = totals.sum { |t| (t - mean)**2 } / n

        {
          avg_home_cards: (home.sum / n).round(2),
          avg_away_cards: (away.sum / n).round(2),
          avg_total_cards: mean.round(2),
          pct_home_2plus_cards: (100.0 * home.count { |c| c >= 2 } / n).round(1),
          pct_away_2plus_cards: (100.0 * away.count { |c| c >= 2 } / n).round(1),
          pct_both_2plus_cards: (
            100.0 * home.zip(away).count { |h, a| h >= 2 && a >= 2 } / n
          ).round(1),
          # Distribuição empírica: P(total > linha) direto do histórico do
          # árbitro, sem supor forma paramétrica nenhuma.
          cards_over_pct: CARD_LINES.to_h do |line|
            [line.to_s, (100.0 * totals.count { |t| t > line } / n).round(1)]
          end,
          # var/média: >1 over-disperso, <1 sub-disperso, ~1 Poisson. É o
          # parâmetro que o debate NB × CMP (B34-B37) tentou fitar globalmente
          # — aqui ele é observável POR ÁRBITRO.
          cards_dispersion: mean.zero? ? nil : (variance / mean).round(2)
        }
      end

      # Faltas por jogo. É o driver causal do cartão (árbitro rigoroso marca
      # mais falta → mais cartão) e nunca tinha sido coletado, apesar de vir
      # no mesmo payload.
      def foul_profile(completed)
        with_fouls = completed.select { |f| f.key?('homeFouls') && f.key?('awayFouls') }
        return { avg_home_fouls: nil, avg_away_fouls: nil, avg_total_fouls: nil } if with_fouls.empty?

        n = with_fouls.length.to_f
        home = with_fouls.sum { |f| (f['homeFouls'] || 0).to_i }
        away = with_fouls.sum { |f| (f['awayFouls'] || 0).to_i }
        {
          avg_home_fouls: (home / n).round(2),
          avg_away_fouls: (away / n).round(2),
          avg_total_fouls: ((home + away) / n).round(2)
        }
      end

      def build_player_stats(data)
        empty_side = -> { { aggregates: empty_aggregates, top_players: [] } }
        return { home: empty_side.call, away: empty_side.call } unless data.is_a?(Hash)

        {
          home: build_side_player_stats(data['homePlayers']),
          away: build_side_player_stats(data['awayPlayers'])
        }
      end

      def build_side_player_stats(players)
        list = players.is_a?(Array) ? players : []
        {
          aggregates: aggregate_players(list),
          top_players: top_players_by_minutes(list)
        }
      end

      def aggregate_players(list)
        agg = empty_aggregates.merge(players_count: list.length)
        AGGREGATE_FIELDS.each do |key|
          src = PLAYER_STAT_FIELDS[key]
          agg[key] = list.sum { |p| (p[src] || 0).to_i }
        end
        agg
      end

      def empty_aggregates
        EMPTY_PLAYER_AGGREGATES.dup
      end

      def top_players_by_minutes(list)
        list
          .sort_by { |p| -((p['minutes'] || 0).to_i) }
          .first(TOP_PLAYERS_LIMIT)
          .map { |p| flatten_player(p) }
      end

      def flatten_player(raw)
        out = { name: raw['name'].to_s.strip }
        PLAYER_STAT_FIELDS.each do |out_key, src_key|
          v = raw[src_key]
          out[out_key] = v.nil? ? 0 : v
        end
        out
      end

      def build_odds_summary(data)
        return {} unless data.is_a?(Array)

        summary = {}
        data.each do |market|
          name = market.dig('market', 'name')
          next unless name && market['outcomes'].is_a?(Hash)

          summary[name] = market['outcomes'].each_with_object({}) do |(outcome_name, outcome), acc|
            acc[outcome_name] = {
              decimal_odds: outcome['decimalOdds'],
              bookmaker: outcome['bookmaker']
            }
          end
        end
        summary
      end

      # ─────────────────────────────────────────────────────────────────────────
      # Fundação Simulação — novos helpers (itens 1-6)
      # ─────────────────────────────────────────────────────────────────────────

      # Item 1 — 4 *Avgs blocks from recent-results widget fixture sub-object
      def build_avgs(data)
        empty = { home_home: {}, home_overall: {}, away_away: {}, away_overall: {} }
        return empty unless data.is_a?(Hash) && data['fixture'].is_a?(Hash)

        fixture = data['fixture']
        {
          home_home:    extract_avgs_block(fixture['homeTeamHomeAvgs']),
          home_overall: extract_avgs_block(fixture['homeTeamOverallAvgs']),
          away_away:    extract_avgs_block(fixture['awayTeamAwayAvgs']),
          away_overall: extract_avgs_block(fixture['awayTeamOverallAvgs'])
        }
      end

      def extract_avgs_block(raw)
        return {} unless raw.is_a?(Hash)

        # Persist all metrics; rename numMatches → num_matches for Ruby convention;
        # also keep the camelCase metrics as-is (43 keys total preserved).
        raw.each_with_object({}) { |(k, v), acc| acc[k == 'numMatches' ? :num_matches : k.to_sym] = v }
      end

      # Item 2 — recent_all: home+away results from all venues
      def build_recent_all(data)
        empty = { home: [], away: [] }
        return empty unless data.is_a?(Hash)

        {
          home: extract_matches(data['recentHomeAllResults']),
          away: extract_matches(data['recentAwayAllResults'])
        }
      end

      # Item 3 — standings: current league table position + stage + fixture slug
      def build_standings(data)
        empty = { home: {}, away: {} }
        return empty unless data.is_a?(Hash)

        fws = data['fixtureWithoutStats']
        return empty unless fws.is_a?(Hash)

        home_id = fws.dig('homeTeam', 'id')
        away_id = fws.dig('awayTeam', 'id')
        stage_name = fws.dig('stage', 'name')
        fixture_slug = fws['slug']

        home_entry = find_team_standing(data['homeTeamResultsWithStandings'], home_id)
        away_entry = find_team_standing(data['awayTeamResultsWithStandings'], away_id)

        {
          home: build_standing_entry(home_entry, fws['homeTeamPosition'], stage_name, fixture_slug),
          away: build_standing_entry(away_entry, fws['awayTeamPosition'], stage_name, fixture_slug)
        }
      end

      def find_team_standing(standings, team_id)
        return nil unless standings.is_a?(Array) && team_id

        standings.find { |r| r.is_a?(Hash) && r.dig('team', 'id') == team_id }
      end

      def build_standing_entry(entry, fixture_position, stage_name, fixture_slug)
        return {} unless entry.is_a?(Hash)

        {
          position: entry['position'],
          played: entry['played'],
          points: entry['points'],
          goal_diff: entry['goalDiff'],
          position_type: entry['positionType'],
          fixture_position: fixture_position,
          stage_name: stage_name,
          fixture_slug: fixture_slug
        }
      end

      # Item 5 — odds_devigged: multiplicative devig across all markets
      # Skips any market where any outcome has decimalOdds == 0 (undefined/missing)
      def build_odds_devigged(data)
        return {} unless data.is_a?(Array)

        result = {}
        data.each do |market|
          next unless market.is_a?(Hash)

          name = market.dig('market', 'name')
          next unless name && market['outcomes'].is_a?(Hash)

          outcomes = market['outcomes']
          odds_values = outcomes.values.map { |o| o.is_a?(Hash) ? o['decimalOdds'].to_f : 0.0 }
          # Skip market if any odds are zero/nil (avoid division by zero)
          next if odds_values.any? { |o| o <= 0 }

          sum_inv = odds_values.sum { |o| 1.0 / o }
          next if sum_inv <= 0

          result[name] = outcomes.each_with_object({}) do |(outcome_name, outcome), acc|
            acc[outcome_name] = ((1.0 / (outcome.is_a?(Hash) ? outcome['decimalOdds'].to_f : 0.0)) / sum_inv).round(6)
          end
        end
        result
      end

      # Item 6 — player_extra: form, seasons, outcome_odds_by_player
      def build_player_extra(data)
        empty = { form: [], home_seasons: [], away_seasons: [], outcome_odds_by_player: {} }
        return empty unless data.is_a?(Hash)

        {
          form: data['playerStatsForm'].is_a?(Array) ? data['playerStatsForm'] : [],
          home_seasons: data['homeTeamSeasons'].is_a?(Array) ? data['homeTeamSeasons'] : [],
          away_seasons: data['awayTeamSeasons'].is_a?(Array) ? data['awayTeamSeasons'] : [],
          outcome_odds_by_player: build_outcome_odds_by_player(data)
        }
      end

      def build_outcome_odds_by_player(data)
        return {} unless data.is_a?(Hash)

        all_players = (Array(data['homePlayers']) + Array(data['awayPlayers']))
        all_players.each_with_object({}) do |player, acc|
          next unless player.is_a?(Hash) && player['outcomeOdds'].is_a?(Hash) && !player['outcomeOdds'].empty?

          name = player['name'].to_s.strip
          next if name.empty?

          acc[name] = player['outcomeOdds'].each_with_object({}) do |(outcome_type, odd_data), inner|
            inner[outcome_type] = odd_data.is_a?(Hash) ? odd_data['decimalOdds'].to_f : 0.0
          end
        end
      end
    end
  end
end
