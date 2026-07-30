require 'date'
require 'json'
require 'time'
require_relative 'db_helper'
require_relative '../../lib/scraper/persister'
require_relative '../../lib/scraper/fixture'
require_relative '../../lib/scraper/uk_time_helper'

RSpec.describe AdamStats::Scraper::Persister, :db do
  before(:all) do
    ENV['DATABASE_URL'] = DBHelper.test_url
    ScraperDBHelper.ensure_schema!
  end

  before(:each) { ScraperDBHelper.truncate_fixtures! }

  def make_fixture(home:, away:, date: Date.today, ko: '20:00', league: 'Test Liga', source: nil, country: nil)
    AdamStats::Scraper::Fixture.new(
      match_date: date,
      ko_time: ko,
      home_team: home,
      away_team: away,
      league: league,
      source_url: source || "/fixture/123/testcountry-test-liga-#{home.downcase}-vs-#{away.downcase}",
      country: country
    )
  end

  describe '.persist (insert path)' do
    it 'inserts an array of new fixtures' do
      fixtures = [
        make_fixture(home: 'A', away: 'B'),
        make_fixture(home: 'C', away: 'D'),
        make_fixture(home: 'E', away: 'F'),
        make_fixture(home: 'G', away: 'H'),
        make_fixture(home: 'I', away: 'J')
      ]
      stats = described_class.persist(fixtures)
      expect(stats.inserted).to eq(5)
      expect(stats.updated).to eq(0)
      expect(ScraperDBHelper.count_fixtures).to eq(5)
    end

    it 'returns a Stats struct with inserted/updated/failed counts' do
      stats = described_class.persist([make_fixture(home: 'A', away: 'B')])
      expect(stats).to respond_to(:inserted, :updated, :failed)
      expect(stats.inserted).to eq(1)
      expect(stats.updated).to eq(0)
      expect(stats.failed).to eq(0)
    end
  end

  describe '.persist (upsert / idempotency)' do
    let(:base) { [make_fixture(home: 'A', away: 'B', ko: '20:00')] }

    it 're-running the same input is idempotent (no duplicates)' do
      described_class.persist(base)
      stats = described_class.persist(base)
      expect(stats.inserted).to eq(0)
      expect(stats.updated).to eq(1)
      expect(ScraperDBHelper.count_fixtures).to eq(1)
    end

    it 'updates ko_time when same dedup key but different ko_time' do
      described_class.persist(base)
      updated = [make_fixture(home: 'A', away: 'B', ko: '21:30')]
      stats = described_class.persist(updated)
      expect(stats.updated).to eq(1)
      row = ScraperDBHelper.fetch_fixtures.first
      expect(row['ko_time']).to eq('21:30:00')
    end

    it 'sets status to parsed after a successful upsert' do
      described_class.persist(base)
      row = ScraperDBHelper.fetch_fixtures.first
      expect(row['status']).to eq('parsed')
    end
  end

  describe '.persist (detail_json)' do
    it 'round-trips a complex jsonb structure' do
      detail = {
        'recent_matches' => [
          { 'date' => '2026-05-01', 'opponent' => 'X', 'score' => '2-1' },
          { 'date' => '2026-04-25', 'opponent' => 'Y', 'score' => '0-0' }
        ],
        'h2h' => { 'wins' => 3, 'losses' => 1, 'draws' => 2 },
        'streak' => 'W-W-D-L-W'
      }
      fixture = make_fixture(home: 'A', away: 'B')
      described_class.persist([fixture], detail_json_by_source_url: { fixture.source_url => detail })

      row = ScraperDBHelper.fetch_fixtures.first
      stored = JSON.parse(row['detail_json'])
      expect(stored).to eq(detail)
    end
  end

  describe '.persist (transactional safety)' do
    it 'rolls back the entire batch when one row is invalid' do
      good = make_fixture(home: 'A', away: 'B')
      bad  = AdamStats::Scraper::Fixture.new(
        match_date: Date.today,
        ko_time: '20:00',
        home_team: nil,
        away_team: 'X',
        league: 'L',
        source_url: '/fixture/x',
        country: nil
      )
      expect {
        described_class.persist([good, bad])
      }.to raise_error(AdamStats::Scraper::PersistError)
      expect(ScraperDBHelper.count_fixtures).to eq(0)
    end
  end

  describe '.persist (country column)' do
    it 'persists country when provided' do
      fixture = make_fixture(home: 'A', away: 'B', country: 'england')
      described_class.persist([fixture])
      row = ScraperDBHelper.fetch_fixtures.first
      expect(row['country']).to eq('england')
    end

    it 'preserves existing country on upsert when new country is nil' do
      fixture_with_country = make_fixture(home: 'A', away: 'B', country: 'england')
      described_class.persist([fixture_with_country])

      fixture_without_country = make_fixture(home: 'A', away: 'B', country: nil)
      described_class.persist([fixture_without_country])

      row = ScraperDBHelper.fetch_fixtures.first
      expect(row['country']).to eq('england')
    end

    it 'updates country when new value is non-nil' do
      fixture = make_fixture(home: 'A', away: 'B', country: 'england')
      described_class.persist([fixture])

      updated = make_fixture(home: 'A', away: 'B', country: 'scotland')
      described_class.persist([updated])

      row = ScraperDBHelper.fetch_fixtures.first
      expect(row['country']).to eq('scotland')
    end
  end

  describe '.persist (kickoff_utc)' do
    it 'persists kickoff_utc as UTC instant for BST fixture (UTC+1)' do
      # 21:30 BST on 2026-05-12 = 20:30 UTC
      fixture = make_fixture(home: 'A', away: 'B', date: Date.new(2026, 5, 12), ko: '21:30')
      described_class.persist([fixture])
      row = ScraperDBHelper.fetch_fixtures.first
      expect(row['kickoff_utc']).not_to be_nil
      stored = Time.parse(row['kickoff_utc']).utc
      expect(stored).to eq(Time.utc(2026, 5, 12, 20, 30, 0))
    end

    it 'persists kickoff_utc as UTC instant for GMT fixture (UTC+0)' do
      # 20:00 GMT on 2026-01-15 = 20:00 UTC
      fixture = make_fixture(home: 'A', away: 'B', date: Date.new(2026, 1, 15), ko: '20:00')
      described_class.persist([fixture])
      row = ScraperDBHelper.fetch_fixtures.first
      stored = Time.parse(row['kickoff_utc']).utc
      expect(stored).to eq(Time.utc(2026, 1, 15, 20, 0, 0))
    end

    it 'persists kickoff_utc with day rollover (00:30 BST on 13/05 = 23:30 UTC on 12/05)' do
      # Copa do Brasil: adamchoi shows match_date=2026-05-13, ko_time=00:30 (BST)
      # Real instant = 23:30 UTC on 2026-05-12
      fixture = make_fixture(home: 'Flamengo', away: 'Atletico', date: Date.new(2026, 5, 13), ko: '00:30')
      described_class.persist([fixture])
      row = ScraperDBHelper.fetch_fixtures.first
      stored = Time.parse(row['kickoff_utc']).utc
      expect(stored).to eq(Time.utc(2026, 5, 12, 23, 30, 0))
    end

    it 'uses noon fallback (12:00 UK local → UTC) when ko_time is nil' do
      fixture = make_fixture(home: 'A', away: 'B', date: Date.new(2026, 5, 12), ko: nil)
      described_class.persist([fixture])
      row = ScraperDBHelper.fetch_fixtures.first
      stored = Time.parse(row['kickoff_utc']).utc
      # 12:00 BST = 11:00 UTC
      expect(stored).to eq(Time.utc(2026, 5, 12, 11, 0, 0))
    end

    it 'updates kickoff_utc when ko_time changes on upsert' do
      fixture = make_fixture(home: 'A', away: 'B', date: Date.new(2026, 5, 12), ko: '20:00')
      described_class.persist([fixture])
      updated = make_fixture(home: 'A', away: 'B', date: Date.new(2026, 5, 12), ko: '21:30')
      described_class.persist([updated])
      row = ScraperDBHelper.fetch_fixtures.first
      stored = Time.parse(row['kickoff_utc']).utc
      expect(stored).to eq(Time.utc(2026, 5, 12, 20, 30, 0))
    end
  end

  describe '.persist (jsonb column type)' do
    it 'stores detail_json with jsonb type' do
      fixture = make_fixture(home: 'A', away: 'B')
      described_class.persist(
        [fixture],
        detail_json_by_source_url: { fixture.source_url => { 'k' => 'v' } }
      )
      conn = DBHelper.connect
      pg_type = conn.query('SELECT pg_typeof(detail_json) AS t FROM fixtures').first['t']
      conn.close
      expect(pg_type).to eq('jsonb')
    end
  end
end
