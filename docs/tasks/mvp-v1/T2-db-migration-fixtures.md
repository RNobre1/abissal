# Task: DB migration — tabela fixtures

> **Session:** Terminal 2 of 12
> **Branch:** `feat/mvp-v1-T2`
> **Status:** `[ ] Planning` `[ ] In progress` `[ ] Tests passing` `[ ] Ready for review`

---

## Objective

Criar a primeira migration SQL com a tabela `fixtures` (conforme `CLAUDE.md#data-model`) e validar via spec que o schema bate com o esperado quando aplicado num Postgres real (container).

---

## Required context

- **Larger feature:** [00-overview.md](00-overview.md)
- **What other sessions are doing:** Wave 2 paralela com T3 (parser), T6 (fetcher), T10 (web scaffolding) — nenhum conflito.
- **Decisions already made:** Postgres 16 self-host (ADR-005). Sem ORM no MVP — SQL puro.
- **Relevant CLAUDE.md sections:** "Data model", "Tech stack", "Commands".

---

## Files ALLOWED to touch

```
db/migrations/001_create_fixtures.sql
db/schema.sql                                  # snapshot pós-migration (gerado/manual)
spec/db/migration_001_spec.rb
spec/db/db_helper.rb                           # helper de conexão pg em testes
```

---

## Files FORBIDDEN

```
db/migrations/002_*                            # tasks futuras
lib/scraper/**, lib/api/**                     # outras tasks
infra/docker-compose.yml                       # T1 já criou
```

---

## Execution order (TDD mandatory)

### Phase 1 — Tests first (RED)

- [ ] Criar `spec/db/db_helper.rb` com conexão `pg` lendo `DATABASE_URL` (default test: `postgres://adam:senha@localhost:5432/adam_stats_test`)
- [ ] Criar `spec/db/migration_001_spec.rb` testando:
  - tabela `fixtures` existe após apply
  - colunas e tipos: `id bigserial`, `match_date date`, `ko_time time`, `home_team text NOT NULL`, `away_team text NOT NULL`, `league text`, `source_url text`, `detail_json jsonb`, `scraped_at timestamptz default now()`, `status text default 'pending'`
  - unique constraint em `(match_date, home_team, away_team)`
  - index `idx_fixtures_match_date` em `match_date`
- [ ] Antes de cada spec: dropar e recriar DB de teste; aplicar migration
- [ ] Rodar: red — tabela não existe ainda
- [ ] `git commit -m "test: schema validation for fixtures table"`

### Phase 2 — Implementation (GREEN)

- [ ] `db/migrations/001_create_fixtures.sql` com:
  ```sql
  CREATE TABLE fixtures (
    id BIGSERIAL PRIMARY KEY,
    match_date DATE NOT NULL,
    ko_time TIME,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    league TEXT,
    source_url TEXT,
    detail_json JSONB,
    scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE UNIQUE INDEX idx_fixtures_dedup ON fixtures (match_date, home_team, away_team);
  CREATE INDEX idx_fixtures_match_date ON fixtures (match_date);
  ```
- [ ] `db/schema.sql` com dump do schema após apply (`pg_dump --schema-only`)
- [ ] `git commit -m "feat(db): create fixtures table with idempotent unique key"`

### Phase 3 — Refactoring (REFACTOR)

- [ ] Avaliar se vale adicionar comentários SQL inline (`COMMENT ON COLUMN`) — opcional
- [ ] Se incluiu, commit `refactor(db): add column comments for documentation`

### Phase 4 — Final verification

- [ ] `bundle exec rspec spec/db/migration_001_spec.rb` passa
- [ ] `psql $DATABASE_URL_TEST -c "\d fixtures"` mostra estrutura esperada
- [ ] `psql $DATABASE_URL_TEST -c "INSERT INTO fixtures (match_date, home_team, away_team) VALUES (CURRENT_DATE, 'A', 'B')"` funciona
- [ ] Segundo `INSERT` idêntico falha com unique violation (proteção idempotência)

---

## Acceptance criteria

- [ ] Migration aplica sem erro em Postgres 16
- [ ] Spec valida todas colunas, tipos, constraints e índices listados
- [ ] `db/schema.sql` reflete o schema atual
- [ ] Nenhum gem ORM adicionado ao Gemfile (SQL puro, conforme decisão)

---

## Mandatory test scenarios

```
Migration 001: create fixtures
  - tabela criada com todas as colunas declaradas
  - tipos corretos (jsonb, timestamptz, etc.)
  - unique index (match_date, home_team, away_team) bloqueia duplicata
  - default 'pending' em status e default now() em scraped_at
  - rollback (DROP TABLE fixtures) limpa estado pra próximo spec
```

---

## Blockers — stop and alert the user if you encounter

- Postgres do container não conecta (T1 talvez não esteja completo)
- Necessidade de PostgreSQL extension (uuid-ossp, pgcrypto, etc.) — fora de escopo; alerta
- Decisão sobre ORM (Sequel) — fora desta task; alerta

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

- **Trade-offs taken:** SQL puro vs Sequel/ActiveRecord. Escolha consciente (YAGNI; revisitar quando 3+ migrations).
- **Deferred to other tasks:** Migration runner (que aplica migrations em ordem) — provavelmente um script `bin/migrate` em T7 ou task separada.
- **Known risks:** schema pode evoluir (ex: separar `fixture_details` em tabela própria) — versionar com migrations adicionais (002+).
