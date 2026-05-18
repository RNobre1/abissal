require 'date'
require 'time'
require_relative '../../lib/scraper/prediction_reconciler'

# Nota: testes com mocks (sem banco real).
# O reconciler usa DB.with_connection e ChoistatsApiClient mockados.
# Para integração real, ver db_helper.rb — não incluído aqui para manter
# o spec rápido e determinístico.

RSpec.describe AdamStats::Scraper::PredictionReconciler do
  # ── mocks e helpers ──────────────────────────────────────────────────────────

  let(:logger_msgs) { [] }
  let(:logger) { ->(m) { logger_msgs << m } }

  # Predição pendente de um jogo que já ocorreu
  def pending_row(id: 1, home: 'Arsenal', away: 'Chelsea',
                  kickoff_iso: (Time.now.utc - 3600).iso8601,
                  fixture_api_id: 999)
    {
      'id' => id,
      'home_team' => home,
      'away_team' => away,
      'kickoff_utc' => kickoff_iso,
      'pred_winner' => 'home',
      'pred_confidence' => 0.72,
      'pred_over_under' => 'over',
      'fixture_id' => fixture_api_id,
      'status' => 'pending'
    }
  end

  # Resposta mockada do widget recent_results para um jogo finalizado (FT)
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

  # Resposta mockada do widget para um jogo ainda não concluído
  def not_finished_widget
    {
      'fixture' => {
        'id' => 999,
        'status' => 'NS'
        # sem homeGoalsFt / awayGoalsFt
      }
    }
  end

  def build_reconciler(pending_rows:, widget_response: nil, update_result: { rowcount: 1 })
    db_conn = double('db_conn')

    # SELECT pendentes
    select_result = double('select_result', to_a: pending_rows)
    allow(db_conn).to receive(:exec_params)
      .with(a_string_matching(/SELECT.*status.*=.*'pending'/im), anything)
      .and_return(select_result)

    # UPDATE (via exec_params ou query)
    allow(db_conn).to receive(:exec_params)
      .with(a_string_matching(/UPDATE.*ai_predictions/im), anything)
      .and_return(double('update_result', cmd_tuples: update_result[:rowcount]))

    client = double('choistats_client')
    if widget_response
      allow(client).to receive(:fetch_widget)
        .with(:recent_results, fixture_id: anything)
        .and_return(widget_response)
    end

    described_class.new(db_conn: db_conn, client: client, logger: logger)
  end

  # ── testes ───────────────────────────────────────────────────────────────────

  describe '#run' do
    it 'preenche actual_* e computa correct_winner/over_under quando placar está disponível' do
      row = pending_row(home: 'Arsenal', away: 'Chelsea')
      reconciler = build_reconciler(
        pending_rows: [row],
        widget_response: finished_widget(home_goals: 2, away_goals: 1)
      )

      result = reconciler.run
      expect(result[:resolved]).to eq(1)
      expect(result[:pending]).to eq(0)
      expect(result[:unresolvable]).to eq(0)
    end

    it 'computa correct_winner=true quando pred_winner="home" e home vence (2-1)' do
      row = pending_row
      updates_captured = []

      db_conn = double('db_conn')
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/SELECT.*status.*=.*'pending'/im), anything)
        .and_return(double('r', to_a: [row]))
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/UPDATE.*ai_predictions/im), anything) do |_sql, params|
          updates_captured << params
          double('r', cmd_tuples: 1)
        end

      client = double('client')
      allow(client).to receive(:fetch_widget).and_return(finished_widget(home_goals: 2, away_goals: 1))

      reconciler = described_class.new(db_conn: db_conn, client: client, logger: logger)
      reconciler.run

      # Params devem incluir: actual_home_goals=2, actual_away_goals=1,
      # correct_winner=true, correct_over_under=true (2+1=3>2.5→over, pred=over),
      # status='resolved', id=row['id']
      expect(updates_captured).not_to be_empty
      params = updates_captured.first
      expect(params).to include(2, 1)    # home_goals, away_goals
      expect(params).to include(true)    # correct_winner
      expect(params).to include('resolved')
    end

    it 'computa correct_winner=false quando pred=home mas away vence (0-2)' do
      row = pending_row
      updates_captured = []

      db_conn = double('db_conn')
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/SELECT.*status.*=.*'pending'/im), anything)
        .and_return(double('r', to_a: [row]))
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/UPDATE.*ai_predictions/im), anything) do |_sql, params|
          updates_captured << params
          double('r', cmd_tuples: 1)
        end

      client = double('client')
      allow(client).to receive(:fetch_widget).and_return(finished_widget(home_goals: 0, away_goals: 2))

      reconciler = described_class.new(db_conn: db_conn, client: client, logger: logger)
      reconciler.run

      params = updates_captured.first
      expect(params).to include(false)   # correct_winner = false
    end

    it 'jogo sem placar (status=NS) → mantém pending (não chama UPDATE com resolved)' do
      row = pending_row
      update_called_with_resolved = false

      db_conn = double('db_conn')
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/SELECT.*status.*=.*'pending'/im), anything)
        .and_return(double('r', to_a: [row]))
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/UPDATE.*ai_predictions/im), anything) do |_sql, params|
          update_called_with_resolved = params.include?('resolved')
          double('r', cmd_tuples: 0)
        end

      client = double('client')
      allow(client).to receive(:fetch_widget).and_return(not_finished_widget)

      reconciler = described_class.new(db_conn: db_conn, client: client, logger: logger)
      result = reconciler.run

      expect(result[:resolved]).to eq(0)
      expect(update_called_with_resolved).to be false
    end

    it 'idempotente: linhas já resolvidas (status=resolved) são ignoradas na query' do
      # O SELECT já filtra status='pending' — linhas resolved não aparecem.
      # Este teste verifica que o SELECT inclui o filtro correto.
      db_conn = double('db_conn')
      select_result = double('r', to_a: [])

      expect(db_conn).to receive(:exec_params)
        .with(a_string_matching(/status.*=.*'pending'/im), anything)
        .and_return(select_result)

      client = double('client')
      reconciler = described_class.new(db_conn: db_conn, client: client, logger: logger)
      result = reconciler.run

      expect(result[:resolved]).to eq(0)
    end

    it 'após MAX_ATTEMPTS_DAYS dias sem placar → marca status=unresolvable' do
      old_kickoff = (Time.now.utc - (described_class::MAX_ATTEMPTS_DAYS + 1) * 86_400).iso8601
      row = pending_row(kickoff_iso: old_kickoff)

      updates_captured = []
      db_conn = double('db_conn')
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/SELECT.*status.*=.*'pending'/im), anything)
        .and_return(double('r', to_a: [row]))
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/UPDATE.*ai_predictions/im), anything) do |_sql, params|
          updates_captured << params
          double('r', cmd_tuples: 1)
        end

      client = double('client')
      # Mesmo sem placar disponível, age old → marca unresolvable
      allow(client).to receive(:fetch_widget).and_return(not_finished_widget)

      reconciler = described_class.new(db_conn: db_conn, client: client, logger: logger)
      result = reconciler.run

      expect(result[:unresolvable]).to eq(1)
      params_flat = updates_captured.flatten
      expect(params_flat).to include('unresolvable')
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
        .with(a_string_matching(/UPDATE.*ai_predictions/im), anything)
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
end
