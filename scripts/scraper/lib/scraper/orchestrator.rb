require 'json'
require_relative 'db'
require_relative 'fetcher'
require_relative 'api_list_fetcher'
require_relative 'choistats_api_fetcher'
require_relative 'detail_page_fetcher'
require_relative 'healthcheck'
require_relative 'parser'
require_relative 'persister'
require_relative 'detail_parser'
require_relative 'league_baseline'
require_relative 'playwright_session'
require_relative 'prediction_reconciler'
require_relative 'simulation/runner'
require_relative 'uk_time_helper'

module AdamStats
  module Scraper
    RunStats = Data.define(:fetched, :persisted_inserted, :persisted_updated, :deleted)

    module DefaultRepo
      module_function

      # Purge fixtures older than `days` days.
      # Uses kickoff_utc when available (more precise: based on actual game time).
      # Falls back to match_date for rows without kickoff_utc (pre-migration data).
      def purge_older_than(days)
        AdamStats::Scraper::DB.with_connection do |conn|
          conn.exec_params(
            "DELETE FROM fixtures WHERE " \
            "  (kickoff_utc IS NOT NULL AND kickoff_utc < now() - $1::int * INTERVAL '1 day') " \
            "  OR (kickoff_utc IS NULL AND match_date < CURRENT_DATE - $1::int * INTERVAL '1 day')",
            [days]
          ).cmd_tuples
        end
      end
    end

    # Post-persist hook: computa a simulação pré-jogo (Runner.simulate) para
    # cada fixture com detail e faz upsert em fixture_simulations. CADA fixture
    # é isolada num rescue StandardError que só loga warning — uma fixture
    # problemática NUNCA derruba o scrape (Lição #11). O Runner já degrada sem
    # raise; este rescue cobre falha de DB/serialização por linha.
    module SimulationHook
      # Idempotência: o scraper re-simula a MESMA fixture todo dia. Há DUAS
      # partial unique indexes em fixture_simulations (0018) — uma para linhas
      # com fixture_id, outra para linhas sem. Um único `ON CONFLICT (cols)`
      # não consegue mirar as duas de forma limpa.
      #
      # Design escolhido (o mais simples CORRETO): DELETE-then-INSERT da
      # identidade da fixture, ambos na MESMA conexão/transação por fixture.
      # O DELETE cobre os dois caminhos (com e sem fixture_id) com um único
      # predicado, sem ramificar SQL nem precisar de dois statements
      # ON CONFLICT distintos. Garantia líquida: re-rodar o scraper para a
      # mesma fixture SUBSTITUI a linha (idempotente), nunca empilha — e fecha
      # de quebra o risco de linha meio-escrita (DELETE+INSERT atômico).
      #
      # Predicado de identidade espelha exatamente as duas unique indexes:
      #   - fixture_id presente → casa por (fixture_id, kickoff_utc)
      #   - fixture_id nil      → casa por (home_team, away_team, kickoff_utc)
      # kickoff_utc nil é comparado via IS NOT DISTINCT FROM (NULL = NULL).
      #
      # Params (posicional): $1 fixture_id, $2 home_team, $3 away_team,
      # $4 kickoff_utc. `league` NÃO é bound aqui (não faz parte de nenhuma
      # das duas chaves de dedup) — ver #delete_params.
      DELETE_PRIOR_SQL = <<~SQL.freeze
        DELETE FROM fixture_simulations
        WHERE (
          $1::bigint IS NOT NULL
          AND fixture_id = $1::bigint
          AND kickoff_utc IS NOT DISTINCT FROM $4::timestamptz
        ) OR (
          $1::bigint IS NULL
          AND fixture_id IS NULL
          AND home_team = $2
          AND away_team = $3
          AND kickoff_utc IS NOT DISTINCT FROM $4::timestamptz
        )
      SQL

      INSERT_SQL = <<~SQL.freeze
        INSERT INTO fixture_simulations
          (fixture_id, home_team, away_team, league, kickoff_utc, model_version,
           p_home, p_draw, p_away, p_btts, p_over_25,
           top_scorelines, sim_stats, per_half_available, market_anchor,
           player_events, status, created_at)
        VALUES ($1, $2, $3, $4, $5::timestamptz, $6,
                $7, $8, $9, $10, $11,
                $12::jsonb, $13::jsonb, $14, $15::jsonb, $16::jsonb, $17, now())
      SQL

      module_function

      # fixtures               — Array<Fixture> (parsed list)
      # detail_json_by_source_url — { source_url => detail hash }
      def run(fixtures, detail_json_by_source_url, logger:)
        return if detail_json_by_source_url.nil? || detail_json_by_source_url.empty?

        by_source = {}
        fixtures.each { |fx| by_source[fx.source_url] = fx }

        AdamStats::Scraper::DB.with_connection do |conn|
          detail_json_by_source_url.each do |source_url, detail|
            fixture = by_source[source_url]
            next if fixture.nil?

            begin
              sim = Simulation::Runner.simulate(detail)
              next if sim.nil? || sim[:status] == 'unsimulable'

              params = build_params(fixture, sim)
              # DELETE+INSERT atômico por fixture: re-rodar substitui a linha
              # (idempotente), nunca empilha. Lição #11: o rescue abaixo isola
              # a fixture; ROLLBACK garante que uma falha não deixa a linha
              # antiga apagada sem a nova no lugar.
              conn.transaction do
                conn.exec_params(DELETE_PRIOR_SQL, delete_params(params))
                conn.exec_params(INSERT_SQL, params)
              end
            rescue StandardError => e
              logger.call("[scrape] simulation failed for #{source_url}: #{e.class}: #{e.message}")
            end
          end
        end
      rescue StandardError => e
        # Falha global do hook (ex.: DB indisponível) — non-fatal, igual ao
        # reconciler/baseline. O scrape em si já persistiu as fixtures.
        logger.call("[scrape] simulation hook failed (non-fatal): #{e.class}: #{e.message}")
      end

      # Extrai os 4 params da identidade de dedup a partir do array completo
      # de build_params ([fixture_id, home, away, league, kickoff, ...]).
      # Ordem casa com DELETE_PRIOR_SQL: $1 fixture_id, $2 home, $3 away,
      # $4 kickoff (league/idx 3 é descartado — não é chave).
      def delete_params(params)
        [params[0], params[1], params[2], params[4]]
      end
      private_class_method :delete_params

      def build_params(fixture, sim)
        kickoff = UkTimeHelper.to_utc_or_noon(fixture.match_date, fixture.ko_time)
        [
          fixture_api_id(fixture),
          fixture.home_team,
          fixture.away_team,
          fixture.league,
          kickoff&.strftime('%Y-%m-%d %H:%M:%S UTC'),
          sim[:model_version],
          sim[:p_home], sim[:p_draw], sim[:p_away], sim[:p_btts], sim[:p_over_25],
          JSON.generate(sim[:top_scorelines] || []),
          JSON.generate(sim[:sim_stats] || {}),
          sim[:per_half_available],
          JSON.generate(sim[:market_anchor] || {}),
          JSON.generate(sim[:player_events] || []),
          sim[:status] || 'pending'
        ]
      end
      private_class_method :build_params

      # source_url shape: /fixture/<id>/<slug> — extrai o id numérico se houver.
      def fixture_api_id(fixture)
        m = fixture.source_url.to_s.match(%r{/fixture/(\d+)})
        m && m[1].to_i
      end
      private_class_method :fixture_api_id
    end

    module Orchestrator
      DEFAULT_LIST_SELECTOR = 'tr[data-ng-repeat*="fixture in"]'.freeze
      DEFAULT_DETAIL_SELECTOR = 'tbody tr td'.freeze
      DEFAULT_RETENTION_DAYS = 3
      # HTTP-direct via ChoistatsApiFetcher handles 4 concurrent workers without
      # the Playwright page-pool degradation. DetailPageFetcher (deprecated) was
      # limited to 1 to avoid listener accumulation / Chromium memory leak.
      DEFAULT_DETAIL_CONCURRENCY = (ENV['SCRAPER_DETAIL_CONCURRENCY'] || '4').to_i
      DEFAULT_LEAGUE_SLUGS = (ENV['SCRAPER_LEAGUE_SLUGS'] || '').split(',').map(&:strip).reject(&:empty?).freeze

      module_function

      # Selects the default list fetcher based on env.
      # SCRAPER_USE_PLAYWRIGHT_LIST=1 forces the legacy Playwright+Parser path.
      # Default: ApiListFetcher (HTTP-direct, no browser).
      def default_list_fetcher
        if ENV['SCRAPER_USE_PLAYWRIGHT_LIST'].to_s.strip == '1'
          Fetcher
        else
          ApiListFetcher.new
        end
      end
      private_class_method :default_list_fetcher

      # Internal hook for testing: wraps the fetcher so specs can intercept.
      def resolve_list_fetcher(fetcher)
        fetcher
      end
      private_class_method :resolve_list_fetcher

      def run(
        base_url: ENV.fetch('SCRAPER_TARGET_BASE_URL', 'https://www.adamchoi.co.uk'),
        success_url: ENV['HEALTHCHECKS_URL'],
        fail_url: ENV['HEALTHCHECKS_FAIL_URL'] || (ENV['HEALTHCHECKS_URL'] && "#{ENV['HEALTHCHECKS_URL']}/fail"),
        fetcher: default_list_fetcher,
        detail_fetcher: ChoistatsApiFetcher.new,
        detail_session: nil,
        detail_concurrency: DEFAULT_DETAIL_CONCURRENCY,
        parser: Parser,
        detail_parser: DetailParser,
        persister: Persister,
        simulation_hook: SimulationHook,
        repo: DefaultRepo,
        baseline: LeagueBaseline,
        healthcheck: Healthcheck,
        retention_days: DEFAULT_RETENTION_DAYS,
        league_slugs: DEFAULT_LEAGUE_SLUGS,
        logger: ->(msg) { warn msg }
      )
        # Ping healthchecks /start no início: se o scrape travar/timeout, healthchecks
        # detecta diferença entre /start sem /success e dispara alerta.
        healthcheck.ping_start(success_url) if success_url
        effective_fetcher = resolve_list_fetcher(fetcher)

        parsed = if effective_fetcher.respond_to?(:fetch_list)
                   # ApiListFetcher path: returns Array<Fixture> directly, no HTML/Parser step.
                   # No Playwright session needed for listing.
                   logger.call('[scrape] listing via ApiListFetcher (HTTP-direct, no browser)')
                   effective_fetcher.fetch_list(
                     days_ahead: ApiListFetcher::DEFAULT_DAYS_AHEAD,
                     from_date: Date.today,
                     league_slugs: [],  # whitelist filtering for detail done below
                     logger: logger
                   )
                 else
                   # Legacy Playwright+Parser path (SCRAPER_USE_PLAYWRIGHT_LIST=1 or explicit Fetcher).
                   logger.call('[scrape] listing via Playwright (legacy, SCRAPER_USE_PLAYWRIGHT_LIST=1)')
                   list_html = effective_fetcher.fetch(
                     "#{base_url}/fixtures",
                     wait_selector: DEFAULT_LIST_SELECTOR
                   )
                   parser.parse_fixtures_list(list_html)
                 end

        fixtures_for_detail = filter_by_league_slugs(parsed, league_slugs)
        if league_slugs.any? && parsed.size != fixtures_for_detail.size
          logger.call("[scrape] league whitelist active: #{fixtures_for_detail.size}/#{parsed.size} fixtures will have detail fetched (slugs=#{league_slugs.join(',')})")
        end

        details_by_url = {}
        if parsed.any?
          if fixtures_for_detail.any?
            details_by_url = collect_details(
              fixtures: fixtures_for_detail,
              base_url: base_url,
              detail_fetcher: detail_fetcher,
              detail_parser: detail_parser,
              detail_session: detail_session,
              detail_concurrency: detail_concurrency,
              logger: logger
            )
          end
          # Persiste TODAS as fixtures parsed — non-whitelisted entram só com
          # metadata (home/away/league/ko_time/source_url) e detail_json=nil,
          # podendo ter o detail puxado on-demand via POST /api/fixtures/:id/refresh-detail.
          stats = persister.persist(parsed, detail_json_by_source_url: details_by_url)

          # Hook aditivo pós-persist: simulação pré-jogo → fixture_simulations.
          # Failure-isolated por fixture E globalmente (Lição #11) — não altera
          # o comportamento existente do scrape.
          simulation_hook.run(parsed, details_by_url, logger: logger)
        else
          stats = Stats.new(inserted: 0, updated: 0, failed: 0)
        end

        # Reconcilia predições pendentes pré-purga: busca placar final via choistats
        # e atualiza ai_predictions. Rescue isolado: falha não derruba o pipeline.
        begin
          recon_stats = PredictionReconciler.new(logger: logger).run
          logger.call("[scrape] reconciler: #{recon_stats.inspect}")
        rescue StandardError => e
          logger.call("[scrape] reconciler failed (non-fatal): #{e.class}: #{e.message}")
        end

        deleted = repo.purge_older_than(retention_days)
        # Recompute league baselines após o batch — agrega trends de todas as
        # fixtures atualmente armazenadas. Não trava o pipeline se falhar.
        begin
          baseline.recompute!
        rescue StandardError => e
          logger.call("[scrape] baseline recompute failed: #{e.class}: #{e.message}")
        end
        run_stats = RunStats.new(
          fetched: parsed.size,
          persisted_inserted: stats.inserted,
          persisted_updated: stats.updated,
          deleted: deleted
        )

        logger.call("[scrape] OK #{run_stats.to_h.inspect}")
        healthcheck.ping_success(success_url) if success_url
        run_stats
      rescue StandardError => e
        logger.call("[scrape] FAILED #{e.class}: #{e.message}")
        healthcheck.ping_failure(fail_url) if fail_url
        raise
      end

      def absolute_url(base, path)
        return nil if path.nil? || path.empty?
        return path if path.start_with?('http')

        "#{base.chomp('/')}#{path.start_with?('/') ? path : "/#{path}"}"
      end
      private_class_method :absolute_url

      # Filtra a lista de fixtures pelos slugs de liga presentes em `source_url`.
      # Whitelist vazia (default) = pass-through (sem filtro).
      # O slug é casado como prefixo + '-' pra evitar 'brazil-serie-a' bater em
      # 'brazil-serie-a-special-cup' por engano.
      def filter_by_league_slugs(fixtures, slugs)
        return fixtures if slugs.nil? || slugs.empty?

        prefixes = slugs.map { |s| "#{s.chomp('-')}-" }
        fixtures.select do |fx|
          path = fx.source_url.to_s.sub(%r{^/fixture/\d+/}, '')
          prefixes.any? { |pre| path.start_with?(pre) }
        end
      end
      private_class_method :filter_by_league_slugs

      def collect_details(fixtures:, base_url:, detail_fetcher:, detail_parser:, detail_session:, detail_concurrency:, logger:)
        targets = fixtures
                  .map { |f| [f.source_url, absolute_url(base_url, f.source_url)] }
                  .reject { |_src, url| url.nil? }

        concurrency = [detail_concurrency.to_i, 1].max
        if detail_session.nil?
          if concurrency > 1 && targets.length > 1
            # HTTP-direct fetchers (e.g. ChoistatsApiFetcher) don't need a Playwright
            # page — they make plain HTTP calls. Use a thread pool calling #fetch(url)
            # directly, without a page pool. Safe: no shared browser state.
            collect_details_threaded(targets,
                                     detail_fetcher: detail_fetcher,
                                     detail_parser: detail_parser,
                                     concurrency: [concurrency, targets.length].min,
                                     logger: logger)
          else
            # Serial fallback — concurrency=1 or single target.
            # Also used by legacy DetailPageFetcher path when no session is passed
            # (e.g. tests, or manual DetailPageFetcher.new with its own session).
            collect_details_serial(targets, detail_fetcher: detail_fetcher, detail_parser: detail_parser, logger: logger)
          end
        else
          # Playwright page pool path — detail_session provides authenticated pages.
          # Used by DetailPageFetcher fallback when Playwright is needed.
          collect_details_parallel(targets,
                                   detail_fetcher: detail_fetcher,
                                   detail_parser: detail_parser,
                                   detail_session: detail_session,
                                   concurrency: [concurrency, targets.length].min,
                                   logger: logger)
        end
      end
      private_class_method :collect_details

      def collect_details_serial(targets, detail_fetcher:, detail_parser:, logger:)
        out = {}
        targets.each do |src_url, abs_url|
          begin
            page = detail_fetcher.fetch(abs_url)
            out[src_url] = detail_parser.parse_detail(page[:html], widgets: page[:widgets]).to_h
          rescue StandardError => e
            logger.call("[scrape] detail fetch failed for #{abs_url}: #{e.class}: #{e.message}")
          end
        end
        out
      end
      private_class_method :collect_details_serial

      # Thread pool for HTTP-direct fetchers (no Playwright page needed).
      # Calls detail_fetcher.fetch(url) from N threads concurrently.
      # Isolates exceptions per-worker (same guarantee as collect_details_parallel).
      def collect_details_threaded(targets, detail_fetcher:, detail_parser:, concurrency:, logger:)
        out = {}
        mutex = Mutex.new
        queue = Thread::Queue.new
        targets.each { |t| queue.push(t) }
        concurrency.times { queue.push(:done) }

        workers = concurrency.times.map do
          Thread.new do
            loop do
              item = queue.pop
              break if item == :done

              src_url, abs_url = item
              begin
                result = detail_fetcher.fetch(abs_url)
                parsed = detail_parser.parse_detail(result[:html], widgets: result[:widgets]).to_h
                mutex.synchronize { out[src_url] = parsed }
              rescue StandardError => e
                logger.call("[scrape] detail fetch failed for #{abs_url}: #{e.class}: #{e.message}")
              end
            end
          end
        end
        workers.each(&:join)
        out
      end
      private_class_method :collect_details_threaded

      def collect_details_parallel(targets, detail_fetcher:, detail_parser:, detail_session:, concurrency:, logger:)
        # Tabela compartilhada protegida por mutex — Hash#[]= não é atômico mesmo em MRI.
        out = {}
        mutex = Mutex.new
        queue = Thread::Queue.new
        targets.each { |t| queue.push(t) }
        concurrency.times { queue.push(:done) }

        detail_session.with_page_pool(size: concurrency) do |pool|
          workers = concurrency.times.map do
            Thread.new do
              loop do
                item = queue.pop
                break if item == :done

                src_url, abs_url = item
                begin
                  pool.acquire do |page|
                    result = detail_fetcher.fetch_with_page(page, abs_url)
                    parsed = detail_parser.parse_detail(result[:html], widgets: result[:widgets]).to_h
                    mutex.synchronize { out[src_url] = parsed }
                  end
                rescue StandardError => e
                  # Isolar a falha por fixture — Thread#join no main re-raise se não
                  # capturarmos aqui, e o ensure do with_pages fecharia o context
                  # antes dos workers irmãos terminarem, gerando TargetClosedError
                  # em cascata. Lição #11 do CLAUDE.md.
                  logger.call("[scrape] detail fetch failed for #{abs_url}: #{e.class}: #{e.message}")
                end
              end
            end
          end
          workers.each(&:join)
        end
        out
      end
      private_class_method :collect_details_parallel
    end
  end
end
