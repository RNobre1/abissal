require 'json'
require_relative '../../../lib/scraper/simulation/runner'
require_relative '../../../lib/scraper/widget_merger'
require_relative '../../../lib/scraper/match_detail'

RSpec.describe AdamStats::Scraper::Simulation::Runner do
  # Build a realistic enriched detail_json by running the real WidgetMerger over
  # the test widget fixtures, then JSON round-tripping (string keys, as the DB
  # would store/return it).
  def enriched_detail
    base = AdamStats::Scraper::MatchDetail.empty
    widgets = {
      recent_results: JSON.parse(File.read(fixture_path('recent-results.json'))),
      players: JSON.parse(File.read(fixture_path('players.json'))),
      odds: JSON.parse(File.read(fixture_path('odds.json'))),
      team_records: JSON.parse(File.read(fixture_path('team-records.json')))
    }
    merged = AdamStats::Scraper::WidgetMerger.merge(base, widgets).to_h
    JSON.parse(JSON.generate(merged)) # string keys, like the persisted blob
  end

  def fixture_path(name)
    File.expand_path("../fixtures/widgets/#{name}", __dir__)
  end

  describe '.simulate (happy path on enriched detail_json)' do
    let(:result) { described_class.simulate(enriched_detail) }

    it 'returns a ready-to-persist scalar hash' do
      expect(result).to be_a(Hash)
      expect(result[:status]).to eq('pending')
      expect(result[:p_home] + result[:p_draw] + result[:p_away]).to be_within(1e-6).of(1.0)
      expect(result[:p_btts]).to be_between(0.0, 1.0)
      expect(result[:p_over_25]).to be_between(0.0, 1.0)
      expect(result[:model_version]).to be_a(String)
    end

    it 'includes top_scorelines, sim_stats, market_anchor and player_events' do
      expect(result[:top_scorelines]).to be_a(Array)
      expect(result[:top_scorelines].length).to be <= 6
      expect(result[:sim_stats]).to be_a(Hash)
      expect(result[:player_events]).to be_a(Array)
    end

    it 'output is small and fully scalar (never the raw blob)' do
      expect(JSON.generate(result).bytesize).to be < 60_000
    end

    it 'is reproducible (deterministic seed derived from the fixture)' do
      a = described_class.simulate(enriched_detail)
      b = described_class.simulate(enriched_detail)
      expect(a).to eq(b)
    end

    # Regression: the seed must be invariant to fields that vary across
    # re-scrapes (kickoff_utc may be absent OR formatted differently in
    # detail_json from run to run). Round-trip through JSON twice — once WITH
    # kickoff_utc present, once WITHOUT — and assert byte-identical output.
    # Proves the cross-RUN guarantee, not just same-in-memory-hash.
    it 'output is invariant to kickoff_utc presence/format across re-scrapes' do
      base = enriched_detail

      with_ko = JSON.parse(JSON.generate(base.merge('kickoff_utc' => '2026-05-18T20:00:00Z')))
      without_ko = JSON.parse(JSON.generate(base.reject { |k, _| k == 'kickoff_utc' }))
      with_other_ko = JSON.parse(JSON.generate(base.merge('kickoff_utc' => '2026-05-19 18:30:00 UTC')))

      out_with    = described_class.simulate(with_ko)
      out_without = described_class.simulate(without_ko)
      out_other   = described_class.simulate(with_other_ko)

      expect(JSON.generate(out_with)).to eq(JSON.generate(out_without))
      expect(JSON.generate(out_with)).to eq(JSON.generate(out_other))
    end
  end

  describe 'honest degradation (NEVER raises)' do
    it 'never emits possession (absent from payload)' do
      expect(result_keys_deep(described_class.simulate(enriched_detail))).not_to include(:possession, 'possession')
    end

    it 'sets per_half_available:false when no HT split is available' do
      d = enriched_detail
      # strip the per-half corner/goal metrics from the avgs blocks
      d['avgs'].each_value do |blk|
        next unless blk.is_a?(Hash)

        blk.delete_if { |k, _| k.to_s =~ /1h|2h|firstHalf|secondHalf/ }
      end
      out = described_class.simulate(d)
      expect(out[:per_half_available]).to be(false)
    end

    it 'returns status:"unsimulable" (no raise) when avgs are missing' do
      out = described_class.simulate({ 'recent_matches' => { 'home' => [], 'away' => [] } })
      expect(out[:status]).to eq('unsimulable')
      expect(out[:p_home]).to be_nil
    end

    it 'returns status:"unsimulable" (no raise) on empty/garbage detail' do
      expect { described_class.simulate({}) }.not_to raise_error
      expect(described_class.simulate({})[:status]).to eq('unsimulable')
      expect(described_class.simulate(nil)[:status]).to eq('unsimulable')
    end

    it 'does not raise when player data is absent (player_events empty)' do
      d = enriched_detail
      d.delete('player_stats')
      d.delete('player_extra')
      out = described_class.simulate(d)
      expect(out[:status]).not_to eq('unsimulable') # score model still works
      expect(out[:player_events]).to eq([])
    end
  end

  def result_keys_deep(obj, acc = [])
    case obj
    when Hash
      obj.each { |k, v| acc << k; result_keys_deep(v, acc) }
    when Array
      obj.each { |v| result_keys_deep(v, acc) }
    end
    acc
  end
end
