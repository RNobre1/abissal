# frozen_string_literal: true

require_relative '../../../lib/scraper/analysis/value_bets'

VB = AdamStats::Scraper::Analysis::ValueBets

RSpec.describe AdamStats::Scraper::Analysis::ValueBets do
  describe '.edge' do
    it 'computa prob*odd-1' do
      expect(VB.edge(0.70, 1.90)).to be_within(1e-9).of(0.33)
    end
    it 'devolve nil p/ odd<=1 ou prob<=0 ou nil' do
      expect(VB.edge(0.7, 1.0)).to be_nil
      expect(VB.edge(0, 2.0)).to be_nil
      expect(VB.edge(nil, 2.0)).to be_nil
    end
  end

  describe '.opposite' do
    it 'over25 under<->over' do
      expect(VB.opposite('over25', 'under')).to eq(['over25', 'over'])
      expect(VB.opposite('over25', 'over')).to eq(['over25', 'under'])
    end
    it 'btts nao<->sim' do
      expect(VB.opposite('btts', 'nao')).to eq(['btts', 'sim'])
      expect(VB.opposite('btts', 'sim')).to eq(['btts', 'nao'])
    end
    it 'corners/sot under<->over mantendo a linha' do
      expect(VB.opposite('corners-under', '95')).to eq(['corners-over', '95'])
      expect(VB.opposite('sot-over', '75')).to eq(['sot-under', '75'])
    end
    it '1x2 não tem oposto binário' do
      expect(VB.opposite('1x2', 'home')).to be_nil
    end
  end

  describe '.classify_row' do
    it 'roi muito negativo (n suficiente) => :avoid' do
      expect(VB.classify_row(18, -0.83)).to eq(:avoid)
    end
    it 'roi positivo (n suficiente) => :trust' do
      expect(VB.classify_row(56, 0.42)).to eq(:trust)
    end
    it 'amostra pequena => :weak (não condena nem confia)' do
      expect(VB.classify_row(8, 1.80)).to eq(:trust) # n==8 limite
      expect(VB.classify_row(7, 1.80)).to eq(:weak)  # n<8
    end
  end

  describe '.klass_for (inferência de fade)' do
    let(:classified) do
      VB.classify([
        { 'market' => 'over25', 'side' => 'under', 'n' => 18, 'roi' => -0.83 },
        { 'market' => '1x2',    'side' => 'home',  'n' => 56, 'roi' => 0.42 },
        { 'market' => 'btts',   'side' => 'nao',   'n' => 9,  'roi' => -0.38 }
      ])
    end

    it 'lado com histórico próprio usa a própria classe' do
      expect(VB.klass_for('1x2', 'home', classified)).to eq(:trust)
      expect(VB.klass_for('over25', 'under', classified)).to eq(:avoid)
    end

    it 'over25-over (sem histórico) herda :trust_inverse do under :avoid' do
      expect(VB.klass_for('over25', 'over', classified)).to eq(:trust_inverse)
    end

    it 'btts-sim (sem histórico) herda :trust_inverse do nao :avoid' do
      expect(VB.klass_for('btts', 'sim', classified)).to eq(:trust_inverse)
    end

    it 'lado totalmente sem referência => :unknown' do
      expect(VB.klass_for('corners-over', '95', classified)).to eq(:unknown)
    end

    it 'histórico próprio FRACO (n<8) cede ao sinal forte do oposto :avoid' do
      cl = VB.classify([
        { 'market' => 'over25', 'side' => 'under', 'n' => 18, 'roi' => -0.83 },
        { 'market' => 'over25', 'side' => 'over',  'n' => 3,  'roi' => 0.10 } # ruído
      ])
      expect(VB.klass_for('over25', 'over', cl)).to eq(:trust_inverse)
    end
  end

  describe '.allowed?' do
    it 'bloqueia :avoid e :avoid_inverse; permite o resto' do
      expect(VB.allowed?(:avoid)).to be(false)
      expect(VB.allowed?(:avoid_inverse)).to be(false)
      expect(VB.allowed?(:trust)).to be(true)
      expect(VB.allowed?(:trust_inverse)).to be(true)
      expect(VB.allowed?(:weak)).to be(true)
      expect(VB.allowed?(:unknown)).to be(true)
    end
  end
end
