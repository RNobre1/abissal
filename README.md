# Abissal

Plataforma pessoal de apostas esportivas, single-user. Une dois domínios:

1. **Gestão de banca** — bookkeeper append-only com auditoria total, dashboard
   com qualidade de mercado financeiro, registro de apostas (single, múltipla,
   bet builder e por foto via OCR), aposta grátis e forecast de banca.
2. **Análise pré-jogo + IA** — scraper Ruby diário coleta fixtures de futebol
   via `api.choistats.com`, roda simulação Monte Carlo (Poisson/Dixon-Coles) por
   jogo, calibra as probabilidades (regressão isotônica) e um recomendador IA
   (DeepSeek R1 via OpenRouter) emite sugestões de aposta com edge calculado.

> Estética e princípios derivados do Design System **Abismo Habitado** v1.0.

## Stack

**Frontend / app:**

- **Next.js 16** (App Router, RSC, Server Actions) + TypeScript + React 19
- **Tailwind CSS v4** com tokens Abismo via `@theme`
- **Supabase** (Postgres 16 + Auth + RLS + Edge Functions + Storage) — região `sa-east-1`
- **DuckDB-WASM** para OLAP client-side em `/explore`
- **lightweight-charts** + **Recharts** para gráficos
- **TanStack Query** + **Zustand** para estado client
- **Zod** + **react-hook-form** para formulários
- **simple-statistics** + **regression** para estatística
- **Cloudflare Workers** (via OpenNext) para hospedagem

**Backend de análise (`scripts/scraper/`):**

- **Ruby 4.0.3** (via mise) — scraper, simulação, reconcilers, recomendador IA
- **Faraday** HTTP-direct contra `api.choistats.com` (sem browser no hot path;
  Playwright só fallback de listagem via `SCRAPER_USE_PLAYWRIGHT_LIST=1`)
- **OpenRouter** — Gemini 2.5 Flash (OCR de bilhete) + DeepSeek R1 (recomendador)
- Simulação **Monte Carlo 10k** + Dixon-Coles + Negative Binomial (stats overdispersas)
- Calibração **isotônica** (`scripts/calibracao/`) + walk-forward backtest
- Orquestração via **GitHub Actions** crons (ver abaixo)

## Setup local

```bash
pnpm install
cp .env.example .env.local   # já preenchido localmente; nunca commitar .env.local
pnpm dev
```

## Scripts

| Comando | Função |
|---|---|
| `pnpm dev` | servidor de desenvolvimento (turbopack) |
| `pnpm build` | build de produção |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | testes unitários (Vitest) |
| `pnpm test:e2e` | testes E2E (Playwright, mobile + desktop viewports) |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier write |

## Estrutura

```
app/                       # rotas Next.js (App Router)
components/                # UI + charts + layout + domain
lib/
  env.ts                   # validação Zod das envs
  format.ts                # currency / percent / mono no pt-BR
  utils.ts                 # cn()
  supabase/                # browser + server clients + tipos gerados
  stats/                   # bankroll, forecast, risk, streaks
  duckdb/                  # client-side OLAP
supabase/
  migrations/              # 0001_init.sql, 0002_audit_triggers.sql, ...
  functions/               # Edge Functions Deno
tests/
  unit/                    # Vitest
  e2e/                     # Playwright
```

## Convenções de Design System

- Toda página vive sobre `--color-void` com textura `strata`.
- Números **sempre** em `font-mono` com `tabular-nums` (use a classe `.num`).
- Headings em Fraunces 300 com tracking negativo.
- Vermelho Garantido (`--color-vermelho`) é **identidade e ruptura**, nunca erro genérico.
- Erros do sistema usam `--color-warning`.
- Saldo financeiro nominal usa `--color-depth-hi`. Saldo positivo histórico fica branco (fato, não emoção).

## Domain model (resumo)

**Banca:** `houses` ← `transactions` (append-only) → `bets` ← `bet_selections`
& `bet_events`. `audit_log` captura toda mutação via trigger Postgres.
`bets.is_free_bet` = aposta grátis (não desconta da banca; retorno = stake×(odd−1)).

**Análise / IA:** `fixtures` (scrape diário, `detail_json` + `kickoff_utc`) →
`fixture_simulations` (Monte Carlo, `sim_stats` + actuals reconciliados) →
`ai_recommendations` (recomendador IA: `verdict` bet/skip, `edge_pct`, `pl_units`
após reconciliação). `model_calibration` guarda as curvas isotônicas por métrica.

Detalhes completos em `CLAUDE.md` (fonte da verdade) e nos ADRs em `docs/adrs/`.

## Backend de análise (`scripts/scraper/`)

Roda em Ruby, fora do Worker (protege o app da classe de outage do scraper).

```bash
cd scripts/scraper
mise install && bundle install
bundle exec bin/scrape                      # scrape + simulação + reconcilers + IA
bundle exec rspec                            # specs (precisa Postgres de teste em :5433)
bundle exec bin/document_choistats_api       # gera docs/external-apis/choistats/
```

### Crons (GitHub Actions)

| Workflow | Schedule (UTC) | Função |
|---|---|---|
| `scrape-daily` | `0 10 * * *` | scrape + sim + reconcilers + recomendador IA |
| `closing-odds-capture` | `0 15,17,19,21 * * *` | captura closing odds (CLV) |
| `telegram-closure` | `0 2 * * *` | resumo diário no Telegram |
| `calibracao-monthly` | dia 5 `0 8 5 * *` | refit calibração isotônica + parâmetros de liga |

> Repo público ⇒ minutos de Actions são gratuitos.

## Deploy (Cloudflare Workers via OpenNext)

Hospedado como Cloudflare Worker — não Pages. O adapter `@opennextjs/cloudflare`
empacota o build do Next.js (incluindo Server Actions e middleware) em um worker
único e serve `/_next/static` via asset binding.

### Scripts locais

| Comando | Função |
|---|---|
| `pnpm cf:build` | Compila Next.js + adapta para worker em `.open-next/` |
| `pnpm cf:preview` | Build + `wrangler dev` em `localhost:8787` (worker real) |
| `pnpm cf:deploy` | Build + `wrangler deploy` (push para produção) |
| `pnpm cf:upload` | Sobe nova versão sem promovê-la (canary / rollback) |

### Setup inicial na Cloudflare (uma vez)

1. **Criar API token** em <https://dash.cloudflare.com/profile/api-tokens>
   com o template *“Edit Cloudflare Workers”*. Guardar no GitHub como o
   secret `CLOUDFLARE_API_TOKEN`. Anotar o `Account ID` (sidebar do dashboard)
   como `CLOUDFLARE_ACCOUNT_ID`.
2. **Cadastrar secrets do Supabase + Sentry** no GitHub Actions:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `NEXT_PUBLIC_SENTRY_DSN` (opcional)
3. **Cadastrar os mesmos valores no worker** (em produção) com:
   ```bash
   pnpm dlx wrangler secret put NEXT_PUBLIC_SUPABASE_URL
   pnpm dlx wrangler secret put NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
   ```
4. **Domínio custom**:
   - No dashboard CF → Workers & Pages → `abissal` → *Triggers* →
     *Add Custom Domain* → `abissal.rnobre.dev`.
   - Cloudflare cria o CNAME automaticamente se `rnobre.dev` já estiver
     na sua conta. Se o DNS estiver fora, criar um `CNAME abissal → abissal.<conta>.workers.dev`.

### Pipeline

- `main` → `deploy.yml` no GitHub Actions roda `pnpm cf:build` e
  `wrangler deploy`.
- Branches de PR → apenas `ci.yml` (lint + typecheck + tests + build).
  Previews com URL única exigem `wrangler versions upload` no fluxo —
  vem na próxima iteração.
