require 'date'
require_relative 'db_helper'
require_relative '../../lib/scraper/orchestrator'
require_relative '../../lib/scraper/choistats_api_fetcher'
require_relative '../../lib/scraper/fixture'
require_relative '../../lib/scraper/page_pool'
require_relative '../../lib/scraper/api_list_fetcher'

RSpec.describe AdamStats::Scraper::Orchestrator do
  # Stub global dos dois reconcilers: a maioria dos specs deste arquivo testa
  # o pipeline central (fetch → parse → detail → persist → purge) e não quer
  # bater no DB/HTTP real através dos reconcilers. Specs que TESTAM a integração
  # do reconciler com o pipeline (block "SimulationReconciler — wired" abaixo)
  # sobrescrevem este stub localmente via `expect(...).to receive(:new)`.
  before(:each) do
    safe_pred = double('pred_reconciler_default', run: { resolved: 0, pending: 0, unresolvable: 0 })
    safe_sim  = double('sim_reconciler_default',  run: { resolved: 0, pending: 0, unresolvable: 0 })
    safe_ai_recon = double('ai_reco_reconciler_default', run: { resolved: 0, pending: 0, unresolvable: 0 })
    # A4 — runner agora retorna { inserted_recos:, errors: }. Default usa 1 não-zero
    # pra silenciar o silent-death detector nos specs do pipeline central.
    safe_ai_run   = double('ai_recommender_default',     run: { inserted_recos: 1, errors: 0 })
    allow(AdamStats::Scraper::PredictionReconciler).to receive(:new).and_return(safe_pred)
    allow(AdamStats::Scraper::SimulationReconciler).to receive(:new).and_return(safe_sim)
    allow(AdamStats::Scraper::AiRecommendationReconciler).to receive(:new).and_return(safe_ai_recon)
    allow(AdamStats::Scraper::AiRecommenderRunner).to receive(:new).and_return(safe_ai_run)
  end

  let(:list_html) { '<html>list</html>' }
  let(:detail_html) { '<html>detail</html>' }
  let(:fixture_a) do
    AdamStats::Scraper::Fixture.new(
      match_date: Date.today,
      ko_time: '20:00',
      home_team: 'A',
      away_team: 'B',
      league: 'L',
      source_url: '/fixture/a-vs-b',
      country: nil
    )
  end
  let(:fixture_b) do
    AdamStats::Scraper::Fixture.new(
      match_date: Date.today + 1,
      ko_time: '21:00',
      home_team: 'C',
      away_team: 'D',
      league: 'L',
      source_url: '/fixture/c-vs-d',
      country: nil
    )
  end

  def build_deps(fetcher_responses: { list_html => list_html }, parsed_list: [fixture_a, fixture_b],
                 detail_parsed: { fixture_a.source_url => { stats: 1 }, fixture_b.source_url => { stats: 2 } },
                 persist_stats: AdamStats::Scraper::Stats.new(inserted: 2, updated: 0, failed: 0),
                 purge_count: 5, healthcheck: double('hc', ping_start: true, ping_success: true, ping_failure: true),
                 baseline: double('baseline', recompute!: 0))
    fetcher = double('fetcher')
    allow(fetcher).to receive(:fetch) do |url, **_kwargs|
      fetcher_responses.fetch(url) { detail_html }
    end
    detail_fetcher = double('detail_fetcher')
    allow(detail_fetcher).to receive(:fetch) do |_url|
      { html: detail_html, widgets: { recent_results: { 'ok' => true } } }
    end
    parser = double('parser', parse_fixtures_list: parsed_list)
    detail_parser = double('detail_parser')
    allow(detail_parser).to receive(:parse_detail) { |_html, **_kwargs| double('detail', to_h: { stats: 1 }) }
    persister = double('persister', persist: persist_stats)
    simulation_hook = double('simulation_hook', run: nil)
    repo = double('repo', purge_older_than: purge_count)

    {
      fetcher: fetcher,
      detail_fetcher: detail_fetcher,
      parser: parser,
      detail_parser: detail_parser,
      persister: persister,
      simulation_hook: simulation_hook,
      repo: repo,
      baseline: baseline,
      healthcheck: healthcheck,
      base_url: 'https://example.test',
      success_url: 'https://hc-ping.com/abc',
      fail_url: 'https://hc-ping.com/abc/fail'
    }
  end

  describe '.run (happy path)' do
    it 'orchestrates fetch -> parse list -> detail_fetcher (html + widgets) -> parse_detail -> persist -> purge' do
      deps = build_deps
      expect(deps[:fetcher]).to receive(:fetch).with('https://example.test/fixtures', anything).and_return(list_html)
      expect(deps[:parser]).to receive(:parse_fixtures_list).with(list_html).and_return([fixture_a, fixture_b])
      expect(deps[:detail_fetcher]).to receive(:fetch).with(%r{example\.test/fixture/a-vs-b}).and_return(html: detail_html, widgets: { recent_results: { 'ok' => true } })
      expect(deps[:detail_fetcher]).to receive(:fetch).with(%r{example\.test/fixture/c-vs-d}).and_return(html: detail_html, widgets: { recent_results: { 'ok' => true } })
      expect(deps[:detail_parser]).to receive(:parse_detail).with(detail_html, widgets: { recent_results: { 'ok' => true } }).twice.and_return(double('d', to_h: { stats: 1 }))
      expect(deps[:persister]).to receive(:persist).with([fixture_a, fixture_b], hash_including(:detail_json_by_source_url))
      expect(deps[:repo]).to receive(:purge_older_than).with(3)

      described_class.run(**deps)
    end

    it 'pings healthcheck success URL on completion' do
      deps = build_deps
      expect(deps[:healthcheck]).to receive(:ping_success).with(deps[:success_url])
      described_class.run(**deps)
    end

    it 'returns RunStats with fetched, persisted_inserted, persisted_updated, deleted counts' do
      deps = build_deps
      stats = described_class.run(**deps)
      expect(stats.fetched).to eq(2)
      expect(stats.persisted_inserted).to eq(2)
      expect(stats.persisted_updated).to eq(0)
      expect(stats.deleted).to eq(5)
    end
  end

  describe '.run (league whitelist)' do
    let(:fixture_premier) do
      AdamStats::Scraper::Fixture.new(
        match_date: Date.today, ko_time: '20:00',
        home_team: 'Tottenham', away_team: 'Leeds', league: 'Premier League',
        source_url: '/fixture/19427224/england-premier-league-tottenham-vs-leeds',
        country: 'england'
      )
    end
    let(:fixture_brasil_a) do
      AdamStats::Scraper::Fixture.new(
        match_date: Date.today, ko_time: '20:00',
        home_team: 'Palmeiras', away_team: 'Internacional', league: 'Serie A',
        source_url: '/fixture/123456/brazil-serie-a-se-palmeiras-vs-internacional-rs',
        country: 'brazil'
      )
    end
    let(:fixture_copa_brasil) do
      AdamStats::Scraper::Fixture.new(
        match_date: Date.today, ko_time: '20:00',
        home_team: 'Flamengo', away_team: 'Vasco', league: 'Copa do Brasil',
        source_url: '/fixture/789/brazil-copa-do-brasil-flamengo-rj-vs-vasco-da-gama',
        country: 'brazil'
      )
    end
    let(:fixture_tunisia) do
      AdamStats::Scraper::Fixture.new(
        match_date: Date.today, ko_time: '20:00',
        home_team: 'X', away_team: 'Y', league: 'Tunisia Primera',
        source_url: '/fixture/333/tunisia-tunisia-primera-division-x-vs-y',
        country: 'tunisia'
      )
    end

    it 'limits the detail fetch to whitelisted slugs (Persister still gets all parsed)' do
      deps = build_deps(parsed_list: [fixture_premier, fixture_brasil_a, fixture_copa_brasil, fixture_tunisia])
      deps[:league_slugs] = %w[england-premier-league brazil-serie-a brazil-serie-b]

      passed = []
      allow(deps[:detail_fetcher]).to receive(:fetch) do |abs_url|
        passed << abs_url
        { html: '<x/>', widgets: {} }
      end
      expect(deps[:persister]).to receive(:persist) do |fixtures_arg, **|
        # Persister recebe TODAS as fixtures parsed
        expect(fixtures_arg.length).to eq(4)
        AdamStats::Scraper::Stats.new(inserted: 4, updated: 0, failed: 0)
      end

      stats = described_class.run(**deps)
      expect(stats.fetched).to eq(4)
      # Detail só pras whitelisted
      expect(passed).to all(satisfy { |u| u.include?('england-premier-league') || u.include?('brazil-serie-a-') })
      expect(passed.length).to eq(2)
    end

    it 'with empty league_slugs whitelist, passes all parsed fixtures through (no filtering)' do
      deps = build_deps(parsed_list: [fixture_premier, fixture_tunisia])
      deps[:league_slugs] = []
      expect(deps[:persister]).to receive(:persist).with(contain_exactly(fixture_premier, fixture_tunisia), anything).and_return(
        AdamStats::Scraper::Stats.new(inserted: 2, updated: 0, failed: 0)
      )
      described_class.run(**deps)
    end

    it 'persists ALL parsed fixtures but only does detail-fetch for the whitelisted ones (on-demand support)' do
      fixture_b = AdamStats::Scraper::Fixture.new(
        match_date: Date.today, ko_time: '20:00',
        home_team: 'Cuiaba', away_team: 'Goias', league: 'Serie B',
        source_url: '/fixture/777/brazil-serie-b-cuiaba-vs-goias',
        country: 'brazil'
      )
      deps = build_deps(parsed_list: [fixture_premier, fixture_brasil_a, fixture_copa_brasil, fixture_tunisia, fixture_b])
      deps[:league_slugs] = ['england-premier-league', 'brazil-serie-a']

      detail_calls = []
      allow(deps[:detail_fetcher]).to receive(:fetch) do |abs_url|
        detail_calls << abs_url
        { html: '<x/>', widgets: {} }
      end

      # Persist deve receber TODAS as 5 fixtures...
      expect(deps[:persister]).to receive(:persist) do |fixtures_arg, **kwargs|
        expect(fixtures_arg.length).to eq(5)
        # ...mas detail_json_by_source_url só tem keys das whitelisted
        keys = kwargs[:detail_json_by_source_url].keys
        expect(keys).to contain_exactly(fixture_premier.source_url, fixture_brasil_a.source_url)
        AdamStats::Scraper::Stats.new(inserted: 5, updated: 0, failed: 0)
      end

      described_class.run(**deps)
      # Detail fetcher só foi chamado pras whitelisted (2 calls, não 5)
      expect(detail_calls.length).to eq(2)
    end

    it 'distinguishes brazil-serie-a from brazil-serie-b correctly in the detail filter (no false prefix match)' do
      fixture_b = AdamStats::Scraper::Fixture.new(
        match_date: Date.today, ko_time: '20:00',
        home_team: 'Cuiaba', away_team: 'Goias', league: 'Serie B',
        source_url: '/fixture/777/brazil-serie-b-cuiaba-vs-goias',
        country: 'brazil'
      )
      deps = build_deps(parsed_list: [fixture_brasil_a, fixture_b])
      deps[:league_slugs] = ['brazil-serie-a'] # apenas A
      detail_urls = []
      allow(deps[:detail_fetcher]).to receive(:fetch) do |u|
        detail_urls << u
        { html: '<x/>', widgets: {} }
      end
      expect(deps[:persister]).to receive(:persist) do |fixtures_arg, detail_json_by_source_url:|
        # Persiste ambas
        expect(fixtures_arg.length).to eq(2)
        # Detail só pra A
        expect(detail_json_by_source_url.keys).to eq([fixture_brasil_a.source_url])
        AdamStats::Scraper::Stats.new(inserted: 2, updated: 0, failed: 0)
      end
      described_class.run(**deps)
      expect(detail_urls.length).to eq(1)
      expect(detail_urls.first).to include('brazil-serie-a-')
    end
  end

  describe '.run (failure path)' do
    it 'pings failure URL and reraises when fetcher fails' do
      deps = build_deps
      allow(deps[:fetcher]).to receive(:fetch).and_raise(AdamStats::Scraper::FetchError.new('boom'))
      expect(deps[:healthcheck]).to receive(:ping_failure).with(deps[:fail_url])
      expect(deps[:healthcheck]).not_to receive(:ping_success)

      expect { described_class.run(**deps) }.to raise_error(AdamStats::Scraper::FetchError)
    end

    it 'still pings success when parser returns an empty list (no fixtures today)' do
      deps = build_deps(parsed_list: [])
      expect(deps[:healthcheck]).to receive(:ping_success)
      expect(deps[:persister]).not_to receive(:persist)
      stats = described_class.run(**deps)
      expect(stats.fetched).to eq(0)
    end
  end

  describe 'defaults' do
    it 'default detail_fetcher is ChoistatsApiFetcher, not DetailPageFetcher' do
      # Introspect the default parameter value via method signature.
      # We do NOT want DetailPageFetcher.new instantiated by the default — that
      # would spin up a Playwright session on every require.
      method_obj = AdamStats::Scraper::Orchestrator.method(:run)
      defaults = method_obj.parameters.select { |type, _| type == :key }.map(&:last)
      # The parameter must exist
      expect(defaults).to include(:detail_fetcher)

      # Call .run with a real default detail_fetcher — capture what it is.
      captured_fetcher = nil
      captured_session = nil
      fake_fetcher = double('fetcher', fetch: list_html)
      fake_parser  = double('parser', parse_fixtures_list: [])
      fake_persister = double('persister')
      fake_repo    = double('repo', purge_older_than: 0)
      fake_hc      = double('hc', ping_start: nil, ping_success: nil, ping_failure: nil)
      fake_baseline = double('baseline', recompute!: nil)

      # Intercept the collect_details call to capture the fetcher used
      allow(AdamStats::Scraper::Orchestrator).to receive(:collect_details) do |**kwargs|
        captured_fetcher = kwargs[:detail_fetcher]
        captured_session = kwargs[:detail_session]
        {}
      end

      # parse returns empty — collect_details never invoked; use a non-empty list
      fake_fixture = AdamStats::Scraper::Fixture.new(
        match_date: Date.today, ko_time: '20:00',
        home_team: 'A', away_team: 'B', league: 'L', source_url: '/fixture/1/x',
        country: nil
      )
      allow(fake_parser).to receive(:parse_fixtures_list).and_return([fake_fixture])
      allow(fake_persister).to receive(:persist).and_return(
        AdamStats::Scraper::Stats.new(inserted: 1, updated: 0, failed: 0)
      )

      AdamStats::Scraper::Orchestrator.run(
        fetcher: fake_fetcher,
        parser: fake_parser,
        persister: fake_persister,
        repo: fake_repo,
        healthcheck: fake_hc,
        baseline: fake_baseline,
        base_url: 'https://example.test',
        success_url: nil,
        fail_url: nil
      )

      expect(captured_fetcher).to be_a(AdamStats::Scraper::ChoistatsApiFetcher)
    end

    it 'DEFAULT_DETAIL_CONCURRENCY is 4 (HTTP-direct handles concurrency without leak)' do
      # The constant is evaluated once at load time. If env was not set when this
      # spec loaded, it must be 4. If env IS set, we skip the assertion to avoid
      # false failure in CI environments that override it.
      unless ENV['SCRAPER_DETAIL_CONCURRENCY']
        expect(AdamStats::Scraper::Orchestrator::DEFAULT_DETAIL_CONCURRENCY).to eq(4)
      end
    end

    it 'default list fetcher is ApiListFetcher when SCRAPER_USE_PLAYWRIGHT_LIST is not set' do
      # When env is unset, the default fetcher: param must be an ApiListFetcher.
      # We verify by inspecting the default via a controlled run that captures it.
      unless ENV['SCRAPER_USE_PLAYWRIGHT_LIST']
        captured_fetcher = nil
        fake_list_fetcher = double('list_fetcher')
        allow(fake_list_fetcher).to receive(:fetch_list).and_return([])

        fake_persister = double('persister')
        fake_repo      = double('repo', purge_older_than: 0)
        fake_hc        = double('hc', ping_start: nil, ping_success: nil, ping_failure: nil)
        fake_baseline  = double('baseline', recompute!: nil)

        allow(AdamStats::Scraper::Orchestrator).to receive(:resolve_list_fetcher) do |fetcher|
          captured_fetcher = fetcher
          fake_list_fetcher
        end

        AdamStats::Scraper::Orchestrator.run(
          persister: fake_persister,
          repo: fake_repo,
          healthcheck: fake_hc,
          baseline: fake_baseline,
          base_url: 'https://example.test',
          success_url: nil,
          fail_url: nil
        )

        expect(captured_fetcher).to be_a(AdamStats::Scraper::ApiListFetcher)
      end
    end
  end

  describe '.run (ApiListFetcher path — no Playwright for listing)' do
    let(:api_list_fetcher) do
      double('api_list_fetcher').tap do |d|
        allow(d).to receive(:respond_to?).with(:fetch_list).and_return(true)
        allow(d).to receive(:fetch_list).and_return([fixture_a, fixture_b])
      end
    end

    it 'calls fetch_list instead of fetch+parse when fetcher responds to fetch_list' do
      deps = build_deps
      deps[:fetcher] = api_list_fetcher

      expect(api_list_fetcher).to receive(:fetch_list).and_return([fixture_a, fixture_b])
      # parser should NOT be called — ApiListFetcher returns Fixtures directly
      expect(deps[:parser]).not_to receive(:parse_fixtures_list)
      expect(deps[:persister]).to receive(:persist).with([fixture_a, fixture_b], anything).and_return(
        AdamStats::Scraper::Stats.new(inserted: 2, updated: 0, failed: 0)
      )

      stats = described_class.run(**deps)
      expect(stats.fetched).to eq(2)
    end

    it 'does NOT instantiate PlaywrightSession when ApiListFetcher is the list fetcher' do
      deps = build_deps
      deps[:fetcher] = api_list_fetcher
      allow(deps[:persister]).to receive(:persist).and_return(
        AdamStats::Scraper::Stats.new(inserted: 2, updated: 0, failed: 0)
      )

      # If Playwright were instantiated we'd need browser env — test would error out.
      # The mere fact that no error is raised confirms no browser session is started.
      expect(AdamStats::Scraper::PlaywrightSession).not_to receive(:new)
      expect { described_class.run(**deps) }.not_to raise_error
    end

    it 'falls back to HTML fetch path when fetcher does NOT respond to fetch_list (Playwright Fetcher)' do
      deps = build_deps
      # The default test double in build_deps has #fetch but not #fetch_list
      expect(deps[:fetcher]).to receive(:fetch)
        .with('https://example.test/fixtures', anything)
        .and_return(list_html)
      expect(deps[:parser]).to receive(:parse_fixtures_list).with(list_html)
        .and_return([fixture_a, fixture_b])

      described_class.run(**deps)
    end

    it 'passes empty league_slugs to fetch_list (filtering for detail done by orchestrator, not ApiListFetcher)' do
      deps = build_deps
      deps[:fetcher] = api_list_fetcher
      deps[:league_slugs] = ['england-premier-league']

      allow(deps[:persister]).to receive(:persist).and_return(
        AdamStats::Scraper::Stats.new(inserted: 2, updated: 0, failed: 0)
      )
      # Orchestrator always passes league_slugs: [] to fetch_list so the full fixture
      # list is fetched; the whitelist is applied only to the detail-fetch step.
      expect(api_list_fetcher).to receive(:fetch_list)
        .with(hash_including(league_slugs: []))
        .and_return([fixture_a, fixture_b])

      described_class.run(**deps)
    end
  end

  describe '.run (HTTP-direct threaded fetch — no detail_session needed)' do
    it 'calls #fetch (no page arg) for each fixture when detail_session is nil and concurrency > 1' do
      fixture_c = AdamStats::Scraper::Fixture.new(
        match_date: Date.today, ko_time: '18:00',
        home_team: 'E', away_team: 'F', league: 'L', source_url: '/fixture/e-vs-f',
        country: nil
      )
      deps = build_deps(parsed_list: [fixture_a, fixture_b, fixture_c])
      deps[:detail_session] = nil
      deps[:detail_concurrency] = 4

      mu = Mutex.new
      calls = []
      deps[:detail_fetcher] = Class.new do
        define_method(:fetch) do |url, **_|
          mu.synchronize { calls << url }
          { html: '<x/>', widgets: {} }
        end
      end.new

      allow(deps[:persister]).to receive(:persist).and_return(
        AdamStats::Scraper::Stats.new(inserted: 3, updated: 0, failed: 0)
      )

      stats = described_class.run(**deps)
      expect(stats.fetched).to eq(3)
      # All fixtures processed via #fetch (no fetch_with_page called)
      expect(calls.length).to eq(3)
      expect(calls.uniq.length).to eq(3)
    end

    it 'does NOT call fetch_with_page in HTTP-direct mode (no page pool needed)' do
      deps = build_deps
      deps[:detail_session] = nil
      deps[:detail_concurrency] = 4

      fetch_calls = []
      fetch_with_page_calls = []
      deps[:detail_fetcher] = Class.new do
        define_method(:fetch) do |url, **_|
          fetch_calls << url
          { html: '<x/>', widgets: {} }
        end
        define_method(:fetch_with_page) do |_page, url, **_|
          fetch_with_page_calls << url
          { html: '<x/>', widgets: {} }
        end
      end.new

      described_class.run(**deps)
      expect(fetch_with_page_calls).to be_empty
      expect(fetch_calls.length).to eq(2)
    end

    it 'isolates exceptions per-thread in HTTP-direct mode (no session, concurrency > 1)' do
      fixture_c = AdamStats::Scraper::Fixture.new(
        match_date: Date.today, ko_time: '18:00',
        home_team: 'E', away_team: 'F', league: 'L', source_url: '/fixture/e-vs-f',
        country: nil
      )
      deps = build_deps(parsed_list: [fixture_a, fixture_b, fixture_c])
      deps[:detail_session] = nil
      deps[:detail_concurrency] = 2

      mu = Mutex.new
      logged = []
      deps[:logger] = ->(m) { mu.synchronize { logged << m } }
      deps[:detail_fetcher] = Class.new do
        define_method(:fetch) do |url, **_|
          raise StandardError, 'http error' if url.include?('c-vs-d')

          { html: '<x/>', widgets: {} }
        end
      end.new

      expect(deps[:persister]).to receive(:persist) do |fixtures_arg, detail_json_by_source_url:|
        expect(fixtures_arg.length).to eq(3)
        expect(detail_json_by_source_url.keys).not_to include(fixture_b.source_url)
        AdamStats::Scraper::Stats.new(inserted: 3, updated: 0, failed: 0)
      end

      expect { described_class.run(**deps) }.not_to raise_error
      expect(logged.any? { |m| m.include?('c-vs-d') }).to be(true)
    end
  end

  describe '.run (parallel detail fetch via PagePool)' do
    let(:fake_session) do
      Class.new do
        def with_page_pool(size:)
          pages = Array.new(size) { Object.new }
          yield AdamStats::Scraper::PagePool.new(pages)
        end
      end.new
    end

    it 'fetches all fixtures using fetch_with_page when detail_session is provided and concurrency > 1' do
      deps = build_deps
      calls = []
      mu = Mutex.new
      deps[:detail_fetcher] = Class.new do
        define_method(:fetch_with_page) do |_page, url|
          mu.synchronize { calls << url }
          { html: '<x/>', widgets: {} }
        end
      end.new
      deps[:detail_session] = fake_session
      deps[:detail_concurrency] = 2

      stats = described_class.run(**deps)
      expect(stats.fetched).to eq(2)
      expect(calls.length).to eq(2)
      expect(calls.uniq.length).to eq(2)
    end

    it 'calls #fetch (not fetch_with_page) when detail_session is nil — threaded or serial' do
      deps = build_deps
      deps[:detail_concurrency] = 4
      # detail_session is nil → collect_details_threaded or serial; both call #fetch
      expect(deps[:detail_fetcher]).to receive(:fetch).twice
      described_class.run(**deps)
    end

    it 'isolates per-worker exceptions: one failing fixture does not abort the batch' do
      fixture_c = AdamStats::Scraper::Fixture.new(
        match_date: Date.today + 1,
        ko_time: '18:00',
        home_team: 'E',
        away_team: 'F',
        league: 'L',
        source_url: '/fixture/e-vs-f',
        country: nil
      )
      deps = build_deps(parsed_list: [fixture_a, fixture_b, fixture_c])

      mu = Mutex.new
      seen = []
      bad_url = fixture_b.source_url
      deps[:detail_fetcher] = Class.new do
        define_method(:fetch_with_page) do |_page, url|
          mu.synchronize { seen << url }
          raise StandardError, 'timeout simulated' if url.include?('c-vs-d')

          { html: '<x/>', widgets: {} }
        end
      end.new
      deps[:detail_session] = fake_session
      deps[:detail_concurrency] = 2

      captured = []
      deps[:logger] = ->(msg) { mu.synchronize { captured << msg } }

      # Persister deve ser chamado APENAS com detail_json das 2 fixtures que deram certo.
      expect(deps[:persister]).to receive(:persist) do |fixtures_arg, detail_json_by_source_url:|
        expect(fixtures_arg.length).to eq(3) # todas as fixtures ainda são persistidas (com/sem detail)
        expect(detail_json_by_source_url.keys).to contain_exactly(fixture_a.source_url, fixture_c.source_url)
        expect(detail_json_by_source_url).not_to have_key(bad_url)
        deps[:persister_stats] || AdamStats::Scraper::Stats.new(inserted: 3, updated: 0, failed: 0)
      end

      expect { described_class.run(**deps) }.not_to raise_error
      expect(seen).to contain_exactly(
        a_string_matching(%r{/fixture/a-vs-b}),
        a_string_matching(%r{/fixture/c-vs-d}),
        a_string_matching(%r{/fixture/e-vs-f})
      )
      # Logger registra a falha citando a URL alvo
      expect(captured.any? { |m| m.include?('c-vs-d') && m.match?(/fail|error|timeout/i) }).to be(true)
    end
  end

  describe '.run (simulation hook — post-persist, additive, failure-isolated)' do
    it 'invokes the simulation hook AFTER persist with parsed fixtures + details' do
      deps = build_deps
      ordered = []
      allow(deps[:persister]).to receive(:persist) do |*_a, **_k|
        ordered << :persist
        AdamStats::Scraper::Stats.new(inserted: 2, updated: 0, failed: 0)
      end
      expect(deps[:simulation_hook]).to receive(:run) do |fixtures_arg, details_arg, **kw|
        ordered << :sim
        expect(fixtures_arg).to eq([fixture_a, fixture_b])
        expect(details_arg).to be_a(Hash)
        expect(kw).to have_key(:logger)
      end
      described_class.run(**deps)
      expect(ordered).to eq(%i[persist sim])
    end

    it 'does NOT invoke the hook when there are no parsed fixtures' do
      deps = build_deps(parsed_list: [])
      expect(deps[:simulation_hook]).not_to receive(:run)
      described_class.run(**deps)
    end

    it 'passes a callable logger so the hook can warn (Lição #11 boundary)' do
      deps = build_deps
      seen_logger = nil
      allow(deps[:simulation_hook]).to receive(:run) do |_fx, _det, logger:|
        seen_logger = logger
      end
      described_class.run(**deps)
      expect(seen_logger).to respond_to(:call)
    end
  end

  describe AdamStats::Scraper::SimulationHook do
    let(:fixture) do
      AdamStats::Scraper::Fixture.new(
        match_date: Date.today, ko_time: '20:00',
        home_team: 'A', away_team: 'B', league: 'L',
        source_url: '/fixture/999/l-a-vs-b', country: nil
      )
    end

    it 'isolates a per-fixture failure: one bad detail does not stop the others' do
      logged = []
      logger = ->(m) { logged << m }
      conn = double('conn')
      # Pre-check SELECT → no existing row ⇒ simula (comportamento original).
      allow(conn).to receive(:exec_params).with(/SELECT/i, anything).and_return([])
      allow(conn).to receive(:exec_params).with(/DELETE|INSERT/i, anything)
      # F4a: LeagueCalibration.load(conn) faz UM query no início → tabela vazia.
      allow(conn).to receive(:query).with(/league_parameters/i).and_return([])
      allow(conn).to receive(:transaction) { |&blk| blk.call }
      allow(AdamStats::Scraper::DB).to receive(:with_connection).and_yield(conn)

      # First fixture detail makes Runner.simulate raise; second is fine.
      allow(AdamStats::Scraper::Simulation::Runner).to receive(:simulate) do |detail|
        raise StandardError, 'sim explode' if detail == { 'bad' => true }

        { status: 'pending', model_version: 'v', p_home: 0.5, p_draw: 0.3, p_away: 0.2,
          p_btts: 0.5, p_over_25: 0.5, top_scorelines: [], sim_stats: {},
          per_half_available: false, market_anchor: {}, player_events: [] }
      end

      fx2 = AdamStats::Scraper::Fixture.new(
        match_date: Date.today, ko_time: '21:00',
        home_team: 'C', away_team: 'D', league: 'L',
        source_url: '/fixture/1000/l-c-vs-d', country: nil
      )

      expect do
        described_class.run(
          [fixture, fx2],
          { fixture.source_url => { 'bad' => true }, fx2.source_url => { 'ok' => true } },
          logger: logger
        )
      end.not_to raise_error

      expect(logged.any? { |m| m.include?(fixture.source_url) && m.match?(/fail|error|explode/i) }).to be(true)
      # 2 fixtures × 1 pre-check SELECT each + 1 DELETE + 1 INSERT for the
      # single good row (the bad one raises in Runner.simulate after its
      # pre-check) = 4 exec_params total.
      expect(conn).to have_received(:exec_params).with(/SELECT/i, anything).twice
      expect(conn).to have_received(:exec_params).with(/DELETE|INSERT/i, anything).twice
      expect(conn).to have_received(:transaction).once
    end

    it 'skips upsert for unsimulable results (no raise)' do
      conn = double('conn')
      # Pre-check SELECT → no existing row ⇒ prossegue para simular.
      allow(conn).to receive(:exec_params).with(/SELECT/i, anything).and_return([])
      allow(conn).to receive(:exec_params).with(/DELETE|INSERT/i, anything)
      # F4a: LeagueCalibration.load(conn) faz UM query no início → tabela vazia.
      allow(conn).to receive(:query).with(/league_parameters/i).and_return([])
      allow(conn).to receive(:transaction) { |&blk| blk.call }
      allow(AdamStats::Scraper::DB).to receive(:with_connection).and_yield(conn)
      allow(AdamStats::Scraper::Simulation::Runner).to receive(:simulate)
        .and_return(status: 'unsimulable', model_version: 'v')

      described_class.run([fixture], { fixture.source_url => { 'x' => 1 } }, logger: ->(_) {})
      # unsimulable ⇒ NENHUM DELETE/INSERT (só o pre-check SELECT roda).
      expect(conn).not_to have_received(:exec_params).with(/DELETE|INSERT/i, anything)
    end

    it 'is a no-op when there are no details' do
      expect(AdamStats::Scraper::DB).not_to receive(:with_connection)
      described_class.run([fixture], {}, logger: ->(_) {})
    end

    # F5: contrato literal das SQLs do hook — ambas devem filtrar por
    # model_version (= $5). Travamento estático evita regressão silenciosa
    # (se alguém remover o predicado, smoke real-DB ainda passaria por sorte
    # quando histórico não existe ainda; este matcher quebra na hora).
    it 'PRECHECK_SQL filters by model_version = $5 (F5)' do
      expect(AdamStats::Scraper::SimulationHook::PRECHECK_SQL).to include('model_version = $5')
    end

    it 'DELETE_PRIOR_SQL filters by model_version = $5 (F5)' do
      expect(AdamStats::Scraper::SimulationHook::DELETE_PRIOR_SQL).to include('model_version = $5')
    end

    it 'a global DB failure is non-fatal (logged, never raised)' do
      logged = []
      allow(AdamStats::Scraper::DB).to receive(:with_connection).and_raise(StandardError, 'db down')
      allow(AdamStats::Scraper::Simulation::Runner).to receive(:simulate)
        .and_return(status: 'pending', model_version: 'v')
      expect do
        described_class.run([fixture], { fixture.source_url => { 'x' => 1 } }, logger: ->(m) { logged << m })
      end.not_to raise_error
      expect(logged.any? { |m| m.include?('non-fatal') }).to be(true)
    end
  end

  describe "#{described_class}'s upsert idempotence (real test DB)" do
    let(:described_hook) { AdamStats::Scraper::SimulationHook }

    before(:all) do
      ENV['DATABASE_URL'] = DBHelper.test_url
      ScraperDBHelper.ensure_schema!
      # 0018 ships in the migration set; reapply explicitly (idempotent
      # `create ... if not exists`) so the partial unique indexes exist even
      # if the test DB was provisioned before this migration was added.
      DBHelper.apply_migration!('0018_fixture_simulations.sql')
      # 0021 (F5) amplia as duas partial unique indexes incluindo
      # model_version. Reapply explícito porque o DROP + CREATE é necessário
      # quando o test DB foi provisionado pré-0021 (índice antigo sem MV
      # ainda existe — `create … if not exists` no 0018 não o substituiria).
      DBHelper.apply_migration!('0021_fixture_simulations_model_version_dedup.sql')
    end

    before(:each) do
      conn = DBHelper.connect
      conn.query('TRUNCATE TABLE fixture_simulations RESTART IDENTITY')
      conn.close
    end

    def count_sims
      conn = DBHelper.connect
      rows = conn.query('SELECT * FROM fixture_simulations ORDER BY id').to_a
      conn.close
      rows
    end

    def sim_result(p_home)
      { status: 'pending', model_version: 'v', p_home: p_home, p_draw: 0.3,
        p_away: (0.7 - p_home).round(4), p_btts: 0.5, p_over_25: 0.5,
        top_scorelines: [], sim_stats: {}, per_half_available: false,
        market_anchor: {}, player_events: [] }
    end

    it 're-running the hook for the SAME keyed fixture REPLACES the row (1 row, latest values)' do
      fx = AdamStats::Scraper::Fixture.new(
        match_date: Date.new(2026, 5, 18), ko_time: '20:00',
        home_team: 'A', away_team: 'B', league: 'L',
        source_url: '/fixture/424242/l-a-vs-b', country: nil
      )

      allow(AdamStats::Scraper::Simulation::Runner).to receive(:simulate).and_return(sim_result(0.10))
      described_hook.run([fx], { fx.source_url => { 'x' => 1 } }, logger: ->(_) {})

      allow(AdamStats::Scraper::Simulation::Runner).to receive(:simulate).and_return(sim_result(0.55))
      described_hook.run([fx], { fx.source_url => { 'x' => 2 } }, logger: ->(_) {})

      rows = count_sims
      expect(rows.length).to eq(1)
      expect(rows.first['p_home'].to_f).to be_within(1e-6).of(0.55)
      expect(rows.first['fixture_id'].to_i).to eq(424_242)
    end

    it 're-running the hook for the SAME null-fixture_id fixture REPLACES the row (1 row, latest values)' do
      # No numeric id in source_url ⇒ fixture_id resolves to nil ⇒
      # dedup falls to (home_team, away_team, kickoff_utc).
      fx = AdamStats::Scraper::Fixture.new(
        match_date: Date.new(2026, 5, 18), ko_time: '20:00',
        home_team: 'NoIdHome', away_team: 'NoIdAway', league: 'L',
        source_url: '/fixture/l-noidhome-vs-noidaway', country: nil
      )

      allow(AdamStats::Scraper::Simulation::Runner).to receive(:simulate).and_return(sim_result(0.20))
      described_hook.run([fx], { fx.source_url => { 'x' => 1 } }, logger: ->(_) {})

      allow(AdamStats::Scraper::Simulation::Runner).to receive(:simulate).and_return(sim_result(0.61))
      described_hook.run([fx], { fx.source_url => { 'x' => 2 } }, logger: ->(_) {})

      rows = count_sims
      expect(rows.length).to eq(1)
      expect(rows.first['p_home'].to_f).to be_within(1e-6).of(0.61)
      expect(rows.first['fixture_id']).to be_nil
    end

    # ------------------------------------------------------------------
    # Incremental pre-check (fix/sim-hook-incremental): antes da MC cara,
    # um SELECT barato decide SIMULAR vs PULAR. Fecha o estouro do timeout
    # do scrape (re-simulava TODA fixture todo dia) E o clobber de linha
    # já reconciliada (resolved/unresolvable) que destruía calibração.
    # ------------------------------------------------------------------
    let(:current_mv) { AdamStats::Scraper::Simulation::Runner::MODEL_VERSION }

    def sim_result_mv(p_home, model_version: 'v', status: 'pending')
      sim_result(p_home).merge(model_version: model_version, status: status)
    end

    def insert_existing_row(fixture_id:, home:, away:, kickoff:, model_version:, status:,
                            p_home: 0.10, resolved: false)
      conn = DBHelper.connect
      conn.exec_params(
        "INSERT INTO fixture_simulations " \
        "(fixture_id, home_team, away_team, league, kickoff_utc, model_version, " \
        " p_home, p_draw, p_away, status" \
        "#{resolved ? ', actual_home_goals, actual_away_goals, correct_winner, correct_over_under, actual_resolved_at' : ''}) " \
        "VALUES ($1,$2,$3,'L',$4::timestamptz,$5,$6,0.3,0.2,$7" \
        "#{resolved ? ',2,1,true,true,now()' : ''})",
        [fixture_id, home, away, kickoff, model_version, p_home, status]
      )
      conn.close
    end

    it '1. no existing row → a fixture_simulations row IS created (new fixture)' do
      fx = AdamStats::Scraper::Fixture.new(
        match_date: Date.new(2026, 5, 18), ko_time: '20:00',
        home_team: 'A', away_team: 'B', league: 'L',
        source_url: '/fixture/424242/l-a-vs-b', country: nil
      )
      allow(AdamStats::Scraper::Simulation::Runner).to receive(:simulate)
        .and_return(sim_result_mv(0.10, model_version: current_mv))

      described_hook.run([fx], { fx.source_url => { 'x' => 1 } }, logger: ->(_) {})

      rows = count_sims
      expect(rows.length).to eq(1)
      expect(rows.first['fixture_id'].to_i).to eq(424_242)
    end

    it '2. existing pending row with SAME model_version → SKIP (no simulate, row intact)' do
      fx = AdamStats::Scraper::Fixture.new(
        match_date: Date.new(2026, 5, 18), ko_time: '20:00',
        home_team: 'A', away_team: 'B', league: 'L',
        source_url: '/fixture/424242/l-a-vs-b', country: nil
      )
      kickoff = AdamStats::Scraper::UkTimeHelper
                .to_utc_or_noon(fx.match_date, fx.ko_time)
                .strftime('%Y-%m-%d %H:%M:%S UTC')
      insert_existing_row(fixture_id: 424_242, home: 'A', away: 'B',
                          kickoff: kickoff, model_version: current_mv,
                          status: 'pending', p_home: 0.99)
      before_row = count_sims.first

      expect(AdamStats::Scraper::Simulation::Runner).not_to receive(:simulate)
      described_hook.run([fx], { fx.source_url => { 'x' => 1 } }, logger: ->(_) {})

      rows = count_sims
      expect(rows.length).to eq(1)
      expect(rows.first['id']).to eq(before_row['id'])
      expect(rows.first['p_home'].to_f).to be_within(1e-6).of(0.99)
      expect(rows.first['created_at']).to eq(before_row['created_at'])
    end

    it '3. existing RESOLVED row → SKIP: reconciliation columns UNTOUCHED (calibration not clobbered)' do
      fx = AdamStats::Scraper::Fixture.new(
        match_date: Date.new(2026, 5, 18), ko_time: '20:00',
        home_team: 'A', away_team: 'B', league: 'L',
        source_url: '/fixture/424242/l-a-vs-b', country: nil
      )
      kickoff = AdamStats::Scraper::UkTimeHelper
                .to_utc_or_noon(fx.match_date, fx.ko_time)
                .strftime('%Y-%m-%d %H:%M:%S UTC')
      insert_existing_row(fixture_id: 424_242, home: 'A', away: 'B',
                          kickoff: kickoff, model_version: current_mv,
                          status: 'resolved', p_home: 0.42, resolved: true)
      before_row = count_sims.first

      expect(AdamStats::Scraper::Simulation::Runner).not_to receive(:simulate)
      described_hook.run([fx], { fx.source_url => { 'x' => 1 } }, logger: ->(_) {})

      rows = count_sims
      expect(rows.length).to eq(1)
      r = rows.first
      expect(r['id']).to eq(before_row['id'])
      expect(r['status']).to eq('resolved')
      expect(r['actual_home_goals'].to_i).to eq(2)
      expect(r['actual_away_goals'].to_i).to eq(1)
      expect(r['correct_winner']).to eq('t')
      expect(r['actual_resolved_at']).to eq(before_row['actual_resolved_at'])
      expect(r['p_home'].to_f).to be_within(1e-6).of(0.42)
    end

    # F5: model_version entra na chave de dedup (migration 0021). Quando a
    # MODEL_VERSION bumpa (v4→v5), a row v4 antiga é PRESERVADA como histórico
    # e uma NOVA row v5 é INSERIDA em paralelo — não há mais sobrescrita.
    # /calibracao agora consegue comparar Brier entre versões.
    it '4. existing row with DIFFERENT model_version → PRESERVA antiga e INSERE nova (F5 histórico)' do
      fx = AdamStats::Scraper::Fixture.new(
        match_date: Date.new(2026, 5, 18), ko_time: '20:00',
        home_team: 'A', away_team: 'B', league: 'L',
        source_url: '/fixture/424242/l-a-vs-b', country: nil
      )
      kickoff = AdamStats::Scraper::UkTimeHelper
                .to_utc_or_noon(fx.match_date, fx.ko_time)
                .strftime('%Y-%m-%d %H:%M:%S UTC')
      insert_existing_row(fixture_id: 424_242, home: 'A', away: 'B',
                          kickoff: kickoff, model_version: 'sim-OLD',
                          status: 'pending', p_home: 0.10)

      allow(AdamStats::Scraper::Simulation::Runner).to receive(:simulate)
        .and_return(sim_result_mv(0.77, model_version: current_mv))
      described_hook.run([fx], { fx.source_url => { 'x' => 1 } }, logger: ->(_) {})

      rows = count_sims
      # Histórico preservado: 2 linhas (v-OLD + v-current), uma por versão.
      expect(rows.length).to eq(2)
      by_mv = rows.group_by { |r| r['model_version'] }
      expect(by_mv['sim-OLD'].length).to eq(1)
      expect(by_mv[current_mv].length).to eq(1)
      # Row antiga intacta; row nova com os números v-current.
      expect(by_mv['sim-OLD'].first['p_home'].to_f).to be_within(1e-6).of(0.10)
      expect(by_mv[current_mv].first['p_home'].to_f).to be_within(1e-6).of(0.77)
    end

    # F5: re-run sob a MESMA model_version corrente é idempotente para a row
    # daquela versão E não toca uma row de versão diferente que coexista.
    # (Smoke-cover dos predicados de model_version nos índices uniques de 0021.)
    it '4b. F5 coexistência: re-run sob MV-corrente atualiza só a row da versão corrente; histórico intacto' do
      fx = AdamStats::Scraper::Fixture.new(
        match_date: Date.new(2026, 5, 18), ko_time: '20:00',
        home_team: 'A', away_team: 'B', league: 'L',
        source_url: '/fixture/424242/l-a-vs-b', country: nil
      )
      kickoff = AdamStats::Scraper::UkTimeHelper
                .to_utc_or_noon(fx.match_date, fx.ko_time)
                .strftime('%Y-%m-%d %H:%M:%S UTC')
      # Histórico v-OLD permanece intocado.
      insert_existing_row(fixture_id: 424_242, home: 'A', away: 'B',
                          kickoff: kickoff, model_version: 'sim-OLD',
                          status: 'pending', p_home: 0.10)
      # Primeira rodada da v-current: nova linha em paralelo (esperado: 2 linhas).
      allow(AdamStats::Scraper::Simulation::Runner).to receive(:simulate)
        .and_return(sim_result_mv(0.55, model_version: current_mv))
      described_hook.run([fx], { fx.source_url => { 'x' => 1 } }, logger: ->(_) {})
      expect(count_sims.length).to eq(2)

      # Segunda rodada na MESMA v-current: pré-check casa a row da v-current
      # com status=pending ⇒ PULA (não re-simula). A linha v-current
      # permanece com p_home=0.55. Histórico v-OLD intocado.
      expect(AdamStats::Scraper::Simulation::Runner).not_to receive(:simulate)
      described_hook.run([fx], { fx.source_url => { 'x' => 2 } }, logger: ->(_) {})

      rows = count_sims
      expect(rows.length).to eq(2)
      by_mv = rows.group_by { |r| r['model_version'] }
      expect(by_mv['sim-OLD'].first['p_home'].to_f).to be_within(1e-6).of(0.10)
      expect(by_mv[current_mv].first['p_home'].to_f).to be_within(1e-6).of(0.55)
    end

    it '5. pre-check SELECT failure → fail-open (still simulates; one error never drops the sim)' do
      fx = AdamStats::Scraper::Fixture.new(
        match_date: Date.new(2026, 5, 18), ko_time: '20:00',
        home_team: 'A', away_team: 'B', league: 'L',
        source_url: '/fixture/424242/l-a-vs-b', country: nil
      )
      allow(AdamStats::Scraper::Simulation::Runner).to receive(:simulate)
        .and_return(sim_result_mv(0.33, model_version: current_mv))

      # Make ONLY the pre-check SELECT raise; DELETE/INSERT must still run.
      real_exec = AdamStats::Scraper::DB.method(:with_connection)
      allow(AdamStats::Scraper::DB).to receive(:with_connection) do |&blk|
        real_exec.call do |conn|
          orig = conn.method(:exec_params)
          allow(conn).to receive(:exec_params) do |sql, *args|
            raise PG::Error, 'precheck boom' if sql.match?(/SELECT/i) && sql.match?(/fixture_simulations/i)

            orig.call(sql, *args)
          end
          blk.call(conn)
        end
      end

      logged = []
      described_hook.run([fx], { fx.source_url => { 'x' => 1 } }, logger: ->(m) { logged << m })

      rows = count_sims
      expect(rows.length).to eq(1)
      expect(rows.first['p_home'].to_f).to be_within(1e-6).of(0.33)
    end
  end

  # ────────────────────────────────────────────────────────────────────────────
  # SimulationReconciler — bug crítico documentado: o reconciler de simulações
  # existia, tinha specs verdes isoladas, mas NUNCA era chamado pelo pipeline
  # diário. Resultado: 665 fixture_simulations ficaram `pending` por dias,
  # bloqueando calibração downstream. Padrão idêntico ao PredictionReconciler
  # (rescue isolado, não-fatal, logger).
  # ────────────────────────────────────────────────────────────────────────────
  describe '.run (SimulationReconciler — wired no pipeline diário)' do
    it 'invokes SimulationReconciler#run exactly once during the daily scrape' do
      deps = build_deps
      fake_recon = double('sim_reconciler')
      expect(fake_recon).to receive(:run).once.and_return(resolved: 3, pending: 1, unresolvable: 0)
      expect(AdamStats::Scraper::SimulationReconciler).to receive(:new)
        .with(logger: kind_of(Proc))
        .and_return(fake_recon)

      described_class.run(**deps)
    end

    it 'invokes SimulationReconciler AFTER PredictionReconciler (ordering matters)' do
      deps = build_deps
      ordered = []

      fake_pred_recon = double('pred_reconciler')
      allow(fake_pred_recon).to receive(:run) do
        ordered << :prediction_reconciler
        { resolved: 0, pending: 0, unresolvable: 0 }
      end
      allow(AdamStats::Scraper::PredictionReconciler).to receive(:new).and_return(fake_pred_recon)

      fake_sim_recon = double('sim_reconciler')
      allow(fake_sim_recon).to receive(:run) do
        ordered << :simulation_reconciler
        { resolved: 0, pending: 0, unresolvable: 0 }
      end
      allow(AdamStats::Scraper::SimulationReconciler).to receive(:new).and_return(fake_sim_recon)

      described_class.run(**deps)
      expect(ordered).to eq(%i[prediction_reconciler simulation_reconciler])
    end

    it 'a SimulationReconciler failure is non-fatal (logged with "non-fatal", pipeline continues)' do
      deps = build_deps
      logged = []
      deps[:logger] = ->(m) { logged << m }

      fake_recon = double('sim_reconciler')
      allow(fake_recon).to receive(:run).and_raise(StandardError, 'sim recon boom')
      allow(AdamStats::Scraper::SimulationReconciler).to receive(:new).and_return(fake_recon)

      # Pipeline finishes successfully and pings healthcheck success.
      expect(deps[:healthcheck]).to receive(:ping_success)
      expect { described_class.run(**deps) }.not_to raise_error

      # Logger registers a non-fatal message mentioning the reconciler.
      expect(logged.any? { |m| m.match?(/sim-reconciler/i) && m.include?('non-fatal') }).to be(true)
    end
  end

  # ────────────────────────────────────────────────────────────────────────────
  # AiRecommendationReconciler — Wave 2 do IA-2 Recomendador.
  # Espelha o teste do SimulationReconciler — wire + ordering + rescue isolado.
  # ────────────────────────────────────────────────────────────────────────────
  describe '.run (AiRecommendationReconciler — wired no pipeline diário)' do
    it 'invokes AiRecommendationReconciler#run exatamente uma vez no scrape diário' do
      deps = build_deps
      fake_recon = double('ai_reco_reconciler')
      expect(fake_recon).to receive(:run).once.and_return(resolved: 0, pending: 0, unresolvable: 0)
      expect(AdamStats::Scraper::AiRecommendationReconciler).to receive(:new)
        .with(logger: kind_of(Proc))
        .and_return(fake_recon)

      described_class.run(**deps)
    end

    it 'invokes AiRecommendationReconciler DEPOIS de SimulationReconciler (ordering matters)' do
      deps = build_deps
      ordered = []

      fake_sim_recon = double('sim_reconciler')
      allow(fake_sim_recon).to receive(:run) do
        ordered << :simulation_reconciler
        { resolved: 0, pending: 0, unresolvable: 0 }
      end
      allow(AdamStats::Scraper::SimulationReconciler).to receive(:new).and_return(fake_sim_recon)

      fake_ai_recon = double('ai_reco_reconciler')
      allow(fake_ai_recon).to receive(:run) do
        ordered << :ai_recommendation_reconciler
        { resolved: 0, pending: 0, unresolvable: 0 }
      end
      allow(AdamStats::Scraper::AiRecommendationReconciler).to receive(:new).and_return(fake_ai_recon)

      described_class.run(**deps)
      expect(ordered).to eq(%i[simulation_reconciler ai_recommendation_reconciler])
    end

    it 'uma falha do AiRecommendationReconciler é non-fatal (pipeline continua)' do
      deps = build_deps
      logged = []
      deps[:logger] = ->(m) { logged << m }

      fake_recon = double('ai_reco_reconciler')
      allow(fake_recon).to receive(:run).and_raise(StandardError, 'ai-reco recon boom')
      allow(AdamStats::Scraper::AiRecommendationReconciler).to receive(:new).and_return(fake_recon)

      expect(deps[:healthcheck]).to receive(:ping_success)
      expect { described_class.run(**deps) }.not_to raise_error

      expect(logged.any? { |m| m.match?(/ai-reco-reconciler/i) && m.include?('non-fatal') }).to be(true)
    end
  end

  # ────────────────────────────────────────────────────────────────────────────
  # AiRecommenderRunner — Wave 2 do IA-2 Recomendador.
  # Roda no FIM do pipeline (após baseline.recompute!).
  # ────────────────────────────────────────────────────────────────────────────
  describe '.run (AiRecommenderRunner — wired no pipeline diário)' do
    it 'invokes AiRecommenderRunner#run exatamente uma vez por scrape' do
      deps = build_deps
      fake_runner = double('ai_recommender')
      expect(fake_runner).to receive(:run).once.and_return({ inserted_recos: 1, errors: 0 })
      expect(AdamStats::Scraper::AiRecommenderRunner).to receive(:new)
        .with(logger: kind_of(Proc))
        .and_return(fake_runner)

      described_class.run(**deps)
    end

    it 'AiRecommenderRunner roda DEPOIS de AiRecommendationReconciler' do
      deps = build_deps
      ordered = []

      fake_recon = double('ai_reco_reconciler')
      allow(fake_recon).to receive(:run) do
        ordered << :ai_reco_reconciler
        { resolved: 0, pending: 0, unresolvable: 0 }
      end
      allow(AdamStats::Scraper::AiRecommendationReconciler).to receive(:new).and_return(fake_recon)

      fake_runner = double('ai_recommender')
      allow(fake_runner).to receive(:run) do
        ordered << :ai_recommender
        { inserted_recos: 1, errors: 0 }
      end
      allow(AdamStats::Scraper::AiRecommenderRunner).to receive(:new).and_return(fake_runner)

      described_class.run(**deps)
      expect(ordered).to eq(%i[ai_reco_reconciler ai_recommender])
    end

    it 'uma falha do AiRecommenderRunner é non-fatal (pipeline continua)' do
      deps = build_deps
      logged = []
      deps[:logger] = ->(m) { logged << m }

      fake_runner = double('ai_recommender')
      allow(fake_runner).to receive(:run).and_raise(StandardError, 'ai-rec boom')
      allow(AdamStats::Scraper::AiRecommenderRunner).to receive(:new).and_return(fake_runner)

      expect(deps[:healthcheck]).to receive(:ping_success)
      expect { described_class.run(**deps) }.not_to raise_error

      expect(logged.any? { |m| m.match?(/ai-recommender/i) && m.include?('non-fatal') }).to be(true)
    end
  end

  # ────────────────────────────────────────────────────────────────────────────
  # A4 — Silent-death detector pro AI Recommender.
  # Quando o runner volta {inserted_recos: 0} (ou raise) MAS o DB ainda tem
  # > 10 fixtures que CABERIAM no FIXTURES_QUERY, algo quebrou silenciosamente.
  # Dispara healthchecks /fail num check SEPARADO (HEALTHCHECKS_AI_RECO_URL)
  # — o check geral do scrape continua verde pois persist/reconciler rodaram OK.
  # ────────────────────────────────────────────────────────────────────────────
  describe '.run (AI Recommender — silent-death detector)' do
    around(:each) do |ex|
      prev = ENV['HEALTHCHECKS_AI_RECO_URL']
      ex.run
      ENV['HEALTHCHECKS_AI_RECO_URL'] = prev
    end

    def repo_with_count(purge:, pending:)
      double('repo', purge_older_than: purge, count_fixtures_eligible_for_reco: pending)
    end

    it 'dispara alerta (log SILENT DEATH + ping /fail) quando created=0 e pending>10' do
      ENV['HEALTHCHECKS_AI_RECO_URL'] = 'https://hc-ping.com/ai-reco-uuid'
      logged = []
      deps = build_deps
      deps[:logger] = ->(m) { logged << m }
      deps[:repo] = repo_with_count(purge: 0, pending: 15)

      fake_runner = double('ai_recommender')
      allow(fake_runner).to receive(:run).and_return({ inserted_recos: 0, errors: 0 })
      allow(AdamStats::Scraper::AiRecommenderRunner).to receive(:new).and_return(fake_runner)

      # ping_failure deve ser chamado com a URL do check separado.
      expect(deps[:healthcheck]).to receive(:ping_failure).with('https://hc-ping.com/ai-reco-uuid')
      expect(deps[:healthcheck]).to receive(:ping_success) # scrape geral OK

      described_class.run(**deps)

      expect(logged.any? { |m| m.include?('SILENT DEATH') }).to be(true)
      expect(logged.any? { |m| m.include?('15 fixtures pending') }).to be(true)
    end

    it 'NÃO dispara alerta quando created>=1 (mesmo com pending>10)' do
      ENV['HEALTHCHECKS_AI_RECO_URL'] = 'https://hc-ping.com/ai-reco-uuid'
      logged = []
      deps = build_deps
      deps[:logger] = ->(m) { logged << m }
      deps[:repo] = repo_with_count(purge: 0, pending: 15)

      fake_runner = double('ai_recommender')
      allow(fake_runner).to receive(:run).and_return({ inserted_recos: 5, errors: 0 })
      allow(AdamStats::Scraper::AiRecommenderRunner).to receive(:new).and_return(fake_runner)

      # ping_failure (do alerta) NUNCA chamado nesse caso.
      expect(deps[:healthcheck]).not_to receive(:ping_failure)
      expect(deps[:healthcheck]).to receive(:ping_success)

      described_class.run(**deps)
      expect(logged.none? { |m| m.include?('SILENT DEATH') }).to be(true)
    end

    it 'NÃO dispara alerta quando pending==0 (não tem nada pra recomendar)' do
      ENV['HEALTHCHECKS_AI_RECO_URL'] = 'https://hc-ping.com/ai-reco-uuid'
      logged = []
      deps = build_deps
      deps[:logger] = ->(m) { logged << m }
      deps[:repo] = repo_with_count(purge: 0, pending: 0)

      fake_runner = double('ai_recommender')
      allow(fake_runner).to receive(:run).and_return({ inserted_recos: 0, errors: 0 })
      allow(AdamStats::Scraper::AiRecommenderRunner).to receive(:new).and_return(fake_runner)

      expect(deps[:healthcheck]).not_to receive(:ping_failure)
      expect(deps[:healthcheck]).to receive(:ping_success)

      described_class.run(**deps)
      expect(logged.none? { |m| m.include?('SILENT DEATH') }).to be(true)
    end

    it 'NÃO dispara alerta quando pending<=10 (boundary: 10 não dispara, só >10)' do
      ENV['HEALTHCHECKS_AI_RECO_URL'] = 'https://hc-ping.com/ai-reco-uuid'
      deps = build_deps
      deps[:repo] = repo_with_count(purge: 0, pending: 10)

      fake_runner = double('ai_recommender')
      allow(fake_runner).to receive(:run).and_return({ inserted_recos: 0, errors: 0 })
      allow(AdamStats::Scraper::AiRecommenderRunner).to receive(:new).and_return(fake_runner)

      expect(deps[:healthcheck]).not_to receive(:ping_failure)
      described_class.run(**deps)
    end

    it 'quando HEALTHCHECKS_AI_RECO_URL vazio: loga SILENT DEATH mas NÃO tenta HTTP (degradação graciosa)' do
      ENV['HEALTHCHECKS_AI_RECO_URL'] = ''
      logged = []
      deps = build_deps
      deps[:logger] = ->(m) { logged << m }
      deps[:repo] = repo_with_count(purge: 0, pending: 25)

      fake_runner = double('ai_recommender')
      allow(fake_runner).to receive(:run).and_return({ inserted_recos: 0, errors: 0 })
      allow(AdamStats::Scraper::AiRecommenderRunner).to receive(:new).and_return(fake_runner)

      # ping_failure do alerta NUNCA chamado (URL vazia ⇒ skip silencioso).
      expect(deps[:healthcheck]).not_to receive(:ping_failure)
      expect(deps[:healthcheck]).to receive(:ping_success)

      described_class.run(**deps)
      # O log ainda dispara — Pilot vê em CI logs mesmo sem o check externo.
      expect(logged.any? { |m| m.include?('SILENT DEATH') }).to be(true)
    end

    it 'quando ENV não setada (nil): comportamento idêntico a vazia (degradação graciosa)' do
      ENV.delete('HEALTHCHECKS_AI_RECO_URL')
      logged = []
      deps = build_deps
      deps[:logger] = ->(m) { logged << m }
      deps[:repo] = repo_with_count(purge: 0, pending: 25)

      fake_runner = double('ai_recommender')
      allow(fake_runner).to receive(:run).and_return({ inserted_recos: 0, errors: 0 })
      allow(AdamStats::Scraper::AiRecommenderRunner).to receive(:new).and_return(fake_runner)

      expect(deps[:healthcheck]).not_to receive(:ping_failure)
      expect { described_class.run(**deps) }.not_to raise_error
      expect(logged.any? { |m| m.include?('SILENT DEATH') }).to be(true)
    end

    it 'dispara alerta quando runner LEVANTA exceção (rescue captura → reco_stats=zeros → branch acende)' do
      ENV['HEALTHCHECKS_AI_RECO_URL'] = 'https://hc-ping.com/ai-reco-uuid'
      logged = []
      deps = build_deps
      deps[:logger] = ->(m) { logged << m }
      deps[:repo] = repo_with_count(purge: 0, pending: 20)

      fake_runner = double('ai_recommender')
      allow(fake_runner).to receive(:run).and_raise(StandardError, 'OpenRouter 401')
      allow(AdamStats::Scraper::AiRecommenderRunner).to receive(:new).and_return(fake_runner)

      expect(deps[:healthcheck]).to receive(:ping_failure).with('https://hc-ping.com/ai-reco-uuid')
      expect(deps[:healthcheck]).to receive(:ping_success)

      described_class.run(**deps)
      expect(logged.any? { |m| m.include?('non-fatal') && m.include?('ai-recommender') }).to be(true)
      expect(logged.any? { |m| m.include?('SILENT DEATH') }).to be(true)
    end

    it 'RunStats expõe recommendations_created (campo novo)' do
      deps = build_deps
      fake_runner = double('ai_recommender', run: { inserted_recos: 7, errors: 1 })
      allow(AdamStats::Scraper::AiRecommenderRunner).to receive(:new).and_return(fake_runner)

      stats = described_class.run(**deps)
      expect(stats.recommendations_created).to eq(7)
    end

    it 'emite log JSON-line [scrape] FINAL no fim (grep-friendly em CI)' do
      ENV['HEALTHCHECKS_AI_RECO_URL'] = 'https://hc-ping.com/ai-reco-uuid'
      logged = []
      deps = build_deps
      deps[:logger] = ->(m) { logged << m }
      deps[:repo] = repo_with_count(purge: 0, pending: 5)

      fake_runner = double('ai_recommender', run: { inserted_recos: 3, errors: 0 })
      allow(AdamStats::Scraper::AiRecommenderRunner).to receive(:new).and_return(fake_runner)

      described_class.run(**deps)

      final = logged.find { |m| m.start_with?('[scrape] FINAL:') }
      expect(final).not_to be_nil
      payload = JSON.parse(final.sub('[scrape] FINAL: ', ''))
      expect(payload['recommendations_created']).to eq(3)
      expect(payload['ai_reco_silent_death']).to eq(false)
      expect(payload).to have_key('scrape_at')
      expect(payload).to have_key('fixtures_listed')
    end
  end
end
