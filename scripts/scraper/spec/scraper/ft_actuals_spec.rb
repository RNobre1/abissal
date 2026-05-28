require 'spec_helper'
require_relative '../../lib/scraper/ft_actuals'

# FtActuals extrai os resultados FT de um widget recent_results do choistats.
# Gols/reds vêm do header `fixture`; corners/SOT/cards vêm do entry de
# recentHomeResults cujo id == fixture_id (o jogo recém-disputado aparece como
# o resultado mais recente do time, com stats completos).
RSpec.describe AdamStats::Scraper::FtActuals do
  let(:played_entry) do
    {
      'id' => 999, 'status' => 'FT',
      'homeGoalsFt' => 3, 'awayGoalsFt' => 0,
      'homeCorners' => 9, 'awayCorners' => 2,
      'homeShotsOnTarget' => 15, 'awayShotsOnTarget' => 1,
      'homeYellows' => 0, 'awayYellows' => 5,
      'homeReds' => 0, 'awayReds' => 1
    }
  end

  def widget(fixture_overrides: {}, home_results: [], away_results: [])
    {
      'fixture' => {
        'id' => 999, 'status' => 'FT',
        'homeGoalsFt' => 3, 'awayGoalsFt' => 0
      }.merge(fixture_overrides),
      'recentHomeResults' => home_results,
      'recentAwayResults' => away_results
    }
  end

  describe '.from_widget' do
    it 'retorna nil quando não FT' do
      w = widget(fixture_overrides: { 'status' => 'NS', 'homeGoalsFt' => nil, 'awayGoalsFt' => nil })
      expect(described_class.from_widget(w, 999)).to be_nil
    end

    it 'retorna gols do header mesmo sem stats secundários' do
      a = described_class.from_widget(widget, 999)
      expect(a[:home_goals]).to eq(3)
      expect(a[:away_goals]).to eq(0)
      expect(a[:has_secondary]).to be false
    end

    it 'extrai corners/SOT/cards do entry recentHomeResults com id casado' do
      a = described_class.from_widget(widget(home_results: [played_entry]), 999)
      expect(a[:home_corners]).to eq(9)
      expect(a[:away_corners]).to eq(2)
      expect(a[:home_sot]).to eq(15)
      expect(a[:away_sot]).to eq(1)
      # cards = yellows + reds
      expect(a[:home_cards]).to eq(0)
      expect(a[:away_cards]).to eq(6) # 5 yellows + 1 red
      expect(a[:has_secondary]).to be true
    end

    it 'acha o entry em recentAwayResults se não estiver no home' do
      a = described_class.from_widget(widget(away_results: [played_entry]), 999)
      expect(a[:home_corners]).to eq(9)
      expect(a[:has_secondary]).to be true
    end

    it 'ignora entries com id diferente (não confunde jogos)' do
      other = played_entry.merge('id' => 111, 'homeCorners' => 99)
      a = described_class.from_widget(widget(home_results: [other]), 999)
      expect(a[:has_secondary]).to be false
      expect(a[:home_corners]).to be_nil
    end

    it 'não marca has_secondary se corners/sot/cards ausentes no entry' do
      thin = { 'id' => 999, 'homeGoalsFt' => 3, 'awayGoalsFt' => 0 }
      a = described_class.from_widget(widget(home_results: [thin]), 999)
      expect(a[:has_secondary]).to be false
    end
  end
end
