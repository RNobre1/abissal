require 'spec_helper'
require 'scraper/ai_reco/edge_calculator'

module AdamStats::Scraper::AiReco
  RSpec.describe EdgeCalculator do
    let(:base_sim) do
      { p_home: 0.50, p_draw: 0.25, p_away: 0.25, p_over_25: 0.60, p_btts: 0.55 }
    end
    let(:base_odds) do
      { home: 2.10, draw: 3.50, away: 3.80, over25: 1.85, under25: 2.00,
        btts_sim: 1.80, btts_nao: 2.10 }
    end

    it 'gera 7 candidatos quando todas odds presentes' do
      out = EdgeCalculator.build(base_sim, base_odds, 1000)
      expect(out.length).to eq(7)
      keys = out.map { |c| "#{c[:market]}-#{c[:side]}" }
      expect(keys).to include('1x2-home', '1x2-draw', '1x2-away',
                              'over25-over', 'over25-under',
                              'btts-sim', 'btts-nao')
    end

    it 'calcula edge: prob*odd - 1 (em %)' do
      out = EdgeCalculator.build(base_sim, base_odds, 1000)
      home = out.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
      # 0.50 * 2.10 - 1 = 0.05 → 5%
      expect(home[:edge_pct]).to be_within(0.1).of(5.0)
    end

    it 'ordena por edge desc' do
      out = EdgeCalculator.build(base_sim, base_odds, 1000)
      out.each_cons(2) { |a, b| expect(a[:edge_pct]).to be >= b[:edge_pct] }
    end

    it 'kelly_units zero pra edge negativo' do
      neg = base_sim.merge(p_home: 0.30)
      out = EdgeCalculator.build(neg, base_odds, 1000)
      home = out.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
      expect(home[:edge_pct]).to be < 0
      expect(home[:kelly_units]).to eq(0)
    end

    it 'kelly fracionado ¼ (1 unit = 1% bankroll)' do
      out = EdgeCalculator.build(base_sim, base_odds, 1000)
      home = out.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
      # f_full = (0.50*1.10 - 0.50)/1.10 = 0.05/1.10 ≈ 0.04545
      # f_quarter = 0.04545/4 ≈ 0.011364
      # bankroll/100 = 10 → units = 0.011364 * 10 ≈ 0.1136
      expect(home[:kelly_units]).to be_within(0.01).of(0.1136)
    end

    it 'ignora mercado sem odd' do
      partial = base_odds.reject { |k, _| %i[over25 under25 btts_sim btts_nao].include?(k) }
      out = EdgeCalculator.build(base_sim, partial, 1000)
      expect(out.all? { |c| c[:market] == '1x2' }).to be true
    end

    it 'aplica isotonic_lookup quando fornecido' do
      lookup = { '1x2-home' => ->(p) { p + 0.05 } }
      out = EdgeCalculator.build(base_sim, base_odds, 1000, isotonic_lookup: lookup)
      home = out.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
      expect(home[:prob_calibrated]).to be_within(0.001).of(0.55)
      # 0.55 * 2.10 - 1 = 0.155 → 15.5%
      expect(home[:edge_pct]).to be_within(0.1).of(15.5)
    end
  end
end
