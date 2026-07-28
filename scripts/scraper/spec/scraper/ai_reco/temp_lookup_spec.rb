require 'spec_helper'
require 'json'
require 'scraper/ai_reco/temp_lookup'

module AdamStats::Scraper::AiReco
  RSpec.describe TempLookup do
    # Espelha o padrão do DistKLookup: linhas de `model_calibration` com
    # metric '{market}-temp' e pairs = [[1, T]] (âncora self-describing —
    # T = y / x, mesma convenção do k que usa [[meanPred, meanActual]]).
    def conn_double(rows)
      conn = double('PG::Connection')
      allow(conn).to receive(:exec_params).and_return(rows)
      conn
    end

    it 'carrega o T de cada mercado principal' do
      rows = [
        { 'metric' => '1x2-temp', 'pairs' => JSON.generate([[1, 1.70]]) },
        { 'metric' => 'over25-temp', 'pairs' => JSON.generate([[1, 2.15]]) },
        { 'metric' => 'btts-temp', 'pairs' => JSON.generate([[1, 2.60]]) }
      ]
      out = described_class.load(conn_double(rows), 'v7')
      expect(out['1x2']).to be_within(0.001).of(1.70)
      expect(out['over25']).to be_within(0.001).of(2.15)
      expect(out['btts']).to be_within(0.001).of(2.60)
    end

    it 'aceita pairs já decodificado (jsonb vira Array)' do
      rows = [{ 'metric' => 'over25-temp', 'pairs' => [[1, 2.15]] }]
      expect(described_class.load(conn_double(rows), 'v7')['over25']).to be_within(0.001).of(2.15)
    end

    it 'ignora métricas que não são -temp (não colide com isotônica nem -dist)' do
      rows = [
        { 'metric' => 'over25', 'pairs' => JSON.generate([[0.1, 0.2], [0.9, 0.8]]) },
        { 'metric' => 'corners-dist', 'pairs' => JSON.generate([[9.0, 9.5]]) },
        { 'metric' => 'over25-temp', 'pairs' => JSON.generate([[1, 2.15]]) }
      ]
      out = described_class.load(conn_double(rows), 'v7')
      expect(out.keys).to eq(['over25'])
    end

    it 'ignora mercado desconhecido' do
      rows = [{ 'metric' => 'corners-temp', 'pairs' => JSON.generate([[1, 2.0]]) }]
      expect(described_class.load(conn_double(rows), 'v7')).to eq({})
    end

    it 'ignora T inválido (<= 0, não-numérico, pairs malformado)' do
      rows = [
        { 'metric' => '1x2-temp', 'pairs' => JSON.generate([[1, 0]]) },
        { 'metric' => 'over25-temp', 'pairs' => JSON.generate([[1, 'x']]) },
        { 'metric' => 'btts-temp', 'pairs' => JSON.generate([]) }
      ]
      expect(described_class.load(conn_double(rows), 'v7')).to eq({})
    end

    it 'short-circuit quando model_version é nil/vazio' do
      conn = double('PG::Connection')
      expect(conn).not_to receive(:exec_params)
      expect(described_class.load(conn, nil)).to eq({})
      expect(described_class.load(conn, '  ')).to eq({})
    end

    it 'degrada pra {} quando o DB falha (nunca derruba o batch)' do
      conn = double('PG::Connection')
      allow(conn).to receive(:exec_params).and_raise(StandardError, 'boom')
      expect(described_class.load(conn, 'v7')).to eq({})
    end

    it 'filtra por model_version e só curvas ativas' do
      conn = double('PG::Connection')
      expect(conn).to receive(:exec_params) do |sql, params|
        expect(sql).to match(/effective_until IS NULL/i)
        expect(params).to eq(['v7'])
        []
      end
      described_class.load(conn, 'v7')
    end
  end
end
