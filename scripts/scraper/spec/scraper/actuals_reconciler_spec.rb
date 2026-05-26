require 'time'
require_relative '../../lib/scraper/actuals/reconciler'

RSpec.describe AdamStats::Scraper::Actuals::Reconciler do
  let(:logger_msgs) { [] }
  let(:logger) { ->(m) { logger_msgs << m } }

  # ── helpers ───────────────────────────────────────────────────────────────────

  def pending_row(id: 1, fixture_id: 999, home_team: 'Arsenal', away_team: 'Chelsea',
                  kickoff_utc: (Time.now.utc - 7200).iso8601,  # 2h atrás
                  league: 'Premier League', country: 'england',
                  actual_home_goals: 2, actual_away_goals: 1)
    {
      'id' => id,
      'fixture_id' => fixture_id,
      'home_team' => home_team,
      'away_team' => away_team,
      'kickoff_utc' => kickoff_utc,
      'league' => league,
      'country' => country,
      'actual_home_goals' => actual_home_goals,
      'actual_away_goals' => actual_away_goals
    }
  end

  def parsed_stats(home_sot: 5, home_corners: 7, home_cards: 2,
                   away_sot: 3, away_corners: 4, away_cards: 1)
    {
      home: { sot: home_sot, corners: home_corners, cards: home_cards },
      away: { sot: away_sot, corners: away_corners, cards: away_cards }
    }
  end

  def build_reconciler(pending_rows:, af_fixture_id: 55555,
                       stats_result: nil,
                       resolver_returns: :af_id,  # :af_id | :nil
                       quota_ok: true)
    db_conn = double('db_conn')

    # SELECT pending
    allow(db_conn).to receive(:exec_params)
      .with(a_string_matching(/FROM fixture_simulations.*actual_corners_home IS NULL/im), anything)
      .and_return(double('r', to_a: pending_rows))

    # UPDATE actuals
    allow(db_conn).to receive(:exec_params)
      .with(a_string_matching(/UPDATE fixture_simulations.*actual_data_source/im), anything)
      .and_return(double('r', cmd_tuples: 1))

    # UPDATE unresolvable
    allow(db_conn).to receive(:exec_params)
      .with(a_string_matching(/UPDATE fixture_simulations.*unresolvable/im), anything)
      .and_return(double('r', cmd_tuples: 1))

    client = double('ApiFootballClient')
    if quota_ok
      allow(client).to receive(:quota_remaining).and_return(80)
    else
      allow(client).to receive(:quota_remaining).and_return(3)
    end

    resolved_id = resolver_returns == :af_id ? af_fixture_id : nil
    resolver = double('FixtureResolver')
    allow(resolver).to receive(:resolve).and_return(resolved_id)

    if stats_result
      allow(client).to receive(:fixture_statistics)
        .and_return(stats_result)
    end

    parser = double('StatisticsParser')
    if stats_result
      allow(parser).to receive(:parse).and_return(parsed_stats)
    end

    described_class.new(
      db_conn: db_conn,
      client: client,
      resolver: resolver,
      logger: logger
    )
  end

  # ── testes principais ─────────────────────────────────────────────────────────

  describe '#run' do
    context 'quando API_FOOTBALL_KEY está ausente' do
      it 'retorna { skipped: "no_key" } sem tocar o banco' do
        reconciler = described_class.new(
          db_conn: double('db_conn'),
          client: nil,
          resolver: nil,
          logger: logger
        )

        result = reconciler.run
        expect(result).to eq({ skipped: 'no_key' })
      end
    end

    context 'quota esgotada (< 5 reqs restantes)' do
      it 'retorna { skipped: "quota_exhausted" } sem processar fixtures' do
        reconciler = build_reconciler(
          pending_rows: [pending_row],
          quota_ok: false
        )

        result = reconciler.run
        expect(result).to include(quota_exhausted: 1)
        expect(result[:resolved]).to be_nil.or eq(0)
      end
    end

    context 'fixture com liga não mapeada' do
      it 'marca unsupported_league e continua' do
        row = pending_row(league: 'Super Liga Galáctica', country: 'earth')
        db_conn = double('db_conn')
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/FROM fixture_simulations/im), anything)
          .and_return(double('r', to_a: [row]))
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/UPDATE fixture_simulations/im), anything)
          .and_return(double('r', cmd_tuples: 1))

        client = double('ApiFootballClient')
        allow(client).to receive(:quota_remaining).and_return(80)

        reconciler = described_class.new(
          db_conn: db_conn,
          client: client,
          resolver: double('resolver'),
          logger: logger
        )

        result = reconciler.run
        expect(result[:unsupported_league]).to eq(1)
        expect(result[:resolved]).to eq(0)
      end
    end

    context 'resolver retorna nil (fixture não encontrada na API)' do
      it 'marca mapping_failed e continua' do
        db_conn = double('db_conn')
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/FROM fixture_simulations/im), anything)
          .and_return(double('r', to_a: [pending_row]))
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/UPDATE fixture_simulations/im), anything)
          .and_return(double('r', cmd_tuples: 1))

        client = double('ApiFootballClient')
        allow(client).to receive(:quota_remaining).and_return(80)

        resolver = double('FixtureResolver')
        allow(resolver).to receive(:resolve).and_return(nil)

        reconciler = described_class.new(
          db_conn: db_conn,
          client: client,
          resolver: resolver,
          logger: logger
        )

        result = reconciler.run
        expect(result[:mapping_failed]).to eq(1)
        expect(result[:resolved]).to eq(0)
      end
    end

    context 'fixture resolvida com stats completas' do
      it 'popula actual_corners/sot/cards e marca resolved' do
        stats_payload = [
          {
            'team' => { 'id' => 1, 'name' => 'Arsenal' },
            'statistics' => [
              { 'type' => 'Shots on Goal', 'value' => 5 },
              { 'type' => 'Corner Kicks', 'value' => 7 },
              { 'type' => 'Yellow Cards', 'value' => 2 },
              { 'type' => 'Red Cards', 'value' => 0 }
            ]
          },
          {
            'team' => { 'id' => 2, 'name' => 'Chelsea' },
            'statistics' => [
              { 'type' => 'Shots on Goal', 'value' => 3 },
              { 'type' => 'Corner Kicks', 'value' => 4 },
              { 'type' => 'Yellow Cards', 'value' => 1 },
              { 'type' => 'Red Cards', 'value' => 1 }
            ]
          }
        ]

        updates_captured = []
        db_conn = double('db_conn')
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/FROM fixture_simulations/im), anything)
          .and_return(double('r', to_a: [pending_row(home_team: 'Arsenal', away_team: 'Chelsea')]))
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/UPDATE fixture_simulations/im), anything) do |_sql, params|
            updates_captured << params
            double('r', cmd_tuples: 1)
          end

        client = double('ApiFootballClient')
        allow(client).to receive(:quota_remaining).and_return(80)
        allow(client).to receive(:fixture_statistics).and_return(stats_payload)

        resolver = double('FixtureResolver')
        allow(resolver).to receive(:resolve).and_return(55555)

        reconciler = described_class.new(
          db_conn: db_conn,
          client: client,
          resolver: resolver,
          logger: logger
        )

        result = reconciler.run
        expect(result[:resolved]).to eq(1)
        expect(result[:stats_failed]).to eq(0)

        # Verifica que o UPDATE tem os valores corretos
        expect(updates_captured).not_to be_empty
        flat_params = updates_captured.flatten
        expect(flat_params).to include(5)   # home sot
        expect(flat_params).to include(3)   # away sot
        expect(flat_params).to include(7)   # home corners
        expect(flat_params).to include(4)   # away corners
        expect(flat_params).to include(2)   # home cards (2y+0r)
        expect(flat_params).to include('api-football')
      end
    end

    context 'fixture resolvida mas stats indisponíveis (liga pequena)' do
      it 'marca stats_failed' do
        db_conn = double('db_conn')
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/FROM fixture_simulations/im), anything)
          .and_return(double('r', to_a: [pending_row]))
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/UPDATE fixture_simulations/im), anything)
          .and_return(double('r', cmd_tuples: 1))

        client = double('ApiFootballClient')
        allow(client).to receive(:quota_remaining).and_return(80)
        allow(client).to receive(:fixture_statistics).and_return([])  # vazio

        resolver = double('FixtureResolver')
        allow(resolver).to receive(:resolve).and_return(55555)

        reconciler = described_class.new(
          db_conn: db_conn,
          client: client,
          resolver: resolver,
          logger: logger
        )

        result = reconciler.run
        expect(result[:stats_failed]).to eq(1)
        expect(result[:resolved]).to eq(0)
      end
    end

    context 'quota esgota durante processamento' do
      it 'para após QuotaExhaustedError e retorna stats parciais' do
        rows = [
          pending_row(id: 1, fixture_id: 101),
          pending_row(id: 2, fixture_id: 102)
        ]

        stats_payload = [
          {
            'team' => { 'id' => 1, 'name' => 'Arsenal' },
            'statistics' => [
              { 'type' => 'Shots on Goal', 'value' => 5 },
              { 'type' => 'Corner Kicks', 'value' => 7 },
              { 'type' => 'Yellow Cards', 'value' => 2 },
              { 'type' => 'Red Cards', 'value' => 0 }
            ]
          },
          {
            'team' => { 'id' => 2, 'name' => 'Chelsea' },
            'statistics' => [
              { 'type' => 'Shots on Goal', 'value' => 3 },
              { 'type' => 'Corner Kicks', 'value' => 4 },
              { 'type' => 'Yellow Cards', 'value' => 1 },
              { 'type' => 'Red Cards', 'value' => 0 }
            ]
          }
        ]

        db_conn = double('db_conn')
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/FROM fixture_simulations/im), anything)
          .and_return(double('r', to_a: rows))
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/UPDATE fixture_simulations/im), anything)
          .and_return(double('r', cmd_tuples: 1))

        client = double('ApiFootballClient')
        allow(client).to receive(:quota_remaining).and_return(80)

        call_count = 0
        allow(client).to receive(:fixture_statistics) do
          call_count += 1
          if call_count == 1
            stats_payload
          else
            raise AdamStats::Scraper::Actuals::ApiFootballClient::QuotaExhaustedError, 'quota'
          end
        end

        resolver = double('FixtureResolver')
        allow(resolver).to receive(:resolve).and_return(55555)

        reconciler = described_class.new(
          db_conn: db_conn,
          client: client,
          resolver: resolver,
          logger: logger
        )

        result = reconciler.run
        expect(result[:resolved]).to eq(1)
        expect(result[:quota_exhausted]).to eq(1)
      end
    end

    context 'erro de rede em uma fixture' do
      it 'loga warning e continua com a próxima fixture' do
        rows = [
          pending_row(id: 1, fixture_id: 101),
          pending_row(id: 2, fixture_id: 102)
        ]

        stats_payload = [
          {
            'team' => { 'id' => 1, 'name' => 'Arsenal' },
            'statistics' => [
              { 'type' => 'Shots on Goal', 'value' => 5 },
              { 'type' => 'Corner Kicks', 'value' => 7 },
              { 'type' => 'Yellow Cards', 'value' => 2 },
              { 'type' => 'Red Cards', 'value' => 0 }
            ]
          },
          {
            'team' => { 'id' => 2, 'name' => 'Chelsea' },
            'statistics' => [
              { 'type' => 'Shots on Goal', 'value' => 3 },
              { 'type' => 'Corner Kicks', 'value' => 4 },
              { 'type' => 'Yellow Cards', 'value' => 1 },
              { 'type' => 'Red Cards', 'value' => 0 }
            ]
          }
        ]

        db_conn = double('db_conn')
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/FROM fixture_simulations/im), anything)
          .and_return(double('r', to_a: rows))
        allow(db_conn).to receive(:exec_params)
          .with(a_string_matching(/UPDATE fixture_simulations/im), anything)
          .and_return(double('r', cmd_tuples: 1))

        client = double('ApiFootballClient')
        allow(client).to receive(:quota_remaining).and_return(80)

        call_count = 0
        allow(client).to receive(:fixture_statistics) do
          call_count += 1
          raise Faraday::ConnectionFailed.new('network error') if call_count == 1
          stats_payload
        end

        resolver = double('FixtureResolver')
        allow(resolver).to receive(:resolve).and_return(55555)

        reconciler = described_class.new(
          db_conn: db_conn,
          client: client,
          resolver: resolver,
          logger: logger
        )

        expect { reconciler.run }.not_to raise_error
        expect(logger_msgs).to include(a_string_matching(/warn|skip|error/i))
      end
    end

    context 'idempotência: linhas já reconciliadas não são re-processadas' do
      it 'o SELECT filtra actual_corners_home IS NULL' do
        db_conn = double('db_conn')
        expect(db_conn).to receive(:exec_params)
          .with(a_string_matching(/actual_corners_home IS NULL/im), anything)
          .and_return(double('r', to_a: []))

        client = double('ApiFootballClient')
        allow(client).to receive(:quota_remaining).and_return(80)

        reconciler = described_class.new(
          db_conn: db_conn,
          client: client,
          resolver: double('resolver'),
          logger: logger
        )

        result = reconciler.run
        expect(result[:resolved]).to eq(0)
      end
    end
  end
end
