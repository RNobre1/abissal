require 'spec_helper'
require 'time'
require_relative '../../lib/scraper/ai_recommendation_reconciler'

# Espelha o pattern de simulation_reconciler_spec.rb — mocks (sem DB real).
# Cobre cada mercado/lado individualmente + verdict=skip + caminhos de erro.
RSpec.describe AdamStats::Scraper::AiRecommendationReconciler do
  let(:logger_msgs) { [] }
  let(:logger) { ->(m) { logger_msgs << m } }

  def pending_row(overrides = {})
    {
      'id' => 1,
      'fixture_id' => 999,
      'kickoff_utc' => (Time.now.utc - 3600).iso8601,
      'verdict' => 'bet',
      'market' => '1x2',
      'side' => 'home',
      'odd_captured' => 2.10,
      'units_final' => 1.5
    }.merge(overrides)
  end

  def finished_widget(home_goals:, away_goals:)
    { 'fixture' => { 'id' => 999, 'status' => 'FT',
                     'homeGoalsFt' => home_goals, 'awayGoalsFt' => away_goals } }
  end

  def not_finished_widget
    { 'fixture' => { 'id' => 999, 'status' => 'NS' } }
  end

  # Widget FT com o entry do jogo em recentHomeResults (stats secundários).
  def finished_widget_with_stats(home_goals:, away_goals:, **stats)
    entry = {
      'id' => 999, 'status' => 'FT',
      'homeGoalsFt' => home_goals, 'awayGoalsFt' => away_goals
    }.merge(stats.transform_keys(&:to_s))
    {
      'fixture' => { 'id' => 999, 'status' => 'FT',
                     'homeGoalsFt' => home_goals, 'awayGoalsFt' => away_goals },
      'recentHomeResults' => [entry]
    }
  end

  # Stub helper: mocks the SELECT to return given rows and captures all UPDATE params.
  def run_with(rows:, widget:)
    updates = []
    db_conn = double('db_conn')
    allow(db_conn).to receive(:exec_params)
      .with(a_string_matching(/SELECT.*ai_recommendations/im), anything)
      .and_return(double('r', to_a: rows))
    allow(db_conn).to receive(:exec_params)
      .with(a_string_matching(/UPDATE.*ai_recommendations/im), anything) do |_sql, params|
        updates << params
        double('r', cmd_tuples: 1)
      end

    client = double('client')
    allow(client).to receive(:fetch_widget).and_return(widget)

    described_class.new(db_conn: db_conn, client: client, logger: logger).run
    updates
  end

  # ── happy path ────────────────────────────────────────────────────────────

  describe '#run resolve happy path' do
    it 'marca status=resolved e calcula PL positivo quando bet ganha (1x2-home, home vence)' do
      updates = run_with(rows: [pending_row], widget: finished_widget(home_goals: 2, away_goals: 1))
      params = updates.first
      # Espera: actual_home, actual_away, bet_won, pl_units, status, id
      expect(params).to include(2, 1, true, 'resolved')
      # PL: won → (2.10 - 1) * 1.5 = 1.65
      expect(params).to include(a_value_within(0.001).of(1.65))
    end

    it 'calcula PL negativo quando bet perde (1x2-home, away vence)' do
      updates = run_with(rows: [pending_row], widget: finished_widget(home_goals: 0, away_goals: 2))
      params = updates.first
      expect(params).to include(0, 2, false, 'resolved')
      # PL lost: -1.5
      expect(params).to include(a_value_within(0.001).of(-1.5))
    end
  end

  # ── 1x2 ──────────────────────────────────────────────────────────────────

  describe '1x2-draw' do
    it 'bet_won=true quando empate' do
      row = pending_row('market' => '1x2', 'side' => 'draw', 'odd_captured' => 3.5, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 1, away_goals: 1))
      expect(updates.first).to include(true)
      # PL: (3.5-1)*1.0 = 2.5
      expect(updates.first).to include(a_value_within(0.001).of(2.5))
    end

    it 'bet_won=false quando não empate' do
      row = pending_row('market' => '1x2', 'side' => 'draw', 'odd_captured' => 3.5, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 2, away_goals: 1))
      expect(updates.first).to include(false)
      expect(updates.first).to include(a_value_within(0.001).of(-1.0))
    end
  end

  describe '1x2-away' do
    it 'bet_won=true quando away vence' do
      row = pending_row('market' => '1x2', 'side' => 'away', 'odd_captured' => 3.0, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 0, away_goals: 2))
      expect(updates.first).to include(true)
      expect(updates.first).to include(a_value_within(0.001).of(2.0))
    end

    it 'bet_won=false quando home vence' do
      row = pending_row('market' => '1x2', 'side' => 'away', 'odd_captured' => 3.0, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 2, away_goals: 0))
      expect(updates.first).to include(false)
    end
  end

  # ── over25 ───────────────────────────────────────────────────────────────

  describe 'over25-over' do
    it 'bet_won=true quando total > 2 (3+ gols)' do
      row = pending_row('market' => 'over25', 'side' => 'over', 'odd_captured' => 1.85, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 2, away_goals: 1))
      expect(updates.first).to include(true)
      # PL: (1.85-1)*1 = 0.85
      expect(updates.first).to include(a_value_within(0.001).of(0.85))
    end

    it 'bet_won=false quando total <= 2 (2 gols exatos)' do
      row = pending_row('market' => 'over25', 'side' => 'over', 'odd_captured' => 1.85, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 1, away_goals: 1))
      expect(updates.first).to include(false)
    end
  end

  describe 'over25-under' do
    it 'bet_won=true quando total <= 2 (1-1)' do
      row = pending_row('market' => 'over25', 'side' => 'under', 'odd_captured' => 2.0, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 1, away_goals: 1))
      expect(updates.first).to include(true)
    end

    it 'bet_won=false quando total > 2' do
      row = pending_row('market' => 'over25', 'side' => 'under', 'odd_captured' => 2.0, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 2, away_goals: 1))
      expect(updates.first).to include(false)
    end

    it 'bet_won=true quando 0-0 (total = 0)' do
      row = pending_row('market' => 'over25', 'side' => 'under', 'odd_captured' => 2.0, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 0, away_goals: 0))
      expect(updates.first).to include(true)
    end
  end

  # ── btts ─────────────────────────────────────────────────────────────────

  describe 'btts-sim' do
    it 'bet_won=true quando ambos marcam (2-1)' do
      row = pending_row('market' => 'btts', 'side' => 'sim', 'odd_captured' => 1.80, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 2, away_goals: 1))
      expect(updates.first).to include(true)
    end

    it 'bet_won=false quando 1-0 (away não marcou)' do
      row = pending_row('market' => 'btts', 'side' => 'sim', 'odd_captured' => 1.80, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 1, away_goals: 0))
      expect(updates.first).to include(false)
    end

    it 'bet_won=false quando 0-0' do
      row = pending_row('market' => 'btts', 'side' => 'sim', 'odd_captured' => 1.80, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 0, away_goals: 0))
      expect(updates.first).to include(false)
    end
  end

  describe 'btts-nao' do
    it 'bet_won=true quando 1-0 (away não marcou)' do
      row = pending_row('market' => 'btts', 'side' => 'nao', 'odd_captured' => 2.10, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 1, away_goals: 0))
      expect(updates.first).to include(true)
    end

    it 'bet_won=true quando 0-0' do
      row = pending_row('market' => 'btts', 'side' => 'nao', 'odd_captured' => 2.10, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 0, away_goals: 0))
      expect(updates.first).to include(true)
    end

    it 'bet_won=false quando 1-1' do
      row = pending_row('market' => 'btts', 'side' => 'nao', 'odd_captured' => 2.10, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 1, away_goals: 1))
      expect(updates.first).to include(false)
    end
  end

  # ── corners (side = linha × 10; total = home + away) ───────────────────────

  describe 'corners-under' do
    it 'bet_won=true quando total < 8.5 (side 85)' do
      row = pending_row('market' => 'corners-under', 'side' => '85', 'odd_captured' => 2.0, 'units_final' => 1.0)
      w = finished_widget_with_stats(home_goals: 1, away_goals: 0, homeCorners: 4, awayCorners: 3)
      expect(run_with(rows: [row], widget: w).first).to include(true, 'resolved')
    end

    it 'bet_won=false quando total > 8.5' do
      row = pending_row('market' => 'corners-under', 'side' => '85', 'odd_captured' => 2.0, 'units_final' => 1.0)
      w = finished_widget_with_stats(home_goals: 1, away_goals: 0, homeCorners: 9, awayCorners: 2)
      expect(run_with(rows: [row], widget: w).first).to include(false, 'resolved')
    end
  end

  describe 'corners-over' do
    it 'bet_won=true quando total > 10.5 (side 105)' do
      row = pending_row('market' => 'corners-over', 'side' => '105', 'odd_captured' => 1.9, 'units_final' => 1.0)
      w = finished_widget_with_stats(home_goals: 2, away_goals: 2, homeCorners: 7, awayCorners: 5)
      expect(run_with(rows: [row], widget: w).first).to include(true, 'resolved')
    end
  end

  # ── shots on target ────────────────────────────────────────────────────────

  describe 'sot-under' do
    it 'bet_won=true quando total < 7.5 (side 75)' do
      row = pending_row('market' => 'sot-under', 'side' => '75', 'odd_captured' => 2.0, 'units_final' => 1.0)
      w = finished_widget_with_stats(home_goals: 0, away_goals: 0, homeShotsOnTarget: 3, awayShotsOnTarget: 2)
      expect(run_with(rows: [row], widget: w).first).to include(true, 'resolved')
    end

    it 'bet_won=false quando total > 7.5' do
      row = pending_row('market' => 'sot-under', 'side' => '75', 'odd_captured' => 2.0, 'units_final' => 1.0)
      w = finished_widget_with_stats(home_goals: 3, away_goals: 0, homeShotsOnTarget: 15, awayShotsOnTarget: 1)
      expect(run_with(rows: [row], widget: w).first).to include(false, 'resolved')
    end
  end

  # ── cards (yellows + reds; side = linha × 10) ───────────────────────────────

  describe 'cards-over' do
    it 'bet_won=true quando total cartões > 4.5 (side 45)' do
      row = pending_row('market' => 'cards-over', 'side' => '45', 'odd_captured' => 2.0, 'units_final' => 1.0)
      w = finished_widget_with_stats(home_goals: 1, away_goals: 1,
                                     homeYellows: 3, homeReds: 0, awayYellows: 2, awayReds: 1)
      # total = 3 + 0 + 2 + 1 = 6 > 4.5
      expect(run_with(rows: [row], widget: w).first).to include(true, 'resolved')
    end

    it 'bet_won=false quando total cartões < 4.5' do
      row = pending_row('market' => 'cards-over', 'side' => '45', 'odd_captured' => 2.0, 'units_final' => 1.0)
      w = finished_widget_with_stats(home_goals: 1, away_goals: 1,
                                     homeYellows: 1, homeReds: 0, awayYellows: 2, awayReds: 0)
      expect(run_with(rows: [row], widget: w).first).to include(false, 'resolved')
    end
  end

  # ── stat secundário indisponível → NÃO marca false-loss ────────────────────

  describe 'mercado secundário sem stat disponível' do
    it 'NÃO resolve (fica pending) quando widget não traz corners (sem recentHomeResults)' do
      row = pending_row('market' => 'corners-under', 'side' => '85', 'odd_captured' => 2.0, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 1, away_goals: 0))
      expect(updates.any? { |p| p.include?('resolved') }).to be false
    end

    it 'marca unresolvable quando stale e sem stat secundário' do
      stale = (Time.now.utc - (described_class::MAX_ATTEMPTS_DAYS + 1) * 86_400).iso8601
      row = pending_row('market' => 'corners-under', 'side' => '85', 'kickoff_utc' => stale,
                        'odd_captured' => 2.0, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 1, away_goals: 0))
      expect(updates.flatten).to include('unresolvable')
    end
  end

  # ── side desconhecido → tri-state (NUNCA grada no lado oposto) ─────────────
  #
  # O contrato tri-state da Lição B19 valia só pro MARKET; o SIDE caía em
  # ternário (`side == 'over' ? ... : ...`), então qualquer valor não-canônico
  # vindo do LLM ('yes', 'sim' em over25, typo) era gradado como se a aposta
  # fosse no lado OPOSTO — inventando vitória ou derrota que ninguém apostou.

  describe 'side não-canônico' do
    it 'over25 com side "yes" NÃO resolve (não grada como under)' do
      row = pending_row('market' => 'over25', 'side' => 'yes', 'odd_captured' => 1.85, 'units_final' => 1.0)
      # 1-1 = 2 gols: sob o bug, "yes" cairia no ramo under e viraria VITÓRIA.
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 1, away_goals: 1))
      expect(updates.any? { |p| p.include?('resolved') }).to be false
    end

    it 'btts com side "yes" NÃO resolve (não grada como nao)' do
      row = pending_row('market' => 'btts', 'side' => 'yes', 'odd_captured' => 1.80, 'units_final' => 1.0)
      # 1-0: sob o bug, "yes" cairia no ramo !both e viraria VITÓRIA.
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 1, away_goals: 0))
      expect(updates.any? { |p| p.include?('resolved') }).to be false
    end

    it '1x2 com side desconhecido NÃO resolve (comportamento já correto — regressão)' do
      row = pending_row('market' => '1x2', 'side' => 'casa', 'odd_captured' => 2.1, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 2, away_goals: 1))
      expect(updates.any? { |p| p.include?('resolved') }).to be false
    end

    it 'marca unresolvable quando side desconhecido e já passou MAX_ATTEMPTS_DAYS' do
      stale = (Time.now.utc - (described_class::MAX_ATTEMPTS_DAYS + 1) * 86_400).iso8601
      row = pending_row('market' => 'over25', 'side' => 'yes', 'kickoff_utc' => stale,
                        'odd_captured' => 1.85, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 1, away_goals: 1))
      expect(updates.flatten).to include('unresolvable')
    end
  end

  # ── odd_captured ausente/inválida → irresolvível ──────────────────────────
  #
  # `odd_captured` NULL virava 0.0 no compute_pl, e uma aposta GANHA recebia
  # (0.0 - 1.0) * units = -units: vitória contabilizada como derrota no ROI.
  # Resolver só as derrotas (deixando as vitórias de fora) enviesaria o ROI
  # pra baixo, então odd inválida é irresolvível nos DOIS casos.

  describe 'odd_captured ausente ou inválida' do
    it 'bet GANHA com odd_captured nil NÃO resolve (não vira PL negativo)' do
      row = pending_row('odd_captured' => nil, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 2, away_goals: 1))
      expect(updates.any? { |p| p.include?('resolved') }).to be false
      expect(updates.flatten).not_to include(a_value_within(0.001).of(-1.0))
    end

    it 'bet PERDIDA com odd_captured nil NÃO resolve (evita viés só-derrotas no ROI)' do
      row = pending_row('odd_captured' => nil, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 0, away_goals: 2))
      expect(updates.any? { |p| p.include?('resolved') }).to be false
    end

    it 'odd_captured <= 1.0 é inválida (odd decimal é sempre > 1) e NÃO resolve' do
      row = pending_row('odd_captured' => 1.0, 'units_final' => 1.0)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 2, away_goals: 1))
      expect(updates.any? { |p| p.include?('resolved') }).to be false
    end

    it 'verdict=skip com odd nula segue resolvendo normal (não é aposta)' do
      row = pending_row('verdict' => 'skip', 'market' => nil, 'side' => nil,
                        'odd_captured' => nil, 'units_final' => nil)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 2, away_goals: 1))
      expect(updates.first).to include('resolved')
    end
  end

  # ── skip ─────────────────────────────────────────────────────────────────

  describe 'verdict=skip' do
    it 'marca resolved com bet_won/pl_units nulos (sem aposta)' do
      row = pending_row('verdict' => 'skip', 'market' => nil, 'side' => nil,
                        'odd_captured' => nil, 'units_final' => nil)
      updates = run_with(rows: [row], widget: finished_widget(home_goals: 2, away_goals: 1))
      params = updates.first
      # bet_won e pl_units devem ser nil; status='resolved'
      expect(params).to include('resolved')
      expect(params).to include(nil) # bet_won
      # actual_*_goals preenchidos
      expect(params).to include(2, 1)
    end
  end

  # ── error paths ──────────────────────────────────────────────────────────

  describe 'paths sem placar' do
    it 'jogo sem placar (status=NS) → mantém pending' do
      updates = run_with(rows: [pending_row], widget: not_finished_widget)
      # NENHUM update deve ter sido feito com status='resolved'
      expect(updates.any? { |p| p.include?('resolved') }).to be false
    end

    it 'após MAX_ATTEMPTS_DAYS sem placar → marca status=unresolvable' do
      stale_kickoff = (Time.now.utc - (described_class::MAX_ATTEMPTS_DAYS + 1) * 86_400).iso8601
      row = pending_row('kickoff_utc' => stale_kickoff)
      updates = run_with(rows: [row], widget: not_finished_widget)
      expect(updates.flatten).to include('unresolvable')
    end

    it 'fixture_id NULL e recente → mantém pending (não tenta API)' do
      row = pending_row('fixture_id' => nil,
                        'kickoff_utc' => (Time.now.utc - 3600).iso8601)
      db_conn = double('db_conn')
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/SELECT.*ai_recommendations/im), anything)
        .and_return(double('r', to_a: [row]))
      updates = []
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/UPDATE.*ai_recommendations/im), anything) do |_sql, params|
          updates << params
          double('r', cmd_tuples: 1)
        end
      client = double('client')
      expect(client).not_to receive(:fetch_widget)

      described_class.new(db_conn: db_conn, client: client, logger: logger).run
      expect(updates).to be_empty
    end
  end

  describe 'erro por linha não derruba batch' do
    it 'isolated rescue: 1 row com client error não impede 2ª row resolver' do
      row_bad = pending_row('id' => 99, 'fixture_id' => 111)
      row_good = pending_row('id' => 100, 'fixture_id' => 222)

      db_conn = double('db_conn')
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/SELECT.*ai_recommendations/im), anything)
        .and_return(double('r', to_a: [row_bad, row_good]))
      updates = []
      allow(db_conn).to receive(:exec_params)
        .with(a_string_matching(/UPDATE.*ai_recommendations/im), anything) do |_sql, params|
          updates << params
          double('r', cmd_tuples: 1)
        end

      client = double('client')
      allow(client).to receive(:fetch_widget) do |_widget, fixture_id:|
        raise StandardError, 'boom' if fixture_id == 111

        finished_widget(home_goals: 2, away_goals: 1)
      end

      expect {
        described_class.new(db_conn: db_conn, client: client, logger: logger).run
      }.not_to raise_error

      # 2ª linha (row_good) deve ter resolvido
      expect(updates.flatten).to include('resolved')
    end
  end

  # ── SELECT contract ──────────────────────────────────────────────────────

  describe 'SELECT filtra status=pending' do
    it 'NÃO seleciona resolved/unresolvable' do
      db_conn = double('db_conn')
      expect(db_conn).to receive(:exec_params)
        .with(a_string_matching(/ai_recommendations.*status.*=.*'pending'/im), anything)
        .and_return(double('r', to_a: []))

      client = double('client')
      described_class.new(db_conn: db_conn, client: client, logger: logger).run
    end
  end
end

# Nota: usamos `a_value_within(...).of(...)` (matcher built-in do RSpec) em vez de
# definir um custom `within` (que conflitava com `RSpec::Matchers#match`/`matches?`).
