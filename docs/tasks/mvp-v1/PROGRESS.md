# MVP v1 — Progress

**Last updated:** 2026-05-11
**Doc level:** completo
**Active wave:** complete — MVP v1 done
**Active task:** none — all 12 tasks merged

---

## Status per task

| Task | Status | Branch | PR | Notes |
|---|---|---|---|---|
| T1 scaffolding-monorepo | [x] Completed 2026-05-11 | `feat/mvp-v1-T1` | merged to main | 33/33 specs green; postgres em :5433 (5432 ocupado local) |
| T2 db-migration-fixtures | [x] Completed 2026-05-11 | `feat/mvp-v1-T2` | merged to main | 13/13 schema specs; idx_fixtures_dedup unique + idx_fixtures_match_date |
| T3 parser-fixtures-list | [x] Completed 2026-05-11 | `feat/mvp-v1-T3` | merged to main | 11/11 specs; parseou 426 fixtures (7 dates, 76 leagues) do snapshot; seletores reais = `td.fixture-team`/`td.ko-time`/`a.fixture-link` (drift do CLAUDE.md) |
| T4 parser-detail-page | [x] Completed 2026-05-11 | `feat/mvp-v1-T4` | merged to main | 13/13 specs; 49 trends extraídos do snapshot real Tottenham vs Leeds; recent/h2h/streak vazios (lazy-loaded — follow-up) |
| T5 persister-upsert | [x] Completed 2026-05-11 | `feat/mvp-v1-T5` | merged to main | 8/8 integration specs contra Postgres real; ON CONFLICT + xmax=0 distingue insert/update |
| T6 fetcher-playwright | [x] Completed 2026-05-11 | `feat/mvp-v1-T6` | merged to main | 8/8 unit specs; integration test marcado `:slow, :network` (skip default) |
| T7 scrape-entrypoint | [x] Completed 2026-05-11 | `feat/mvp-v1-T7` | merged to main | 12/12 specs (5 orchestrator + 7 healthcheck); systemd-analyze OK; retention purge inline; healthchecks ping success/fail |
| T8 api-fixtures-endpoint | [x] Completed 2026-05-11 | `feat/mvp-v1-T8` | merged to main | 12/12 specs; Roda 3.103 + Puma 6.6 + rackup 2.2; CORS inline (sem rack-cors); ADR-007 registrado |
| T9 api-analyze-endpoint | [x] Completed 2026-05-11 | `feat/mvp-v1-T9` | merged to main | 25/25 specs (10 openrouter + 7 prompt + 8 analyze); Faraday 2.13 + WebMock; chat history preservada |
| T10 web-scaffolding-vite | [x] Completed 2026-05-11 | `feat/mvp-v1-T10` | merged to main | smoke test passa; build 143kB gz 46kB; vite 6.4.2 + vitest 2.1.9 + React 18.3 + TS 5.9 |
| T11 web-fixtures-list | [x] Completed 2026-05-11 | `feat/mvp-v1-T11` | merged to main | 14 specs novos verdes (4 client + 4 card + 6 list); MSW mockou /api/fixtures; loading/empty/error/retry/toggle implementados; bundle 147kB gz 47kB |
| T12 web-analyze-ui | [x] Completed 2026-05-11 | `feat/mvp-v1-T12` | merged to main | 14 specs novos (3 chat + 8 panel + 3 analyze api); react-markdown + remark-gfm; chat history 3+ turnos; bundle 308kB gz 96kB |

---

## Metrics snapshot

| Métrica | Atual | Alvo MVP v1 |
|---|---|---|
| Tasks completed | 12 / 12 ✅ | 12 / 12 |
| Tests Ruby (RSpec) | 136 + 1 pending integration | ≥1 spec por módulo (parser, persister, fetcher, orchestrator, API) |
| API endpoints | 1 / 2 (`GET /api/fixtures` live) | 2 (`GET /api/fixtures`, `POST /api/analyze`) |
| Tests Frontend (Vitest) | 29 (App + FixturesList + FixtureCard + AnalyzePanel + ChatMessage + 2 api) | ≥1 spec por componente principal |
| Postgres tables | 1 (`fixtures`) | 1 (`fixtures`) |
| Lines of production code | TBD | TBD |
| Cron rodando em prod | ❌ | ✅ |
| `bundle exec rspec` passa | ✅ (scaffolding) | ✅ |
| `pnpm test` passa | n/a | ✅ |

---

## Decisions taken during execution

> Cada decisão arquitetural feita dentro de uma task deve ser registrada aqui (e promovida pra ADR no `CLAUDE.md` se for significativa).

- **2026-05-11 (T1):** Porta Postgres host = `5433` em dev local (5432 já ocupado por outro container do user). Container interno mantém 5432. Em prod o Postgres é systemd-managed sem Docker, então isso só vale em dev.

---

## Chronological history

- **2026-05-11** — Decomposição criada. 12 tasks definidas em 6 waves. Doc level: completo.
- **2026-05-11** — T1 completed. 33/33 specs scaffolding verdes. `bundle install`, Docker Compose Postgres 16-alpine + healthcheck, mise.toml (Ruby 4.0.3 + Node 22), Gemfile com playwright-ruby-client/nokogiri/pg/rspec/rack-test/pry-byebug. Conexão `pg` gem via `DATABASE_URL` validada com `SELECT version()` retornando `PostgreSQL 16.13`.
- **2026-05-11** — T2 completed. 13/13 schema specs verdes. Migration `001_create_fixtures.sql` cria tabela com unique `(match_date, home_team, away_team)` e index `idx_fixtures_match_date`. `db/schema.sql` dumped do dev DB via `pg_dump --schema-only`. DB de teste: `adam_stats_test` no mesmo container.
- **2026-05-11** — T3 completed. Parser Nokogiri puro extrai 426 fixtures do snapshot Ruby POC (7 datas, 76 ligas). `AdamStats::Scraper::Fixture` é `Data.define` immutable. Seletores reais descobertos: `[data-ng-repeat*="date in"]` → `tbody[data-ng-repeat*="league"]` → `tr[data-ng-repeat*="fixture"]` com `td.fixture-team` (home/away por posição) e `td.ko-time > a.fixture-link` (texto limpo HH:MM, sem odds inline). Drift do CLAUDE.md anotado em lessons learned.
- **2026-05-11** — T6 completed. `AdamStats::Scraper::Fetcher` orquestra `playwright-ruby-client` com DI de session (testável sem rede). `PlaywrightSession#with_page` encapsula create/launch/context/page com cleanup garantido. Erros estruturados: `FetchError` (status code), `FetchTimeoutError` (sub-classe). Integration spec marcado `:slow, :network` — só roda com `RUN_NETWORK_TESTS=1`. `Playwright::TimeoutError.new(message:)` exige keyword arg (descoberto via specs).
- **2026-05-11** — T5 completed. Persister upsert idempotente contra Postgres real (integration test, sem mock). SQL `INSERT ... ON CONFLICT (match_date, home_team, away_team) DO UPDATE` com `RETURNING (xmax = 0)` distingue insert (`true`) de update (`false`). `Stats.new(inserted:, updated:, failed:)` retornado pro orchestrator. Transação batch — uma row inválida derruba o batch inteiro (`PersistError` + ROLLBACK). `detail_json` round-trip jsonb validado.
- **2026-05-11** — Incidente: dispatchei subagent T10 em paralelo com T5, working tree shared causou que o commit T5 caísse na branch T10 + arquivos T10 untracked vazaram pro stage do T5. Recovery: matei subagent, `git reset HEAD~1` em T10 (sem `--hard` porque o harness bloqueia), switch pra T5 limpo. **Decisão:** próximos paralelismos só via subagent quando os arquivos forem 100% non-overlapping E o subagent commitar logo. Pra T10 vou rodar sequencial agora.
- **2026-05-11** — T10 completed sequencial. Aproveitei tooling do subagent (package.json com vite 6/vitest 2.1/RTL 16/jsdom 25/TS 5.9, tsconfig dual file, vite.config com proxy `/api → :4567`, tests/setup.ts com jest-dom matcher). Criei `src/App.tsx` placeholder + `src/main.tsx` + `index.html` + `vite-env.d.ts`. Smoke test passa, `pnpm typecheck` clean, `pnpm build` produz bundle 143kB. Fix: removi `vite.config.ts` do `include` do root `tsconfig.json` (gera conflito de "must be built" com `tsbuildinfo`); usei `defineConfig` do `vitest/config` (pra ter campo `test` tipado).
- **2026-05-11** — Bugfix `fix(scraper): avoid double page.close (session owns lifecycle)` descoberto enquanto fazia mini-POC do T4: chamar `Fetcher.fetch` contra a detail page falhava porque tanto o `Fetcher.fetch` ensure quanto o `PlaywrightSession#with_page` ensure chamavam `page.close`, e o segundo encontrava o target já fechado (`Playwright::TargetClosedError`). Solução: session owns o lifecycle, fetcher só usa o page. Commit direto no main (fora do escopo T4).
- **2026-05-11** — T4 completed. Mini-POC capturou `spec/scraper/fixtures/adamchoi-detail-sample.html` (402KB) via Fetcher contra a detail page real do Tottenham vs Leeds. **wait_selector crítico:** `body` retorna 101KB (AngularJS shell sem dados); `tbody tr td` retorna 402KB (dados hidratados). Parser extrai 49 stat trends ricos (Over 25 Booking Points, Cards, Corners, BTTS, Goals etc.) com `home_percent/home_ratio/away_percent/away_ratio`. JSON serializa em ~5.6KB (cabe folgado em jsonb). **Descoberta:** as seções "Recent Matches", "Predictions", "Player Stats" do adamchoi são lazy-loaded ao clicar na aba — não vêm no primeiro render. Implementação atual retorna `recent_matches`, `h2h`, `streak` vazios. Follow-up: simular click via Playwright pra capturar essas seções (provavelmente em task `mvp-v1-polish` ou feature dedicada).
- **2026-05-11** — T8 completed. Endpoint `GET /api/fixtures?date=today|tomorrow|YYYY-MM-DD` operacional. Stack: **Roda 3.103** (routing tree) + **Puma 6.6** + **Rackup 2.2** (Rack 3 extraiu o binário). Decisão registrada como **ADR-007** no CLAUDE.md. CORS implementado inline no route block (`API_CORS_ORIGIN` env), `OPTIONS` preflight retorna 204. Smoke test via `bundle exec rackup` confirma 200 + headers corretos contra DB local. **Roda gotcha:** não tem `r.options do ... end` matcher; pra preflight usei `r.request_method == 'OPTIONS'` no top do route. **Spec gotcha:** `migration_001_spec` dropa a tabela no `after(:all)`, e os specs de API podiam rodar depois sem schema; resolvi chamando `ensure_schema!` em `before(:each)` em vez de só no `before(:suite)`.
- **2026-05-11** — T7 completed. Pipeline end-to-end orquestrado em `AdamStats::Scraper::Orchestrator.run`: fetch `/fixtures` → parse list → fetch cada detail → parse detail → persist com `detail_json` → purge `match_date < now - 3 days` → ping healthchecks success/failure. DI manual de fetcher/parser/persister/repo/healthcheck pra unit tests sem rede/DB. `bin/scrape` é entrypoint executável com `--help`. systemd units (`adam-stats-scraper.service` + `.timer`, OnCalendar=`*-*-* 06:00:00 UTC`, Persistent=true) validados via `systemd-analyze verify`. `deploy.sh` provisório via rsync + ssh (formal CI/CD fica pro ADR-006).
- **2026-05-11** — T9 completed. `POST /api/analyze` operacional. `OpenRouterClient` usa Faraday 2.13 com Bearer auth, mapeia erros pra hierarquia (`OpenRouterAuthError` 401/403, `OpenRouterRateLimitError` 429 com `retry_after`, `OpenRouterServerError` 5xx, `OpenRouterTimeoutError` em network errors). `PromptBuilder` monta `[system, user, ...history]` em português, system prompt instrui "use SOMENTE os dados fornecidos" e formata trends em listas legíveis. Endpoint mapeia upstream: 5xx → 502, 429 → 429 (passa `Retry-After`), 401/timeout → 502 com sanitização de API key. WebMock stuba todas as chamadas em specs — zero hit real em CI.
- **2026-05-11** — T11 completed. Componentes `<FixturesList>` + `<FixtureCard>` + `<DateToggle>` + `ApiError` helper. `getFixtures(date)` consome `/api/fixtures` via fetch nativo (sem react-query — YAGNI). Loading/empty/error/retry states implementados. MSW v2 mocka API em todos os testes (zero rede real). Adicionei `cleanup()` no `tests/setup.ts` — sem isso, RTL não desfaz mounts entre testes e `getByRole('button')` falha com "multiple elements". CSS puro modesto. App.tsx integra FixturesList + placeholder de painel pra T12 ligar.
- **2026-05-11** — T12 completed. **MVP v1 done.** `<AnalyzePanel>` (side panel) abre ao selecionar uma fixture, dispara `analyzeFixture(id, [])` no mount, renderiza resposta IA via `<MarkdownRenderer>` (react-markdown + remark-gfm). `<ChatMessageView>` distingue user vs assistant; user alinha à direita com balão azul, assistant em cinza com markdown completo (headings, listas, bold, code, tabelas via GFM). Input + botão "Enviar" pra follow-up: cada turno appenda user message + chama API com history completa + appenda assistant response. Testado com 3+ turnos preservando contexto. Loading/error/retry/close implementados. **Sanitização:** react-markdown default escapa HTML; nunca habilitei `rehype-raw` nem injetei HTML cru (anti-XSS).
