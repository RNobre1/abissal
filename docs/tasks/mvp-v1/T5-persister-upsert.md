# Task: Persister upsert (Postgres)

> **Session:** Terminal 5 of 12
> **Branch:** `feat/mvp-v1-T5`
> **Status:** `[ ] Planning` `[ ] In progress` `[ ] Tests passing` `[ ] Ready for review`

---

## Objective

Implementar o persister que recebe `Array<Fixture>` (do parser T3) + opcionalmente `MatchDetail` (do parser T4) e faz upsert idempotente no Postgres real (em container Docker). Integration test, não mock.

---

## Required context

- **Larger feature:** [00-overview.md](00-overview.md)
- **What other sessions are doing:** Wave 3 paralela com T4 (detail parser). Sem conflito de arquivos.
- **Decisions already made:** Postgres self-host (ADR-005), SQL puro (sem ORM). `pg` gem padrão.
- **Relevant CLAUDE.md sections:** "Data model", "Environment variables" (`DATABASE_URL`).

---

## Files ALLOWED to touch

```
lib/scraper/persister.rb
lib/scraper/db.rb                              # helper de conexão pg (reutilizável)
spec/scraper/persister_spec.rb
spec/scraper/db_helper.rb                      # extends spec/db/db_helper.rb com seed/clean
```

---

## Files FORBIDDEN

```
lib/scraper/parser.rb, fetcher.rb, detail_parser.rb   # outras tasks
db/migrations/**                                      # T2
infra/**, web/**, lib/api/**                          # outras tasks
```

---

## Execution order (TDD mandatory)

### Phase 1 — Tests first (RED)

- [ ] `spec/scraper/persister_spec.rb` rodando contra Postgres em container (`DATABASE_URL` aponta pra DB de teste; truncate `fixtures` antes de cada spec)
- [ ] Cenários:
  - insere array de 5 Fixture novas → 5 rows na tabela
  - segunda chamada com mesmo array → ainda 5 rows (idempotente via unique key)
  - chamada com Fixture com `match_date/home/away` idêntico mas `ko_time` diferente → 1 row atualizada (UPDATE, não duplicate)
  - persiste `detail_json` como jsonb (round-trip preserva estrutura)
  - falha no meio do batch (ex: home_team NULL) → transação rollback, 0 rows persistidas
  - retorna stats `{inserted: N, updated: M, failed: K}`
- [ ] Red: persister não existe
- [ ] `git commit -m "test: persister upsert scenarios with real postgres"`

### Phase 2 — Implementation (GREEN)

- [ ] `lib/scraper/db.rb`: connection pool simples via `PG.connect(ENV.fetch('DATABASE_URL'))`; `with_connection` block helper
- [ ] `lib/scraper/persister.rb`:
  - `persist(fixtures, detail_json_by_source_url: {})` → `Stats`
  - SQL: `INSERT ... ON CONFLICT (match_date, home_team, away_team) DO UPDATE SET ko_time=EXCLUDED.ko_time, league=EXCLUDED.league, source_url=EXCLUDED.source_url, detail_json=EXCLUDED.detail_json, scraped_at=now(), status='parsed' RETURNING (xmax = 0) AS inserted`
  - `xmax = 0` distingue insert vs update no result
  - tudo dentro de `BEGIN; ... COMMIT;` — rollback em qualquer erro
- [ ] `git commit -m "feat(scraper): idempotent upsert persister with transactional batch"`

### Phase 3 — Refactoring (REFACTOR)

- [ ] Extrair SQL pra constante ou método privado se ficar denso
- [ ] Evitar interpolação de string em SQL — usar parametrização `$1, $2, ...` sempre

### Phase 4 — Final verification

- [ ] `bundle exec rspec spec/scraper/persister_spec.rb` passa
- [ ] Inspecionar DB após specs (`psql ... -c "SELECT * FROM fixtures"`) — sem lixo persistido entre specs
- [ ] Verificar que `detail_json` é jsonb (não text) via `SELECT pg_typeof(detail_json) FROM fixtures`

---

## Acceptance criteria

- [ ] Upsert é idempotente (re-rodar com mesmo input não cria duplicatas)
- [ ] Transacional (rollback em erro parcial)
- [ ] Retorna estatísticas úteis pro orchestrator (T7) logar
- [ ] Zero SQL injection (parametrização sempre)

---

## Mandatory test scenarios

```
AdamStats::Scraper::Persister.persist
  - insert puro: array de 5 → 5 inserted
  - idempotência: re-rodar → 0 inserted, 5 updated (ou no-op se nada mudou)
  - update parcial: Fixture com ko_time diferente → 1 updated
  - jsonb round-trip: persist com detail_json complexo → SELECT retorna mesmo Hash
  - rollback: 1 row inválida no batch → 0 rows persistidas, exceção elevada
  - retorna Stats(inserted:, updated:, failed:)
```

---

## Blockers — stop and alert the user if you encounter

- Conexão com Postgres falha (T1+T2 talvez não estejam completos no ambiente do agent)
- Necessidade de extension Postgres (uuid-ossp, pg_trgm) — fora de escopo
- Performance: batch de 500 fixtures > 2s — alertar pra avaliar prepared statements

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

- **Trade-offs taken:** `pg` gem puro vs Sequel — escolha YAGNI. ON CONFLICT no SQL vs lookup-then-update — atomic, menos round-trips.
- **Deferred to other tasks:** retenção/purge (>3 dias) vai pra T7 orchestrator. Migration runner também.
- **Known risks:** se schema evoluir (ex: campo `score` futuro), upsert precisa atualizar SQL. Mitigação: spec de "upsert preserva colunas não passadas".
