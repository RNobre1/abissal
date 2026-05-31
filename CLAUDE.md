# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**This file is the absolute source of truth for the project.** Read it at the start of every session and confirm understanding before any action. Every relevant technical decision must be recorded here.

---

## Project

- **Name:** Abissal
- **Stack:** Next.js 16 (App Router, RSC, Server Actions) + TypeScript + React 19 + Tailwind v4 + Supabase (Postgres + Auth + RLS) + Cloudflare Workers (via OpenNext). Scraper Ruby 4.0.3 isolado em `scripts/scraper/`.
- **Description:** Plataforma pessoal unificada com **dois domínios complementares**:
  1. **Gestão de banca de apostas** (single-user no MVP, multi-tenant via RLS) — bets, transactions, houses, audit log, balance snapshots. Dashboard com qualidade financeira.
  2. **Análise pré-jogo de fixtures de futebol** (adam-stats domain) — scraper diário coleta fixtures via `api.choistats.com`, persiste em Postgres (retenção ~4 dias) e roda um pipeline pós-persist: simulação estatística (força-de-temporada + Dixon-Coles + Monte Carlo), reconciliação de resultados reais e o **recomendador IA-2** (`deepseek/deepseek-r1`) que sugere apostas com edge calculado. UI lista jogos do dia; ao clicar, mostra simulação + análise LLM em streaming (OpenRouter) + chat de follow-up. Calibração contínua (CLV/Brier/ROI) no painel `/calibracao`.
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
- Next.js **16.2.6** (App Router, Server Components, Server Actions, Route Handlers)
- React 19.2, TypeScript 5
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
- `playwright-ruby-client` retained as fallback only (HTTP-direct is the default path now — see Lesson A6 below)
- RSpec + WebMock for tests
- Self-contained sub-project under `scripts/scraper/` with own `Gemfile`, `mise.toml`, `.ruby-version`

**DB:**
- PostgreSQL **17.6** (Supabase managed)
- Migrations as numbered SQL in `supabase/migrations/` (`0001_init.sql`…). Apply via `supabase db push` against a linked project, or via the Management API SQL endpoint when local TCP 5432 is firewalled.

**Hospedagem:**
- Cloudflare Worker `abissal` (custom domain `abissal.rnobre.dev`) built from Next.js via OpenNext (`@opennextjs/cloudflare`).
- **GitHub Actions crons** (repo público ⇒ minutos gratuitos):
  - `scrape-daily.yml` — 10:00 UTC (07:00 BRT). Scrape + simulação + reconcilers + recompute de baseline. `timeout-minutes: 20` (a IA-2 saiu daqui — ver B20-bis). Popula Supabase via pooler. `workflow_dispatch` disponível.
  - `ai-reco.yml` — 10:45 UTC (07:45 BRT), ~45min após o scrape. Recomendador IA-2 **desacoplado** (B20-bis): `bin/run_ai_recommender` → `AiRecommenderJob`. Chamadas R1 paralelizadas (`AI_RECO_CONCURRENCY`, default 6). `timeout-minutes: 45`, cron+manual only (sem push — workflow caro de LLM). `workflow_dispatch` disponível.
  - `closing-odds-capture.yml` — 15/17/19/21 UTC. Captura closing odds (CLV) na janela ao redor do KO.
  - `telegram-closure.yml` — 02:00 UTC. Resumo diário no Telegram.
  - `calibracao-monthly.yml` — dia 5, 08:00 UTC. Refita parâmetros por liga (`scripts/calibracao/fit-league-parameters.ts`, ligas com `n≥20`) + calibração isotônica IA (`scripts/calibracao/fit-isotonic.ts`). Manual: `gh workflow run calibracao-monthly.yml -R RNobre1/abissal`. Local: `pnpm exec tsx scripts/calibracao/fit-league-parameters.ts`. Secrets: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; `HEALTHCHECKS_CALIBRATE_URL` opcional.
- Backup: Supabase free tier mantém backup rolling de 7 dias. `pg_dump` adicional exigiria Pro.

## Environment variables

```
# Supabase (frontend + backend)
NEXT_PUBLIC_SUPABASE_URL=https://etdrxzgspgslunivhrbe.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=<jwt>            # server-only; bypasses RLS
NEXT_PUBLIC_APP_URL=http://localhost:3000  # dev origin (prod = https://abissal.rnobre.dev)

# LLM (OpenRouter) — server-only
OPENROUTER_API_KEY=sk-or-...               # required by /api/analyze e recomendador IA-2
OPENROUTER_MODEL=deepseek/deepseek-v3.2    # análise streaming (/api/analyze)
AI_RECO_MODEL=deepseek/deepseek-r1         # recomendador IA-2 batch (cron noturno)
AI_RECO_MODEL_ONDEMAND=deepseek/deepseek-r1 # botão "pedir análise IA" em /fixtures/[id]
AI_RECO_CONCURRENCY=6                       # chamadas R1 concorrentes no batch (cron ai-reco). Vazio ⇒ default 6

# Fixtures source
ADAMCHOI_API_TOKEN=45834886-68b3-11eb-...  # token público/estático embutido na SPA choistats

# Telegram closure bot (opcional — cron telegram-closure)
TELEGRAM_BOT_TOKEN=                        # via @BotFather
TELEGRAM_CHAT_ID=                          # via @userinfobot

# Sentry (optional)
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
```

Locally, copy from `.env.example` to `.env.local` (o scraper tem o seu próprio `scripts/scraper/.env.example`). **Never commit `.env*` except `.env.example`.**

GH Actions secrets (produção):
- `SCRAPER_DATABASE_URL` — Supabase pooler URL (senha URL-encoded).
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- `OPENROUTER_API_KEY`, `ADAMCHOI_API_TOKEN`.
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (deploy).
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (cron telegram-closure).
- `HEALTHCHECKS_URL` — ping do scrape geral; `HEALTHCHECKS_AI_RECO_URL` — silent-death detector do recomendador IA.
- `E2E_USER_EMAIL`, `E2E_USER_PASSWORD` — usuário dedicado de E2E (job `e2e` do `ci.yml`). Ver nota abaixo.
- (var) `SCRAPER_LEAGUE_SLUGS` — CSV whitelist (deixar **unset** em prod — ver Lição B7).

**Usuário E2E dedicado:** `e2e@rnobre.dev` (criado via Supabase admin API, `email_confirm:true`). É **RLS-isolado** — tem banca própria vazia, não toca os dados do Pilot; mas vê os dados compartilhados de fixtures/simulação/calibração (`authenticated SELECT`). Os E2E logam pelo fluxo real de senha (`tests/e2e/helpers/auth.ts#loginAsTestUser`), creds via `.env.local` (local, gitignored) ou GH secrets (CI). Specs read-only — não escrevem na banca; os write-tests (disciplina, bet-slip stub) ficam `skip`-guardados. Viewport mobile = **Galaxy S23 FE** (412×915, projeto `mobile-s23fe` em `playwright.config.ts`).

## Directory structure

```
abissal/
├── CLAUDE.md, README.md, AGENTS.md (symlink → CLAUDE.md)
├── package.json, pnpm-lock.yaml
├── next.config.ts, tsconfig.json, vitest.config.ts, playwright.config.ts
├── wrangler.jsonc, open-next.config.ts  # Cloudflare Worker (OpenNext target)
├── middleware.ts                        # Supabase session refresh em toda request
├── app/                                 # Next.js App Router
│   ├── layout.tsx, globals.css
│   ├── (auth)/login/                    # email+password login
│   ├── (dashboard)/                     # banca + fixtures + análise
│   │   ├── banca/ bets/ transactions/ houses/ forecast/ explore/ audit/
│   │   ├── bilhete/                     # bilhete múltipla / bet builder
│   │   ├── fixtures/ [id]/ [id]/stats/  # listagem + análise + dashboard de stats
│   │   ├── calibracao/                  # painel CLV/Brier/ROI + pipeline health
│   │   ├── configuracoes/               # disciplina_settings
│   │   ├── llm-observability/ logs/ admin/
│   │   └── _components/                 # destaques-do-dia, etc.
│   └── api/
│       ├── fixtures/route.ts            # GET ?date= → FixtureDTO[]
│       ├── fixtures/[id]/refresh/route.ts
│       ├── analyze/route.ts             # POST SSE → OpenRouter stream
│       ├── ai-reco/{compute,feedback,apostei}/ # recomendador IA-2 on-demand + feedback
│       ├── bets/export/  calibracao/secondary-metrics/  telemetry/
├── components/                          # banca, bets, bet-slip, calibracao, charts,
│   └── …                                #   disciplina, fixtures (+ fixtures/stats), oportunidades, ui
├── lib/
│   ├── env.ts (Zod), format.ts, utils.ts
│   ├── supabase/                        # client, server, middleware, admin (service_role), types
│   ├── fixtures/ (+ fixtures/stats/)    # time, types, repository, choistats-api, analysis-cache, prompt-builder
│   ├── ai/  ai-reco/                    # openrouter client + recomendador IA-2 (edge calc, blending)
│   ├── banca/ bets/ bet-slip/ bet-slip-ocr/ disciplina/  # domínio banca + OCR de bilhete
│   ├── calibracao/  alerts/  telemetry/  telegram/
│   └── (stats e duckdb OLAP servem /explore e /fixtures/[id]/stats)
├── supabase/migrations/                 # 0001-0042 (ver "Data model")
├── scripts/
│   ├── scraper/                         # sub-projeto Ruby 4.0.3 (Gemfile, mise.toml)
│   │   ├── bin/{scrape, run_ai_recommender, capture_closing_odds, document_choistats_api, reresolve_secondary_markets}
│   │   ├── lib/scraper/                 # módulos Ruby (orchestrator, reconcilers, ft_actuals, sim engine…)
│   │   └── spec/                        # ~565 RSpec examples
│   ├── calibracao/                      # fit-league-parameters.ts, fit-isotonic.ts (cron mensal)
│   ├── telegram/send-closure.ts         # resumo diário
│   └── poc/
├── tests/  (unit/ · api/ · integration/ · e2e/)  + co-located *.test.ts em lib/
└── .github/workflows/
    ├── ci.yml                           # lint + typecheck + tests + next build
    ├── deploy.yml                       # opennextjs-cloudflare build + wrangler deploy
    ├── scrape-daily.yml                 # cron 10:00 UTC — scrape + sim + reconcilers + baseline
    ├── ai-reco.yml                      # cron 10:45 UTC — recomendador IA-2 desacoplado (R1 paralelo)
    ├── closing-odds-capture.yml         # cron 15/17/19/21 UTC — CLV
    ├── telegram-closure.yml             # cron 02:00 UTC — resumo
    └── calibracao-monthly.yml           # cron dia 5 08:00 UTC
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
pnpm test:e2e                    # Playwright (2 projetos: desktop-chromium + mobile-s23fe)
pnpm exec playwright test --grep-invert "live OCR"   # suíte E2E sem o teste pago de OCR (o que o CI roda)

# Quality gates
pnpm lint                        # ESLint
pnpm typecheck                   # tsc --noEmit
pnpm format                      # prettier write
pnpm telegram:document-api       # regenera docs/external-apis/telegram/ (Bot API; re-rode p/ detectar drift)

# Scraper (separate Ruby project)
cd scripts/scraper
mise install                     # ruby 4.0.3 + node 22
bundle install
bundle exec rspec                # ~565 examples
bundle exec bin/scrape           # one-off scrape (env DATABASE_URL required)
bundle exec bin/capture_closing_odds        # captura closing odds (CLV)
bundle exec bin/run_ai_recommender          # recomendador IA-2 desacoplado (cron ai-reco; ver B20-bis)
bundle exec bin/reresolve_secondary_markets # re-resolve corners/cards/sot (ver B19)
bundle exec bin/document_choistats_api      # regenera docs/external-apis/choistats/

# Cloudflare deploy
pnpm cf:build                    # opennextjs-cloudflare build (sem deploy)
pnpm cf:deploy                   # build + wrangler deploy (manual; CI faz no push pra main)
pnpm cf:upload                   # build + wrangler versions upload (preview version)

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

> O índice abaixo é a referência viva. O schema canônico está em `supabase/migrations/` (0001-0042). Migrations são **append-only / históricas** — nunca editar uma aplicada; criar a próxima `NNNN_`.

### Banca (núcleo em `0001_init.sql`, evoluído em 0014/0027/0030/0032-0034/0039-0042)

`houses ← transactions (append-only) → bets ← bet_selections & bet_events`. `audit_log` captura toda mutação via trigger. `balance_snapshots` regenerados diariamente. Tabelas de referência: `sports`, `markets`. RLS user-scoped `auth.uid() = user_id`. Dinheiro: `numeric(14,2)`.

| Tabela / objeto | Propósito |
|---|---|
| `bet_slips` + `bet_slip_legs` | Bilhete múltipla / bet builder (draft → committed); legs com FK opcional pra `ai_recommendations`. |
| `disciplina_settings` | Fricção ética por usuário: stop-loss, max bets/dia, cooldown pós-derrota, quiet mode, thesis gate. |
| `bets` (colunas extra) | `ai_recommendation_id`, `is_free_bet` (free bet não desconta da banca), `thesis`. |
| RPCs `place_bet` / `resolve_bet` | Ledger transacional; lógica diferenciada pra free bet (ganho = `stake*(odds-1)`). |
| Views `roi_by_house_view`, `roi_by_period_view` | ROI/yield/win-rate por casa e por mês+rolling-30d (`security_invoker`). |

### Fixtures / análise (adam-stats domain — migrations 0007-0026, 0028-0029, 0031, 0035-0037)

Dados de referência compartilhados entre usuários. Escritas (scraper, refresh-detail, sim, cache, calibração) vão via **service_role** (bypassa RLS); o front lê via `authenticated SELECT`.

| Tabela / view | Propósito | RLS |
|---|---|---|
| `fixtures` | Uma linha por jogo. Retenção ~3-4 dias. Único em `(match_date, home_team, away_team)`. Escalares + `detail_json jsonb` (blob pesado — **nunca cruzar inteiro pro Worker**, ver B12/B14) + `kickoff_utc timestamptz` (instante UTC absoluto, corrige o bug cross-midnight BRT — A8). GIN `pg_trgm` em home/away pra fuzzy match de OCR (0037). | authenticated SELECT |
| `analysis_cache` | Memoiza respostas LLM. Chave `content_hash` (sha256 de model+fixture+question+detail). FK `fixtures(id) ON DELETE CASCADE`. | authenticated |
| `league_baselines` | Baselines estatísticos por liga (avg over/btts/etc.). PK `(league, stat_label)`. | authenticated SELECT |
| `fixture_simulations` | **Motor estatístico**: Poisson + Dixon-Coles + Monte Carlo 10k → escalares `p_*` + `sim_stats jsonb` (gols/BTTS/corners/cards/SOT por time/tempo). Colunas `actual_*` populadas pelo reconciler **via choistats** (B19), `actual_data_source`, `model_version`. | service_role |
| `ai_predictions` | Predição estruturada pré-jogo (winner+over) reconciliada (legado copilot, alimenta Brier). | service_role |
| `ai_recommendations` | **Recomendador IA-2**: market/side/units/edge/kelly/reasoning/prob_estimated. Múltiplos mercados (1x2, over, btts, corners, cards, sot). | authenticated SELECT |
| `ai_reco_feedback` | Feedback humano por reco (agree/disagree/apostei). | authenticated |
| `model_calibration` | Curva isotônica pós-modelo por métrica (1x2/over25/btts). | service_role write |
| `league_parameters` | Parâmetros calibrados por liga (ρ Dixon-Coles, baselines de gols, K shrinkage). | service_role write |
| `closing_odds` | Odds próximas ao KO pra CLV. Único `(fixture_id, market, side, source)` (0026). | authenticated SELECT |
| `fixture_badges_view` | View SQL que computa badges/realce a partir de `detail_json` **dentro do Postgres** (escalar pro Worker — B14). | authenticated |
| `llm_request_logs` | Log de chamadas LLM (modelo, latência, tokens, custo, prompt_version, erro). | authenticated SELECT |
| `ui_telemetry` | Eventos de UX (click/panel/elapsed). user_id nullable (anon OK). | own + anon |
| `actuals_fixture_mapping` | **ÓRFÃ** — sobrou da api-football (abandonada 2026-05-28); o reconciler de actuals usa choistats, não esta tabela. | — |

### Métricas de calibração (apêndice)

- **Hit rate (winner / over-under)** — fração de acertos em `ai_predictions.correct_*`. Útil mas só significa algo em ≥ 300 resolved.
- **Brier score** — distância quadrática entre probabilidade prevista e resultado real (0 = perfeito; 0.25 = chute aleatório binário). Aplicado tanto em `ai_predictions.pred_confidence` (legado copilot) quanto em `fixture_simulations.p_*` (motor estatístico) e `ai_recommendations.prob_estimated` (IA-2).
- **ROI / win-rate (apostas resolvidas)** — `sum(pl_units) / sum(units_final)`. Métrica de bottom-line; varia muito até passar de 300 bets.
- **CLV (Closing Line Value)** — `(odd_taken / odd_close − 1) × 100`. Persistido em `closing_odds` (migration `0026`, fixture × market × side × source, único por `(fixture_id, market, side, source)`); capturado 4×/dia via `.github/workflows/closing-odds-capture.yml` chamando o widget `/api/widget/match/{id}/odds` do Choistats numa janela `[now+5min, now+4h]` ao redor do KO. **Métrica única que sobrevive a small-sample**: ROI/Brier exigem 300+ bets pra distinguir sorte de skill; CLV diz isso em ~50. Painel em `/calibracao` (seção CLV) mostra média geral, IC95% (`σ/√n × 1.96`), quebra por liga/mercado. **Target Wave C: +1.5% sustentado em ≥ 300 bets**.

## External services and APIs

**Choistats (public, token-gated SPA):**
- Listing: `GET https://api.choistats.com/api/widget/fixtures/date/YYYY-MM-DD` → JSON with one entry per fixture for that UTC day. Native fields: `homeTeam.name`, `awayTeam.name`, `league.name`, `league.country.name`, `date` (UTC ms).
- Detail widgets: `/api/widget/match/{id}/{recent-results | team-records | players}`, `/api/widget/{chances|odds|predictions}/fixture/{id}`. Predictions widget may 404 — tolerate.
- Required headers: `X-Adamchoi-Api-Token: 45834886-68b3-11eb-99f4-9e36325824ad`, `Referer: https://www.adamchoi.co.uk/`, `Accept: application/json`.

**OpenRouter (LLM):**
- `POST https://openrouter.ai/api/v1/chat/completions` com `Authorization: Bearer $OPENROUTER_API_KEY`, `HTTP-Referer: https://abissal.rnobre.dev`, `X-Title: Abissal`.
- **Análise streaming** (`/api/analyze`): `OPENROUTER_MODEL` (default `deepseek/deepseek-v3.2`), `stream: true` proxiado via SSE.
- **Recomendador IA-2** (cron Ruby + `/api/ai-reco/compute`): `AI_RECO_MODEL` / `AI_RECO_MODEL_ONDEMAND` = `deepseek/deepseek-r1` (reasoning lento ~p95 195s, barato; aceitável fora do hot path).

**Telegram (closure bot):**
- **Bot API** via `TELEGRAM_BOT_TOKEN` → chat `TELEGRAM_CHAT_ID`. Resumo diário (cron `telegram-closure`, `scripts/telegram/send-closure.ts` + `lib/telegram/closure-message.ts`).
- **Bot API ≠ MTProto.** Usamos **só** a Bot API (`api.telegram.org/bot<token>/METHOD`, doc `core.telegram.org/bots/api`, hoje v10.0). **NÃO** usar a MTProto/`core.telegram.org/api` (cliente de conta de usuário) nem clientes tipo `vysheng/tg` (abandonado ~2016, exige login da conta pessoal = superfície de credencial enorme + risco de ToS). Bot token basta pra tudo do escopo (envio, webhook, comandos).
- **Doc viva:** `docs/external-apis/telegram/telegram-bot-api.md` (gerada por `pnpm telegram:document-api` → `scripts/telegram/document-bot-api.ts`; render puro testável em `lib/telegram/bot-api-doc.ts`). Destaca os métodos que o projeto usa + catálogo completo (176 métodos/303 tipos) + sinaliza drift. Re-rode pra detectar mudança de versão.

**Healthchecks.io:**
- `https://hc-ping.com/<uuid>` — pings success / `/fail` / `/start`. `HEALTHCHECKS_URL` no scrape; `HEALTHCHECKS_AI_RECO_URL` é o silent-death detector do recomendador IA (ping `/fail` quando 0 recos com fixtures pendentes).

## Technical decisions (ADRs)

> Each major decision gets an ADR entry. The narrative below is the index; deep dives live in `docs/adrs/` when needed.

1. **ADR-001 — Unified `abissal` + adam-stats into a single Next.js repo (CF Workers)** — _2026-05-12_ — Originally two separate projects (`Bet-Manager` and `adam-stats`). Unified into the existing `abissal` codebase because:
   (a) shared design system (Abismo Habitado), (b) shared Supabase project + region, (c) shared stack (Next.js + TS + Vitest), (d) functional adjacency (analyse fixture → place bet → record in banca), (e) CF Workers via OpenNext already wired in the `abissal` repo. Trade-off: ported the React+Vite frontend of adam-stats into Next.js Server Components. Trade-off accepted: "*não me importo com o retrabalho*" (user).

2. **ADR-002 — API routes in Next.js (Route Handlers), not Supabase Edge Functions, not standalone CF Workers** — _2026-05-12_ — Cloudflare Workers (via OpenNext) have no wall-clock timeout while the client stays connected and no subrequest duration limit on the Free plan, which is critical for `/api/analyze` SSE streaming OpenRouter responses. Supabase Edge Functions are capped at **150s** on Free, which is borderline for LLM responses + chat tails. Standalone CF Workers would have split the codebase needlessly. Decision: keep all three routes inside the Next.js `app/api/` tree, deployed as part of the same Worker.

3. **ADR-003 — Ruby scraper isolated in `scripts/scraper/`** — _2026-05-12_ — The adam-stats Ruby scraper (Faraday + Nokogiri + pg) was ported as-is into `scripts/scraper/` with its own `Gemfile`/`mise.toml`. No rewrite to TypeScript: 349 working specs, the HTTP-direct `ApiListFetcher` path is already fast (Playwright dropped from the hot path — see Lesson A6), and GitHub Actions runs Ruby natively. The scraper does not bundle into the Next.js build.

4. **ADR-004 — Supabase Free tier with HTTPS-only access from local dev** — _2026-05-12_ — The local dev network blocks TCP 5432/6543 outbound (common BR ISP filter). Migrations are applied via Supabase Management API `/v1/projects/{ref}/database/query` (HTTPS:443) until the network is unblocked. GitHub Actions runners have no such filter, so the scraper connects via the pooler in production. Local Next.js dev works because `@supabase/ssr` uses HTTPS PostgREST, not raw TCP.

5. **ADR-005 — Dashboard de stats por fixture: chart libs e visualização** — _2026-05-13_ — Para `/fixtures/[id]/stats` (11 painéis denso "Trading Terminal + Stadium Wall"), decisão de stack: **recharts** 2.15 (sparkline, radar 6-axis, scatter min×eff, line multi-series, ranking) + **lightweight-charts** 4.2.3 (séries temporais densas — PPG rolling, booking_points trend) + **CSS Grid puro** (heatmap de streaks de 109-194 entries × 10 grupos) + **Tailwind v4 container queries** (responsive layout sem media queries). Insights derivados server-side via `simple-statistics` + `regression` (correlações r ≥ 0.5, trends por regressão linear, padrões condicionais, outliers ≥ 2σ) — não vão pra bundle client. **Rejeitadas:** ECharts (60+ KB gzip; overkill), Nivo (D3 wrapper pesado), Chart.js (sem SSR-friendly radar), react-financial-charts (especializado em candlesticks), react-grid-layout + dnd-kit (drag-resize fora de escopo MVP), react-window (substituído por `@tanstack/react-virtual` que já estava no projeto). DuckDB-WASM permanece exclusivo de `/explore`. **Bundle delta:** +186.9 KB gzip num único chunk dedicado `/fixtures/[id]/stats` — **estourou o budget conservador de +150 KB gzip por ~37 KB**; aceito como não-blocking porque a rota é dedicada (lazy por route), não impacta entry points (login, fixtures list, dashboard, betting flow), e usuário só baixa o chunk com intenção explícita de ver stats. Follow-up condicional registrado: se Lighthouse Performance < 85 ou LCP > 2.5s em real-device test pós-deploy, splittar painéis via `next/dynamic` (ganho esperado -30 a -60 KB no first paint). Fundamentação completa em `docs/pesquisas/dashboard-stats-fixture-arquitetura.md` §10 e medições empíricas em `docs/tasks/dashboard-stats-fixture/bundle-report.md`.

6. **ADR-006 — Simulação pré-jogo: força-de-temporada + Dixon-Coles + Monte Carlo, computada no scraper Ruby, schema próprio** — _2026-05-18_ — Simulação pré-jogo pré-computada por fixture (placar + todas as stats por time/tempo + camada por jogador com **provável escalação**). Decisão: modelo = força ataque/defesa de temporada (blocos `*Avgs` do choistats, `numMatches` 17-37 — já são as forças, **sem MLE global**) normalizada pela liga → Poisson + correção **Dixon-Coles τ** (ρ prior calibrável); **Negative Binomial** p/ stats overdispersas (escanteios/cartões); **Monte Carlo 10k → só escalares**; shrinkage **condicional** a `numMatches` baixo; alocação de eventos por jogador (provável XI por `started`/`minutes`, excl. `injured`). Computado **no scraper Ruby pós-persist** (Worker só lê escalares — protege contra a classe de outage 1101, ver B12/B14/B15); schema **`fixture_simulations` próprio** (migration `0018`, escalar + jsonb pequeno, RLS service-role-only, sem FK rígida — não estende `ai_predictions`/0016, ortogonal); odds devigadas (multiplicativo) + `outcomeOdds` por jogador como **âncora de validação não-circular, nunca input**. **Re-scrape tardio de escalação: NÃO no MVP** (Opção A — projeção do histórico, rotulada "provável escalação"; Opção B = follow-up condicional ao Brier dos `player_events`). Pré-requisito compartilhado: enriquecer `WidgetMerger` (6 itens descartados hoje) — beneficia simulação **e** o dashboard de stats (ADR-005). Fundamentação: `docs/pesquisas/simulacao-pre-jogo-fixtures.md` (L3 v0.3, research-critic real 2 rodadas: v0.1 REPROVADA, v0.2 APROVADA C/ RESSALVAS, v0.3 ressalvas aplicadas). Decomposição/execução: `docs/tasks/simulacao-pre-jogo-fixtures/00-plan.md`. **Status: IMPLEMENTADO e mergeado na `main` (2026-05-18) via subagent-driven paralelo em worktrees** — T0 POC (`093c43d`) ‖ T1 fundação-gate (`f70dac2`); T2 motor+`0018`+hook (`0181ec9`) ‖ T3 dashboard (`2c4ebab`); T4 calibração/`brierScore`/reconciler (`0635cc8`) ‖ T5 guard generalizado (`903ac41`). Cada task passou por TDD + review adversarial em 2 etapas (spec-compliance → code-quality) com loop de fix; gate combinado verde a cada merge (RSpec scraper 350/0/1 · Vitest 675 · lint 0 · typecheck). **Pendência operacional (gated ao Pilot):** aplicar a migration `0018_fixture_simulations.sql` no Postgres de produção — o hook do orchestrator é warning-safe (Lição A5), então prod permanece saudável sem ela (simulação degrada para "indisponível" até a migration ser aplicada); aplicação via Management API depende da rotação do PAT Supabase exposto (pendência de segurança pré-existente).

7. **ADR-007 — Roda + Puma para o endpoint Ruby `/api/fixtures`** — _2026-05-11_ — Escolha de framework (Roda 3.103 + Puma 6.6 + Rackup 2.2) pro endpoint do adam-stats standalone. **SUPERSEDED por ADR-002** na unificação: as rotas migraram pra Next.js Route Handlers; o serviço Roda não existe mais. Registro mantido por completude histórica (detalhe em `docs/tasks/mvp-v1/PROGRESS.md`).

8. **ADR-008 — Mercados secundários (corners, cards, SOT)** — _2026-05-26_ — ACCEPTED. Extensão do edge-calculator e da calibração pra mercados além de 1x2/over/btts. Deep dive em `docs/adrs/008-mercados-secundarios.md`. Os *actuals* desses mercados são reconciliados via choistats (ver B19), não via fonte externa.

10. **ADR-010 — Recomendador IA-2 desacoplado do scrape + chamadas R1 paralelizadas** — _2026-05-29_ — ACCEPTED. A IA-2 rodava inline no `orchestrator.rb` (fim do `scrape-daily`); a inferência R1 (~p95 195s/chamada, serial) inflava o runtime e estourava o `timeout-minutes` do scrape (cancelado aos 60min em 29/05 — ver B20-bis), truncando a coleta **e** a própria cobertura de skip da Parte 1 (a cauda de skips rápidos roda após as chamadas R1, que morriam no timeout). Decisão em duas alavancas complementares: **(A) paralelizar** as chamadas R1 dentro do `AiRecommenderRunner` num pool limitado (`Thread`+`Queue` stdlib, `AI_RECO_CONCURRENCY` default 6) — refatorado em 3 fases (edge-calc+skip **serial** → fan-out R1 **paralelo, só rede** → gravação **serial**), mantendo a `PG::Connection` (não thread-safe) single-threaded o tempo todo; ~50min → ~10-15min. **(B) desacoplar** a IA-2 num job standalone (`AiRecommenderJob` = runner + silent-death detector + ciclo de healthcheck próprio) rodado por `bin/run_ai_recommender` no workflow dedicado `ai-reco.yml` (cron 10:45 UTC, ~45min após o scrape; `timeout-minutes: 45`, cron/manual-only). O `scrape-daily` perde a IA-2 e cai pra `timeout: 20min` (coleta pura ~10-15min). **Por que ambas:** A deixa cada rodada rápida; B garante que um dia ruim de R1 jamais derrube a coleta. **Hibernação:** A é perf (mesmo modelo/prompt/threshold/nº de chamadas — só o agendamento muda), B é infra pura — ambas permitidas. TDD: 4 specs de paralelização no runner + `ai_recommender_job_spec` (9 ex.) absorvendo a invocação/silent-death que saíram do `orchestrator_spec`. Workflow segue o checklist `optimizing-github-actions`. Commits `31fc71d` (A) + `05b06ac` (B). **Pendência operacional:** GH var `AI_RECO_CONCURRENCY` (opcional, default 6 no código); o cron `ai-reco.yml` precisa das mesmas secrets/vars de LLM que saíram do `scrape-daily` (já existentes: `OPENROUTER_API_KEY`, `AI_RECO_MODEL`, etc.).

9. **ADR-009 — Reconciler de actuals via API-Football** — _2026-05-26 REVERTED · 2026-05-28 REMOVED_ — Tentativa de buscar resultados FT (corners/cards/SOT) na API-Football. Revertida porque o free tier não cobre seasons 2025+; **removida por completo em 2026-05-28** (código, docs, workflow `api-football-snapshot`, GH secrets, key rotacionada — a chave havia vazado no histórico público). Substituída pela extração via choistats `recent_results` (B19). A migration `0036` e a tabela `actuals_fixture_mapping` permanecem como dead schema benigno (não removidas — migrations são append-only).

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

- **B12 — 2026-05-17 — Outage Worker 1101: lista de fixtures puxava `detail_json` inteiro.** O site inteiro (`/fixtures?date=today` via `fixturesForBrtDay` em `lib/fixtures/repository.ts`, consumido por `app/(dashboard)/fixtures/page.tsx` E `app/api/fixtures/route.ts`) selecionava o blob `detail_json` completo para ~285 linhas/dia (retenção não está purgando — ver follow-up adam-stats). Payload medido contra prod Supabase: **34.1 MB/dia** → estoura RAM/CPU do Cloudflare Worker → **Error 1101 "Worker threw exception"** intermitente desde a tarde anterior. **Não era o copilot/IA** (mesma classe de bug do incidente copilot 1101 — ver memória `copilot-prod-incident`: payload pesado não-orçado num Worker). **Fix:** `FIXTURE_COLUMNS` só escalares + probe de presença `hd_probe:detail_json->>team_record`; `has_detail = row.hd_probe != null`; sem `computeBadges`/`badges` na lista (`FixtureDTO.badges?` é opcional — `fixture-card.tsx` degrada gracioso com `?? []`). Payload novo: **~270 KB** (125× menor). Página de detalhe `/fixtures/[id]` tem query própria (1 linha) — intocada, segue completa. **Lição central:** *validar o payload real contra prod Supabase ANTES de deployar um fix de outage* — a 1ª tentativa (sub-paths `->streaks`/`->referee_record`) media 25.8 MB (não-fix); a 2ª (`->team_record->home->>type`) era 100% nula (path errado, quebraria `has_detail`); só a medição real revelou que `detail_json->>team_record` é o único probe não-nulo em 249/249 linhas (0 falsos-negativos; o leaf profundo `->home->overall->>type` tinha 1 falso-negativo real). Probe profundo é semanticamente errado pra "blob existe?" — qualquer leaf pode ser nulo com detail presente. **Follow-ups acordados:** (1) restaurar badges via view/RPC Postgres (computa em SQL, custo ~zero no Worker); (2) retenção não purga (1018 linhas, repo adam-stats — Ruby/cron/VPS, incidente separado).

- **B13 — 2026-05-18 — Harness SQL para migration 0014 está ausente (exceção consciente).** A verificação comportamental de `0014_banca_loop.sql` (que `resolve_bet` persiste o ledger corretamente, que `generate_balance_snapshots` é idempotente via `ON CONFLICT DO UPDATE`, que `roi_by_house_view`/`roi_by_period_view` retornam valores numericamente corretos) exige um Postgres real com o schema aplicado — harness inexistente neste repo. O SQL foi auditado estaticamente pela spec-review e aprovado. Os testes app-side em `tests/integration/banca-snapshot.test.ts` cobrem o contrato da action (`resolveBetAction` propaga erros, chama RPC com params corretos), mas NÃO verificam o comportamento SQL. **Resolução decidida:** aceitar a lacuna como exceção consciente; substituir o `banca-snapshot.test.ts` tautológico (que fazia regex no texto SQL e assertions sobre objetos que o próprio teste escreveu) por testes app-side honestos; registrar follow-up em `docs/tasks/loop-banca/01-followup-sql-harness.md` com o harness mínimo necessário (`supabase start` + `supabase db push` + testes via `pg` driver). **Mesma decisão para `banca-views.test.ts`:** substituído por testes de render real da página `/banca` com mock Supabase retornando linhas no formato das views.
- **B14 — 2026-05-18 — Re-abertura do outage 1101 pela seção "Destaques do dia"; resolvido com badges em SQL (B12 follow-up #1).** A feature `alertas-proativos` introduziu `fixturesWithBadgesForDashboard` + `BADGE_COLUMNS` em `lib/fixtures/repository.ts`, que selecionava `detail_json->referee_record` e `detail_json->streaks` para rodar `computeBadges()` em JS num Server Component (`app/(dashboard)/_components/destaques-do-dia.tsx`) na rota `/` — a mais quente, mesmo Worker do B12. **Medido contra prod (BRT 2026-05-18, 47 fixtures): 83.269 B/fixture → 22.63 MB no pico de 285 fixtures** — classe de payload IDÊNTICA ao não-fix rejeitado do B12. Além disso, o realce de `/fixtures` (`fixtures-list.tsx`) era dead code: a query da lista não traz badges, então `isHighSignal(fixture.badges ?? [])` era sempre `false` (mascarado por badges mockados no teste). **Fix estrutural (B12 follow-up #1 cumprido):** migration `0017_fixture_badges.sql` cria a view `fixture_badges_view` (SECURITY INVOKER) que porta a lógica de `computeBadges()` para SQL puro lendo `detail_json->streaks`/`->referee_record` DENTRO do Postgres e emitindo só escalares `(fixture_id bigint, badges text[], high_signal boolean)`. `fixturesWithBadgesForDashboard` agora faz 2 queries escalares (fixtures + view, join por id em JS); `fixturesForBrtDay` ganha uma query suplementar mínima `(fixture_id, high_signal)` que alimenta o realce real de `/fixtures` (via `fixture.high_signal`, não mais `isHighSignal(badges)` morto). `badgesFromSlugs()` (`lib/fixtures/badges.ts`) rehidrata slugs→Badge com `BADGE_BY_SLUG` (fonte única de label/tone, lockstep com a view SQL). Guard de payload abrangente (`lib/fixtures/repository-payload-guard.test.ts`) varre estaticamente TODO `.select(...)` do repository e reprova qualquer `detail_json` que não seja o probe escalar `->>team_record`. Dismiss agora idempotente: `.upsert(..., { onConflict: 'user_id,fixture_id', ignoreDuplicates: true })` em `actions.ts`. **Payload medido pós-fix contra prod: ~1.433 B/fixture → ~399 KB no pico (fixtures escalar + view escalar, pior caso 3 badges/linha) — redução ~58×, KBs e não MBs.** **Lição:** badge/realce derivado de JSON pesado SEMPRE computa no Postgres (view/RPC) e cruza só escalar pro Worker; teste-guard estático por regex em todo `.select` evita reintrodução em qualquer função, não só na que estourou. **Pendência (não-bloqueante):** a migration `0017` precisa ser aplicada em prod (`supabase db push` ou Management API) antes do deploy do front — enquanto não aplicada, `fetchBadgeView` degrada gracioso (sem badges/realce, zero crash).
- **B15 — 2026-05-18 — A API choistats já entrega médias de temporada (`*Avgs`) e o `WidgetMerger` as descartava; premissa errada quase fechou arquitetura ruim.** Na pesquisa da simulação pré-jogo, a v0.1 assumiu "regime n≈10 jogos/time, derivar médias na mão" → método frágil (DC-lite + shrinkage pesado). **Verificação empírica do payload real** (`scripts/scraper/spec/scraper/fixtures/widgets/recent-results.json`) provou: o widget retorna 4 blocos `fixture.{homeTeamHomeAvgs,homeTeamOverallAvgs,awayTeamAwayAvgs,awayTeamOverallAvgs}` com ~43 métricas cada + `numMatches` **17-37** (temporada inteira, split de mando) — e `WidgetMerger.build_recent_matches` (`widget_merger.rb:98-106`) só lia `recentHomeResults`/`recentAwayResults`, **descartando os `*Avgs`**. Idem `recentHome/AwayAllResults`, `*ResultsWithStandings`, `goalKicks`/`throwIns` per-match, 52 mercados de odds, e Tier-3 de `players.json` (`playerStatsForm`/`*TeamSeasons`/`outcomeOdds`). **Lição:** (1) antes de fechar método estatístico, **inspecionar o payload bruto inteiro** que já recebemos — não assumir granularidade a partir do que o merger persiste (o merger pode estar jogando fora dado de ouro); (2) decisão P0 exige `research-critic` real, não auto-revisão (a v0.1 só caiu porque o critic real rodou — Lição #1 reconfirmada; v0.1 REPROVADA, v0.2 APROVADA C/ RESSALVAS); (3) escalação simulada é **projeção do histórico — a UI deve rotular "provável escalação", nunca XI oficial** (scrape 1×/dia 07:00 BRT; oficial só ~1h pré-KO; re-scrape tardio = Opção B, follow-up condicional). A fundação de enriquecer o `WidgetMerger` beneficia simulação **e** o dashboard de stats existente. Ver ADR-006 + `docs/pesquisas/simulacao-pre-jogo-fixtures.md`.

- **B19 — 2026-05-28 — Reconciler marcava corners/SOT/cards como derrota automática; os actuals SEMPRE estiveram na API (premissa Wave G/W-R errada).** Ambos os reconcilers (`AiRecommendationReconciler`, `SimulationReconciler`) liam só o objeto `fixture` (header) do widget `recent_results`, que expõe apenas `homeGoalsFt/awayGoalsFt/homeReds/awayReds`. Como `bet_won?` não tinha branch pra corners/SOT/cards (caía no `else → false`) mas a linha era marcada `resolved` assim que havia gols, **55 recos de mercados secundários viraram false-loss** (0% win, −100% ROI). Isso derrubou o ROI aparente da IA pra −29,8% e envenenava o treino. **Causa raiz:** os stats secundários NÃO ficam no header — ficam no entry de `recent_results.recentHomeResults[0]` (e `recentAwayResults[0]`) cujo `id == fixture_id`: o jogo recém-disputado aparece como o resultado mais recente do time, com `homeCorners/awayCorners`, `homeShotsOnTarget/awayShotsOnTarget`, `homeYellows/awayYellows`, `homeReds/awayReds` completos. A investigação Wave G/W-R (2026-05-25, ADR-008) concluiu "indisponível" por olhar só o header — repetindo o erro da Lição B15. **Fix:** módulo `lib/scraper/ft_actuals.rb` (extrai goals+secundários do entry por id), `bet_won?` tri-state (corners/SOT/cards via `over_under`, linha = `side`÷10; `nil` quando stat ausente ⇒ fica pending, NUNCA false-loss), `SimulationReconciler` popula `actual_corners/cards/sot_home/away` + `actual_data_source`. Cards = `yellows + reds` (contagem, não booking points — `sim_stats.cards` é count, p50≈2/time). Re-resolução em prod via `bin/reresolve_secondary_markets`: **ROI da IA passou de −29,8% (artefato) para +11,9% real** (61/128 bet-verdicts ganhas). **Regra (reforça B15):** antes de concluir que um dado não existe na API, inspecionar o payload BRUTO inteiro — não só o campo óbvio. Documentação viva da API: `bin/document_choistats_api` → `docs/external-apis/choistats/choistats-api.md` (re-rode pra detectar drift).

- **B18 — 2026-05-25 — `ENV['X'] || default` é fragil em GH Actions: `${{ vars.X }}` injeta string vazia quando vars não está definida, e `'' || default` em Ruby retorna `''` (string vazia é truthy).** Bug em produção: `AiRecommenderRunner` no scrape #2 fez 43 chamadas OpenRouter com `model=""` → `400 No models provided` em todas. Fix: `env_val.to_s.strip.empty? ? DEFAULT : env_val`. **Regra:** sempre normalizar ENV vars vazias pra `nil` antes do `||` em Ruby. Pattern reutilizável no AiRecommenderRunner. Lição secundária: PT-BR scrape logs precisam ter feedback quando IA é chamada com config inválida (atualmente só `error` em llm_request_logs — vale checar healthchecks/fail webhook).

- **B17 — 2026-05-24 — Componente com múltiplos `chrome` modes precisa de smoke E2E ou perde features inteiras silenciosamente.** O agente F3-prod colou o `<CalibrationBadge>` dentro do prop `eyebrow={...}` do `PanelShell` em `simulation-panel.tsx`. Tudo verde local (758 testes), `applyCalibration` flipava `calibrated_via_isotonic=true` corretamente, probs eram alteradas (0.6289→0.587). Mas em prod o badge não aparecia. **Causa raiz:** `SimulationPanel` tem `if (chrome === "bare") return body;` (linha 377) que descarta o PanelShell inteiro — incluindo o eyebrow onde o badge vivia. E `page.tsx` chama com `chrome="bare"` (porque o `SimulationDisclosure` já provê a casca, evitando card-in-card). **Sem teste unitário do componente nem smoke ao vivo, o bug viajou pra prod.** Fix em `be146f8`: mover badge pro topo do `SimulationBody` (que é renderizado em ambos modos `bare` e `shell`). **Regra:** quando o panel tem 2+ chrome modes (default `shell` + variants como `bare`/`minimal`), TODA feature que afeta o header/eyebrow deve ser duplicada nos modos OU vivir no body. Testes do componente precisam exercitar todos os modos. E pra UI sem teste — smoke E2E ao vivo após deploy é OBRIGATÓRIO antes de declarar shipped, não opcional.

- **B16 — 2026-05-21 — Reconciler é OBRIGATÓRIO no pipeline, não é opcional.** O `SimulationReconciler` foi criado com specs verdes mas NUNCA cabeado no `orchestrator.rb` (só o `PredictionReconciler` estava). Resultado: 665 simulações ficaram `pending` por dias, bloqueando toda calibração downstream (F4/F8/F13/F14). Fix em `009b1b4`: adicionado bloco `begin/rescue` chamando `SimulationReconciler.new(logger:).run` logo após o PredictionReconciler. **Regra:** ao criar um novo `*Reconciler`, SEMPRE adicionar ao pipeline diário no mesmo PR. Spec do orchestrator deve cobrir a invocação (e o rescue não-fatal). Lição secundária: WebMock `NetConnectNotAllowedError < Exception` (não `StandardError`) vaza dos `rescue StandardError` do reconciler — considerar `rescue Exception` em testes de pipeline ou stubar reconciler globalmente em specs de integração.

- **B20 — 2026-05-28 — `scrape-daily` estourou o `timeout-minutes: 30` por 3 dias seguidos (26-28/05); o pipeline pós-persist inflou o runtime.** Os runs apareciam como `cancelled` em ~30min com a annotation `The job has exceeded the maximum execution time of 30m0s`. O scrape em si era ~5min pra ~564 fixtures (A6), mas o pipeline pós-persist cresceu muito: simulação Monte Carlo + reconcilers (Prediction/Simulation/AiRecommendation) + recompute de baselines + **recomendador IA-2 chamando OpenRouter R1 (p95 ~195s por fixture com edge)** no fim. Fix imediato: `timeout-minutes` 30→60 (commit `eb4818d`). **Nota:** o fix entrou às 14:17 UTC, *depois* do scrape de 28/05 (10:00 UTC) — o primeiro run a rodar com 60min é o de 2026-05-29. **Regra:** ao adicionar etapas pesadas (especialmente chamadas LLM) ao orchestrator, reavaliar o `timeout-minutes` do workflow no mesmo PR. Se 60min apertar, mover o recomendador IA-2 pra um workflow separado do scrape (desacoplar o hot path de coleta da inferência LLM).

- **B20-bis — 2026-05-29 — o scrape estourou os 60min no 1º run com o cap novo; a IA-2 era serial e nunca terminava. Resolvido com paralelização (A) + desacoplamento (B).** O run de 29/05 (1º com `timeout-minutes: 60`) foi `cancelled` aos 60.3min — confirmando que o problema do B20 era **estrutural**, não de tuning: a IA-2 chamava o R1 em **série** (`fixtures.each` → `client.call` bloqueante ~60-90s), então mesmo 60min não bastava (processou 111 de ~340 sims antes de morrer). Pior: a "cauda" de skips rápidos da Parte 1 (skip-coverage) roda **depois** das chamadas R1 — e o job morria *durante* as chamadas, então o overflow ficava sem o badge "IA · sem valor". **Fix (ADR-010), duas camadas:** (A) paralelizar as chamadas R1 num pool limitado (`Thread`+`Queue`, `AI_RECO_CONCURRENCY=6`) — refatorando o runner em 3 fases (edge-calc+skip **serial** → R1 **paralelo só-rede** → gravação **serial**) pra manter a `PG::Connection` single-threaded (ela **não é thread-safe** — a regra de ouro aqui); ~50min → ~10-15min. (B) desacoplar a IA-2 num workflow próprio (`ai-reco.yml` + `bin/run_ai_recommender` + `AiRecommenderJob`), cron 10:45 UTC, pra que um dia ruim de R1 nunca derrube a coleta; `scrape-daily` cai pra `timeout: 20min`. **Regras:** (1) pipeline dominado por I/O lento (LLM, HTTP) → paralelizar a I/O, **nunca** o acesso ao DB (fan-out só na rede, escritas em fase serial); (2) bumpar `timeout-minutes` é band-aid se a etapa é serial-bound — a correção é concorrência ou desacoplamento; (3) feature cujo efeito visível depende de uma "cauda" do pipeline (ex: skips após as chamadas LLM) só entrega se o pipeline **terminar** — medir o run inteiro, não só a fase principal.

- **B21 — 2026-05-29 — revisão de perf (Lighthouse + trace Firefox real do Pilot + Playwright/probe): a `fixture_badges_view` recomputava JSONB da tabela inteira a cada leitura (sem predicate pushdown).** A revisão de performance percebida (login Lighthouse 100/100; CLS 0 em todas as rotas; cliente leve — sem jank de Layout/GC) isolou **um** gargalo consistente (não cold-start): `/fixtures` TTFB ~1,1s e `/api/fixtures` ~800ms. Probe das 3 queries de `fixturesForBrtDay` via PostgREST mostrou a `fixture_badges_view` em **~725ms** (vs base escalar ~110ms, verdicts IA ~95ms). `EXPLAIN ANALYZE` (390 fixtures na tabela, pedindo 48 do dia): as CTEs `strong_streaks` (GroupAggregate + `jsonb_array_elements` → ~84k linhas de ~357 fixtures) e `referee_flag` (seq scan, 390) computavam a tabela **inteira** ANTES do filtro `fixture_id IN (...)` que o PostgREST aplica no topo — **sem pushdown**. Como `detail_json` só muda no scrape (1×/dia), recomputar por leitura é desperdício puro. **Fix (`0043_fixture_badges_view_pushdown.sql`):** reescrever a view como UM passe `from fixtures f` com subqueries **LATERAL** correlacionadas em `f.detail_json` → o filtro `f.id = ANY(ids)` vira Bitmap Index Scan no pkey ANTES dos laterais, que só rodam pras linhas filtradas (`loops=48`). EXPLAIN pós-fix: **679ms → 83ms**; prod via PostgREST **~725ms → ~180ms** (~3,7×); `/api/fixtures` TTFB **~0,8s → ~0,5s**. **Paridade verificada contra prod: 390/390 linhas idênticas (badges[] + high_signal), 0 divergências** — contrato escalar inalterado, app não muda, `create or replace view` reversível (re-aplicar 0017), zero risco no write-path do scrape. O teste `badge-thresholds.parity.test.ts` foi reapontado pra 0043. **Regra (reforça B12/B14):** view que computa sobre JSONB pesado DEVE permitir pushdown do filtro (LATERAL correlacionado por-linha, não CTE agregada sobre a tabela toda) — senão paga full-table a cada leitura. **Itens menores da mesma revisão:** (a) **favicon** vinha com `Cache-Control: max-age=0, must-revalidate` → 74 refetches/sessão (8,6s acumulados). 1ª tentativa via `next.config headers()` foi **inócua**: o `app/favicon.ico` é servido como **static asset do Cloudflare** (binding `assets` → `.open-next/assets`, fora do Worker), então `headers()` não o alcança (confirmado pós-deploy: header inalterado). Fix correto: **`public/_headers`** (mecanismo de headers do CF Workers Assets; OpenNext copia `public/` pro bundle) com `immutable` só no `/favicon.ico` (URL versionada por hash; **não** aplicar a `sw.js`). *Impacto real é pequeno* — o CF serve da edge (`cf-cache-status: HIT`), então as revalidações são 304 baratas; os picos de 1,45s no trace eram coincidência de cold-start, não custo inerente do favicon. (b) **crash de aba em `/transactions/new`** no trace: form trivial (dropdown + campos), **ambiental** (Firefox Nightly 149 + Profiler gravando 180MB + 7 extensões), sem bug de app → sem mudança (YAGNI). (c) **shimmer "infinito"**: já guardado por `prefers-reduced-motion` no globals.css (intencional) → sem mudança. (d) **cold-start bimodal** (home/calibração 1-1,5s frio): o `middleware.ts` chama `supabase.auth.getUser()` (round-trip à Auth) em toda navegação — **FOLLOW-UP pro Pilot** (decisão de segurança): migrar pra `getClaims()` (verificação local de JWT) exige confirmar chaves JWT assimétricas habilitadas; não shipado autonomamente por risco de lockout. Harnesses reutilizáveis em `scripts/perf/` (`measure-prod.mjs` = Web Vitals/Playwright por rota; `probe-fixtures-queries.mjs` = timing por query).

- **B22 — 2026-05-30 — "carregando infinito" no `/login` + login lento: dois sintomas independentes (systematic-debugging).** **(1) Beacon do Cloudflare Web Analytics (RUM) — não era código nosso.** O auto-injection do Web Analytics estava LIGADO no dashboard CF (provável default ao adicionar o domínio; ninguém pediu) → o edge injetava `<script integrity="sha512…" src="static.cloudflareinsights.com/beacon.min.js/v8…">` **condicionado a User-Agent de browser** (`curl` puro NÃO via; `curl -A "<Firefox UA>"` via — foi assim que confirmei a origem). Bloqueadores (o AdGuard do Pilot) devolvem um stub → o hash SRI não bate → CORS + conexão pendurada → o Firefox nunca fecha o `load` → spinner infinito (a página já estava funcional). O beacon reporta via `POST /cdn-cgi/rum` no PRÓPRIO domínio → explica o "Esperando abissal.rnobre.dev…" na barra de status. **Fix:** desligar no dashboard (Web Analytics → Manage site → **Disable**/Delete) — ação do Pilot; não há acesso a Web Analytics via MCP/wrangler. Confirmado via `curl -A` + Playwright (`BEACON:[]`, `load` limpo). **Regra:** terceiro injetado no edge **só pra browsers** não aparece em `curl` puro — reproduzir com UA de browser; e RUM/analytics de terceiro com SRI quebra silenciosamente sob adblock. **(2) `getUser()` → `getClaims()` no middleware (cumpre o follow-up B21).** `getUser()` fazia POST `/auth/v1/user` (round-trip a sa-east-1) em TODA navegação. O risco que travava o fix era "JWT assimétrico habilitado?" → **confirmado ES256** via `curl …/auth/v1/.well-known/jwks.json` (keys com `kid`/`x`/`y`). `getClaims()` valida a assinatura **localmente** (WebCrypto + JWK cacheado), sem round-trip; refresh preservado (`getClaims`→`getSession`→`_callRefreshToken` se `hasExpired`→re-set cookies via `setAll`; `@supabase/ssr` = `autoRefreshToken:false,persistSession:true`). TDD: `lib/supabase/middleware.test.ts` (env **`node`** — `happy-dom` quebra o `instanceof Headers` que o `NextResponse.next` exige). Layout do dashboard já usava getClaims (B21). **Regra (reforça a skill Supabase):** `getClaims` (validação local) é a recomendação oficial p/ proteger páginas no SSR (read-path); **Server Actions de escrita mantêm `getUser`** (validação server-side completa vale o round-trip). Não usar `user_metadata` em decisão de autorização — só exibição. **Read-paths migrados (e529c4d):** 6 Server Components de leitura (painel, bilhete, bilhete/builder, disciplina, admin/telemetry, destaques-do-dia) → helper `authedUserId` (`lib/supabase/auth.ts`, 3 testes TDD). **ARMADILHA `runtime="edge"` (descoberta ao migrar o `/api/bets/export`):** era o ÚNICO `runtime="edge"` do projeto e retornava **500 em prod mesmo DESLOGADO** (antes do auth gate), independente de getUser/getClaims — o revert pro getUser NÃO corrigiu (refutou a 1ª hipótese, que era getClaims). Causa: **OpenNext/Cloudflare roda tudo no Worker em Node.js e é incompatível com `runtime="edge"`** (doc oficial). Bug pré-existente (introduzido no 5d6849e), não da migração. Fix (4facc0f): remover a diretiva → 401. **REGRA: NUNCA declarar `export const runtime="edge"` neste projeto** — todos os endpoints (inclusive `/api/analyze` com SSE) usam o runtime padrão (Node). O export ficou com getUser (download pontual, não hot-path). Lição de processo (systematic-debugging): quando o revert de uma hipótese NÃO corrige o sintoma, a hipótese estava errada — formar nova, não empilhar fix. **Não atacado:** cold-start do Worker (hibernação free tier).

---

## Do not

- Bypass the TDD flow (write production code before tests).
- Execute state-changing commands without explicit approval.
- Add speculative code or abstractions "for the future".
- Modify files outside the declared scope of the current task.
- Touch `~/.claude/` global without explicit approval.
- Add `Co-Authored-By: Claude` (or any equivalent trailer) to commit messages — explicit project rule.
