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
        allow(conn).to receive(:query).with(/SELECT s\.id.*FROM fixture_simulations/im).and_return([])
        runner = described_class.new(conn: conn, logger: logger, client: client, dry_run: true)
        expect { runner.run }.not_to raise_error
        expect(client).not_to have_received(:call)
      end
    end

    describe 'when there are no upcoming sim rows' do
      it 'nao chama IA nem tenta inserir' do
        conn = conn_double
        allow(conn).to receive(:query).with(/SELECT s\.id.*FROM fixture_simulations/im).and_return([])
        runner = described_class.new(conn: conn, logger: logger, client: client)
        runner.run
        expect(client).not_to have_received(:call)
      end
    end

    describe 'when no candidate has edge >= 20%' do
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
            'odds_summary' => {
              'Result' => {
                'A' => { 'decimal_odds' => 2.0 },
                'Draw' => { 'decimal_odds' => 3.0 },
                'B' => { 'decimal_odds' => 3.2 }
              },
              'Match Goals Overs/Unders' => {
                'Over 2.5' => { 'decimal_odds' => 2.0 },
                'Under 2.5' => { 'decimal_odds' => 1.85 }
              },
              'BTTS' => {
                'Yes' => { 'decimal_odds' => 1.9 },
                'No' => { 'decimal_odds' => 1.9 }
              }
            }
          )
        }
        conn = conn_double
        allow(conn).to receive(:query).with(/SELECT s\.id.*FROM fixture_simulations/im).and_return([sim_row])
        allow(conn).to receive(:query).with(/SELECT DISTINCT league\s+FROM league_parameters/im).and_return([])
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

    describe 'pre-filter: edge alto em liga NAO calibrada' do
      # Sim super off + odd longa: garante que mesmo APÓS blending sim×mercado
      # (α=0.5 universal) a edge_pct fica > 50. Pra odd=4.0 e prob_market_devig
      # ~ 0.25, sim=0.99 → blended = 0.5*0.99 + 0.5*0.25 = 0.62 → edge = 148%.
      # Pre-blending puro era edge = 0.99*4.0-1 = 296%.
      let(:high_edge_sim_row) do
        {
          'fixture_id' => '999',
          'home_team' => 'Kolding IF',
          'away_team' => 'Some Team',
          'league' => 'Uncalibrated League',
          'kickoff_utc' => '2026-05-30T15:00:00Z',
          'p_home' => '0.99', 'p_draw' => '0.005', 'p_away' => '0.005',
          'p_over_25' => '0.50', 'p_btts' => '0.50',
          'top_scorelines' => '[]', 'sim_stats' => '{}',
          'detail_json' => JSON.generate(
            'odds_summary' => {
              'Result' => {
                'Kolding IF' => { 'decimal_odds' => 4.0 },
                'Draw' => { 'decimal_odds' => 4.0 },
                'Some Team' => { 'decimal_odds' => 2.0 }
              },
              'Match Goals Overs/Unders' => {
                'Over 2.5' => { 'decimal_odds' => 2.0 },
                'Under 2.5' => { 'decimal_odds' => 1.85 }
              },
              'BTTS' => {
                'Yes' => { 'decimal_odds' => 2.0 },
                'No' => { 'decimal_odds' => 1.9 }
              }
            }
          )
        }
      end

      it 'NAO chama a IA quando top candidate edge>50 em liga nao-calibrada (persiste skip direto)' do
        conn = conn_double
        allow(conn).to receive(:query).with(/SELECT s\.id.*FROM fixture_simulations/im).and_return([high_edge_sim_row])
        allow(conn).to receive(:query).with(/SELECT DISTINCT league\s+FROM league_parameters/im).and_return([])
        captured_inserts = []
        allow(conn).to receive(:exec_params) do |sql, params|
          captured_inserts << [sql, params] if sql.include?('INSERT INTO ai_recommendations')
          []
        end

        runner = described_class.new(conn: conn, logger: logger, client: client)
        runner.run

        expect(client).not_to have_received(:call)
        expect(captured_inserts.length).to eq(1)
        params = captured_inserts.first[1]
        expect(params).to include('skip')
        expect(params).to include('edge_suspect_pre_filtered')
      end

      it 'CHAMA a IA normalmente quando top candidate edge>50 mas liga CALIBRADA' do
        calibrated_row = high_edge_sim_row.merge('league' => 'Premier League')
        conn = conn_double
        allow(conn).to receive(:query).with(/SELECT s\.id.*FROM fixture_simulations/im).and_return([calibrated_row])
        allow(conn).to receive(:query).with(/SELECT DISTINCT league\s+FROM league_parameters/im).and_return([{ 'league' => 'Premier League' }])
        allow(conn).to receive(:exec_params).and_return([{ 'id' => 1 }])

        runner = described_class.new(conn: conn, logger: logger, client: client)
        runner.run

        expect(client).to have_received(:call)
      end

      it 'CHAMA a IA quando top candidate edge=40 em liga nao-calibrada (entre old 30 e new 50)' do
        # Backtest mostrou que edges 30-50% em ligas nao-calibradas contem
        # winners — threshold v2 (50) deixa passar pra IA decidir.
        # Pra ter edge_blended ~40 com odd=2.0: blended ~0.70 → sim ~ 0.95
        # (com prob_market_devig ~0.49, blended = 0.5*0.95+0.5*0.49 = 0.72,
        #  edge = 0.72*2.0-1 = 44%).
        passthru_row = high_edge_sim_row.merge(
          'p_home' => '0.40', 'p_draw' => '0.30', 'p_away' => '0.30',
          'p_btts' => '0.95'
        )
        conn = conn_double
        allow(conn).to receive(:query).with(/SELECT s\.id.*FROM fixture_simulations/im).and_return([passthru_row])
        allow(conn).to receive(:query).with(/SELECT DISTINCT league\s+FROM league_parameters/im).and_return([])
        allow(conn).to receive(:exec_params).and_return([{ 'id' => 1 }])

        runner = described_class.new(conn: conn, logger: logger, client: client)
        runner.run

        expect(client).to have_received(:call)
      end

      it 'CHAMA a IA quando top candidate edge<=50 em liga nao-calibrada' do
        moderate_row = high_edge_sim_row.merge(
          # Threshold v2 (20%): precisa edge_blended >= 20. Pra odd_btts=2.0
          # e prob_market_devig ~0.487, blended = 0.5*p_sim + 0.5*0.487.
          # p_btts=0.75 → blended=0.619 → edge_blended=23.8% (entre 20 e 50).
          'p_home' => '0.40', 'p_draw' => '0.30', 'p_away' => '0.30',
          'p_btts' => '0.75'
        )
        conn = conn_double
        allow(conn).to receive(:query).with(/SELECT s\.id.*FROM fixture_simulations/im).and_return([moderate_row])
        allow(conn).to receive(:query).with(/SELECT DISTINCT league\s+FROM league_parameters/im).and_return([])
        allow(conn).to receive(:exec_params).and_return([{ 'id' => 1 }])

        runner = described_class.new(conn: conn, logger: logger, client: client)
        runner.run

        expect(client).to have_received(:call)
      end
    end

    describe 'sanity guard pos-IA (defesa secundária)' do
      # NOTA: o pre-filtro já bloqueia o caso onde TOP candidate tem edge>50.
      # Como o IA escolhe entre os candidatos (edge<=top por definição), na prática
      # sanity pos-IA é redundante com pre-filtro EM RUBY. Mantido como camada extra
      # de segurança caso algum caminho futuro pule o pre-filtro (ex: passa
      # `bet_candidates` manualmente). Aqui testamos a unidade `apply_sanity_guard!`
      # diretamente sobre decisão+candidato.
      it 'sobrescreve verdict pra skip quando candidato escolhido edge>50 + !calibrated' do
        runner = described_class.new(conn: conn_double, logger: logger, client: client)
        decision = { verdict: 'bet', market: 'btts', side: 'sim',
                     units_final: 0.5, prob_estimated: 0.7,
                     reduction_reason: nil, confidence: 'alto' }
        chosen = { market: 'btts', side: 'sim', edge_pct: 60.0 }
        result = runner.send(:apply_sanity_guard, decision, chosen, false)
        expect(result[:verdict]).to eq('skip')
        expect(result[:reduction_reason]).to eq('edge_suspect_high_in_uncalibrated_league')
        expect(result[:units_final]).to eq(0)
      end

      it 'NAO sobrescreve quando liga CALIBRADA' do
        runner = described_class.new(conn: conn_double, logger: logger, client: client)
        decision = { verdict: 'bet', market: 'btts', side: 'sim', units_final: 1.5 }
        chosen = { market: 'btts', side: 'sim', edge_pct: 60.0 }
        result = runner.send(:apply_sanity_guard, decision, chosen, true)
        expect(result[:verdict]).to eq('bet')
        expect(result[:units_final]).to eq(1.5)
      end

      it 'NAO sobrescreve quando edge_pct = 40 (entre old 30 e new 50)' do
        runner = described_class.new(conn: conn_double, logger: logger, client: client)
        decision = { verdict: 'bet', market: 'btts', side: 'sim', units_final: 0.5 }
        chosen = { market: 'btts', side: 'sim', edge_pct: 40.0 }
        result = runner.send(:apply_sanity_guard, decision, chosen, false)
        expect(result[:verdict]).to eq('bet')
      end

      it 'NAO sobrescreve quando edge_pct <= 50' do
        runner = described_class.new(conn: conn_double, logger: logger, client: client)
        decision = { verdict: 'bet', market: 'btts', side: 'sim', units_final: 0.5 }
        chosen = { market: 'btts', side: 'sim', edge_pct: 25.0 }
        result = runner.send(:apply_sanity_guard, decision, chosen, false)
        expect(result[:verdict]).to eq('bet')
      end

      it 'passa through quando verdict ja eh skip' do
        runner = described_class.new(conn: conn_double, logger: logger, client: client)
        decision = { verdict: 'skip', confidence: 'baixo' }
        result = runner.send(:apply_sanity_guard, decision, nil, false)
        expect(result[:verdict]).to eq('skip')
      end
    end

    describe 'FIXTURES_QUERY prioritization' do
      it 'ORDER BY prioriza ligas calibradas (subquery em league_parameters)' do
        sql = described_class::FIXTURES_QUERY
        # A query precisa olhar pra league_parameters dentro do ORDER BY (subquery)
        # ou em um CASE/IN clause. Validação de substring:
        expect(sql).to match(/league_parameters/i)
        expect(sql).to match(/ORDER BY/i)
      end
    end

    describe '#run return contract (A4)' do
      it 'retorna { inserted_recos:, errors: } com zeros quando não há fixtures' do
        conn = conn_double
        allow(conn).to receive(:query).with(/SELECT s\.id.*FROM fixture_simulations/im).and_return([])
        runner = described_class.new(conn: conn, logger: logger, client: client)
        result = runner.run
        expect(result).to be_a(Hash)
        expect(result[:inserted_recos]).to eq(0)
        expect(result[:errors]).to eq(0)
      end

      it 'loga "[ai-reco] DONE: created=N errors=M" no fim' do
        conn = conn_double
        allow(conn).to receive(:query).with(/SELECT s\.id.*FROM fixture_simulations/im).and_return([])
        runner = described_class.new(conn: conn, logger: logger, client: client)
        runner.run
        expect(logger_msgs.any? { |m| m.start_with?('[ai-reco] DONE:') }).to be(true)
      end

      it 'inserted_recos é 0 em dry_run mode (não persiste)' do
        sim_row = {
          'fixture_id' => '1', 'home_team' => 'A', 'away_team' => 'B',
          'league' => 'L', 'kickoff_utc' => '2026-05-30T15:00:00Z',
          'p_home' => '0.60', 'p_draw' => '0.20', 'p_away' => '0.20',
          'p_over_25' => '0.60', 'p_btts' => '0.50',
          'top_scorelines' => '[]', 'sim_stats' => '{}',
          'detail_json' => JSON.generate(
            'odds_summary' => {
              'Result' => { 'A' => { 'decimal_odds' => 2.0 }, 'Draw' => { 'decimal_odds' => 3.5 }, 'B' => { 'decimal_odds' => 3.8 } }
            }
          )
        }
        conn = conn_double
        allow(conn).to receive(:query).with(/SELECT s\.id.*FROM fixture_simulations/im).and_return([sim_row])
        allow(conn).to receive(:query).with(/SELECT DISTINCT league\s+FROM league_parameters/im).and_return([])
        runner = described_class.new(conn: conn, logger: logger, client: client, dry_run: true)
        result = runner.run
        expect(result[:inserted_recos]).to eq(0)
      end
    end

    # ── Wave O+E: secondary stats extraction ────────────────────────────────────

    describe 'extract_sim — secondary stats (Wave O+E)' do
      let(:runner) { described_class.new(conn: conn_double, logger: logger, client: client, dry_run: true) }

      it 'extrai sim_corners_total_mean de sim_stats (home.p50 + away.p50)' do
        sim_stats = {
          'home' => { 'corners' => { 'p50' => 5.8 }, 'cards' => { 'p50' => 2.1 }, 'sot' => { 'p50' => 3.8 } },
          'away' => { 'corners' => { 'p50' => 4.7 }, 'cards' => { 'p50' => 2.2 }, 'sot' => { 'p50' => 2.9 } }
        }
        row = { 'p_home' => '0.5', 'p_draw' => '0.25', 'p_away' => '0.25',
                'p_over_25' => '0.6', 'p_btts' => '0.55',
                'sim_stats' => JSON.generate(sim_stats) }
        result = runner.send(:extract_sim, row)
        expect(result[:sim_corners_total_mean]).to be_within(0.01).of(10.5)
        expect(result[:sim_cards_total_mean]).to be_within(0.01).of(4.3)
        expect(result[:sim_sot_total_mean]).to be_within(0.01).of(6.7)
      end

      it 'sim_corners_total_mean é nil quando sim_stats está vazio' do
        row = { 'p_home' => '0.5', 'p_draw' => '0.25', 'p_away' => '0.25',
                'p_over_25' => '0.6', 'p_btts' => '0.55',
                'sim_stats' => '{}' }
        result = runner.send(:extract_sim, row)
        expect(result[:sim_corners_total_mean]).to be_nil
      end
    end

    describe 'extract_odds — secondary market odds (Wave O+E)' do
      let(:runner) { described_class.new(conn: conn_double, logger: logger, client: client, dry_run: true) }

      it 'extrai corners_over_95 e corners_under_95 do odds_summary' do
        detail = {
          'odds_summary' => {
            'Result' => {
              'A' => { 'decimal_odds' => 2.0 }, 'Draw' => { 'decimal_odds' => 3.5 }, 'B' => { 'decimal_odds' => 3.8 }
            },
            'Total Corners' => {
              'Over 9.5' => { 'decimal_odds' => 1.90 },
              'Under 9.5' => { 'decimal_odds' => 1.90 }
            },
            'Total Cards' => {
              'Over 4.5' => { 'decimal_odds' => 1.85 }
            },
            'Total shots on target' => {
              'Over 7.5' => { 'decimal_odds' => 1.95 },
              'Under 7.5' => { 'decimal_odds' => 1.85 }
            }
          }
        }
        row = { 'home_team' => 'A', 'away_team' => 'B', 'detail_json' => JSON.generate(detail) }
        result = runner.send(:extract_odds, row)
        expect(result[:corners_over_95]).to be_within(0.01).of(1.90)
        expect(result[:corners_under_95]).to be_within(0.01).of(1.90)
        expect(result[:cards_over_45]).to be_within(0.01).of(1.85)
        expect(result[:sot_over_75]).to be_within(0.01).of(1.95)
        expect(result[:sot_under_75]).to be_within(0.01).of(1.85)
      end

      it 'retorna nil para market key ausente' do
        detail = {
          'odds_summary' => {
            'Result' => {
              'A' => { 'decimal_odds' => 2.0 }, 'Draw' => { 'decimal_odds' => 3.5 }, 'B' => { 'decimal_odds' => 3.8 }
            }
          }
        }
        row = { 'home_team' => 'A', 'away_team' => 'B', 'detail_json' => JSON.generate(detail) }
        result = runner.send(:extract_odds, row)
        expect(result[:corners_over_95]).to be_nil
        expect(result[:cards_over_45]).to be_nil
        expect(result[:sot_over_75]).to be_nil
      end
    end

    describe 'LLM parse-error fallback copy' do
      it 'NAO vaza texto técnico em reasoning_full quando LLM falha' do
        # Regressão: ai_recommendations 309 (Fluminense), 194, 183, 136 tinham
        # reasoning_full = "failed to parse decision JSON (schema mismatch or
        # invalid JSON)" — vazava string interna do client pro card user-facing.
        runner = described_class.new(conn: conn_double, logger: logger, client: client, dry_run: true)
        row = { 'fixture_id' => 99, 'home_team' => 'A', 'away_team' => 'B',
                'league' => 'L', 'kickoff_utc' => '2026-05-30T15:00:00Z' }
        candidates = []
        failed_result = { ok: false, error: 'failed to parse decision JSON (schema mismatch or invalid JSON)' }

        captured_params = nil
        conn = instance_double(PG::Connection)
        result_double = double('PG::Result', first: nil)
        allow(conn).to receive(:exec_params) { |_sql, params| captured_params = params; result_double }

        runner.send(:insert_reco, conn, row, candidates, true, failed_result, nil, 0.0)

        # params order: ..., summary_line(22), reasoning_full(23), ...
        # RECO_INSERT_SQL: indices baseados no array passado
        summary_line = captured_params[22]
        reasoning_full = captured_params[23]

        expect(summary_line).to eq('Análise indisponível agora')
        expect(reasoning_full).to eq('A IA não conseguiu processar este jogo desta vez. Tente pedir uma nova análise em alguns minutos.')
        expect(reasoning_full).not_to include('failed to parse')
        expect(reasoning_full).not_to include('schema mismatch')
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
              'odds_summary' => {
                'Result' => {
                  'A' => { 'decimal_odds' => 2.0 },
                  'Draw' => { 'decimal_odds' => 3.5 },
                  'B' => { 'decimal_odds' => 3.8 }
                },
                'Match Goals Overs/Unders' => {
                  'Over 2.5' => { 'decimal_odds' => 1.85 },
                  'Under 2.5' => { 'decimal_odds' => 2.0 }
                },
                'BTTS' => {
                  'Yes' => { 'decimal_odds' => 1.8 },
                  'No' => { 'decimal_odds' => 2.1 }
                }
              }
            ) }
        ]
        conn = conn_double
        allow(conn).to receive(:query).with(/SELECT s\.id.*FROM fixture_simulations/im).and_return(sims)
        allow(conn).to receive(:query).with(/SELECT DISTINCT league\s+FROM league_parameters/im).and_return([])

        runner = described_class.new(conn: conn, logger: logger, client: client)
        expect { runner.run }.not_to raise_error
      end
    end

    # ── Parte 1: cobertura de skip desacoplada do orçamento de LLM ──────────────
    # O edge-calc roda em TODAS as fixtures da janela (skip é de graça, sem LLM),
    # mas o LLM só é chamado no máximo `llm_budget` vezes (corte de tokens).
    # Resultado: o badge "IA · sem valor" aparece mesmo fora do top-N, sem custo.
    describe 'orçamento de chamadas LLM (Parte 1 — skip-coverage)' do
      # Linha sem valor: odds tunadas pra todo candidato ficar com edge < 10%.
      def no_value_row(id)
        {
          'fixture_id' => id.to_s,
          'home_team' => 'A', 'away_team' => 'B', 'league' => 'L',
          'kickoff_utc' => '2026-05-30T15:00:00Z',
          'p_home' => '0.40', 'p_draw' => '0.30', 'p_away' => '0.30',
          'p_over_25' => '0.50', 'p_btts' => '0.50',
          'top_scorelines' => '[]', 'sim_stats' => '{}',
          'detail_json' => JSON.generate(
            'odds_summary' => {
              'Result' => {
                'A' => { 'decimal_odds' => 2.0 },
                'Draw' => { 'decimal_odds' => 3.0 },
                'B' => { 'decimal_odds' => 3.2 }
              },
              'Match Goals Overs/Unders' => {
                'Over 2.5' => { 'decimal_odds' => 2.0 },
                'Under 2.5' => { 'decimal_odds' => 1.85 }
              },
              'BTTS' => {
                'Yes' => { 'decimal_odds' => 1.9 },
                'No' => { 'decimal_odds' => 1.9 }
              }
            }
          )
        }
      end

      # Linha COM valor: btts/sim com edge ~24% (liga não-calibrada, abaixo do
      # SANITY 50 → não é pré-filtrada → chama a IA). Mesmo shape do teste
      # "CHAMA a IA quando edge<=50 em liga nao-calibrada".
      def value_row(id)
        {
          'fixture_id' => id.to_s,
          'home_team' => 'Home', 'away_team' => 'Away', 'league' => 'L',
          'kickoff_utc' => '2026-05-30T15:00:00Z',
          'p_home' => '0.40', 'p_draw' => '0.30', 'p_away' => '0.30',
          'p_over_25' => '0.50', 'p_btts' => '0.75',
          'top_scorelines' => '[]', 'sim_stats' => '{}',
          'detail_json' => JSON.generate(
            'odds_summary' => {
              'Result' => {
                'Home' => { 'decimal_odds' => 4.0 },
                'Draw' => { 'decimal_odds' => 4.0 },
                'Away' => { 'decimal_odds' => 2.0 }
              },
              'Match Goals Overs/Unders' => {
                'Over 2.5' => { 'decimal_odds' => 2.0 },
                'Under 2.5' => { 'decimal_odds' => 1.85 }
              },
              'BTTS' => {
                'Yes' => { 'decimal_odds' => 2.0 },
                'No' => { 'decimal_odds' => 1.9 }
              }
            }
          )
        }
      end

      def setup_conn(rows)
        conn = conn_double
        allow(conn).to receive(:query).with(/SELECT s\.id.*FROM fixture_simulations/im).and_return(rows)
        allow(conn).to receive(:query).with(/SELECT DISTINCT league\s+FROM league_parameters/im).and_return([])
        inserts = []
        allow(conn).to receive(:exec_params) do |sql, params|
          inserts << params if sql.include?('INSERT INTO ai_recommendations')
          [{ 'id' => 1 }]
        end
        [conn, inserts]
      end

      it 'chama o LLM no máximo `llm_budget` vezes mesmo com mais candidatos de valor' do
        rows = [value_row(1), value_row(2), value_row(3)]
        conn, inserts = setup_conn(rows)

        runner = described_class.new(conn: conn, logger: logger, client: client, llm_budget: 2)
        runner.run

        expect(client).to have_received(:call).exactly(2).times
        verdicts = inserts.map { |p| p[11] }
        expect(verdicts.count('bet')).to eq(2)
        expect(verdicts.count('skip')).to eq(0)
        # 3ª fixture de valor fica pra on-demand: nem LLM nem persist.
        expect(inserts.length).to eq(2)
      end

      it 'persiste skip pra fixtures sem valor SEM consumir o orçamento de LLM' do
        # Ordem: valor consome o único slot de LLM ANTES de um skip aparecer —
        # prova que skip continua sendo persistido após o orçamento esgotar.
        rows = [no_value_row(1), value_row(2), no_value_row(3), value_row(4)]
        conn, inserts = setup_conn(rows)

        runner = described_class.new(conn: conn, logger: logger, client: client, llm_budget: 1)
        runner.run

        expect(client).to have_received(:call).exactly(1).time
        verdicts = inserts.map { |p| p[11] }
        # 2 skips (de graça, mesmo o 2º vindo depois do orçamento esgotar) + 1 bet.
        expect(verdicts.count('skip')).to eq(2)
        expect(verdicts.count('bet')).to eq(1)
        # A 2ª fixture de valor (id 4) fica pra on-demand: sem insert.
        expect(inserts.length).to eq(3)
      end

      it 'usa LLM_CALL_BUDGET como default quando llm_budget não é passado' do
        expect(described_class::LLM_CALL_BUDGET).to be_a(Integer)
        expect(described_class::LLM_CALL_BUDGET).to be > 0
      end
    end
  end
end
