require 'date'
require_relative '../../../lib/scraper/actuals/fixture_resolver'

RSpec.describe AdamStats::Scraper::Actuals::FixtureResolver do
  let(:logger_msgs) { [] }
  let(:logger) { ->(m) { logger_msgs << m } }
  let(:client) { double('ApiFootballClient') }

  # Mock DB connection
  let(:db_conn) { double('PG::Connection') }

  subject(:resolver) do
    described_class.new(client: client, db_conn: db_conn, logger: logger)
  end

  # Uma row típica de fixture_simulations
  def build_row(id: 1, fixture_id: 999, home_team: 'Arsenal', away_team: 'Chelsea',
                kickoff_utc: '2026-05-25T20:00:00Z', league: 'Premier League',
                country: 'england')
    {
      'id' => id,
      'fixture_id' => fixture_id,
      'home_team' => home_team,
      'away_team' => away_team,
      'kickoff_utc' => kickoff_utc,
      'league' => league,
      'country' => country
    }
  end

  # ── cache hit ─────────────────────────────────────────────────────────────────

  describe 'cache hit' do
    it 'retorna api_football_fixture_id do cache sem chamar o client' do
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/actuals_fixture_mapping/), [999])
        .and_return(double('r', to_a: [{ 'api_football_fixture_id' => '88888' }]))

      # Client não deve ser chamado quando há cache hit
      expect(client).not_to receive(:fixtures_by_date)

      row = build_row(fixture_id: 999)
      result = resolver.resolve(row, 39)

      expect(result).to eq(88888)
    end
  end

  # ── cache miss + discovery ────────────────────────────────────────────────────

  describe 'cache miss → discovery via API' do
    before do
      # SELECT retorna vazio (cache miss)
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/actuals_fixture_mapping/), anything)
        .and_return(double('r', to_a: []))
      # INSERT de cache
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/INSERT INTO actuals_fixture_mapping/), anything)
        .and_return(double('r'))
    end

    it 'chama fixtures_by_date com date e league corretos' do
      api_response = [
        {
          'fixture' => { 'id' => 55555, 'date' => '2026-05-25T20:00:00+00:00',
                         'status' => { 'short' => 'FT' } },
          'teams' => {
            'home' => { 'id' => 1, 'name' => 'Arsenal' },
            'away' => { 'id' => 2, 'name' => 'Chelsea' }
          }
        }
      ]

      expect(client).to receive(:fixtures_by_date)
        .with(date: '2026-05-25', league: 39, season: 2026)
        .and_return(api_response)

      row = build_row(fixture_id: 999, home_team: 'Arsenal', away_team: 'Chelsea',
                      kickoff_utc: '2026-05-25T20:00:00Z')
      result = resolver.resolve(row, 39)
      expect(result).to eq(55555)
    end

    it 'retorna nil e loga quando zero matches na API' do
      allow(client).to receive(:fixtures_by_date).and_return([])

      row = build_row(fixture_id: 999, home_team: 'Arsenal', away_team: 'Chelsea')
      result = resolver.resolve(row, 39)

      expect(result).to be_nil
      expect(logger_msgs).to include(a_string_matching(/unresolvable|no match/i))
    end

    it 'retorna nil e loga quando múltiplos matches ambíguos' do
      api_response = [
        {
          'fixture' => { 'id' => 11111, 'date' => '2026-05-25T14:00:00+00:00',
                         'status' => { 'short' => 'FT' } },
          'teams' => {
            'home' => { 'id' => 1, 'name' => 'Arsenal' },
            'away' => { 'id' => 2, 'name' => 'Chelsea' }
          }
        },
        {
          'fixture' => { 'id' => 22222, 'date' => '2026-05-25T20:00:00+00:00',
                         'status' => { 'short' => 'FT' } },
          'teams' => {
            'home' => { 'id' => 1, 'name' => 'Arsenal' },
            'away' => { 'id' => 2, 'name' => 'Chelsea' }
          }
        }
      ]
      allow(client).to receive(:fixtures_by_date).and_return(api_response)

      row = build_row(fixture_id: 999, home_team: 'Arsenal', away_team: 'Chelsea')
      result = resolver.resolve(row, 39)

      expect(result).to be_nil
      expect(logger_msgs).to include(a_string_matching(/ambig|multiple|unresolvable/i))
    end

    it 'cacheia o resultado encontrado via INSERT' do
      api_response = [
        {
          'fixture' => { 'id' => 77777, 'date' => '2026-05-25T20:00:00+00:00',
                         'status' => { 'short' => 'FT' } },
          'teams' => {
            'home' => { 'id' => 1, 'name' => 'Arsenal' },
            'away' => { 'id' => 2, 'name' => 'Chelsea' }
          }
        }
      ]
      allow(client).to receive(:fixtures_by_date).and_return(api_response)

      insert_params = nil
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/INSERT INTO actuals_fixture_mapping/), anything) do |_sql, params|
          insert_params = params
          double('r')
        end

      row = build_row(fixture_id: 999, home_team: 'Arsenal', away_team: 'Chelsea')
      resolver.resolve(row, 39)

      expect(insert_params).to include(999, 77777)
    end
  end

  # ── fuzzy match com nomes normalizados ────────────────────────────────────────

  describe 'match por normalização de nomes' do
    before do
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/actuals_fixture_mapping/), anything)
        .and_return(double('r', to_a: []))
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/INSERT INTO actuals_fixture_mapping/), anything)
        .and_return(double('r'))
    end

    it 'bate "Flamengo" (DB) com "Flamengo RJ" (API) após normalização falha → nil' do
      api_response = [
        {
          'fixture' => { 'id' => 44444, 'date' => '2026-05-25T00:00:00+00:00',
                         'status' => { 'short' => 'FT' } },
          'teams' => {
            'home' => { 'id' => 1, 'name' => 'Flamengo RJ' },
            'away' => { 'id' => 2, 'name' => 'Palmeiras SP' }
          }
        }
      ]
      allow(client).to receive(:fixtures_by_date).and_return(api_response)

      row = build_row(fixture_id: 777, home_team: 'Flamengo', away_team: 'Palmeiras',
                      league: 'Serie A', country: 'brazil')
      result = resolver.resolve(row, 71)
      # Exact normalized match falha — nome "flamengo rj" != "flamengo"
      expect(result).to be_nil
    end

    it 'bate nomes idênticos normalizados (lowercase + trim)' do
      api_response = [
        {
          'fixture' => { 'id' => 33333, 'date' => '2026-05-25T00:00:00+00:00',
                         'status' => { 'short' => 'FT' } },
          'teams' => {
            'home' => { 'id' => 1, 'name' => 'Arsenal FC' },  # com FC
            'away' => { 'id' => 2, 'name' => 'Chelsea' }
          }
        }
      ]
      allow(client).to receive(:fixtures_by_date).and_return(api_response)

      # DB também tem "Arsenal FC"
      row = build_row(fixture_id: 888, home_team: 'Arsenal FC', away_team: 'Chelsea')
      result = resolver.resolve(row, 39)
      expect(result).to eq(33333)
    end
  end

  # ── extração de season_year ───────────────────────────────────────────────────

  describe '#season_for' do
    it 'extrai o ano da temporada a partir do kickoff_utc' do
      row = build_row(kickoff_utc: '2026-05-25T20:00:00Z')
      # Season = ano do kickoff para ligas com temporada calendário
      expect(resolver.season_for(row)).to eq(2026)
    end

    it 'usa ano correto para fixtures de dezembro (fim de temporada europeia)' do
      row = build_row(kickoff_utc: '2026-12-20T20:00:00Z')
      expect(resolver.season_for(row)).to eq(2026)
    end
  end
end
