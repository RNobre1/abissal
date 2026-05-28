# MVP v1 — Overview

**Date:** 2026-05-11
**Status:** COMPLETED on 2026-05-11
**Objective:** Entregar o Adam Stats end-to-end (scraper diário no Postgres → API HTTP → frontend React com análise IA via OpenRouter), rodando em VPS Hetzner com retenção de 3-4 dias.

---

## Diagnosis

| Categoria | Hoje | Alvo (MVP v1) |
|---|---|---|
| Stack documentada | ✅ `CLAUDE.md` + pesquisa v0.4 | ✅ — sem mudança |
| Scaffolding monorepo | 0% | 100% |
| Scraper Playwright | só POC descartável em `.poc/` | módulo `lib/scraper/` testado, agendado via systemd |
| Schema Postgres | inexistente | 1 migration aplicada |
| API HTTP | inexistente | `GET /api/fixtures`, `POST /api/analyze` |
| Frontend | inexistente | React+TS+Vite com lista + análise |
| Integração OpenRouter | inexistente | client gem + endpoint `/api/analyze` |
| Retenção 3-4 dias | inexistente | script de purge cronado |
| Deploy script | inexistente | provisório (`scp` + `systemctl restart`); ADR-006 formaliza depois |

---

## Tasks (execution order)

| Task | Name | Dependency | Estimate | Status |
|------|------|------------|----------|--------|
| [T1](T1-scaffolding-monorepo.md) | scaffolding-monorepo | None | M (~1h) | [x] Completed 2026-05-11 |
| [T2](T2-db-migration-fixtures.md) | db-migration-fixtures | T1 | S (~30min) | [x] Completed 2026-05-11 |
| [T3](T3-parser-fixtures-list.md) | parser-fixtures-list | T1 | M (~1h) | [x] Completed 2026-05-11 |
| [T4](T4-parser-detail-page.md) | parser-detail-page | T1, T3 | L (~2h) | [x] Completed 2026-05-11 |
| [T5](T5-persister-upsert.md) | persister-upsert | T1, T2, T3 | M (~1.5h) | [x] Completed 2026-05-11 |
| [T6](T6-fetcher-playwright.md) | fetcher-playwright | T1 | M (~1h) | [x] Completed 2026-05-11 |
| [T7](T7-scrape-entrypoint.md) | scrape-entrypoint | T3, T4, T5, T6 | M (~1.5h) | [x] Completed 2026-05-11 |
| [T8](T8-api-fixtures-endpoint.md) | api-fixtures-endpoint | T1, T2, T5 | M (~1h) | [x] Completed 2026-05-11 |
| [T9](T9-api-analyze-endpoint.md) | api-analyze-endpoint | T1, T8 | M (~1.5h) | [x] Completed 2026-05-11 |
| [T10](T10-web-scaffolding-vite.md) | web-scaffolding-vite | T1 | S (~30min) | [x] Completed 2026-05-11 |
| [T11](T11-web-fixtures-list.md) | web-fixtures-list | T8, T10 | M (~1.5h) | [x] Completed 2026-05-11 |
| [T12](T12-web-analyze-ui.md) | web-analyze-ui | T9, T11 | L (~2h) | [x] Completed 2026-05-11 |

> **Status syntax:** `[ ] Pending` -> `[ ] Ready to dispatch` -> `[x] Completed YYYY-MM-DD (#PR -> hash)`.
> Tasks blocked by another task: `[ ] Pending — blocked by T{N}`.

**Estimativa total: ~15h** (single-thread). Com paralelismo via waves: ~6-8h wall-clock.

---

## Sub-tasks identified

> Backlog de follow-ups descobertos durante execução ou revisão.

| Sub-task | Origin | Description |
|---|---|---|
| Lazy-loaded sections do detail page | T4 (2026-05-11) | "Recent Matches", "Predictions", "Player Stats" e "Head to Head" no adamchoi só renderizam após clicar na aba — primeiro render só carrega o painel default ("Current seasons statistics"). Capturar via Playwright `click` é follow-up pós-MVP. Trends ricas (49 entradas) já cobrem caso de uso primário. |

**Sub-task antecipado em T4:** capturar HTML de uma detail page real do adamchoi antes do TDD do parser (mini-POC ~10min dentro do escopo de T4). Não vira T-file próprio.

---

## How to execute

**Start a task in a new terminal:**
```
Read the file docs/tasks/mvp-v1/T{N}-{name}.md and execute the task described in it.
Branch: feat/mvp-v1-T{N}. TDD mandatory. When done, open PR to main.
```

**Parallelism allowed:**

| Wave | Parallel tasks | Prerequisite |
|------|----------------|--------------|
| 1 | T1 (solo) | None |
| 2 | T2 + T3 + T6 + T10 | T1 complete |
| 3 | T4 + T5 | T1+T3 / T1+T2+T3 |
| 4 | T7 + T8 | T3+T4+T5+T6 / T2+T5 |
| 5 | T9 + T11 | T8 / T8+T10 |
| 6 | T12 (solo) | T9+T11 |

Solo dev pode rodar serialmente. Waves só importam se delegar a múltiplos agentes em paralelo (via `xp-stack:dispatching-parallel-agents`).

---

## General rules

- **TDD absolute** — tests first, code after
- **One branch per task:** `feat/mvp-v1-T{N}`
- **Conventional commits** matching the change type
- **Don't touch code outside declared scope** (cada T-file lista `Files ALLOWED` / `FORBIDDEN`)
- **CI must pass** após cada task (CI ainda não existe; até lá, `bundle exec rspec` + `pnpm test` local antes de PR)
- **On completion:** atualizar status aqui, atualizar `PROGRESS.md`, abrir PR pra main
- **PR is not self-merge:** Pilot revisa e mergeia

---

## On feature completion

When ALL tasks have `[x] Completed`:

1. Atualizar header deste arquivo: `**Status:** COMPLETED on YYYY-MM-DD`.
2. Atualizar `PROGRESS.md` com snapshot final de métricas.
3. Adicionar ADR-006 (CI/CD) ao `CLAUDE.md` se a fase 6 do ciclo Akita/XP for executada dentro do MVP.
4. **DO NOT delete the folder.** Arquival em-place ou `git mv` para `docs/tasks/_archive/mvp-v1/`.
