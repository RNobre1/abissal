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

## Multi-usuário (desde 2026-07-30)

O sistema deixou de ser single-user: há **mais de uma conta real** em uso
(o Pilot e o irmão dele). Isso muda o que antes era teoria em risco concreto.

**O que já está certo** (auditado no Postgres de produção em 30/07):
- Toda tabela com `user_id` tem política RLS referenciando `auth.uid()`.
- Todas as views são `security_invoker` (não rodam como dona, logo respeitam RLS).

**A armadilha real:** RLS não protege nada quando o código usa
`createAdminClient()` — que é `service_role` e **ignora RLS por completo**. Boa
parte das rotas usa. Dois vazamentos foram encontrados e corrigidos assim:
`fetchLinkedBet` mostrava a aposta do OUTRO usuário no mesmo jogo, e
`/calibracao` somava o ROI das duas contas.

**Regra:** toda leitura de tabela user-scoped feita com o client admin precisa
de `.eq("user_id", ...)` explícito. Há um guard estático em
`tests/unit/multiuser-isolation-guard.test.ts` que quebra o CI se isso for
esquecido. Tabelas user-scoped: `bets`, `bet_selections`, `bet_slips`,
`bet_slip_legs`, `transactions`, `houses`, `balance_snapshots`,
`disciplina_settings`, `audit_log`, `bet_events`.

**Pendências conhecidas do modelo multi-usuário:**
- `disciplina_settings` existe só para uma conta; `checkDisciplinaLimits` falha
  **aberto** quando não há config — ou seja, uma conta nova nasce sem nenhum
  limite de disciplina.
- `ui_telemetry` grava `user_id` nulo em tudo: não dá para separar o uso de cada
  um.
- `actuals_fixture_mapping` (tabela órfã) é a única sem RLS habilitada.

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
  - `scrape-daily.yml` — 10:00 UTC (07:00 BRT). Scrape + simulação + reconcilers. `timeout-minutes: 20` (a IA-2 saiu daqui — ver B20-bis). Popula Supabase via pooler. `workflow_dispatch` disponível.
  - `ai-reco.yml` — 10:45 UTC (07:45 BRT), ~45min após o scrape. Recomendador IA-2 **desacoplado** (B20-bis): `bin/run_ai_recommender` → `AiRecommenderJob`. Chamadas R1 paralelizadas (`AI_RECO_CONCURRENCY`, default 6). `timeout-minutes: 45`, cron+manual only (sem push — workflow caro de LLM). `workflow_dispatch` disponível.
  - `closing-odds-capture.yml` — 15/17/19/21 UTC. Captura closing odds (CLV) na janela ao redor do KO.
  - `telegram-closure.yml` — 02:00 UTC. Resumo diário no Telegram.
  - `calibracao-weekly.yml` — **todo domingo, 12:00 UTC** (era mensal, dia 5 — ver lição B24). Roda após o scrape (10:00) + reconcilers + ai-reco (10:45), pegando sábado já resolvido. Refita parâmetros por liga (`scripts/calibracao/fit-league-parameters.ts`, ligas com `n≥20`) + calibração isotônica IA (`scripts/calibracao/fit-isotonic.ts`). **Refit mecânico data-driven — NÃO mexe em prompt/modelo** (decisão manual, por evidência, nunca por calendário). Manual: `gh workflow run calibracao-weekly.yml -R RNobre1/abissal`. Local: `pnpm exec tsx scripts/calibracao/fit-league-parameters.ts`. Secrets: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; `HEALTHCHECKS_CALIBRATE_URL` opcional.
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
│   │   ├── fixtures/ [id]/              # listagem + análise (o dashboard de stats
│   │   │   └── [id]/stats/              #   virou a própria [id]; /stats é só redirect legado)
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
│   ├── fixtures/ (+ fixtures/stats/)    # time, types, repository, choistats-api, prompt-builder
│   ├── ai/  ai-reco/                    # openrouter client + recomendador IA-2 (edge calc, blending)
│   ├── banca/ bets/ bet-slip/ bet-slip-ocr/ disciplina/  # domínio banca + OCR de bilhete
│   ├── calibracao/  alerts/  telemetry/  telegram/
│   └── (stats e duckdb OLAP servem /explore e /fixtures/[id]/stats)
├── supabase/migrations/                 # 0001-0042 (ver "Data model")
├── scripts/
│   ├── scraper/                         # sub-projeto Ruby 4.0.3 (Gemfile, mise.toml)
│   │   ├── bin/{scrape, resimulate, run_ai_recommender, capture_closing_odds, document_choistats_api, reresolve_secondary_markets}
│   │   ├── lib/scraper/                 # módulos Ruby (orchestrator, reconcilers, ft_actuals, sim engine…)
│   │   └── spec/                        # ~565 RSpec examples
│   ├── calibracao/                      # fit-league-parameters.ts, fit-isotonic.ts (cron semanal/domingo)
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
    └── calibracao-weekly.yml            # cron domingo 12:00 UTC (era mensal — B24)
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
bundle exec bin/resimulate [--dry-run]      # re-simula o detail_json JÁ armazenado (sem tocar a API);
                                            #   use após bump de model_version (ver B50). --dry-run
                                            #   imprime o diagnóstico sem escrever.
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
| `analysis_cache` | **ÓRFÃ** — nunca foi fiada. O schema existe (chave `content_hash`, FK `fixtures(id) ON DELETE CASCADE`) e o `CLAUDE.md` chegou a listar um `lib/fixtures/analysis-cache.ts` que **não existe**; nenhuma rota lê ou grava. Tabela com 0 linhas. Vale ressuscitar: com p95 do LLM em 153s, reabrir o mesmo jogo hoje paga a análise inteira de novo. Enquanto não for fiada, é dead schema (migrations são append-only). | authenticated |
| `league_baselines` | **ÓRFÃ** — aposentada 2026-07-29. Cadeia rompida de ponta a ponta: o produtor (`extract_trends`) só roda no caminho HTML/Playwright deprecated (A6), então `detail_json.trends` vinha `[]` em 12/12 fixtures, a tabela tinha **0 linhas** em prod e `fetch_for_league` nunca era chamado. O `recompute!` diário ainda fazia TRUNCATE + full scan de `detail_json` (~100 MB/dia) pra produzir zero linhas — removido do orchestrator. A pergunta que ela responderia ("taxa-base desta liga") tem resposta melhor em `lib/calibracao/market-accuracy.ts`, dos resultados REAIS reconciliados; o proxy via `streaks` errava até 14pp. Schema mantido (migrations são append-only). | — |
| `fixture_simulations` | **Motor estatístico**: Poisson + Dixon-Coles + Monte Carlo 10k → escalares `p_*` + `sim_stats jsonb` (gols/BTTS/corners/cards/SOT por time/tempo — chave **`sot`**, nunca `shots_on_target`). Colunas `actual_*` populadas pelo reconciler **via choistats** (B19), `actual_data_source`, `model_version` (**v8** desde 29/07 — `SeasonAvgs`, ver B50). `model_version` entra na chave de dedup, então versões coexistem e o histórico sobrevive a bumps. | service_role |
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

### Config global (migration 0050)

| Tabela | Propósito | RLS |
|---|---|---|
| `app_settings` | Config GLOBAL key-value (≠ `disciplina_settings`, que é por-usuário). 1ª flag: `ai_enabled` — **kill switch global de IA**. Quando `false`, TODO uso de LLM/OpenRouter é pulado: cron recomendador IA-2 (`AiRecommenderJob` lê via `GlobalConfig.ai_enabled?` e sai pingando healthcheck **success**, não silent-death), `/api/ai-reco/compute` (503), OCR de bilhete (`parse-photo-action`). Lido pelo app (`lib/settings/ai-toggle.ts#isAiEnabled`) e pelo scraper (`scripts/scraper/lib/scraper/global_config.rb`). **Default graceful = LIGADO** (ausência/erro ⇒ ligado). Toggle em `/configuracoes/ia`. Escrita só via service_role. A simulação (Monte Carlo) NÃO é IA — segue rodando com a flag off. | authenticated SELECT |

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

5. **ADR-005 — Dashboard de stats por fixture: chart libs e visualização** — _2026-05-13_ — **(nota 2026-07-30: a rota `/fixtures/[id]/stats` hoje é só um `redirect` legado — o dashboard virou a própria `/fixtures/[id]`. As libs e o bundle descritos aqui vivem lá.)** Para `/fixtures/[id]/stats` (11 painéis denso "Trading Terminal + Stadium Wall"), decisão de stack: **recharts** 2.15 (sparkline, radar 6-axis, scatter min×eff, line multi-series, ranking) + **lightweight-charts** 4.2.3 (séries temporais densas — PPG rolling, booking_points trend) + **CSS Grid puro** (heatmap de streaks de 109-194 entries × 10 grupos) + **Tailwind v4 container queries** (responsive layout sem media queries). Insights derivados server-side via `simple-statistics` + `regression` (correlações r ≥ 0.5, trends por regressão linear, padrões condicionais, outliers ≥ 2σ) — não vão pra bundle client. **Rejeitadas:** ECharts (60+ KB gzip; overkill), Nivo (D3 wrapper pesado), Chart.js (sem SSR-friendly radar), react-financial-charts (especializado em candlesticks), react-grid-layout + dnd-kit (drag-resize fora de escopo MVP), react-window (substituído por `@tanstack/react-virtual` que já estava no projeto). DuckDB-WASM permanece exclusivo de `/explore`. **Bundle delta:** +186.9 KB gzip num único chunk dedicado `/fixtures/[id]/stats` — **estourou o budget conservador de +150 KB gzip por ~37 KB**; aceito como não-blocking porque a rota é dedicada (lazy por route), não impacta entry points (login, fixtures list, dashboard, betting flow), e usuário só baixa o chunk com intenção explícita de ver stats. Follow-up condicional registrado: se Lighthouse Performance < 85 ou LCP > 2.5s em real-device test pós-deploy, splittar painéis via `next/dynamic` (ganho esperado -30 a -60 KB no first paint). Fundamentação completa em `docs/pesquisas/dashboard-stats-fixture-arquitetura.md` §10 e medições empíricas em `docs/tasks/dashboard-stats-fixture/bundle-report.md`.

6. **ADR-006 — Simulação pré-jogo: força-de-temporada + Dixon-Coles + Monte Carlo, computada no scraper Ruby, schema próprio** — _2026-05-18_ — Simulação pré-jogo pré-computada por fixture (placar + todas as stats por time/tempo + camada por jogador com **provável escalação**). Decisão: modelo = força ataque/defesa de temporada (blocos `*Avgs` do choistats, `numMatches` 17-37 — já são as forças, **sem MLE global**) normalizada pela liga → Poisson + correção **Dixon-Coles τ** (ρ prior calibrável); **Negative Binomial** p/ stats overdispersas (escanteios/cartões); **Monte Carlo 10k → só escalares**; shrinkage **condicional** a `numMatches` baixo; alocação de eventos por jogador (provável XI por `started`/`minutes`, excl. `injured`). Computado **no scraper Ruby pós-persist** (Worker só lê escalares — protege contra a classe de outage 1101, ver B12/B14/B15); schema **`fixture_simulations` próprio** (migration `0018`, escalar + jsonb pequeno, RLS service-role-only, sem FK rígida — não estende `ai_predictions`/0016, ortogonal); odds devigadas (multiplicativo) + `outcomeOdds` por jogador como **âncora de validação não-circular, nunca input**. **Re-scrape tardio de escalação: NÃO no MVP** (Opção A — projeção do histórico, rotulada "provável escalação"; Opção B = follow-up condicional ao Brier dos `player_events`). Pré-requisito compartilhado: enriquecer `WidgetMerger` (6 itens descartados hoje) — beneficia simulação **e** o dashboard de stats (ADR-005). Fundamentação: `docs/pesquisas/simulacao-pre-jogo-fixtures.md` (L3 v0.3, research-critic real 2 rodadas: v0.1 REPROVADA, v0.2 APROVADA C/ RESSALVAS, v0.3 ressalvas aplicadas). Decomposição/execução: `docs/tasks/simulacao-pre-jogo-fixtures/00-plan.md`. **Status: IMPLEMENTADO e mergeado na `main` (2026-05-18) via subagent-driven paralelo em worktrees** — T0 POC (`093c43d`) ‖ T1 fundação-gate (`f70dac2`); T2 motor+`0018`+hook (`0181ec9`) ‖ T3 dashboard (`2c4ebab`); T4 calibração/`brierScore`/reconciler (`0635cc8`) ‖ T5 guard generalizado (`903ac41`). Cada task passou por TDD + review adversarial em 2 etapas (spec-compliance → code-quality) com loop de fix; gate combinado verde a cada merge (RSpec scraper 350/0/1 · Vitest 675 · lint 0 · typecheck). **Pendência operacional (gated ao Pilot):** aplicar a migration `0018_fixture_simulations.sql` no Postgres de produção — o hook do orchestrator é warning-safe (Lição A5), então prod permanece saudável sem ela (simulação degrada para "indisponível" até a migration ser aplicada); aplicação via Management API depende da rotação do PAT Supabase exposto (pendência de segurança pré-existente).

7. **ADR-007 — Roda + Puma para o endpoint Ruby `/api/fixtures`** — _2026-05-11_ — Escolha de framework (Roda 3.103 + Puma 6.6 + Rackup 2.2) pro endpoint do adam-stats standalone. **SUPERSEDED por ADR-002** na unificação: as rotas migraram pra Next.js Route Handlers; o serviço Roda não existe mais. Registro mantido por completude histórica (detalhe em `docs/tasks/mvp-v1/PROGRESS.md`).

8. **ADR-008 — Mercados secundários (corners, cards, SOT)** — _2026-05-26_ — ACCEPTED. Extensão do edge-calculator e da calibração pra mercados além de 1x2/over/btts. Deep dive em `docs/adrs/008-mercados-secundarios.md`. Os *actuals* desses mercados são reconciliados via choistats (ver B19), não via fonte externa.

10. **ADR-010 — Recomendador IA-2 desacoplado do scrape + chamadas R1 paralelizadas** — _2026-05-29_ — ACCEPTED. A IA-2 rodava inline no `orchestrator.rb` (fim do `scrape-daily`); a inferência R1 (~p95 195s/chamada, serial) inflava o runtime e estourava o `timeout-minutes` do scrape (cancelado aos 60min em 29/05 — ver B20-bis), truncando a coleta **e** a própria cobertura de skip da Parte 1 (a cauda de skips rápidos roda após as chamadas R1, que morriam no timeout). Decisão em duas alavancas complementares: **(A) paralelizar** as chamadas R1 dentro do `AiRecommenderRunner` num pool limitado (`Thread`+`Queue` stdlib, `AI_RECO_CONCURRENCY` default 6) — refatorado em 3 fases (edge-calc+skip **serial** → fan-out R1 **paralelo, só rede** → gravação **serial**), mantendo a `PG::Connection` (não thread-safe) single-threaded o tempo todo; ~50min → ~10-15min. **(B) desacoplar** a IA-2 num job standalone (`AiRecommenderJob` = runner + silent-death detector + ciclo de healthcheck próprio) rodado por `bin/run_ai_recommender` no workflow dedicado `ai-reco.yml` (cron 10:45 UTC, ~45min após o scrape; `timeout-minutes: 45`, cron/manual-only). O `scrape-daily` perde a IA-2 e cai pra `timeout: 20min` (coleta pura ~10-15min). **Por que ambas:** A deixa cada rodada rápida; B garante que um dia ruim de R1 jamais derrube a coleta. **Hibernação:** A é perf (mesmo modelo/prompt/threshold/nº de chamadas — só o agendamento muda), B é infra pura — ambas permitidas. TDD: 4 specs de paralelização no runner + `ai_recommender_job_spec` (9 ex.) absorvendo a invocação/silent-death que saíram do `orchestrator_spec`. Workflow segue o checklist `optimizing-github-actions`. Commits `31fc71d` (A) + `05b06ac` (B). **Pendência operacional:** GH var `AI_RECO_CONCURRENCY` (opcional, default 6 no código); o cron `ai-reco.yml` precisa das mesmas secrets/vars de LLM que saíram do `scrape-daily` (já existentes: `OPENROUTER_API_KEY`, `AI_RECO_MODEL`, etc.).

9. **ADR-009 — Reconciler de actuals via API-Football** — _2026-05-26 REVERTED · 2026-05-28 REMOVED_ — Tentativa de buscar resultados FT (corners/cards/SOT) na API-Football. Revertida porque o free tier não cobre seasons 2025+; **removida por completo em 2026-05-28** (código, docs, workflow `api-football-snapshot`, GH secrets, key rotacionada — a chave havia vazado no histórico público). Substituída pela extração via choistats `recent_results` (B19). A migration `0036` e a tabela `actuals_fixture_mapping` permanecem como dead schema benigno (não removidas — migrations são append-only).

## Lessons learned

> **Movidas para [`docs/lessons.md`](docs/lessons.md)** (eram >50% deste índice). Leia-as lá e **append nelas, nunca aqui** — `CLAUDE.md` é o hub. Regras críticas recorrentes que valem relembrar a cada sessão:
> - **Worker CF é frágil:** payload pesado/JSON só escalar pro Worker; computar badges/insights em SQL ou `ssr:false`, nunca cruzar `detail_json` inteiro (B12/B14/B21/B23). **NUNCA `export const runtime="edge"`** (OpenNext roda em Node — quebra; B22).
> - **IA/calibração:** refit isotônico é semanal/mecânico; **prompt/threshold/Kelly só mudam por EVIDÊNCIA, nunca por calendário** (B24, anti-[[walk-forward-bomb]]). Calibrar é o conserto, não hard-skip (B26).
> - **Fiação:** ao "terminar" uma feature/reconciler/calibração, confirmar que está WIRED no caminho de produção principal — não só num secundário (B16/B25). Reconciler novo entra no pipeline no mesmo PR (B16).
> - **Bump de `model_version`:** `fixture_simulations` é versionada por design (versões coexistem). Quem lê pra AGIR precisa de `DISTINCT ON (fixture_id)` — sem isso o bump duplica recos. E varrer os consumidores que filtram por versão: no vazio eles não falham, emitem **probabilidade crua** (B53).
> - **Antes de concluir "indisponível" ou fechar método:** inspecionar o payload BRUTO inteiro da API (B15/B19). Validar payload real contra prod ANTES de deployar fix de outage (B12).

## Do not

- Bypass the TDD flow (write production code before tests).
- Execute state-changing commands without explicit approval.
- Add speculative code or abstractions "for the future".
- Modify files outside the declared scope of the current task.
- Touch `~/.claude/` global without explicit approval.
- Add `Co-Authored-By: Claude` (or any equivalent trailer) to commit messages — explicit project rule.
