require 'spec_helper'
require 'json'
require 'scraper/ai_recommender_runner'

module AdamStats::Scraper
  RSpec.describe AiRecommenderRunner do
    let(:logger_msgs) { [] }
    let(:logger) { ->(m) { logger_msgs << m } }

    let(:client) do
      c = double('OpenrouterClient')
      allow(c).to receive(:call).and_return(
        ok: true,
        decision: { verdict: 'bet', market: 'btts', side: 'sim',
                    units_final: 1.5, prob_estimated: 0.64,
                    kelly_pre: 1.8, reduction_reason: 'lineup',
                    confidence: 'medio', summary_line: 'BTTS 1.5u 64%',
                    reasoning: 'a' * 200, red_flags: [] },
        raw_content: 'mock',
        usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
        latency_ms: 8500,
        model_returned: 'deepseek/deepseek-r1'
      )
      c
    end

    def conn_double
      conn = double('PG::Connection')
      allow(conn).to receive(:query).and_return([])
      allow(conn).to receive(:exec_params).and_return([])
      conn
    end

    describe 'dry_run mode' do
      it 'nao chama insert no DB e nao chama IA' do
        conn = conn_double
        allow(conn).to receive(:query).with(/SELECT.*fixture_simulations/im).and_return([])
        runner = described_class.new(conn: conn, logger: logger, client: client, dry_run: true)
        expect { runner.run }.not_to raise_error
        expect(client).not_to have_received(:call)
      end
    end

    describe 'when there are no upcoming sim rows' do
      it 'nao chama IA nem tenta inserir' do
        conn = conn_double
        allow(conn).to receive(:query).with(/SELECT.*fixture_simulations/im).and_return([])
        runner = described_class.new(conn: conn, logger: logger, client: client)
        runner.run
        expect(client).not_to have_received(:call)
      end
    end

    describe 'when no candidate has edge >= 5%' do
      it 'salva verdict=skip e NAO chama a IA' do
        sim_row = {
          'fixture_id' => '123',
          'home_team' => 'A', 'away_team' => 'B', 'league' => 'L',
          'kickoff_utc' => '2026-05-30T15:00:00Z',
          'p_home' => '0.40', 'p_draw' => '0.30', 'p_away' => '0.30',
          'p_over_25' => '0.50', 'p_btts' => '0.50',
          'top_scorelines' => '[]', 'sim_stats' => '{}',
          # Odds tunadas pra todo candidato ficar com edge < 5%:
          #   home 0.40*2.0 - 1 = -20%; draw 0.30*3.0 - 1 = -10%;
          #   away 0.30*3.2 - 1 = -4% (≈0.30*3.2 = 0.96); over/under em torno de 0%; btts -5%
          'detail_json' => JSON.generate(
            'odds' => {
              '1X2' => { '1' => { 'average' => 2.0 }, 'X' => { 'average' => 3.0 }, '2' => { 'average' => 3.2 } },
              'OVER_UNDER_2_5' => { 'OVER' => { 'average' => 2.0 }, 'UNDER' => { 'average' => 1.85 } },
              'BTTS' => { 'YES' => { 'average' => 1.9 }, 'NO' => { 'average' => 1.9 } }
            }
          )
        }
        conn = conn_double
        allow(conn).to receive(:query).with(/SELECT.*fixture_simulations/im).and_return([sim_row])
        allow(conn).to receive(:query).with(/SELECT.*league_parameters/im).and_return([])
        captured_inserts = []
        allow(conn).to receive(:exec_params) do |sql, params|
          captured_inserts << [sql, params] if sql.include?('INSERT INTO ai_recommendations')
          []
        end

        runner = described_class.new(conn: conn, logger: logger, client: client)
        runner.run

        expect(client).not_to have_received(:call)
        expect(captured_inserts.length).to eq(1)
        expect(captured_inserts.first[1]).to include('skip')
      end
    end

    describe 'failure isolation' do
      it 'uma fixture com erro nao derruba o batch' do
        sims = [
          { 'fixture_id' => '1', 'home_team' => 'X', 'away_team' => 'Y',
            'league' => 'L', 'kickoff_utc' => '2026-05-30T15:00:00Z',
            'p_home' => 'invalid', 'p_draw' => '0.20', 'p_away' => '0.20',
            'p_over_25' => '0.60', 'p_btts' => '0.50',
            'top_scorelines' => 'invalid', 'sim_stats' => '{}',
            'detail_json' => 'invalid' },
          { 'fixture_id' => '2', 'home_team' => 'A', 'away_team' => 'B',
            'league' => 'L', 'kickoff_utc' => '2026-05-30T15:00:00Z',
            'p_home' => '0.60', 'p_draw' => '0.20', 'p_away' => '0.20',
            'p_over_25' => '0.60', 'p_btts' => '0.50',
            'top_scorelines' => '[]', 'sim_stats' => '{}',
            'detail_json' => JSON.generate(
              'odds' => {
                '1X2' => { '1' => { 'average' => 2.0 }, 'X' => { 'average' => 3.5 }, '2' => { 'average' => 3.8 } },
                'OVER_UNDER_2_5' => { 'OVER' => { 'average' => 1.85 }, 'UNDER' => { 'average' => 2.0 } },
                'BTTS' => { 'YES' => { 'average' => 1.8 }, 'NO' => { 'average' => 2.1 } }
              }
            ) }
        ]
        conn = conn_double
        allow(conn).to receive(:query).with(/SELECT.*fixture_simulations/im).and_return(sims)
        allow(conn).to receive(:query).with(/SELECT.*league_parameters/im).and_return([])

        runner = described_class.new(conn: conn, logger: logger, client: client)
        expect { runner.run }.not_to raise_error
      end
    end
  end
end
