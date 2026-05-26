require 'webmock/rspec'
require 'faraday'
require_relative '../../../lib/scraper/actuals/api_football_client'

RSpec.describe AdamStats::Scraper::Actuals::ApiFootballClient do
  let(:key) { 'test-key-123' }
  let(:base_url) { 'https://v3.football.api-sports.io' }
  let(:logger_msgs) { [] }
  let(:logger) { ->(m) { logger_msgs << m } }

  subject(:client) { described_class.new(key: key, logger: logger) }

  before { stub_request(:any, /v3\.football\.api-sports\.io/) }

  # ── status ────────────────────────────────────────────────────────────────────

  describe '#status' do
    it 'usa header x-apisports-key correto' do
      stub_request(:get, "#{base_url}/status")
        .with(headers: { 'x-apisports-key' => key })
        .to_return(
          status: 200,
          body: JSON.generate({
            'response' => { 'requests' => { 'current' => 5, 'limit_day' => 100 } }
          }),
          headers: { 'Content-Type' => 'application/json' }
        )

      result = client.status
      expect(result).to include('requests')
      expect(result['requests']['current']).to eq(5)
    end

    it 'retorna nil quando response está vazio' do
      stub_request(:get, "#{base_url}/status")
        .to_return(
          status: 200,
          body: JSON.generate({ 'response' => {} }),
          headers: { 'Content-Type' => 'application/json' }
        )

      result = client.status
      expect(result).to eq({})
    end
  end

  # ── fixtures_by_date ─────────────────────────────────────────────────────────

  describe '#fixtures_by_date' do
    it 'chama /fixtures com parâmetros corretos' do
      stub_request(:get, /v3\.football\.api-sports\.io\/fixtures/)
        .with(query: { 'date' => '2026-05-25', 'league' => '71', 'season' => '2026' })
        .to_return(
          status: 200,
          body: JSON.generate({ 'response' => [] }),
          headers: { 'Content-Type' => 'application/json' }
        )

      result = client.fixtures_by_date(date: '2026-05-25', league: 71, season: 2026)
      expect(result).to eq([])
    end

    it 'retorna array de fixtures da resposta' do
      fixture_payload = [
        {
          'fixture' => { 'id' => 12345, 'date' => '2026-05-25T20:00:00+00:00',
                         'status' => { 'short' => 'FT' } },
          'teams' => {
            'home' => { 'id' => 100, 'name' => 'Flamengo' },
            'away' => { 'id' => 200, 'name' => 'Palmeiras' }
          }
        }
      ]
      stub_request(:get, /v3\.football\.api-sports\.io\/fixtures/)
        .with(query: hash_including('date' => '2026-05-25'))
        .to_return(
          status: 200,
          body: JSON.generate({ 'response' => fixture_payload }),
          headers: { 'Content-Type' => 'application/json' }
        )

      result = client.fixtures_by_date(date: '2026-05-25', league: 71, season: 2026)
      expect(result.size).to eq(1)
      expect(result.first.dig('fixture', 'id')).to eq(12345)
    end
  end

  # ── fixture_statistics ────────────────────────────────────────────────────────

  describe '#fixture_statistics' do
    it 'chama /fixtures/statistics com fixture id correto' do
      stub_request(:get, /v3\.football\.api-sports\.io\/fixtures\/statistics/)
        .with(query: { 'fixture' => '99999' })
        .to_return(
          status: 200,
          body: JSON.generate({ 'response' => [] }),
          headers: { 'Content-Type' => 'application/json' }
        )

      result = client.fixture_statistics(fixture_id: 99999)
      expect(result).to eq([])
    end

    it 'retorna array com stats por time' do
      stats_payload = [
        {
          'team' => { 'id' => 100, 'name' => 'Arsenal' },
          'statistics' => [
            { 'type' => 'Shots on Goal', 'value' => 5 },
            { 'type' => 'Corner Kicks', 'value' => 7 },
            { 'type' => 'Yellow Cards', 'value' => 2 },
            { 'type' => 'Red Cards', 'value' => 0 }
          ]
        },
        {
          'team' => { 'id' => 200, 'name' => 'Chelsea' },
          'statistics' => [
            { 'type' => 'Shots on Goal', 'value' => 3 },
            { 'type' => 'Corner Kicks', 'value' => 4 },
            { 'type' => 'Yellow Cards', 'value' => 1 },
            { 'type' => 'Red Cards', 'value' => 1 }
          ]
        }
      ]
      stub_request(:get, /v3\.football\.api-sports\.io\/fixtures\/statistics/)
        .with(query: hash_including('fixture' => '12345'))
        .to_return(
          status: 200,
          body: JSON.generate({ 'response' => stats_payload }),
          headers: { 'Content-Type' => 'application/json' }
        )

      result = client.fixture_statistics(fixture_id: 12345)
      expect(result.size).to eq(2)
      expect(result.first['team']['name']).to eq('Arsenal')
    end
  end

  # ── tratamento de erros ───────────────────────────────────────────────────────

  describe 'tratamento de erros HTTP' do
    it 'levanta ApiFootballError em resposta 401 (chave inválida)' do
      stub_request(:get, /\/status/).to_return(
        status: 401,
        body: JSON.generate({ 'errors' => { 'token' => 'Error/Missing application key' } }),
        headers: { 'Content-Type' => 'application/json' }
      )

      expect { client.status }.to raise_error(
        AdamStats::Scraper::Actuals::ApiFootballClient::ApiFootballError,
        /401/
      )
    end

    it 'levanta QuotaExhaustedError quando errors contém rateLimit de quota' do
      stub_request(:get, /\/fixtures\/statistics/).to_return(
        status: 200,
        body: JSON.generate({
          'errors' => { 'requests' => 'You have reached the limit of... per day' },
          'response' => []
        }),
        headers: { 'Content-Type' => 'application/json' }
      )

      expect { client.fixture_statistics(fixture_id: 1) }.to raise_error(
        AdamStats::Scraper::Actuals::ApiFootballClient::QuotaExhaustedError
      )
    end

    it 'levanta RateLimitError em resposta 429 (per-minute throttle)' do
      stub_request(:get, /\/fixtures\/statistics/).to_return(
        status: 429,
        body: JSON.generate({ 'errors' => { 'rateLimit' => 'Too many requests.' } }),
        headers: { 'Content-Type' => 'application/json', 'retry-after' => '15' }
      )

      expect { client.fixture_statistics(fixture_id: 1) }.to raise_error(
        AdamStats::Scraper::Actuals::ApiFootballClient::RateLimitError
      )
    end
  end

  describe '#quota_remaining' do
    it 'retorna reqs restantes via /status' do
      stub_request(:get, "#{base_url}/status")
        .to_return(
          status: 200,
          body: JSON.generate({
            'response' => { 'requests' => { 'current' => 30, 'limit_day' => 100 } }
          }),
          headers: { 'Content-Type' => 'application/json' }
        )

      expect(client.quota_remaining).to eq(70)
    end
  end

  describe 'sem chave configurada' do
    it 'levanta erro imediatamente quando key é nil' do
      expect {
        described_class.new(key: nil, logger: logger)
      }.to raise_error(ArgumentError, /API_FOOTBALL_KEY/)
    end
  end
end
