require 'json'
require_relative '../../lib/scraper/widget_merger'
require_relative '../../lib/scraper/match_detail'

RSpec.describe AdamStats::Scraper::WidgetMerger do
  WIDGET_DIR = File.expand_path('fixtures/widgets', __dir__)

  def load_widget(name)
    JSON.parse(File.read(File.join(WIDGET_DIR, "#{name}.json")))
  end

  let(:widgets) do
    {
      team_records: load_widget('team-records'),
      recent_results: load_widget('recent-results'),
      chances: load_widget('chances'),
      odds: load_widget('odds'),
      players: load_widget('players')
    }
  end

  let(:base) { AdamStats::Scraper::MatchDetail.empty.with(trends: [{ label: 'demo', home_percent: 50, away_percent: 50 }]) }
  let(:merged) { described_class.merge(base, widgets) }

  it 'preserves trends from base' do
    expect(merged.trends.first[:label]).to eq('demo')
  end

  describe 'team_record' do
    it 'extracts overall records for both teams (position, played, points, form)' do
      home_overall = merged.team_record[:home][:overall]
      expect(home_overall).to include(
        type: 'All',
        played: 35,
        points: 37,
        points_per_game: 1.1
      )
      expect(home_overall[:position]).to match(/\d+(st|nd|rd|th)/)
      expect(home_overall[:form]).to be_an(Array)
      expect(home_overall[:form].length).to be >= 1
    end

    it 'extracts home-only record for home team and away-only for away team' do
      expect(merged.team_record[:home][:home][:type]).to eq('Home')
      expect(merged.team_record[:away][:away][:type]).to eq('Away')
    end
  end

  describe 'recent_matches' do
    it 'extracts up to 10 home games for home team and 10 away games for away team' do
      expect(merged.recent_matches[:home]).to be_an(Array)
      expect(merged.recent_matches[:home].length).to be_between(1, 10)
      expect(merged.recent_matches[:away].length).to be_between(1, 10)
    end

    it 'each match has date_iso, teams, score and rich per-match stats' do
      match = merged.recent_matches[:home].first
      expect(match['date_iso']).to match(/\A\d{4}-\d{2}-\d{2}\z/)
      expect(match['home_team']).to be_a(String)
      expect(match['away_team']).to be_a(String)
      expect(match['homeGoalsFt']).to be_a(Integer)
      expect(match['awayGoalsFt']).to be_a(Integer)
      expect(match).to have_key('homeCorners')
      expect(match).to have_key('homeBookingPoints')
      expect(match).to have_key('homeTotalShots')
    end

    it 'each match also carries offsides, 1H/2H corners, tackles and yellow-reds (premium fields)' do
      match = merged.recent_matches[:home].first
      %w[homeOffsides awayOffsides
         homeCorners1h awayCorners1h
         homeCorners2h awayCorners2h
         homeTackles awayTackles
         homeYellowReds awayYellowReds].each do |key|
        expect(match).to have_key(key), "expected #{key.inspect} in recent_match"
      end
    end
  end

  describe 'h2h' do
    it 'returns last head-to-head matches' do
      expect(merged.h2h).to be_an(Array)
      expect(merged.h2h.length).to be >= 1
      expect(merged.h2h.first).to include('home_team', 'away_team', 'homeGoalsFt', 'awayGoalsFt')
    end
  end

  describe 'streaks' do
    it 'extracts per-team streak facts grouped by category' do
      expect(merged.streaks[:home]).to be_an(Array)
      expect(merged.streaks[:home].length).to be >= 1
      first = merged.streaks[:home].first
      expect(first).to include(:stat_type, :overall_perc, :home_perc, :away_perc, :group)
    end
  end

  describe 'predictions' do
    it 'returns up to 3 top predictions with chance and odds' do
      expect(merged.predictions).to be_an(Array)
      expect(merged.predictions.length).to be >= 1
      first = merged.predictions.first
      expect(first[:stat_type]).to be_a(String)
      expect(first[:chance]).to be_a(Numeric)
    end

    it 'strips HTML from streak descriptions inside predictions' do
      first = merged.predictions.first
      all_stats = first[:home_stats] + first[:away_stats]
      all_stats.each { |s| expect(s).not_to match(/<[a-z]/i) }
    end
  end

  describe 'odds_summary' do
    it 'maps each market name to its outcomes with decimal odds' do
      expect(merged.odds_summary).to be_a(Hash)
      expect(merged.odds_summary).not_to be_empty
      first_market = merged.odds_summary.values.first
      first_outcome = first_market.values.first
      expect(first_outcome[:decimal_odds]).to be_a(Numeric)
    end
  end

  describe 'player_stats (shots, fouls, offsides, etc)' do
    it 'is populated for home and away with aggregates + top players' do
      ps = merged.player_stats
      expect(ps).to be_a(Hash)
      expect(ps).to have_key(:home)
      expect(ps).to have_key(:away)
      expect(ps[:home]).to have_key(:aggregates)
      expect(ps[:home]).to have_key(:top_players)
    end

    it 'aggregates per-team include shots, shots on target, fouls, offsides, tackles, cards, goals, assists' do
      agg = merged.player_stats[:home][:aggregates]
      %i[total_shots shots_on_target fouls_committed fouls_drawn offsides tackles
         yellows reds goals assists goals_1h goals_2h cards_1h cards_2h
         minutes players_count].each { |k| expect(agg).to have_key(k) }
      expect(agg[:total_shots]).to be >= 0
      expect(agg[:players_count]).to be >= 1
    end

    it 'aggregates equal the sum of individual players for the corresponding side' do
      home_raw = widgets[:players]['homePlayers']
      expected_shots = home_raw.sum { |p| p['totalShots'].to_i }
      expected_offsides = home_raw.sum { |p| p['offsides'].to_i }
      expect(merged.player_stats[:home][:aggregates][:total_shots]).to eq(expected_shots)
      expect(merged.player_stats[:home][:aggregates][:offsides]).to eq(expected_offsides)
    end

    it 'returns up to 11 top players per side ordered by minutes desc' do
      tops = merged.player_stats[:home][:top_players]
      expect(tops).to be_an(Array)
      expect(tops.length).to be <= 11
      minutes = tops.map { |p| p[:minutes] }
      expect(minutes).to eq(minutes.sort.reverse)
    end

    it 'each top player exposes the canonical stat keys' do
      sample = merged.player_stats[:home][:top_players].first
      %i[name played started minutes goals assists yellows reds
         total_shots shots_on_target fouls_committed fouls_drawn
         offsides tackles goals_1h goals_2h cards_1h cards_2h].each do |k|
        expect(sample).to have_key(k), "expected key #{k.inspect} in top_player"
      end
    end

    it 'tolerates missing players widget gracefully' do
      result = described_class.merge(base, widgets.except(:players))
      expect(result.player_stats[:home][:aggregates][:players_count]).to eq(0)
      expect(result.player_stats[:home][:top_players]).to eq([])
    end
  end

  describe 'referee_record' do
    let(:referee_fixtures) do
      # 4 completed games, 1 future (status NS)
      [
        { 'id' => 100, 'status' => 'FT', 'homeBookingPoints' => 40, 'awayBookingPoints' => 30, 'homeYellowReds' => 0, 'awayYellowReds' => 0, 'referee' => { 'id' => 14343, 'name' => 'Marco Guida' } },
        { 'id' => 101, 'status' => 'FT', 'homeBookingPoints' => 50, 'awayBookingPoints' => 25, 'homeYellowReds' => 1, 'awayYellowReds' => 0, 'referee' => { 'id' => 14343, 'name' => 'Marco Guida' } },
        { 'id' => 102, 'status' => 'FT', 'homeBookingPoints' => 20, 'awayBookingPoints' => 45, 'homeYellowReds' => 0, 'awayYellowReds' => 1, 'referee' => { 'id' => 14343, 'name' => 'Marco Guida' } },
        { 'id' => 103, 'status' => 'FT', 'homeBookingPoints' => 35, 'awayBookingPoints' => 30, 'homeYellowReds' => 0, 'awayYellowReds' => 0, 'referee' => { 'id' => 14343, 'name' => 'Marco Guida' } },
        { 'id' => 104, 'status' => 'NS', 'homeBookingPoints' => 0, 'awayBookingPoints' => 0, 'homeYellowReds' => 0, 'awayYellowReds' => 0, 'referee' => { 'id' => 14343, 'name' => 'Marco Guida' } }
      ]
    end

    it 'aggregates booking points / yellow reds over COMPLETED games only and exposes the referee name' do
      result = described_class.merge(base, widgets.merge(referee_fixtures: referee_fixtures))
      rec = result.referee_record
      expect(rec[:name]).to eq('Marco Guida')
      expect(rec[:fixtures_count]).to eq(5)
      expect(rec[:completed]).to eq(4)
      # (40+30 + 50+25 + 20+45 + 35+30) / 4 = 275 / 4 = 68.75 total bp per game
      expect(rec[:avg_total_booking_points]).to be_within(0.05).of(68.75)
      # home avg = (40+50+20+35)/4 = 36.25; away avg = (30+25+45+30)/4 = 32.5
      expect(rec[:avg_home_booking_points]).to be_within(0.05).of(36.25)
      expect(rec[:avg_away_booking_points]).to be_within(0.05).of(32.5)
      # total yellow_reds = 2 across 4 completed
      expect(rec[:total_yellow_reds]).to eq(2)
    end

    it 'returns nil when referee_fixtures is missing or empty' do
      no_referee = described_class.merge(base, widgets.merge(referee_fixtures: nil))
      expect(no_referee.referee_record).to be_nil
      empty_referee = described_class.merge(base, widgets.merge(referee_fixtures: []))
      expect(empty_referee.referee_record).to be_nil
    end

    # O widget /referee/{id}/fixtures devolve ~30 campos POR JOGO apitado
    # (cartões por lado, faltas, corners 1H/2H, chutes, pênaltis) e nós
    # guardávamos só a média de booking points. Booking point é uma métrica
    # composta (amarelo=10, vermelho=25 no choistats) — some a contagem de
    # cartões e a forma da distribuição, que é justamente o que decide um
    # mercado over/under.
    describe 'campos ricos por jogo (28/07)' do
      # 4 jogos completos com cartões e faltas explícitos.
      let(:rich_fixtures) do
        [
          { 'id' => 200, 'status' => 'FT', 'homeBookingPoints' => 40, 'awayBookingPoints' => 30,
            'homeYellows' => 4, 'awayYellows' => 3, 'homeReds' => 0, 'awayReds' => 0,
            'homeYellowReds' => 0, 'awayYellowReds' => 0, 'homeFouls' => 14, 'awayFouls' => 11,
            'referee' => { 'id' => 1, 'name' => 'Ref' } },
          { 'id' => 201, 'status' => 'FT', 'homeBookingPoints' => 20, 'awayBookingPoints' => 45,
            'homeYellows' => 2, 'awayYellows' => 3, 'homeReds' => 0, 'awayReds' => 1,
            'homeYellowReds' => 0, 'awayYellowReds' => 1, 'homeFouls' => 9, 'awayFouls' => 16,
            'referee' => { 'id' => 1, 'name' => 'Ref' } },
          { 'id' => 202, 'status' => 'FT', 'homeBookingPoints' => 10, 'awayBookingPoints' => 10,
            'homeYellows' => 1, 'awayYellows' => 1, 'homeReds' => 0, 'awayReds' => 0,
            'homeYellowReds' => 0, 'awayYellowReds' => 0, 'homeFouls' => 8, 'awayFouls' => 7,
            'referee' => { 'id' => 1, 'name' => 'Ref' } },
          { 'id' => 203, 'status' => 'FT', 'homeBookingPoints' => 30, 'awayBookingPoints' => 20,
            'homeYellows' => 3, 'awayYellows' => 2, 'homeReds' => 0, 'awayReds' => 0,
            'homeYellowReds' => 0, 'awayYellowReds' => 0, 'homeFouls' => 12, 'awayFouls' => 10,
            'referee' => { 'id' => 1, 'name' => 'Ref' } }
        ]
      end

      def rec_for(fixtures)
        described_class.merge(base, widgets.merge(referee_fixtures: fixtures)).referee_record
      end

      it 'conta CARTÕES por lado (amarelos + vermelhos), não só booking points' do
        rec = rec_for(rich_fixtures)
        # casa: (4+0 + 2+0 + 1+0 + 3+0)/4 = 10/4 = 2.5
        expect(rec[:avg_home_cards]).to be_within(0.01).of(2.5)
        # fora: (3+0 + 3+1 + 1+0 + 2+0)/4 = 10/4 = 2.5
        expect(rec[:avg_away_cards]).to be_within(0.01).of(2.5)
        expect(rec[:avg_total_cards]).to be_within(0.01).of(5.0)
      end

      it 'expõe % de jogos com 2+ cartões para cada lado' do
        rec = rec_for(rich_fixtures)
        # casa 2+: jogos 200(4), 201(2), 203(3) = 3/4 = 75%
        expect(rec[:pct_home_2plus_cards]).to be_within(0.1).of(75.0)
        # fora 2+: 200(3), 201(4), 203(2) = 3/4 = 75%
        expect(rec[:pct_away_2plus_cards]).to be_within(0.1).of(75.0)
        # ambos 2+ no mesmo jogo: 200, 201, 203 = 3/4 = 75%
        expect(rec[:pct_both_2plus_cards]).to be_within(0.1).of(75.0)
      end

      it 'expõe a distribuição empírica de over/under do total de cartões' do
        rec = rec_for(rich_fixtures)
        # totais por jogo: 7, 6, 2, 5
        dist = rec[:cards_over_pct]
        expect(dist['3.5']).to be_within(0.1).of(75.0)  # 7,6,5 > 3.5
        expect(dist['5.5']).to be_within(0.1).of(50.0)  # 7,6 > 5.5
        expect(dist['6.5']).to be_within(0.1).of(25.0)  # 7 > 6.5
      end

      it 'expõe faltas por jogo — o driver causal do cartão' do
        rec = rec_for(rich_fixtures)
        # (14+11 + 9+16 + 8+7 + 12+10)/4 = 87/4 = 21.75
        expect(rec[:avg_total_fouls]).to be_within(0.01).of(21.75)
      end

      it 'expõe o índice de dispersão dos cartões (var/média)' do
        rec = rec_for(rich_fixtures)
        # totais 7,6,2,5 → média 5.0, variância populacional 3.5 → 0.7
        expect(rec[:cards_dispersion]).to be_within(0.01).of(0.7)
      end

      it 'degrada gracioso quando o payload não traz os campos novos (contrato antigo)' do
        rec = rec_for(referee_fixtures)
        # sem homeYellows/homeFouls, os campos novos são nil — nunca 0, que
        # o consumidor leria como "árbitro que não dá cartão".
        expect(rec[:avg_total_cards]).to be_nil
        expect(rec[:avg_total_fouls]).to be_nil
        expect(rec[:cards_dispersion]).to be_nil
        expect(rec[:pct_both_2plus_cards]).to be_nil
        # e o que já existia continua valendo
        expect(rec[:avg_total_booking_points]).to be_within(0.05).of(68.75)
      end

      it 'ignora jogos não completados no cálculo dos campos novos' do
        with_upcoming = rich_fixtures + [
          { 'id' => 204, 'status' => 'NS', 'homeYellows' => 0, 'awayYellows' => 0,
            'homeReds' => 0, 'awayReds' => 0, 'homeFouls' => 0, 'awayFouls' => 0,
            'referee' => { 'id' => 1, 'name' => 'Ref' } }
        ]
        rec = rec_for(with_upcoming)
        expect(rec[:completed]).to eq(4)
        expect(rec[:avg_total_cards]).to be_within(0.01).of(5.0)
      end
    end

    it 'handles the case where all fixtures are upcoming (no completed games to average)' do
      upcoming_only = referee_fixtures.map { |f| f.merge('status' => 'NS', 'homeBookingPoints' => 0, 'awayBookingPoints' => 0) }
      result = described_class.merge(base, widgets.merge(referee_fixtures: upcoming_only))
      rec = result.referee_record
      expect(rec[:name]).to eq('Marco Guida')
      expect(rec[:fixtures_count]).to eq(5)
      expect(rec[:completed]).to eq(0)
      expect(rec[:avg_total_booking_points]).to be_nil
    end
  end

  # ─────────────────────────────────────────────────────────────────────────────
  # NEW KEYS — Fundação Simulação (item 1-6)
  # ─────────────────────────────────────────────────────────────────────────────

  # Item 1 — avgs: 4 *Avgs blocks from recent-results widget fixture object
  describe 'avgs (item 1)' do
    it 'exposes all 4 Avgs blocks keyed as home_home / home_overall / away_away / away_overall' do
      avgs = merged.avgs
      expect(avgs).to be_a(Hash)
      expect(avgs).to have_key(:home_home)
      expect(avgs).to have_key(:home_overall)
      expect(avgs).to have_key(:away_away)
      expect(avgs).to have_key(:away_overall)
    end

    it 'home_home has num_matches=17 and avgGoalsTotal=2.9 (from fixture)' do
      hh = merged.avgs[:home_home]
      expect(hh[:num_matches]).to eq(17)
      expect(hh[:avgGoalsTotal]).to eq(2.9)
    end

    it 'home_overall has num_matches=35' do
      expect(merged.avgs[:home_overall][:num_matches]).to eq(35)
    end

    it 'away_away has num_matches=17 and avgGoalsTotal=2.9' do
      aa = merged.avgs[:away_away]
      expect(aa[:num_matches]).to eq(17)
      expect(aa[:avgGoalsTotal]).to eq(2.9)
    end

    it 'away_overall has num_matches=35' do
      expect(merged.avgs[:away_overall][:num_matches]).to eq(35)
    end

    it 'each block exposes all 43 metric keys (num_matches + 42 avg metrics)' do
      %i[home_home home_overall away_away away_overall].each do |key|
        block = merged.avgs[key]
        expect(block.keys.length).to eq(43), "expected 43 keys in avgs[:#{key}], got #{block.keys.length}"
      end
    end

    it 'includes goalKicks and throwIns metrics inside each avg block' do
      hh = merged.avgs[:home_home]
      %i[goalKicksTotal goalKicksFor goalKicksAg throwInsTotal throwInsFor throwInsAg].each do |k|
        expect(hh).to have_key(k), "expected avgs[:home_home] to have key #{k.inspect}"
      end
    end

    it 'returns empty hashes for all 4 blocks when recent_results is nil' do
      result = described_class.merge(base, widgets.except(:recent_results))
      expect(result.avgs).to eq(home_home: {}, home_overall: {}, away_away: {}, away_overall: {})
    end
  end

  # Item 2 — recent_all: home+away results (all venues)
  describe 'recent_all (item 2)' do
    it 'exposes home and away arrays from recentHomeAllResults / recentAwayAllResults' do
      ra = merged.recent_all
      expect(ra).to be_a(Hash)
      expect(ra[:home]).to be_an(Array)
      expect(ra[:away]).to be_an(Array)
    end

    it 'has 10 entries each (from fixture data)' do
      expect(merged.recent_all[:home].length).to eq(10)
      expect(merged.recent_all[:away].length).to eq(10)
    end

    it 'each entry carries the full match fields including date_iso, teams, goals and goal_kicks' do
      entry = merged.recent_all[:home].first
      expect(entry['date_iso']).to match(/\A\d{4}-\d{2}-\d{2}\z/)
      expect(entry['home_team']).to be_a(String)
      expect(entry['away_team']).to be_a(String)
      expect(entry['homeGoalsFt']).to be_a(Integer)
      expect(entry).to have_key('homeGoalKicks')
      expect(entry).to have_key('homeThrowIns')
    end

    it 'returns empty arrays when recent_results is absent' do
      result = described_class.merge(base, widgets.except(:recent_results))
      expect(result.recent_all).to eq(home: [], away: [])
    end
  end

  # Item 3 — standings: current league table position for both teams
  describe 'standings (item 3)' do
    it 'exposes home and away sub-hashes' do
      st = merged.standings
      expect(st).to be_a(Hash)
      expect(st).to have_key(:home)
      expect(st).to have_key(:away)
    end

    it 'includes stage name from fixtureWithoutStats' do
      expect(merged.standings[:home][:stage_name]).to eq('Regular Season')
      expect(merged.standings[:away][:stage_name]).to eq('Regular Season')
    end

    it 'includes fixture-level position from fixtureWithoutStats' do
      expect(merged.standings[:home][:fixture_position]).to eq('17th')
      expect(merged.standings[:away][:fixture_position]).to eq('16th')
    end

    it 'home team has position=17th, played=35, points=37 from ResultsWithStandings' do
      home_st = merged.standings[:home]
      expect(home_st[:position]).to eq('17th')
      expect(home_st[:played]).to eq(35)
      expect(home_st[:points]).to eq(37)
      expect(home_st[:goal_diff]).to eq(-9)
    end

    it 'away team has position=16th, played=35, points=43' do
      away_st = merged.standings[:away]
      expect(away_st[:position]).to eq('16th')
      expect(away_st[:played]).to eq(35)
      expect(away_st[:points]).to eq(43)
    end

    it 'includes fixtureWithoutStats slug' do
      expect(merged.standings[:home]).to have_key(:fixture_slug)
      expect(merged.standings[:home][:fixture_slug]).to be_a(String)
    end

    it 'returns empty hashes when team_records is absent' do
      result = described_class.merge(base, widgets.except(:team_records))
      expect(result.standings).to eq(home: {}, away: {})
    end
  end

  # Item 4 — goal_kicks and throw_ins in recent_matches and h2h
  describe 'goal_kicks / throw_ins in recent_matches and h2h (item 4)' do
    it 'each recent_matches[:home] item carries homeGoalKicks, awayGoalKicks, homeThrowIns, awayThrowIns' do
      match = merged.recent_matches[:home].first
      %w[homeGoalKicks awayGoalKicks homeThrowIns awayThrowIns].each do |key|
        expect(match).to have_key(key), "expected #{key.inspect} in recent_matches[:home].first"
      end
    end

    it 'each recent_matches[:away] item carries goal_kicks and throw_ins' do
      match = merged.recent_matches[:away].first
      %w[homeGoalKicks awayGoalKicks homeThrowIns awayThrowIns].each do |key|
        expect(match).to have_key(key), "expected #{key.inspect} in recent_matches[:away].first"
      end
    end

    it 'first recent_matches[:home] item has homeGoalKicks=7, awayGoalKicks=6, homeThrowIns=15, awayThrowIns=20' do
      m = merged.recent_matches[:home].first
      expect(m['homeGoalKicks']).to eq(7)
      expect(m['awayGoalKicks']).to eq(6)
      expect(m['homeThrowIns']).to eq(15)
      expect(m['awayThrowIns']).to eq(20)
    end

    it 'each h2h item carries homeGoalKicks and homeThrowIns' do
      h2h_match = merged.h2h.first
      %w[homeGoalKicks awayGoalKicks homeThrowIns awayThrowIns].each do |key|
        expect(h2h_match).to have_key(key), "expected #{key.inspect} in h2h.first"
      end
    end

    it 'first h2h item has homeGoalKicks=9, awayGoalKicks=18' do
      expect(merged.h2h.first['homeGoalKicks']).to eq(9)
      expect(merged.h2h.first['awayGoalKicks']).to eq(18)
    end
  end

  # Item 5 — odds_devigged: multiplicative devig across all 52 markets
  describe 'odds_devigged (item 5)' do
    it 'is a Hash with at least one market' do
      expect(merged.odds_devigged).to be_a(Hash)
      expect(merged.odds_devigged).not_to be_empty
    end

    it 'covers all 52 markets (or at least those with valid non-zero odds)' do
      expect(merged.odds_devigged.length).to be >= 50
    end

    it 'each market maps outcome names to probabilities (Floats in 0..1)' do
      merged.odds_devigged.each do |market_name, outcomes|
        outcomes.each do |outcome_name, prob|
          expect(prob).to be_a(Float), "expected Float for #{market_name}/#{outcome_name}, got #{prob.class}"
          expect(prob).to be_between(0.0, 1.0), "prob #{prob} out of range for #{market_name}/#{outcome_name}"
        end
      end
    end

    it 'probabilities sum to ≈1.0 for the Result market' do
      result_probs = merged.odds_devigged['Result']
      expect(result_probs).to be_a(Hash)
      expect(result_probs.values.sum).to be_within(0.001).of(1.0)
    end

    it 'probabilities sum to ≈1.0 for the BTTS market' do
      btts_probs = merged.odds_devigged['BTTS']
      expect(btts_probs).to be_a(Hash)
      expect(btts_probs.values.sum).to be_within(0.001).of(1.0)
    end

    it 'Result market has 3 outcomes (home win, draw, away win)' do
      expect(merged.odds_devigged['Result'].keys.length).to eq(3)
    end

    it 'devigged Result home-win probability is between 0.4 and 0.7 (sensible range for 1.74 odds)' do
      home_prob = merged.odds_devigged['Result']['Tottenham Hotspur']
      expect(home_prob).to be_between(0.40, 0.70)
    end

    it 'returns empty hash when odds widget is absent' do
      result = described_class.merge(base, widgets.except(:odds))
      expect(result.odds_devigged).to eq({})
    end
  end

  # Item 6 — player_extra: form, seasons, outcome_odds_by_player
  describe 'player_extra (item 6)' do
    it 'exposes form, home_seasons, away_seasons, outcome_odds_by_player' do
      pe = merged.player_extra
      expect(pe).to be_a(Hash)
      expect(pe).to have_key(:form)
      expect(pe).to have_key(:home_seasons)
      expect(pe).to have_key(:away_seasons)
      expect(pe).to have_key(:outcome_odds_by_player)
    end

    it 'form is the raw playerStatsForm array with 85 entries' do
      expect(merged.player_extra[:form]).to be_an(Array)
      expect(merged.player_extra[:form].length).to eq(85)
    end

    it 'first form entry has expected shape (player, statName, fixtureOdds)' do
      entry = merged.player_extra[:form].first
      expect(entry).to have_key('player')
      expect(entry).to have_key('statName')
      expect(entry).to have_key('fixtureOdds')
    end

    it 'home_seasons has 3 entries for Tottenham' do
      expect(merged.player_extra[:home_seasons]).to be_an(Array)
      expect(merged.player_extra[:home_seasons].length).to eq(3)
    end

    it 'away_seasons has 3 entries for Leeds' do
      expect(merged.player_extra[:away_seasons]).to be_an(Array)
      expect(merged.player_extra[:away_seasons].length).to eq(3)
    end

    it 'outcome_odds_by_player is keyed by player name with outcome odds hash' do
      odds_by_player = merged.player_extra[:outcome_odds_by_player]
      expect(odds_by_player).to be_a(Hash)
      expect(odds_by_player).not_to be_empty
    end

    it 'outcome_odds_by_player includes at least ANYTIME_SCORER and TO_BE_CARDED outcomes' do
      odds_by_player = merged.player_extra[:outcome_odds_by_player]
      # At least one player should have ANYTIME_SCORER
      players_with_scorer = odds_by_player.select { |_, v| v.key?('ANYTIME_SCORER') }
      expect(players_with_scorer).not_to be_empty

      players_with_carded = odds_by_player.select { |_, v| v.key?('TO_BE_CARDED') }
      expect(players_with_carded).not_to be_empty
    end

    it 'Micky van de Ven has ANYTIME_SCORER odds of 7.0 in outcome_odds_by_player' do
      # key matches "Micky van de Ven" name (may have trailing spaces — strip)
      player_key = merged.player_extra[:outcome_odds_by_player].keys.find { |k| k.strip == 'Micky van de Ven' }
      expect(player_key).not_to be_nil, 'Micky van de Ven not found in outcome_odds_by_player'
      expect(merged.player_extra[:outcome_odds_by_player][player_key]['ANYTIME_SCORER']).to eq(7.0)
    end

    it 'tolerates missing players widget gracefully' do
      result = described_class.merge(base, widgets.except(:players))
      pe = result.player_extra
      expect(pe[:form]).to eq([])
      expect(pe[:home_seasons]).to eq([])
      expect(pe[:away_seasons]).to eq([])
      expect(pe[:outcome_odds_by_player]).to eq({})
    end
  end

  # ─────────────────────────────────────────────────────────────────────────────
  # REGRESSION — old keys unchanged in shape
  # ─────────────────────────────────────────────────────────────────────────────
  describe 'regression — existing keys shape unchanged' do
    it 'team_record has home/away with overall+home/away sub-keys' do
      tr = merged.team_record
      expect(tr).to have_key(:home)
      expect(tr).to have_key(:away)
      expect(tr[:home]).to have_key(:overall)
      expect(tr[:home]).to have_key(:home)
      expect(tr[:away]).to have_key(:overall)
      expect(tr[:away]).to have_key(:away)
    end

    it 'recent_matches still has the pre-existing fields (not overwritten by recent_all)' do
      rm = merged.recent_matches
      expect(rm).to have_key(:home)
      expect(rm).to have_key(:away)
      match = rm[:home].first
      expect(match['homeGoalsFt']).to be_a(Integer)
      expect(match['date_iso']).to match(/\A\d{4}-\d{2}-\d{2}\z/)
    end

    it 'h2h is still an Array with home_team / away_team / homeGoalsFt' do
      expect(merged.h2h).to be_an(Array)
      expect(merged.h2h.first).to include('home_team', 'away_team', 'homeGoalsFt')
    end

    it 'streaks still has home/away arrays with stat_type entries' do
      expect(merged.streaks[:home]).to be_an(Array)
      expect(merged.streaks[:home].first).to include(:stat_type, :group)
    end

    it 'predictions still returns an array with stat_type and chance' do
      expect(merged.predictions).to be_an(Array)
      expect(merged.predictions.first).to include(:stat_type, :chance)
    end

    it 'odds_summary still maps market names to decimal_odds hashes' do
      os = merged.odds_summary
      expect(os).to be_a(Hash)
      expect(os).not_to be_empty
      first_outcome = os.values.first.values.first
      expect(first_outcome).to have_key(:decimal_odds)
    end

    it 'player_stats still has home/away aggregates + top_players with canonical keys' do
      ps = merged.player_stats
      expect(ps[:home]).to have_key(:aggregates)
      expect(ps[:home]).to have_key(:top_players)
      expect(ps[:home][:aggregates]).to have_key(:total_shots)
      expect(ps[:home][:aggregates]).to have_key(:players_count)
    end

    it 'no existing key is removed or renamed by the new additions' do
      h = merged.to_h
      %i[trends team_record recent_matches h2h streaks predictions odds_summary player_stats referee_record].each do |k|
        expect(h).to have_key(k), "expected existing key #{k.inspect} to still be present in merged hash"
      end
    end
  end

  describe 'edge cases' do
    it 'returns the base detail unchanged when widgets is empty' do
      result = described_class.merge(base, {})
      expect(result.recent_matches).to eq(home: [], away: [])
      expect(result.h2h).to eq([])
      expect(result.streaks).to eq(home: [], away: [])
      expect(result.predictions).to eq([])
    end

    it 'tolerates nil widgets argument' do
      expect { described_class.merge(base, nil) }.not_to raise_error
    end

    it 'serializes the merged detail to JSON without errors' do
      expect { JSON.generate(merged.to_h) }.not_to raise_error
    end
  end

  # ─────────────────────────────────────────────────────────────────────────────
  # DEGRADATION specs — robustness against nil/partial payloads (fixes 1-7)
  # ─────────────────────────────────────────────────────────────────────────────

  describe 'degradation: build_odds_devigged' do
    # Fix 1 — nil outcome VALUE inside a market's outcomes hash
    it 'does not raise when an outcome value is nil (null in JSON)' do
      odds_with_nil_outcome = [
        {
          'market' => { 'name' => 'Result' },
          'outcomes' => {
            'Home' => { 'decimalOdds' => 1.74 },
            'Draw' => nil,
            'Away' => { 'decimalOdds' => 5.5 }
          }
        }
      ]
      expect do
        described_class.build_odds_devigged(odds_with_nil_outcome)
      end.not_to raise_error
    end

    it 'skips a market where any outcome value is nil (zero/undefined odds guard)' do
      odds_with_nil_outcome = [
        {
          'market' => { 'name' => 'NilMarket' },
          'outcomes' => { 'Home' => { 'decimalOdds' => 1.74 }, 'Draw' => nil }
        }
      ]
      result = described_class.build_odds_devigged(odds_with_nil_outcome)
      expect(result).not_to have_key('NilMarket')
    end

    # Fix 2 — nil market ELEMENT in the odds array
    it 'does not raise when the odds array contains a nil element' do
      odds_with_nil_market = [
        nil,
        {
          'market' => { 'name' => 'Result' },
          'outcomes' => {
            'Home' => { 'decimalOdds' => 1.74 },
            'Draw' => { 'decimalOdds' => 3.6 },
            'Away' => { 'decimalOdds' => 5.5 }
          }
        }
      ]
      expect do
        described_class.build_odds_devigged(odds_with_nil_market)
      end.not_to raise_error
    end

    it 'still processes valid markets after a nil element in the array' do
      odds_with_nil_market = [
        nil,
        {
          'market' => { 'name' => 'Result' },
          'outcomes' => {
            'Home' => { 'decimalOdds' => 1.74 },
            'Draw' => { 'decimalOdds' => 3.6 },
            'Away' => { 'decimalOdds' => 5.5 }
          }
        }
      ]
      result = described_class.build_odds_devigged(odds_with_nil_market)
      expect(result).to have_key('Result')
      expect(result['Result'].values.sum).to be_within(0.001).of(1.0)
    end
  end

  describe 'degradation: find_team_standing / build_standings' do
    # Fix 3 — nil ELEMENT in standings array
    it 'does not raise when the standings array contains a nil element' do
      standings_with_nil = [nil, { 'team' => { 'id' => 99 }, 'position' => '1st', 'played' => 10, 'points' => 25, 'goalDiff' => 10, 'positionType' => 'Champions' }]
      expect do
        described_class.find_team_standing(standings_with_nil, 99)
      end.not_to raise_error
    end

    it 'still finds the correct entry after a nil element in standings' do
      standings_with_nil = [nil, { 'team' => { 'id' => 99 }, 'position' => '1st', 'played' => 10, 'points' => 25, 'goalDiff' => 10, 'positionType' => 'Champions' }]
      result = described_class.find_team_standing(standings_with_nil, 99)
      expect(result).to be_a(Hash)
      expect(result['position']).to eq('1st')
    end

    # Fix 5 — no matching team id in standings (cup/playoff scenario)
    it 'returns {} per side when standings arrays have no entry matching the team id' do
      # Build a custom team_records payload where fws has team ids but standings list
      # contains entries for different team ids (cup/playoff scenario).
      team_records_no_match = {
        'fixtureWithoutStats' => {
          'homeTeam' => { 'id' => 1001 },
          'awayTeam' => { 'id' => 1002 },
          'stage'    => { 'name' => 'Cup Quarter-Final' },
          'slug'     => 'cup-qf-home-vs-away',
          'homeTeamPosition' => 'N/A',
          'awayTeamPosition' => 'N/A'
        },
        'homeTeamResultsWithStandings' => [
          { 'team' => { 'id' => 9999 }, 'position' => '5th', 'played' => 20, 'points' => 30, 'goalDiff' => 5, 'positionType' => 'Normal' }
        ],
        'awayTeamResultsWithStandings' => [
          { 'team' => { 'id' => 8888 }, 'position' => '3rd', 'played' => 20, 'points' => 40, 'goalDiff' => 12, 'positionType' => 'Champions' }
        ]
      }
      result = described_class.build_standings(team_records_no_match)
      expect(result[:home]).to eq({})
      expect(result[:away]).to eq({})
    end
  end

  describe 'degradation: build_outcome_odds_by_player' do
    # Fix 4 — empty/nil player name must not be stored as "" key
    it 'does not create an empty-string key when a player has a nil or blank name' do
      players_data = {
        'homePlayers' => [
          { 'name' => nil,  'outcomeOdds' => { 'ANYTIME_SCORER' => { 'decimalOdds' => 5.0 } } },
          { 'name' => '  ', 'outcomeOdds' => { 'ANYTIME_SCORER' => { 'decimalOdds' => 7.0 } } },
          { 'name' => 'Harry Kane', 'outcomeOdds' => { 'ANYTIME_SCORER' => { 'decimalOdds' => 2.5 } } }
        ],
        'awayPlayers' => []
      }
      result = described_class.build_outcome_odds_by_player(players_data)
      expect(result).not_to have_key('')
      expect(result).to have_key('Harry Kane')
    end

    it 'does not silently overwrite when two blank-named players appear in sequence' do
      players_data = {
        'homePlayers' => [
          { 'name' => '', 'outcomeOdds' => { 'ANYTIME_SCORER' => { 'decimalOdds' => 5.0 } } },
          { 'name' => '', 'outcomeOdds' => { 'ANYTIME_SCORER' => { 'decimalOdds' => 9.0 } } }
        ],
        'awayPlayers' => []
      }
      result = described_class.build_outcome_odds_by_player(players_data)
      # Neither player should pollute the result hash
      expect(result.keys).not_to include('')
      expect(result).to be_empty
    end
  end

  describe 'degradation: extract_avgs_block (fix 6 — single-pass rename)' do
    it 'maps numMatches to :num_matches and drops the camelCase key' do
      raw = { 'numMatches' => 10, 'avgGoalsTotal' => 2.5, 'avgCornersTotal' => 4.1 }
      result = described_class.extract_avgs_block(raw)
      expect(result).to have_key(:num_matches)
      expect(result[:num_matches]).to eq(10)
      expect(result).not_to have_key(:numMatches)
    end

    it 'preserves all other keys as symbols' do
      raw = { 'numMatches' => 5, 'avgGoalsTotal' => 1.8, 'avgCornersTotal' => 3.9 }
      result = described_class.extract_avgs_block(raw)
      expect(result).to have_key(:avgGoalsTotal)
      expect(result[:avgGoalsTotal]).to eq(1.8)
      expect(result).to have_key(:avgCornersTotal)
    end
  end

  describe 'degradation: outcome_odds decimalOdds coerced to Float (fix 7)' do
    it 'stores decimalOdds as Float even when the JSON value is an Integer' do
      players_data = {
        'homePlayers' => [
          { 'name' => 'Test Player', 'outcomeOdds' => { 'ANYTIME_SCORER' => { 'decimalOdds' => 7 } } }
        ],
        'awayPlayers' => []
      }
      result = described_class.build_outcome_odds_by_player(players_data)
      val = result['Test Player']['ANYTIME_SCORER']
      expect(val).to be_a(Float)
      expect(val).to eq(7.0)
    end
  end
end
