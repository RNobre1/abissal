require 'date'
require 'time'
require 'faraday'
require_relative 'db_helper'
require_relative '../../lib/scraper/simulation_reconciler'

# Espelha prediction_reconciler_spec.rb: testes principais com mocks (sem banco
# real) — rápidos e determinísticos. Acrescenta um bloco de integração com o
# test DB real (migration 0018 aplicada) pra confirmar que o SELECT/UPDATE
# batem no schema de fixture_simulations.
RSpec.describe AdamStats::Scraper::SimulationReconciler do
  # ── mocks e helpers ──────────────────────────────────────────────────────────

  let(:logger_msgs) { [] }
  let(:logger) { ->(m) { logger_msgs << m } }

  # Simulação pendente de um jogo que já ocorreu
  def pending_row(id: 1, home: 'Arsenal', away: 'Chelsea',
                  kickoff_iso: (Time.now.utc - 3600).iso8601,
                  fixture_api_id: 999,
                  p_home: 0.55, p_draw: 0.25, p_away: 0.20, p_over_25: 0.60)
    {
      'id' => id,
      'home_team' => home,
      'away_team' => away,
      'kickoff_utc' => kickoff_iso,
      'fixture_id' => fixture_api_id,
      'p_home' => p_home,
      'p_draw' => p_draw,
      'p_away' => p_away,
      'p_over_25' => p_over_25,
      'status' => 'pending'
    }
  end

  def finished_widget(home_goals: 2, away_goals: 1)
    {
      'fixture' => {
        'id' => 999,
        'status' => 'FT',
        'homeGoalsFt' => home_goals,
        'awayGoalsFt' => away_goals
      }
    }
  end

  def not_finished_widget
    {
      'fixture' => {
        'id' => 999,
        'status' => 'NS'
      }
    }
  end

  # ── testes (mock) ────────────────────────────────────────────────────────────

  describe '#run' do
    it 'preenche actual_* e computa correct_winner/over_under quando placar disponível' do
      row = pending_row(home: 'Arsenal', away: 'Chelsea')
      updates_captured = []

      db_conn = double('db_conn')
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/SELECT.*fixture_simulations.*status.*=.*'pending'/im), anything)
        .and_return(double('r', to_a: [row]))
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/UPDATE.*fixture_simulations/im), anything) do |_sql, params|
          updates_captured << params
          double('r', cmd_tuples: 1)
        end

      client = double('client')
      allow(client).to receive(:fetch_widget).and_return(finished_widget(home_goals: 2, away_goals: 1))

      reconciler = described_class.new(db_conn: db_conn, client: client, logger: logger)
      result = reconciler.run

      expect(result[:resolved]).to eq(1)
      expect(result[:pending]).to eq(0)
      expect(result[:unresolvable]).to eq(0)

      params = updates_captured.first
      # actual_home_goals=2, actual_away_goals=1; pred argmax=home (0.55) e
      # home venceu 2-1 → correct_winner=true; p_over_25=0.60>=0.5 → over,
      # total=3>2.5 → over → correct_over_under=true; status=resolved
      expect(params).to include(2, 1)
      expect(params).to include(true)
      expect(params).to include('resolved')
    end

    it 'correct_winner=false quando argmax=home mas away vence (0-2)' do
      row = pending_row
      updates_captured = []

      db_conn = double('db_conn')
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/SELECT.*status.*=.*'pending'/im), anything)
        .and_return(double('r', to_a: [row]))
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/UPDATE.*fixture_simulations/im), anything) do |_sql, params|
          updates_captured << params
          double('r', cmd_tuples: 1)
        end

      client = double('client')
      allow(client).to receive(:fetch_widget).and_return(finished_widget(home_goals: 0, away_goals: 2))

      reconciler = described_class.new(db_conn: db_conn, client: client, logger: logger)
      reconciler.run

      expect(updates_captured.first).to include(false)
    end

    it 'argmax escolhe draw quando p_draw é o maior e jogo empata' do
      row = pending_row(p_home: 0.20, p_draw: 0.55, p_away: 0.25)
      updates_captured = []

      db_conn = double('db_conn')
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/SELECT.*status.*=.*'pending'/im), anything)
        .and_return(double('r', to_a: [row]))
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/UPDATE.*fixture_simulations/im), anything) do |_sql, params|
          updates_captured << params
          double('r', cmd_tuples: 1)
        end

      client = double('client')
      allow(client).to receive(:fetch_widget).and_return(finished_widget(home_goals: 1, away_goals: 1))

      reconciler = described_class.new(db_conn: db_conn, client: client, logger: logger)
      reconciler.run

      # 1-1 empate, argmax=draw → correct_winner=true
      expect(updates_captured.first).to include(true)
    end

    it 'correct_over_under=false quando p_over_25<0.5 (under previsto) mas jogo é over' do
      row = pending_row(p_over_25: 0.30)
      updates_captured = []

      db_conn = double('db_conn')
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/SELECT.*status.*=.*'pending'/im), anything)
        .and_return(double('r', to_a: [row]))
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/UPDATE.*fixture_simulations/im), anything) do |_sql, params|
          updates_captured << params
          double('r', cmd_tuples: 1)
        end

      client = double('client')
      # 3-1 = 4 gols → over real; pred under (0.30<0.5) → mismatch
      allow(client).to receive(:fetch_widget).and_return(finished_widget(home_goals: 3, away_goals: 1))

      reconciler = described_class.new(db_conn: db_conn, client: client, logger: logger)
      reconciler.run

      params = updates_captured.first
      # correct_winner=true (home venceu, argmax home), correct_over_under=false
      expect(params).to include(true)
      expect(params).to include(false)
    end

    it 'jogo sem placar (status=NS) → mantém pending, não chama UPDATE com resolved' do
      row = pending_row
      update_called_with_resolved = false

      db_conn = double('db_conn')
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/SELECT.*status.*=.*'pending'/im), anything)
        .and_return(double('r', to_a: [row]))
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/UPDATE.*fixture_simulations/im), anything) do |_sql, params|
          update_called_with_resolved = params.include?('resolved')
          double('r', cmd_tuples: 0)
        end

      client = double('client')
      allow(client).to receive(:fetch_widget).and_return(not_finished_widget)

      reconciler = described_class.new(db_conn: db_conn, client: client, logger: logger)
      result = reconciler.run

      expect(result[:resolved]).to eq(0)
      expect(result[:pending]).to eq(1)
      expect(update_called_with_resolved).to be false
    end

    it 'idempotente: SELECT filtra status=pending — resolved/unsimulable não aparecem' do
      db_conn = double('db_conn')
      expect(db_conn).to receive(:exec_params)
        .with(a_string_matching(/fixture_simulations.*status.*=.*'pending'/im), anything)
        .and_return(double('r', to_a: []))

      client = double('client')
      reconciler = described_class.new(db_conn: db_conn, client: client, logger: logger)
      result = reconciler.run

      expect(result[:resolved]).to eq(0)
    end

    it 'após MAX_ATTEMPTS_DAYS sem placar → marca status=unresolvable' do
      old_kickoff = (Time.now.utc - (described_class::MAX_ATTEMPTS_DAYS + 1) * 86_400).iso8601
      row = pending_row(kickoff_iso: old_kickoff)

      updates_captured = []
      db_conn = double('db_conn')
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/SELECT.*status.*=.*'pending'/im), anything)
        .and_return(double('r', to_a: [row]))
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/UPDATE.*fixture_simulations/im), anything) do |_sql, params|
          updates_captured << params
          double('r', cmd_tuples: 1)
        end

      client = double('client')
      allow(client).to receive(:fetch_widget).and_return(not_finished_widget)

      reconciler = described_class.new(db_conn: db_conn, client: client, logger: logger)
      result = reconciler.run

      expect(result[:unresolvable]).to eq(1)
      expect(updates_captured.flatten).to include('unresolvable')
    end

    context 'quando fixture_id é NULL' do
      it 'row recente → mantém pending (não tenta API, não marca unresolvable)' do
        row = pending_row(kickoff_iso: (Time.now.utc - 3600).iso8601, fixture_api_id: nil)

        updates_captured = []
        db_conn = double('db_conn')
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/SELECT.*status.*=.*'pending'/im), anything)
          .and_return(double('r', to_a: [row]))
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/UPDATE.*fixture_simulations/im), anything) do |_sql, params|
            updates_captured << params
            double('r', cmd_tuples: 1)
          end

        client = double('client')
        expect(client).not_to receive(:fetch_widget)

        reconciler = described_class.new(db_conn: db_conn, client: client, logger: logger)
        result = reconciler.run

        expect(result[:pending]).to eq(1)
        expect(result[:unresolvable]).to eq(0)
        expect(updates_captured).to be_empty
      end

      it 'row com fixture_id NULL e stale → marca unresolvable' do
        old_kickoff = (Time.now.utc - (described_class::MAX_ATTEMPTS_DAYS + 1) * 86_400).iso8601
        row = pending_row(kickoff_iso: old_kickoff, fixture_api_id: nil)

        updates_captured = []
        db_conn = double('db_conn')
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/SELECT.*status.*=.*'pending'/im), anything)
          .and_return(double('r', to_a: [row]))
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/UPDATE.*fixture_simulations/im), anything) do |_sql, params|
            updates_captured << params
            double('r', cmd_tuples: 1)
          end

        client = double('client')
        expect(client).not_to receive(:fetch_widget)

        reconciler = described_class.new(db_conn: db_conn, client: client, logger: logger)
        result = reconciler.run

        expect(result[:unresolvable]).to eq(1)
        expect(result[:pending]).to eq(0)
        expect(updates_captured.flatten).to include('unresolvable')
      end
    end

    it 'erro de rede em um jogo → warning + skip; não derruba o batch' do
      rows = [
        pending_row(id: 1, fixture_api_id: 111),
        pending_row(id: 2, fixture_api_id: 222)
      ]

      db_conn = double('db_conn')
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/SELECT.*status.*=.*'pending'/im), anything)
        .and_return(double('r', to_a: rows))
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/UPDATE.*fixture_simulations/im), anything)
        .and_return(double('r', cmd_tuples: 1))

      client = double('client')
      call_count = 0
      allow(client).to receive(:fetch_widget) do
        call_count += 1
        raise Faraday::ConnectionFailed.new('network error') if call_count == 1

        finished_widget(home_goals: 1, away_goals: 0)
      end

      reconciler = described_class.new(db_conn: db_conn, client: client, logger: logger)
      expect { reconciler.run }.not_to raise_error

      expect(logger_msgs).to include(a_string_matching(/warn.*skip|error.*skip|network|failed/i))
    end
  end

  # ── integração com test DB real (migration 0018) ─────────────────────────────
  # Espelha o bloco real-DB do orchestrator_spec: aplica 0018 (idempotente) e
  # confirma que SELECT só pega 'pending' < now e nunca 'unsimulable'.
  describe 'integração com fixture_simulations real (test DB)' do
    before(:all) do
      ENV['DATABASE_URL'] = DBHelper.test_url
      ScraperDBHelper.ensure_schema!
      DBHelper.apply_migration!('0018_fixture_simulations.sql')
    end

    before(:each) do
      conn = DBHelper.connect
      conn.query('TRUNCATE TABLE fixture_simulations RESTART IDENTITY')
      conn.close
    end

    def insert_sim(status:, kickoff:, fixture_id: 12_345, home: 'Real', away: 'Barca',
                   p_home: 0.5, p_draw: 0.3, p_away: 0.2, p_over_25: 0.6)
      conn = DBHelper.connect
      conn.exec_params(
        'INSERT INTO fixture_simulations ' \
        '(fixture_id, home_team, away_team, kickoff_utc, model_version, ' \
        ' p_home, p_draw, p_away, p_over_25, status) ' \
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [fixture_id, home, away, kickoff, 'v-test', p_home, p_draw, p_away, p_over_25, status]
      )
      conn.close
    end

    def fetch_all
      conn = DBHelper.connect
      rows = conn.query('SELECT * FROM fixture_simulations ORDER BY id').to_a
      conn.close
      rows
    end

    it 'pending + FT real → resolved com correct_winner/over_under preenchidos' do
      insert_sim(status: 'pending', kickoff: (Time.now.utc - 3600),
                 p_home: 0.6, p_draw: 0.25, p_away: 0.15, p_over_25: 0.7)

      client = double('client')
      allow(client).to receive(:fetch_widget)
        .and_return(finished_widget(home_goals: 2, away_goals: 0))

      AdamStats::Scraper::SimulationReconciler
        .new(client: client, logger: logger).run

      row = fetch_all.first
      expect(row['status']).to eq('resolved')
      expect(row['actual_home_goals'].to_i).to eq(2)
      expect(row['actual_away_goals'].to_i).to eq(0)
      expect(row['correct_winner']).to eq('t')      # argmax=home, home venceu
      expect(row['correct_over_under']).to eq('f')  # pred over (0.7), total=2 → under
      expect(row['actual_resolved_at']).not_to be_nil
    end

    it 're-run após resolved é no-op (idempotente: SELECT só pega pending)' do
      insert_sim(status: 'pending', kickoff: (Time.now.utc - 3600))
      client = double('client')
      allow(client).to receive(:fetch_widget)
        .and_return(finished_widget(home_goals: 1, away_goals: 0))

      reconciler = AdamStats::Scraper::SimulationReconciler
                   .new(client: client, logger: logger)
      reconciler.run
      first = fetch_all.first

      reconciler.run # segunda passada
      second = fetch_all.first

      expect(second['status']).to eq('resolved')
      expect(second['actual_resolved_at']).to eq(first['actual_resolved_at'])
    end

    it "rows status='unsimulable' nunca são selecionadas (ficam intactas)" do
      insert_sim(status: 'unsimulable', kickoff: (Time.now.utc - 7200))

      client = double('client')
      expect(client).not_to receive(:fetch_widget)

      AdamStats::Scraper::SimulationReconciler
        .new(client: client, logger: logger).run

      row = fetch_all.first
      expect(row['status']).to eq('unsimulable')
      expect(row['actual_resolved_at']).to be_nil
    end

    it 'sem placar ainda → permanece pending' do
      insert_sim(status: 'pending', kickoff: (Time.now.utc - 3600))

      client = double('client')
      allow(client).to receive(:fetch_widget).and_return(not_finished_widget)

      AdamStats::Scraper::SimulationReconciler
        .new(client: client, logger: logger).run

      expect(fetch_all.first['status']).to eq('pending')
    end

    it 'stale sem placar → unresolvable' do
      old = Time.now.utc - (described_class::MAX_ATTEMPTS_DAYS + 1) * 86_400
      insert_sim(status: 'pending', kickoff: old)

      client = double('client')
      allow(client).to receive(:fetch_widget).and_return(not_finished_widget)

      AdamStats::Scraper::SimulationReconciler
        .new(client: client, logger: logger).run

      expect(fetch_all.first['status']).to eq('unresolvable')
    end
  end
end
