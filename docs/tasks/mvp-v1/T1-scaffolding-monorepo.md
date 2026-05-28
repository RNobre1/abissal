# Task: Scaffolding monorepo

> **Session:** Terminal 1 of 12
> **Branch:** `feat/mvp-v1-T1`
> **Status:** `[ ] Planning` `[ ] In progress` `[ ] Tests passing` `[ ] Ready for review`

---

## Objective

Criar a estrutura mínima do monorepo (diretórios + arquivos de configuração) pra que as demais tasks possam rodar TDD sem reinventar tooling. Nenhum código de produção nesta task.

---

## Required context

- **Larger feature:** [00-overview.md](00-overview.md)
- **What other sessions are doing:** Nenhuma (T1 é o root da Wave 1; T2-T12 dependem disso).
- **Decisions already made:** ADR-001 (Ruby 4.0.3), ADR-002 (Hetzner CX22), ADR-004 (mise), ADR-005 (Postgres self-host) — todas em `CLAUDE.md`.
- **Relevant CLAUDE.md sections:** "Tech stack", "Directory structure", "Environment variables", "Commands".

---

## Files ALLOWED to touch

```
Gemfile
Gemfile.lock                                   # gerado por bundle install
mise.toml                                      # Ruby 4.0.3 + Node 22
.ruby-version                                  # backup pra rbenv/asdf users
.env.example
.gitignore                                     # já existe; pode editar
README.md                                      # criar minimal
lib/.gitkeep
bin/.gitkeep
spec/.gitkeep
spec/spec_helper.rb                            # bootstrap RSpec
db/.gitkeep
db/migrations/.gitkeep
infra/.gitkeep
infra/docker-compose.yml                       # Postgres 16
web/package.json                               # minimal stub — só pra T10 expandir
.rspec                                         # config do RSpec (--format doc, --color)
```

---

## Files FORBIDDEN

```
lib/scraper/**                                 # T3-T6
lib/api/**                                     # T8-T9
db/migrations/001_*.sql                        # T2
web/src/**                                     # T10-T12
web/vite.config.ts                             # T10
infra/systemd/**                               # T7
docs/**                                        # esta task não toca docs
.poc/**                                        # POCs ficam intactos como referência
```

> Se precisar tocar algo da lista FORBIDDEN, **pare e alerte**.

---

## Execution order (TDD mandatory)

### Phase 1 — Tests first (RED)

Esta task é scaffolding puro — não tem "feature" pra testar via unit test. O "test" aqui é **validação de setup**:

- [ ] Criar `spec/spec_helper.rb` mínimo
- [ ] Criar `spec/scaffolding_spec.rb` testando:
  - Diretórios obrigatórios existem (`lib/`, `bin/`, `spec/`, `db/migrations/`, `infra/`, `web/`)
  - `Gemfile` lista pelo menos `playwright-ruby-client`, `nokogiri`, `pg`, `rspec`
  - `mise.toml` declara Ruby 4.0.3 e Node 22
  - `infra/docker-compose.yml` define service `postgres`
- [ ] Rodar: tests falham (red) pelos motivos certos (arquivos não existem ainda)
- [ ] `git commit -m "test: scaffolding validation scenarios"`

### Phase 2 — Implementation (GREEN)

- [ ] `mise.toml` com `[tools] ruby = "4.0.3"`, `node = "22"`
- [ ] `.ruby-version` com `4.0.3`
- [ ] `Gemfile` minimal com `playwright-ruby-client ~> 1.59`, `nokogiri ~> 1.19`, `pg ~> 1.5`, `rspec ~> 3`, `rack-test ~> 2` (placeholder pra T8), `pry-byebug` (dev)
- [ ] `bundle install` → gera `Gemfile.lock`
- [ ] `.rspec` com `--require spec_helper --format documentation --color`
- [ ] `.env.example` conforme `CLAUDE.md#environment-variables`
- [ ] `infra/docker-compose.yml` com service `postgres:16-alpine`, volume nomeado, healthcheck, port 5432
- [ ] `web/package.json` stub minimal: `{ "name": "adam-stats-web", "private": true, "type": "module" }` — T10 expande
- [ ] `README.md` minimal: link pra `CLAUDE.md`, comandos de setup
- [ ] `.gitignore` adiciona: `Gemfile.lock` NÃO (deve ser commitado), `vendor/bundle/`, `.env`, `web/node_modules/`, `web/dist/`, `coverage/`, `.byebug_history`
- [ ] Criar `.gitkeep` em pastas vazias listadas
- [ ] `git commit -m "feat(scaffold): monorepo skeleton with Ruby + Node toolchain"`

### Phase 3 — Refactoring (REFACTOR)

- [ ] Garantir que `bundle exec rspec` roda sem erros de require
- [ ] Garantir que `docker compose -f infra/docker-compose.yml config` valida
- [ ] `git commit -m "refactor: ..."` — só se houve mudança real

### Phase 4 — Final verification

- [ ] `bundle exec rspec spec/scaffolding_spec.rb` passa
- [ ] `docker compose -f infra/docker-compose.yml up -d postgres` sobe o container
- [ ] `psql $DATABASE_URL -c "SELECT 1"` funciona (conexão Postgres OK)
- [ ] `docker compose down` derruba limpo
- [ ] `git diff --stat main..HEAD` lista só os arquivos permitidos

---

## Acceptance criteria

- [ ] `bundle install` completa sem erros em Ruby 4.0.3
- [ ] `bundle exec rspec` executa e passa com pelo menos os specs de scaffolding
- [ ] Postgres sobe via Docker Compose e aceita conexões
- [ ] Nenhum arquivo das pastas FORBIDDEN foi tocado
- [ ] Branch `feat/mvp-v1-T1` aberto e PR pronto pra review

---

## Mandatory test scenarios

```
Scaffolding
  - estrutura de diretórios obrigatórios existe
  - Gemfile declara gems mínimas do MVP
  - mise.toml fixa Ruby 4.0.3 e Node 22
  - docker-compose.yml expõe Postgres 16 com healthcheck
  - .env.example contém todas as vars referenciadas em CLAUDE.md
```

---

## Blockers — stop and alert the user if you encounter

- Necessidade de instalar pacote de sistema novo (devel libs faltando além das já documentadas)
- Erro de compilação em gem nativo no Ruby 4.0 — pode exigir downgrade pra 3.4 (decisão do Pilot)
- Conflito com arquivos pré-existentes (`.gitignore` já tem entries; preservar)

---

## Execution log

> Preencher durante execução.

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

- **Trade-offs taken:** Gemfile único no root (vs múltiplos por app). YAGNI; se um dia precisar separar, separa.
- **Deferred to other tasks:** API gem (Sinatra/Roda) — T8 decide. Front deps reais — T10. Drivers DB extras (Sequel?) — fica pra Foundation de cada módulo.
- **Known risks:** Ruby 4.0 tem 3 semanas de mercado; algum gem futuro pode quebrar — se quebrar, abrir `lessons learned` em `CLAUDE.md`.
