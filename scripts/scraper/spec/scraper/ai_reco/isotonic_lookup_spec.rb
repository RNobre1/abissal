require 'spec_helper'
require 'scraper/ai_reco/isotonic_lookup'

module AdamStats::Scraper::AiReco
  RSpec.describe IsotonicLookup do
    # Porta Ruby do lib/calibracao/isotonic.ts#applyIsotonic — comportamento
    # idêntico (clamp nas bordas + interpolação linear + curva vazia = identidade).
    describe '.interpolator' do
      it 'curva vazia → função identidade' do
        fn = described_class.interpolator([])
        expect(fn.call(0.42)).to eq(0.42)
      end

      it 'clampa abaixo do primeiro ponto' do
        fn = described_class.interpolator([[0.2, 0.1], [0.8, 0.7]])
        expect(fn.call(0.05)).to eq(0.1)
      end

      it 'clampa acima do último ponto' do
        fn = described_class.interpolator([[0.2, 0.1], [0.8, 0.7]])
        expect(fn.call(0.95)).to eq(0.7)
      end

      it 'retorna o y exato num ponto da curva' do
        fn = described_class.interpolator([[0.2, 0.1], [0.8, 0.7]])
        expect(fn.call(0.2)).to eq(0.1)
      end

      it 'interpola linearmente entre dois pontos' do
        fn = described_class.interpolator([[0.0, 0.0], [1.0, 0.5]])
        # x=0.6 → y = 0 + 0.6*(0.5-0) = 0.30
        expect(fn.call(0.6)).to be_within(1e-9).of(0.30)
      end

      it 'corrige overconfidence (0.84 cru → ~0.55 calibrado)' do
        # curva típica: o modelo diz 0.84, a frequência real é ~0.55
        fn = described_class.interpolator([[0.5, 0.45], [0.84, 0.55], [0.95, 0.60]])
        expect(fn.call(0.84)).to be_within(1e-9).of(0.55)
      end
    end

    describe '.load' do
      # pairs chega do PG como texto JSON (jsonb sem type decoder).
      def conn_with(rows)
        conn = double('PG::Connection')
        allow(conn).to receive(:exec_params)
          .with(/FROM model_calibration/im, ['sim-v7'])
          .and_return(rows)
        conn
      end

      it 'monta Hash<metric → Proc> a partir das curvas ativas' do
        rows = [
          { 'metric' => '1x2-home', 'pairs' => '[[0.5,0.45],[0.8,0.55]]' },
          { 'metric' => 'over25',   'pairs' => '[[0.6,0.50],[0.9,0.62]]' }
        ]
        lookup = described_class.load(conn_with(rows), 'sim-v7')
        expect(lookup.keys).to contain_exactly('1x2-home', 'over25')
        expect(lookup['1x2-home']).to respond_to(:call)
        expect(lookup['1x2-home'].call(0.8)).to be_within(1e-9).of(0.55)
      end

      it 'aceita pairs já como Array (não só String JSON)' do
        rows = [{ 'metric' => '1x2-draw', 'pairs' => [[0.2, 0.15], [0.4, 0.30]] }]
        lookup = described_class.load(conn_with(rows), 'sim-v7')
        expect(lookup['1x2-draw'].call(0.2)).to be_within(1e-9).of(0.15)
      end

      it 'pula linhas com pairs inválido/vazio sem quebrar' do
        rows = [
          { 'metric' => 'over25', 'pairs' => 'lixo-não-json' },
          { 'metric' => '1x2-home', 'pairs' => '[]' },
          { 'metric' => '1x2-away', 'pairs' => '[[0.3,0.25]]' }
        ]
        lookup = described_class.load(conn_with(rows), 'sim-v7')
        expect(lookup.keys).to contain_exactly('1x2-away')
      end

      it "ignora métricas de distribuição ('*-dist' são do DistKLookup)" do
        rows = [
          { 'metric' => 'corners-dist', 'pairs' => '[[8.95,9.53]]' },
          { 'metric' => '1x2-home', 'pairs' => '[[0.5,0.45],[0.8,0.55]]' }
        ]
        lookup = described_class.load(conn_with(rows), 'sim-v7')
        expect(lookup.keys).to contain_exactly('1x2-home')
      end

      it 'model_version nil → hash vazio (sem query)' do
        conn = double('PG::Connection')
        expect(conn).not_to receive(:exec_params)
        expect(described_class.load(conn, nil)).to eq({})
      end

      it 'erro de DB → hash vazio (degrada gracioso, não derruba o batch)' do
        conn = double('PG::Connection')
        allow(conn).to receive(:exec_params).and_raise(StandardError, 'boom')
        expect(described_class.load(conn, 'sim-v7')).to eq({})
      end
    end
  end
end
