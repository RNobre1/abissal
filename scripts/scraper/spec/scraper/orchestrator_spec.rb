require 'date'
require_relative 'db_helper'
require_relative '../../lib/scraper/orchestrator'
require_relative '../../lib/scraper/choistats_api_fetcher'
require_relative '../../lib/scraper/fixture'
require_relative '../../lib/scraper/page_pool'
require_relative '../../lib/scraper/api_list_fetcher'

RSpec.describe AdamStats::Scraper::Orchestrator do
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
      allow(conn).to receive(:exec_params)
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
      # The good fixture still got upserted — idempotent design issues a
      # DELETE-prior + INSERT per fixture (2 exec_params for the 1 good row).
      expect(conn).to have_received(:exec_params).twice
      expect(conn).to have_received(:transaction).once
    end

    it 'skips upsert for unsimulable results (no raise)' do
      conn = double('conn')
      allow(conn).to receive(:exec_params)
      allow(conn).to receive(:transaction) { |&blk| blk.call }
      allow(AdamStats::Scraper::DB).to receive(:with_connection).and_yield(conn)
      allow(AdamStats::Scraper::Simulation::Runner).to receive(:simulate)
        .and_return(status: 'unsimulable', model_version: 'v')

      described_class.run([fixture], { fixture.source_url => { 'x' => 1 } }, logger: ->(_) {})
      expect(conn).not_to have_received(:exec_params)
    end

    it 'is a no-op when there are no details' do
      expect(AdamStats::Scraper::DB).not_to receive(:with_connection)
      described_class.run([fixture], {}, logger: ->(_) {})
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
  end
end
