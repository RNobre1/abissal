# Task: Scrape entrypoint + systemd + retention

> **Session:** Terminal 7 of 12
> **Branch:** `feat/mvp-v1-T7`
> **Status:** `[ ] Planning` `[ ] In progress` `[ ] Tests passing` `[ ] Ready for review`

---

## Objective

Integrar fetcher (T6) → parser (T3) → detail_parser (T4) → persister (T5) num orchestrator + `bin/scrape` invocável. Adicionar systemd `.service` + `.timer` pra rodar 1x/dia. Implementar retenção (purge de fixtures > 3 dias). Ping healthchecks.io em sucesso e falha.

---

## Required context

- **Larger feature:** [00-overview.md](00-overview.md)
- **What other sessions are doing:** Wave 4 paralela com T8 (API). Sem conflito de arquivos.
- **Decisions already made:** systemd timer (ADR-003), healthchecks.io (ADR-003), retenção 3-4 dias (`CLAUDE.md#data-model`).
- **Relevant CLAUDE.md sections:** "Tech stack" (Infra), "Commands", "External services" (healthchecks.io).

---

## Files ALLOWED to touch

```
bin/scrape                                     # executable Ruby
lib/scraper.rb                                 # top-level orchestrator (AdamStats::Scraper.run)
lib/scraper/orchestrator.rb                    # lógica end-to-end
lib/scraper/healthcheck.rb                     # client de healthchecks.io
infra/systemd/adam-stats-scraper.service
infra/systemd/adam-stats-scraper.timer
infra/scripts/retention-purge.sh               # ou Ruby — decide na task
infra/scripts/deploy.sh                        # script provisório de deploy
spec/scraper/orchestrator_spec.rb
spec/scraper/healthcheck_spec.rb
```

---

## Files FORBIDDEN

```
lib/scraper/parser.rb, fetcher.rb, persister.rb, detail_parser.rb   # já existem
db/migrations/**                                                      # T2
lib/api/**                                                            # T8-T9
web/**                                                                # T10-T12
```

---

## Execution order (TDD mandatory)

### Phase 1 — Tests first (RED)

- [ ] `spec/scraper/orchestrator_spec.rb` cobrindo happy path + falha:
  - `Orchestrator.run` chama fetcher → parser → (para cada fixture: fetcher detail → detail_parser) → persister
  - dependencies injetadas (mocks de fetcher/parser/persister), permitindo unit test sem rede/DB
  - happy path → retorna `Stats(fetched:, parsed:, persisted:, failed:)` + ping healthchecks success URL
  - exceção em fetcher → ping healthchecks fail URL + reraise (systemd marca o run como failed)
  - retenção: chama `DELETE FROM fixtures WHERE match_date < CURRENT_DATE - INTERVAL '3 days'` no fim do happy path
- [ ] `spec/scraper/healthcheck_spec.rb`:
  - `Healthcheck.ping_success` faz GET na env `HEALTHCHECKS_URL`
  - `Healthcheck.ping_failure` faz GET em `HEALTHCHECKS_URL + '/fail'`
  - timeout / erro de rede: log warning, **não levanta** (não pode mascarar erro original)
- [ ] Red: orchestrator não existe
- [ ] `git commit -m "test: orchestrator e2e + healthchecks scenarios"`

### Phase 2 — Implementation (GREEN)

- [ ] `lib/scraper/healthcheck.rb`: cliente HTTP minimal (`Net::HTTP`) com timeout 5s
- [ ] `lib/scraper/orchestrator.rb`: orquestração sequencial + try/rescue + retention purge
- [ ] `lib/scraper.rb`: `AdamStats::Scraper.run(args = {})` — top-level entry
- [ ] `bin/scrape`: shebang Ruby (`#!/usr/bin/env ruby`), `require 'bundler/setup'`, `require_relative '../lib/scraper'`, `exit AdamStats::Scraper.run`. Tornar executável (`chmod +x`).
- [ ] `infra/systemd/adam-stats-scraper.service`: `Type=oneshot`, `User=adam`, `WorkingDirectory=/opt/adam-stats`, `EnvironmentFile=/etc/adam-stats.env`, `ExecStart=/opt/adam-stats/bin/scrape`
- [ ] `infra/systemd/adam-stats-scraper.timer`: `OnCalendar=*-*-* 06:00:00 UTC`, `Persistent=true` (recupera runs perdidos)
- [ ] `infra/scripts/retention-purge.sh`: opcional, ou rodar via Orchestrator
- [ ] `infra/scripts/deploy.sh`: script bash mínimo (`rsync` ou `scp` + `systemctl restart adam-stats-scraper.timer`)
- [ ] `git commit -m "feat(scraper): orchestrator + systemd timer + healthchecks integration"`

### Phase 3 — Refactoring (REFACTOR)

- [ ] Garantir logs estruturados (JSON ou key=value) — facilita parsing em journalctl
- [ ] Garantir que `bin/scrape --help` mostra usage minimal

### Phase 4 — Final verification

- [ ] `bundle exec rspec spec/scraper/orchestrator_spec.rb spec/scraper/healthcheck_spec.rb` passa
- [ ] `bin/scrape --dry-run` (se implementado) executa sem fazer rede/DB
- [ ] `systemd-analyze verify infra/systemd/adam-stats-scraper.service` passa (validação de syntax)
- [ ] `systemd-analyze verify infra/systemd/adam-stats-scraper.timer` passa
- [ ] `infra/scripts/deploy.sh --dry-run` (se aplicável) não fala em produção real

---

## Acceptance criteria

- [ ] `bin/scrape` é executável e roda end-to-end localmente (com fetcher real ou mock dependendo de env)
- [ ] systemd units validam via `systemd-analyze verify`
- [ ] Retenção remove rows > 3 dias old
- [ ] Healthchecks.io ping de sucesso e falha implementados
- [ ] Stats logadas em formato parseável (journalctl friendly)

---

## Mandatory test scenarios

```
AdamStats::Scraper::Orchestrator.run
  - happy path: fetcher OK → parser OK → persister OK → ping success
  - fetcher raise → ping fail + reraise
  - parser retorna [] → ping success (não é erro; sem fixtures hoje)
  - retention purge é chamada após persistência bem-sucedida
  - stats retornadas: {fetched, parsed_list, parsed_detail, persisted, deleted, failed}

AdamStats::Scraper::Healthcheck
  - ping_success faz GET na URL configurada
  - ping_failure faz GET na URL + '/fail'
  - timeout não eleva exceção (apenas log)
```

---

## Blockers — stop and alert the user if you encounter

- T3, T4, T5, T6 não estão completos (orchestrator não pode integrar peças inexistentes)
- `HEALTHCHECKS_URL` não setado em `.env` (decisão: Pilot cria conta em healthchecks.io e gera UUID — ou se não tiver, log fica como warning não-fatal)
- systemd não disponível em alguma distro de dev — alertar (no VPS é garantido)

---

## Execution log

- **Phase 1 (red):** {{...}}
- **Phase 2 (green):** {{...}}
- **Phase 3 (refactor):** {{...}}
- **Phase 4 (verification):** {{...}}

### Incidents / deviations

{{...}}

---

## State on pause

- **Done:** {{...}}
- **In progress:** {{...}}
- **Exact next step:** {{...}}
- **Tests:** {{...}}

---

## Notes for review session

- **Trade-offs taken:** Orchestrator com DI manual (sem container DI) — YAGNI. Retenção dentro do mesmo run (não cron separado) — menos peças móveis.
- **Deferred to other tasks:** Deploy script real (CI/CD) — ADR-006 futura. Migration runner — pode entrar aqui se for trivial; senão, task separada.
- **Known risks:** Race condition em rerun (systemd `Persistent=true` reinvoca após boot — pode rodar 2x no dia). Mitigação: persister é idempotente (T5), então 2 runs = mesmo estado final.
