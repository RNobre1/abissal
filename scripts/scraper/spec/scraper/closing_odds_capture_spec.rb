require 'spec_helper'
require 'json'
require 'scraper/closing_odds_capture'

module AdamStats::Scraper
  RSpec.describe ClosingOddsCapture do
    let(:logger_msgs) { [] }
    let(:logger) { ->(m) { logger_msgs << m } }

    # Minimal odds widget shape: array de { market: { name }, outcomes: {...} }
    # — réplica do payload real de /api/widget/match/<id>/odds (ver
    # spec/scraper/fixtures/widgets/odds.json pra payload completo).
    let(:odds_payload) do
      [
        {
          'market' => { 'name' => 'Result' },
          'outcomes' => {
            'Tottenham Hotspur' => { 'decimalOdds' => 1.74, 'bookmaker' => 'UNIBET' },
            'Draw'              => { 'decimalOdds' => 4.0,  'bookmaker' => 'UNIBET' },
            'Leeds United'      => { 'decimalOdds' => 4.5,  'bookmaker' => 'UNIBET' }
          }
        },
        {
          'market' => { 'name' => 'BTTS' },
          'outcomes' => {
            'Yes' => { 'decimalOdds' => 1.62, 'bookmaker' => 'UNIBET' },
            'No'  => { 'decimalOdds' => 2.18, 'bookmaker' => 'UNIBET' }
          }
        },
        {
          'market' => { 'name' => 'Match Goals Overs/Unders' },
          'outcomes' => {
            'Over 2.5'  => { 'decimalOdds' => 1.65, 'bookmaker' => 'BET365' },
            'Under 2.5' => { 'decimalOdds' => 2.30, 'bookmaker' => 'BET365' }
          }
        }
      ]
    end

    let(:client) do
      c = double('ChoistatsApiClient')
      allow(c).to receive(:fetch_widget).with(:odds, fixture_id: anything).and_return(odds_payload)
      c
    end

    let(:reco_row) do
      {
        'id' => 42,
        'fixture_id' => 19427224,
        'home_team' => 'Tottenham Hotspur',
        'away_team' => 'Leeds United'
      }
    end

    def conn_double(rows: [reco_row])
      conn = double('PG::Connection')
      allow(conn).to receive(:exec_params).and_return([])
      # SELECT query
      allow(conn).to receive(:query).and_return(rows)
      conn
    end

    # O cron ficou VERDE capturando zero de 01/06 a 28/07 (kill switch da IA ⇒
    # nenhuma reco verdict='bet' ⇒ nenhuma elegível) e ninguém notou, porque
    # "exit 0" era indistinguível de "capturou tudo". `run` agora devolve o
    # placar pro caller publicar no step summary / healthcheck.
    describe '#run devolve o placar da rodada' do
      it 'retorna eligible e captured quando captura odds' do
        stats = described_class.new(conn: conn_double, client: client, logger: logger).run
        expect(stats[:eligible]).to eq(1)
        expect(stats[:captured]).to be > 0
      end

      it 'retorna zeros quando não há recos elegíveis (o modo de falha silencioso)' do
        stats = described_class.new(conn: conn_double(rows: []), client: client, logger: logger).run
        expect(stats[:eligible]).to eq(0)
        expect(stats[:captured]).to eq(0)
      end

      it 'conta eligible mesmo quando o payload não rende odds (captured=0)' do
        c = double('ChoistatsApiClient')
        allow(c).to receive(:fetch_widget).and_return(nil)
        stats = described_class.new(conn: conn_double, client: c, logger: logger).run
        expect(stats[:eligible]).to eq(1)
        expect(stats[:captured]).to eq(0)
      end

      it 'não deixa uma fixture com erro zerar o placar das demais' do
        rows = [reco_row, reco_row.merge('id' => 43, 'fixture_id' => 19427225)]
        c = double('ChoistatsApiClient')
        call = 0
        allow(c).to receive(:fetch_widget) do
          call += 1
          raise StandardError, 'boom' if call == 1

          odds_payload
        end
        stats = described_class.new(conn: conn_double(rows: rows), client: c, logger: logger).run
        expect(stats[:eligible]).to eq(2)
        expect(stats[:captured]).to be > 0
        expect(stats[:errors]).to eq(1)
      end
    end

    describe 'fixture selection' do
      it 'queries ai_recommendations com verdict=bet e kickoff_utc nas próximas 4h' do
        conn = conn_double
        capture = described_class.new(conn: conn, client: client, logger: logger)
        seen_sql = nil
        allow(conn).to receive(:query) do |sql|
          seen_sql = sql
          []
        end
        capture.run
        expect(seen_sql).to match(/verdict\s*=\s*'bet'/im)
        expect(seen_sql).to match(/kickoff_utc\s*BETWEEN/im)
        expect(seen_sql).to match(/INTERVAL\s*'4\s*hours'/im)
      end

      it 'aborta gracioso quando não há recos elegíveis' do
        conn = conn_double(rows: [])
        capture = described_class.new(conn: conn, client: client, logger: logger)
        expect { capture.run }.not_to raise_error
        expect(client).not_to have_received(:fetch_widget)
      end

      it 'não filtra por NOT EXISTS em closing_odds — reco com odds já capturadas volta a ser elegível' do
        conn = conn_double
        seen_sql = nil
        allow(conn).to receive(:query) do |sql|
          seen_sql = sql
          [reco_row]
        end

        described_class.new(conn: conn, client: client, logger: logger).run

        # last-write-wins: a query NÃO deve excluir fixtures que já têm closing_odds
        expect(seen_sql).not_to match(/NOT\s+EXISTS/im)
      end
    end

    describe 'odds parsing + insertion' do
      it 'extrai 1x2/btts/over25 do payload Choistats e insere 7 rows' do
        conn = conn_double
        capture = described_class.new(conn: conn, client: client, logger: logger)

        # 7 inserts esperados: home, draw, away, over, under, sim, nao
        expect(conn).to receive(:exec_params)
          .with(/INSERT INTO closing_odds/im, anything)
          .exactly(7).times
          .and_return([])

        capture.run
      end

      it 'persiste odds com market/side corretos e mantém precisão decimal' do
        conn = conn_double
        seen = []
        allow(conn).to receive(:exec_params) do |_sql, params|
          seen << params
          []
        end

        described_class.new(conn: conn, client: client, logger: logger).run

        h2h = seen.find { |p| p[1] == '1x2' && p[2] == 'home' }
        expect(h2h).not_to be_nil
        expect(h2h[3]).to eq(1.74)
        expect(h2h[4]).to eq('choistats')
        expect(h2h[5]).to eq(42) # ai_recommendation_id

        draw_row = seen.find { |p| p[1] == '1x2' && p[2] == 'draw' }
        expect(draw_row[3]).to eq(4.0)

        over_row = seen.find { |p| p[1] == 'over25' && p[2] == 'over' }
        expect(over_row[3]).to eq(1.65)

        btts_yes = seen.find { |p| p[1] == 'btts' && p[2] == 'sim' }
        expect(btts_yes[3]).to eq(1.62)
      end

      it 'pula fixtures sem odds payload (graceful)' do
        conn = conn_double
        empty_client = double('ChoistatsApiClient')
        allow(empty_client).to receive(:fetch_widget).with(:odds, fixture_id: anything).and_return(nil)

        capture = described_class.new(conn: conn, client: empty_client, logger: logger)
        expect(conn).not_to receive(:exec_params).with(/INSERT INTO closing_odds/im, anything)
        capture.run
        expect(logger_msgs.any? { |m| m.include?('sem odds') }).to be true
      end

      it 'pula fixtures cujo odds widget retorna estrutura inválida' do
        conn = conn_double
        bad_client = double('ChoistatsApiClient')
        allow(bad_client).to receive(:fetch_widget)
          .with(:odds, fixture_id: anything)
          .and_return({ 'unexpected' => 'shape' })

        capture = described_class.new(conn: conn, client: bad_client, logger: logger)
        expect(conn).not_to receive(:exec_params).with(/INSERT INTO closing_odds/im, anything)
        expect { capture.run }.not_to raise_error
      end
    end

    describe 'last-write-wins (upsert)' do
      it 'usa ON CONFLICT DO UPDATE SET odd_close/captured_at — nunca DO NOTHING' do
        conn = conn_double
        seen_sql = nil
        allow(conn).to receive(:exec_params) do |sql, _params|
          seen_sql ||= sql
          []
        end

        described_class.new(conn: conn, client: client, logger: logger).run

        expect(seen_sql).to match(/ON CONFLICT/i)
        expect(seen_sql).to match(/DO UPDATE/i)
        expect(seen_sql).to match(/odd_close\s*=\s*EXCLUDED\.odd_close/i)
        expect(seen_sql).to match(/captured_at\s*=\s*now\(\)/i)
        expect(seen_sql).not_to match(/DO NOTHING/i)
      end

      it 'upsert também atualiza ai_recommendation_id em conflito' do
        conn = conn_double
        seen_sql = nil
        allow(conn).to receive(:exec_params) do |sql, _params|
          seen_sql ||= sql
          []
        end

        described_class.new(conn: conn, client: client, logger: logger).run

        expect(seen_sql).to match(/ai_recommendation_id\s*=\s*EXCLUDED\.ai_recommendation_id/i)
      end

      it 'toda chamada de INSERT usa o mesmo SQL com upsert (primeira captura e re-capturas)' do
        conn = conn_double
        seen_sqls = []
        allow(conn).to receive(:exec_params) do |sql, _params|
          seen_sqls << sql
          []
        end

        described_class.new(conn: conn, client: client, logger: logger).run

        expect(seen_sqls).not_to be_empty
        seen_sqls.each do |sql|
          expect(sql).to match(/ON CONFLICT.*DO UPDATE/im)
          expect(sql).to match(/odd_close\s*=\s*EXCLUDED\.odd_close/i)
          expect(sql).to match(/captured_at\s*=\s*now\(\)/i)
        end
      end
    end

    describe 'isolamento de falha por fixture' do
      it 'continua processando demais recos quando uma fixture levanta exceção' do
        conn = conn_double(rows: [
          reco_row.merge('fixture_id' => 1),
          reco_row.merge('fixture_id' => 2, 'id' => 43)
        ])
        flaky_client = double('ChoistatsApiClient')
        allow(flaky_client).to receive(:fetch_widget).with(:odds, fixture_id: 1).and_raise(StandardError, 'boom')
        allow(flaky_client).to receive(:fetch_widget).with(:odds, fixture_id: 2).and_return(odds_payload)

        # Pelo menos 1 fixture (a 2) deve ter inserido — não vamos checar o
        # número exato porque o teste de parsing já cobre isso. Aqui só
        # garantimos resiliência.
        expect(conn).to receive(:exec_params).at_least(:once).and_return([])

        expect {
          described_class.new(conn: conn, client: flaky_client, logger: logger).run
        }.not_to raise_error
      end
    end
  end
end
