# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**This file is the absolute source of truth for the project.** Read it at the start of every session and confirm understanding before any action. Every relevant technical decision must be recorded here.

---

## Project

- **Name:** Abissal
- **Stack:** Next.js 16 (App Router, RSC, Server Actions) + TypeScript + React 19 + Tailwind v4 + Supabase (Postgres + Auth + RLS) + Cloudflare Workers (via OpenNext). Scraper Ruby 4.0.3 isolado em `scripts/scraper/`.
- **Description:** Plataforma pessoal unificada com **dois domínios complementares**:
  1. **Gestão de banca de apostas** (single-user no MVP, multi-tenant via RLS) — bets, transactions, houses, audit log, balance snapshots. Dashboard com qualidade financeira.
  2. **Análise pré-jogo de fixtures de futebol** (adam-stats domain) — scraper diário coleta fixtures via `api.choistats.com`, persiste em Postgres com retenção ~4 dias. UI lista jogos do dia; ao clicar, chama LLM (OpenRouter `deepseek/deepseek-v3.2`) que produz análise em streaming + chat de follow-up.
- **Hospedagem:** `https://abissal.rnobre.dev` — Cloudflare Worker (OpenNext build do Next.js inteiro). Supabase free tier em região `sa-east-1`.
- **Design system:** Abismo Habitado v1.0. Sempre numerais em `font-mono` com `tabular-nums` (`.num`). Headings em Fraunces 300 com tracking negativo. Vermelho Garantido (`--color-vermelho`) é identidade, não erro.

> **Note on AGENTS.md:** se o repo passar a ter `AGENTS.md`, mantenha como symlink pro `CLAUDE.md`. Não editar o symlink.

## Methodology: Pair Programming (Akita/XP)

This project follows strict **Pair Programming**: the user is the **Architect/Pilot**, the AI is the **Executor Agent**.

### Non-negotiable principles

1. **No architectural hallucination** — User defines skeleton; AI fills incrementally.
2. **Absolute TDD** — Tests first, code only to make a failing test pass.
3. **Transparency** — Destructive actions (migrations, packages, deletions) require explicit approval.
4. **Correction with record** — Errors documented in Lessons Learned below.
5. **YAGNI** — One task at a time. No speculative code.
6. **Conventional Commits** — `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
7. **No `Co-Authored-By: Claude` trailer**, ever — explicit project rule across all commits.

See the `xp-stack:akita-xp-rules` skill for the full ruleset.

### Mandatory skill integration

- **Phase 1 design** (any non-trivial feature) → `superpowers:brainstorming`
- **Any bug, test failure, or unexpected behavior** → `superpowers:systematic-debugging`
- **Before claiming "done"** → `superpowers:verification-before-completion`
- **2+ independent tasks in a wave** → `superpowers:dispatching-parallel-agents` (+ `using-git-worktrees`)
- **Working with Supabase** (db, auth, edge functions, RLS, RPCs) → `supabase:supabase`

---

## Tech stack

**Frontend + API (the Next.js app):**
- Next.js **16.2** (App Router, Server Components, Server Actions, Route Handlers)
- React 19, TypeScript 5
- Tailwind CSS v4 (via `@tailwindcss/postcss`)
- `@supabase/ssr` + `@supabase/supabase-js` for browser/server clients
- Radix UI primitives + Lucide icons + `class-variance-authority`
- TanStack Query + Zustand for client state; Zod + react-hook-form for forms
- `lightweight-charts` + Recharts for charts; `@duckdb/duckdb-wasm` for client-side OLAP in `/explore`
- Vitest (unit + API route handler tests) + Playwright (E2E)
- Sentry (optional, DSN env-driven)

**Scraper (Ruby):**
- Ruby **4.0.3** + Bundler (managed via [mise](https://mise.jdx.dev))
- `faraday` + `faraday-retry` for HTTP, `nokogiri` for HTML parsing, `pg` for Postgres
- `playwright-ruby-client` retained as fallback only (HTTP-direct is the default path now — see Lessons #5 below)
- RSpec + WebMock for tests
- Self-contained sub-project under `scripts/scraper/` with own `Gemfile`, `mise.toml`, `.ruby-version`

**DB:**
- PostgreSQL **17.6** (Supabase managed)
- Migrations as numbered SQL in `supabase/migrations/` (`0001_init.sql`…). Apply via `supabase db push` against a linked project, or via the Management API SQL endpoint when local TCP 5432 is firewalled.

**Hospedagem:**
- Cloudflare Worker `abissal` (custom domain `abissal.rnobre.dev`) built from Next.js via OpenNext (`@opennextjs/cloudflare`).
- Daily scraper: GitHub Actions cron (`.github/workflows/scrape-daily.yml`), runs at 07:00 BRT (10:00 UTC), populates Supabase via the pooler URL.
- Backup: Supabase free tier already keeps a 7-day rolling backup. Additional `pg_dump` would require Pro.

## Environment variables

```
# Supabase (frontend + backend)
NEXT_PUBLIC_SUPABASE_URL=https://etdrxzgspgslunivhrbe.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=<jwt>            # server-only; bypasses RLS
NEXT_PUBLIC_APP_URL=http://localhost:3000  # dev origin (prod = https://abissal.rnobre.dev)

# Adam-stats fixtures domain (server-only)
OPENROUTER_API_KEY=sk-or-...               # required by /api/analyze
OPENROUTER_MODEL=deepseek/deepseek-v3.2    # default; override per-request possible
ADAMCHOI_API_TOKEN=45834886-68b3-11eb-...  # static public token of the choistats SPA

# Sentry (optional)
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
```

Locally, copy from `.env.example` to `.env.local`. **Never commit `.env*` except `.env.example`.**

GH Actions secrets (for the scraper):
- `SCRAPER_DATABASE_URL` — Supabase pooler URL (URL-encoded password).
- `ADAMCHOI_API_TOKEN`
- `HEALTHCHECKS_URL` — full UUID ping endpoint.
- (var) `SCRAPER_LEAGUE_SLUGS` — CSV whitelist.

## Directory structure

```
abissal/
├── CLAUDE.md
├── README.md
├── package.json, pnpm-lock.yaml
├── next.config.ts, tsconfig.json, vitest.config.ts, playwright.config.ts
├── wrangler.jsonc                       # Cloudflare Worker config (OpenNext target)
├── open-next.config.ts
├── middleware.ts                        # Supabase session refresh on every request
├── app/                                 # Next.js App Router
│   ├── layout.tsx, globals.css
│   ├── (auth)/login/                    # email+password login
│   ├── (dashboard)/                     # banca: bets / transactions / houses / forecast / explore / audit
│   ├── fixtures/                        # adam-stats UI (à porta) — listing + analyze panel
│   └── api/
│       ├── fixtures/route.ts            # GET ?date= → FixtureDTO[]
│       ├── fixtures/[id]/refresh/route.ts # POST → re-scrape detail
│       └── analyze/route.ts             # POST SSE → OpenRouter stream
├── components/                          # Radix-based UI + domain components
│   └── fixtures/                        # FixturesList, FixtureCard, DateChips, AnalyzePanel
├── lib/
│   ├── env.ts                           # Zod-validated env
│   ├── format.ts, utils.ts
│   ├── supabase/                        # client.ts, server.ts, middleware.ts, admin.ts (service_role), types.ts
│   ├── fixtures/                        # time.ts, types.ts, repository.ts, choistats-api.ts, analysis-cache.ts, prompt-builder.ts
│   ├── openrouter.ts                    # streaming chat completion client
│   ├── stats/                           # bankroll, forecast, risk, streaks
│   └── duckdb/                          # client-side OLAP for /explore
├── supabase/
│   └── migrations/                      # 0001..0006 banca + 0007..0011 fixtures
├── scripts/
│   └── scraper/                         # self-contained Ruby 4.0.3 sub-project
│       ├── Gemfile, mise.toml, .ruby-version
│       ├── bin/scrape
│       ├── lib/scraper/                 # Ruby modules
│       └── spec/                        # 201 RSpec examples
├── tests/
│   ├── unit/                            # vitest (lib non-React + format helpers)
│   ├── api/                             # vitest (route handlers — fixtures.test.ts, fixtures-refresh.test.ts, analyze.test.ts)
│   └── e2e/                             # Playwright
└── .github/workflows/
    ├── ci.yml                           # lint + typecheck + tests + next build
    ├── deploy.yml                       # opennextjs-cloudflare build + wrangler deploy
    └── scrape-daily.yml                 # cron 10:00 UTC (07:00 BRT) + workflow_dispatch
```

**Naming conventions:**
- TS files / components: kebab-case (`fixtures-list.tsx`); PascalCase for the exported component.
- Hooks / utils: camelCase.
- Tables: plural snake_case (`fixtures`, `bets`).
- Migrations: `NNNN_descriptive.sql` (zero-padded 4 digits).

## Commands

```bash
# Setup
pnpm install
cp .env.example .env.local       # fill in keys

# Dev
pnpm dev                         # Next.js dev server (turbopack) on :3000
pnpm cf:preview                  # OpenNext build + wrangler dev (emulates Worker)

# Tests
pnpm test                        # vitest run (unit + API)
pnpm test:watch                  # vitest watch mode
pnpm test:e2e                    # Playwright

# Quality gates
pnpm lint                        # ESLint
pnpm typecheck                   # tsc --noEmit
pnpm format                      # prettier write

# Scraper (separate Ruby project)
cd scripts/scraper
mise install                     # ruby 4.0.3 + node 22
bundle install
bundle exec rspec                # 201 examples
bundle exec bin/scrape           # one-off scrape (env DATABASE_URL required)

# Cloudflare deploy
pnpm cf:deploy                   # build + wrangler deploy (manually; CI does this on push to main)

# Supabase
supabase link --project-ref etdrxzgspgslunivhrbe   # one-time, with SUPABASE_DB_PASSWORD env
supabase db push                                    # apply local supabase/migrations against remote
# Fallback (when local TCP 5432 is blocked by ISP):
curl -X POST "https://api.supabase.com/v1/projects/etdrxzgspgslunivhrbe/database/query" \
  -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" \
  --data "$(jq -Rs '{query: .}' < supabase/migrations/0007_create_fixtures.sql)"
```

## Data model

### Banca (existing — see `supabase/migrations/0001_init.sql` for the canonical schema)

`houses ← transactions (append-only) → bets ← bet_selections & bet_events`. `audit_log` captures every mutation via trigger. `balance_snapshots` regenerated by Edge Function daily. Reference tables: `sports`, `markets`. User-scoped via RLS `auth.uid() = user_id`. Money: `numeric(14,2)`.

### Fixtures (adam-stats domain — migrations 0007-0011)

| Table | Purpose | RLS |
|---|---|---|
| `fixtures` | One row per match. Retention ~3-4 days. Unique on `(match_date, home_team, away_team)`. Columns: `match_date date`, `ko_time time`, `home_team`, `away_team`, `league`, `country` (slug), `source_url`, `detail_json jsonb`, `kickoff_utc timestamptz` (absolute UTC instant — fixes the cross-midnight BRT bug — see Lesson #6), `scraped_at`, `status`. Indexes: `(match_date)`, `(kickoff_utc)`. | `authenticated SELECT` |
| `analysis_cache` | Memoizes LLM responses. Keyed by `content_hash` (sha256 of model + fixture_id + question + detail_json). FK to `fixtures(id) ON DELETE CASCADE`. | `authenticated SELECT/INSERT` |
| `league_baselines` | Pre-computed per-league statistical baselines (avg over/btts/etc.). PK `(league, stat_label)`. | `authenticated SELECT` |

Writes (scraper, refresh-detail, cache fill) go through service_role (bypasses RLS) — fixtures are reference data shared across users.

## External services and APIs

**Choistats (public, token-gated SPA):**
- Listing: `GET https://api.choistats.com/api/widget/fixtures/date/YYYY-MM-DD` → JSON with one entry per fixture for that UTC day. Native fields: `homeTeam.name`, `awayTeam.name`, `league.name`, `league.country.name`, `date` (UTC ms).
- Detail widgets: `/api/widget/match/{id}/{recent-results | team-records | players}`, `/api/widget/{chances|odds|predictions}/fixture/{id}`. Predictions widget may 404 — tolerate.
- Required headers: `X-Adamchoi-Api-Token: 45834886-68b3-11eb-99f4-9e36325824ad`, `Referer: https://www.adamchoi.co.uk/`, `Accept: application/json`.

**OpenRouter (LLM):**
- `POST https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer $OPENROUTER_API_KEY`, `HTTP-Referer: https://abissal.rnobre.dev`, `X-Title: Abissal`.
- Default model `deepseek/deepseek-v3.2`. `stream: true` for SSE proxying.

**Healthchecks.io:**
- `https://hc-ping.com/<uuid>` — pings success / `/fail` / `/start`. Used by the daily scrape cron.

## Technical decisions (ADRs)

> Each major decision gets an ADR entry. The narrative below is the index; deep dives live in `docs/adrs/` when needed.

1. **ADR-001 — Unified `abissal` + adam-stats into a single Next.js repo (CF Workers)** — _2026-05-12_ — Originally two separate projects (`Bet-Manager` and `adam-stats`). Unified into the existing `abissal` codebase because:
   (a) shared design system (Abismo Habitado), (b) shared Supabase project + region, (c) shared stack (Next.js + TS + Vitest), (d) functional adjacency (analyse fixture → place bet → record in banca), (e) CF Workers via OpenNext already wired in the `abissal` repo. Trade-off: ported the React+Vite frontend of adam-stats into Next.js Server Components. Trade-off accepted: "*não me importo com o retrabalho*" (user).

2. **ADR-002 — API routes in Next.js (Route Handlers), not Supabase Edge Functions, not standalone CF Workers** — _2026-05-12_ — Cloudflare Workers (via OpenNext) have no wall-clock timeout while the client stays connected and no subrequest duration limit on the Free plan, which is critical for `/api/analyze` SSE streaming OpenRouter responses. Supabase Edge Functions are capped at **150s** on Free, which is borderline for LLM responses + chat tails. Standalone CF Workers would have split the codebase needlessly. Decision: keep all three routes inside the Next.js `app/api/` tree, deployed as part of the same Worker.

3. **ADR-003 — Ruby scraper isolated in `scripts/scraper/`** — _2026-05-12_ — The adam-stats Ruby scraper (Faraday + Nokogiri + pg) was ported as-is into `scripts/scraper/` with its own `Gemfile`/`mise.toml`. No rewrite to TypeScript: 349 working specs, the HTTP-direct `ApiListFetcher` path is already fast (Playwright dropped from the hot path — see Lesson #5), and GitHub Actions runs Ruby natively. The scraper does not bundle into the Next.js build.

4. **ADR-004 — Supabase Free tier with HTTPS-only access from local dev** — _2026-05-12_ — The local dev network blocks TCP 5432/6543 outbound (common BR ISP filter). Migrations are applied via Supabase Management API `/v1/projects/{ref}/database/query` (HTTPS:443) until the network is unblocked. GitHub Actions runners have no such filter, so the scraper connects via the pooler in production. Local Next.js dev works because `@supabase/ssr` uses HTTPS PostgREST, not raw TCP.

5. **ADR-005 — Dashboard de stats por fixture: chart libs e visualização** — _2026-05-13_ — Para `/fixtures/[id]/stats` (11 painéis denso "Trading Terminal + Stadium Wall"), decisão de stack: **recharts** 2.15 (sparkline, radar 6-axis, scatter min×eff, line multi-series, ranking) + **lightweight-charts** 4.2.3 (séries temporais densas — PPG rolling, booking_points trend) + **CSS Grid puro** (heatmap de streaks de 109-194 entries × 10 grupos) + **Tailwind v4 container queries** (responsive layout sem media queries). Insights derivados server-side via `simple-statistics` + `regression` (correlações r ≥ 0.5, trends por regressão linear, padrões condicionais, outliers ≥ 2σ) — não vão pra bundle client. **Rejeitadas:** ECharts (60+ KB gzip; overkill), Nivo (D3 wrapper pesado), Chart.js (sem SSR-friendly radar), react-financial-charts (especializado em candlesticks), react-grid-layout + dnd-kit (drag-resize fora de escopo MVP), react-window (substituído por `@tanstack/react-virtual` que já estava no projeto). DuckDB-WASM permanece exclusivo de `/explore`. **Bundle delta:** +186.9 KB gzip num único chunk dedicado `/fixtures/[id]/stats` — **estourou o budget conservador de +150 KB gzip por ~37 KB**; aceito como não-blocking porque a rota é dedicada (lazy por route), não impacta entry points (login, fixtures list, dashboard, betting flow), e usuário só baixa o chunk com intenção explícita de ver stats. Follow-up condicional registrado: se Lighthouse Performance < 85 ou LCP > 2.5s em real-device test pós-deploy, splittar painéis via `next/dynamic` (ganho esperado -30 a -60 KB no first paint). Fundamentação completa em `docs/pesquisas/dashboard-stats-fixture-arquitetura.md` §10 e medições empíricas em `docs/tasks/dashboard-stats-fixture/bundle-report.md`.

## Lessons learned

> Append entries; never edit the past. Lessons #1-#17 carried over from `adam-stats/CLAUDE.md` are renumbered as A1-A17 to keep history clear; lessons specific to the unified codebase start at B1.

**A. Carried over from adam-stats:**

- **A5 (was #11) — `collect_details_parallel` worker isolation.** Thread.new without rescue lets a single Playwright::TimeoutError tear down the entire BrowserContext and cascade. Fixed by wrapping each worker thread body in `rescue StandardError`. Fixtures without detail_json pass through to the persister (next run retries; `COALESCE(EXCLUDED.detail_json, fixtures.detail_json)` preserves prior detail).

- **A6 (was #13) — Playwright Page degradation under long batches.** Listing migrated to `ApiListFetcher` (HTTP-direct against `api.choistats.com`). RAM idle dropped from ~1.2GB to <200MB; runtime from ~13min to ~5min for 564 fixtures. Playwright kept as fallback only (`SCRAPER_USE_PLAYWRIGHT_LIST=1`).

- **A7 (was #14) — Adamchoi doesn't qualify country in `league`.** "Premier League" was used for both English and Ukrainian leagues. Country extracted from `source_url` slug via regex (`/fixture/<id>/<country>-...`); frontend disambiguates with flag emoji prefix.

- **A8 (was #16) — Cross-midnight BRT bug.** Adamchoi groups fixtures by London day; a 21:30 BRT game on 12/05 (= 00:30 BST on 13/05 in London) showed up as "tomorrow" in the user's local view. Fixed by computing `kickoff_utc timestamptz` at scrape time and querying with a BRT day window `[date 03:00 UTC, (date+1) 03:00 UTC)`. Backfill on existing rows via the BST-aware UPDATE in migration 0011.

- **A9 (was #17) — Listing via HTTP-direct API.** `GET https://api.choistats.com/api/widget/fixtures/date/YYYY-MM-DD` returns structured JSON (homeTeam.name, awayTeam.name, league.country.name, date as UTC ms). Token + Referer required. Listing dropped from ~30s (Playwright SPA) to <500ms per date.

**B. New (post-unification):**

- **B1 — 2026-05-12 — TCP 5432/6543 outbound blocked locally (not ISP-specific; common in BR residential).** `supabase db push` and `psql` both fail with timeout. Workaround: Management API `/v1/projects/{ref}/database/query` over HTTPS:443. Confirmed it accepts arbitrary SQL (DDL + DML). GH Actions has no such filter, so production scrape runs normally.

- **B2 — 2026-05-12 — Supabase Free plan limit is per administrator user, not per organization.** "RNobre1 (2 project limit)" rejected creating a third even across orgs. Reused the existing `abissal` project (renamed from a sandbox).

- **B3 — 2026-05-12 — `gh secret set --body-file` doesn't exist on older `gh` versions (use stdin).** The `--body` flag accepts stdin if omitted; `printf '%s' VAL | gh secret set NAME` works reliably.

- **B4 — 2026-05-12 — `JS new Date("2026-02-30")` silently rolls over to `2026-03-02`.** `parseDateParam` validates by round-tripping `toISOString().slice(0,10) === input`.

- **B5 — 2026-05-12 — Local Postgres docker doesn't have Supabase's `authenticated`/`anon`/`service_role` roles.** Migrations with `create policy ... to authenticated` fail with `role does not exist`. `scripts/scraper/spec/db/db_helper.rb#ensure_supabase_roles!` creates them idempotently before applying migrations.

- **B6 — 2026-05-12 — Supabase Free pooler URL is `aws-1-sa-east-1.pooler.supabase.com` (not aws-0).** The Management API `connection_string` field returns `db.<ref>.supabase.co:6543`, which resolves to IPv6-only on Free tier and is unreachable from GitHub Actions runners (`Network is unreachable` on `2600:1f1e:...`). The `aws-0-*` pooler responds with `Tenant or user not found` — that host is no longer the active gateway for this region. Working URL: `postgres://postgres.<project_ref>:<password-url-encoded>@aws-1-sa-east-1.pooler.supabase.com:6543/postgres`.

- **B7 — 2026-05-12 — `SCRAPER_LEAGUE_SLUGS` whitelist became a no-op after the HTTP-direct listing migration.** `filter_by_league_slugs` in `Orchestrator` matches the `source_url` slug; but `ApiListFetcher` (the HTTP-direct path, now the default) sets `source_url = /fixture/{id}` without the league slug. Result: every fixture is filtered out of detail-fetching → DB has 752 rows but 0 with `detail_json`. Fix: leave `SCRAPER_LEAGUE_SLUGS` unset in production so all fixtures get detail. The filter only matters for the Playwright fallback (`SCRAPER_USE_PLAYWRIGHT_LIST=1`), which still emits slugged `source_url`s.

- **B8 — 2026-05-12 — Vitest needs an env setup file in this repo.** `lib/env.ts` parses with Zod at module import time. Any spec that (transitively) imports a server-only module crashes at parse time before the spec's own mocks run. `tests/setup-env.ts` populates dummy defaults via `process.env.X ??= ...` and is loaded via `vitest.config.ts → setupFiles`. Individual specs that want to test the "missing env var" path still do `vi.stubEnv(...)` + `vi.resetModules()` and re-import the route lazily.

- **B9 — 2026-05-13 — `@next/bundle-analyzer` is a no-op under Next 16 Turbopack.** The plugin only hooks the Webpack compiler; with `next build` using Turbopack (default on 16.x) the `ANALYZE=true` env var is silently ignored — no `.next/analyze/*.html` artifact is generated. Wrap em `next.config.ts` permaneceu (zero overhead, futura-prova quando voltar pra Webpack ou usar `--turbopack=false`). **Workaround pra medir bundle deltas hoje:** comparar chunk sizes via `find .next/static -name "*.js" -exec sh -c 'echo "$(wc -c < "$1") $(gzip -c "$1" | wc -c) $1"' _ {} \;` entre dois builds (baseline ref + feature). Documentado em `docs/tasks/dashboard-stats-fixture/bundle-report.md`.

- **B10 — 2026-05-13 — Tree-shaking de `recharts` é parcial mesmo com `experimental.optimizePackageImports`.** O dashboard de stats importa 5 componentes de `recharts` (`LineChart`, `RadarChart`, `ScatterChart`, `ResponsiveContainer`, `XAxis/YAxis/Tooltip`). O chunk final pesa ~90-100 KB gzip — muito além do esperado por uma seleção tão pequena. `optimizePackageImports` em Next 16 ajuda no DX (HMR rápido) mas o output prod ainda agrupa Polar+Cartesian+Scatter scales pq todos compartilham um core. Combinado com `lightweight-charts` (51 KB gzip já medido) + helpers (cmdk, react-virtual, slider Radix), bate +187 KB gzip num único route chunk. **Decisão de produto:** chunk fica isolado em `/fixtures/[id]/stats` — não afeta entry points; usuário entra com intenção. Splitting via `next/dynamic` por painel fica como follow-up condicional se Lighthouse < 85 em real-device.

- **B11 — 2026-05-13 — Build em CI sem `.env.local` precisa de fake `OPENROUTER_API_KEY`.** `lib/env.ts` declara `OPENROUTER_API_KEY: z.string().min(1).optional()`, mas o `.optional()` só permite `undefined`, não string vazia. Em `.env.local` o valor vinha como `OPENROUTER_API_KEY=` (string vazia), que falha `min(1)` no `Zod.parse` durante `next build` em `page data collection`. Workaround pra build offline: `OPENROUTER_API_KEY=sk-stub-build pnpm build`. Em CI o segredo já vem populado, então não é problema na prática. Schema fix de longo prazo: `OPENROUTER_API_KEY: z.string().min(1).optional().or(z.literal(""))` ou ler `process.env.OPENROUTER_API_KEY || undefined` no parse — defer pra refator futuro de `lib/env.ts`.

---

## Do not

- Bypass the TDD flow (write production code before tests).
- Execute state-changing commands without explicit approval.
- Add speculative code or abstractions "for the future".
- Modify files outside the declared scope of the current task.
- Touch `~/.claude/` global without explicit approval.
- Add `Co-Authored-By: Claude` (or any equivalent trailer) to commit messages — explicit project rule.
