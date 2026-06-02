require 'spec_helper'
require 'scraper/ai_reco/dist_k_lookup'

module AdamStats::Scraper::AiReco
  RSpec.describe DistKLookup do
    # Lê as linhas de calibração de DISTRIBUIÇÃO ('corners-dist'/'cards-dist'/
    # 'sot-dist') de model_calibration e expõe Hash<stat → k>, onde
    # k = meanActual / meanPred (pairs guarda [[meanPred, meanActual]]).
    # Porta Ruby de lib/ai-reco/dist-k-repository.ts — comportamento idêntico.

    def conn_with(rows)
      conn = double('PG::Connection')
      allow(conn).to receive(:exec_params)
        .with(/FROM model_calibration/im, ['sim-v7'])
        .and_return(rows)
      conn
    end

    describe '.load' do
      it 'monta Hash<stat → k> a partir das linhas *-dist ativas' do
        rows = [
          { 'metric' => 'corners-dist', 'pairs' => '[[8.95,9.53]]' },
          { 'metric' => 'cards-dist',   'pairs' => '[[3.43,3.87]]' },
          { 'metric' => 'sot-dist',     'pairs' => '[[7.71,8.26]]' }
        ]
        k = described_class.load(conn_with(rows), 'sim-v7')
        expect(k.keys).to contain_exactly('corners', 'cards', 'sot')
        expect(k['corners']).to be_within(1e-6).of(9.53 / 8.95)
        expect(k['cards']).to be_within(1e-6).of(3.87 / 3.43)
        expect(k['sot']).to be_within(1e-6).of(8.26 / 7.71)
      end

      it 'ignora métricas que não são *-dist (isotônicas etc.)' do
        rows = [
          { 'metric' => '1x2-home',     'pairs' => '[[0.5,0.45],[0.8,0.55]]' },
          { 'metric' => 'corners-dist', 'pairs' => '[[10.0,11.0]]' }
        ]
        k = described_class.load(conn_with(rows), 'sim-v7')
        expect(k.keys).to contain_exactly('corners')
        expect(k['corners']).to be_within(1e-6).of(1.1)
      end

      it 'descarta linha com meanPred não-positivo (evita divisão por zero)' do
        rows = [{ 'metric' => 'corners-dist', 'pairs' => '[[0,9.5]]' }]
        expect(described_class.load(conn_with(rows), 'sim-v7')).to eq({})
      end

      it 'descarta pairs malformado' do
        rows = [
          { 'metric' => 'corners-dist', 'pairs' => 'lixo' },
          { 'metric' => 'cards-dist',   'pairs' => '[]' },
          { 'metric' => 'sot-dist',     'pairs' => '[[7.0,7.5]]' }
        ]
        k = described_class.load(conn_with(rows), 'sim-v7')
        expect(k.keys).to contain_exactly('sot')
      end

      it 'model_version vazio → {} (short-circuit, sem tocar o conn)' do
        expect(described_class.load(double('conn'), '')).to eq({})
        expect(described_class.load(double('conn'), nil)).to eq({})
      end

      it 'erro de DB → {} (degrada gracioso, nunca quebra o batch)' do
        conn = double('PG::Connection')
        allow(conn).to receive(:exec_params).and_raise(StandardError.new('boom'))
        expect(described_class.load(conn, 'sim-v7')).to eq({})
      end
    end
  end
end
