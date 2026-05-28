# Task: API GET /api/fixtures

> **Session:** Terminal 8 of 12
> **Branch:** `feat/mvp-v1-T8`
> **Status:** `[ ] Planning` `[ ] In progress` `[ ] Tests passing` `[ ] Ready for review`

---

## Objective

Expor endpoint HTTP `GET /api/fixtures?date=today|tomorrow|YYYY-MM-DD` que lê do Postgres e retorna JSON da lista de fixtures. Primeira pedra da API HTTP.

---

## Required context

- **Larger feature:** [00-overview.md](00-overview.md)
- **What other sessions are doing:** Wave 4 paralela com T7 (scrape entrypoint). Sem conflito.
- **Decisions already made:** Web framework Ruby a decidir entre Sinatra, Roda ou Rails-API — **decisão sai nesta task**, registrada como ADR-007 em `CLAUDE.md`. Recomendação default: **Roda** (leve, modular, ergonomia moderna). Pilot pode override pra Sinatra (mais conhecido).
- **Relevant CLAUDE.md sections:** "Tech stack", "Data model", "Commands", "Environment variables" (`API_PORT`, `API_CORS_ORIGIN`).

---

## Files ALLOWED to touch

```
lib/api/app.rb                                 # Roda/Sinatra app
lib/api/routes/fixtures.rb
lib/api/serializers/fixture_serializer.rb
lib/api/db_repository.rb                       # ou reusar lib/scraper/db.rb
bin/api                                        # executable pra rodar local
config.ru                                      # Rack entrypoint
spec/api/fixtures_spec.rb
spec/api/app_helper.rb                         # helpers Rack::Test
```

**Atualizar Gemfile** com `roda` (ou `sinatra`) + `rack` + `rack-test` (dev).

---

## Files FORBIDDEN

```
lib/api/routes/analyze.rb                      # T9
lib/scraper/**                                 # já existem
db/migrations/**                               # T2
web/**                                         # T10-T12
infra/systemd/**                               # T7 já criou
```

---

## Execution order (TDD mandatory)

### Phase 1 — Tests first (RED)

- [ ] Decidir framework (Roda recomendado) e atualizar Gemfile + ADR-007
- [ ] `spec/api/fixtures_spec.rb` com Rack::Test:
  - `GET /api/fixtures` sem date → 400 com mensagem útil
  - `GET /api/fixtures?date=today` → 200, JSON array, contém fixtures com `match_date == today`
  - `GET /api/fixtures?date=tomorrow` → 200, JSON array, contém fixtures com `match_date == today + 1`
  - `GET /api/fixtures?date=2026-05-15` → 200, fixtures do dia ou `[]`
  - `GET /api/fixtures?date=invalid` → 400
  - resposta tem `Content-Type: application/json` e `Cache-Control: no-cache` (dados mudam diariamente)
  - CORS header `Access-Control-Allow-Origin` setado a partir de `API_CORS_ORIGIN`
- [ ] Seed do DB de teste com 5 fixtures (hoje, amanhã, ontem) antes de cada spec
- [ ] Red: app não existe
- [ ] `git commit -m "test: GET /api/fixtures scenarios"`

### Phase 2 — Implementation (GREEN)

- [ ] Escolher framework e atualizar Gemfile (`roda ~> 3.x` ou `sinatra ~> 4.x`). Decisão registrada em ADR-007.
- [ ] `lib/api/app.rb`: Roda/Sinatra app com roteamento mínimo
- [ ] `lib/api/routes/fixtures.rb`: handler GET
- [ ] `lib/api/serializers/fixture_serializer.rb`: Fixture → Hash JSON-able
- [ ] `lib/api/db_repository.rb`: query `SELECT * FROM fixtures WHERE match_date = $1 ORDER BY ko_time`
- [ ] `config.ru`: `require_relative 'lib/api/app'; run AdamStats::API::App.freeze.app` (Roda) ou similar
- [ ] `bin/api`: shebang + `exec rackup -p $API_PORT config.ru`
- [ ] CORS middleware (manual ou `rack-cors`)
- [ ] `git commit -m "feat(api): GET /api/fixtures with date filter"`

### Phase 3 — Refactoring (REFACTOR)

- [ ] Extrair date parsing pra helper (`Date.parse` com handling de `today`/`tomorrow`)
- [ ] Error handler central pra 4xx/5xx (JSON consistente)

### Phase 4 — Final verification

- [ ] `bundle exec rspec spec/api/fixtures_spec.rb` passa
- [ ] `bundle exec bin/api` sobe servidor local em `$API_PORT`
- [ ] `curl http://localhost:$API_PORT/api/fixtures?date=today` retorna JSON
- [ ] Frontend (T11) pode consumir o endpoint sem CORS issue (testar manual via browser quando T11 estiver pronto)

---

## Acceptance criteria

- [ ] Endpoint responde JSON corretamente pra `today`, `tomorrow` e datas absolutas
- [ ] Validação de input: rejeita date malformada com 400
- [ ] CORS habilitado pra origem do frontend Vite (`http://localhost:5173` em dev)
- [ ] ADR-007 registrado em `CLAUDE.md`
- [ ] Zero query injection (parametrização sempre)

---

## Mandatory test scenarios

```
GET /api/fixtures
  - sem ?date → 400 + JSON error
  - ?date=today → 200 + array com fixtures de hoje
  - ?date=tomorrow → 200 + array com fixtures de amanhã
  - ?date=YYYY-MM-DD válida → 200 + filter correto
  - ?date=invalid → 400
  - sem rows → 200 + []
  - CORS header presente quando origem é API_CORS_ORIGIN
```

---

## Blockers — stop and alert the user if you encounter

- Indecisão Pilot entre Roda/Sinatra/Rails-API — perguntar (não escolher silenciosamente algo que vire dívida)
- DB vazio dificulta seed de teste — usar factories simples ou inserir direto via SQL no setup do spec

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

- **Trade-offs taken:** Roda escolhida (esperado) por modularidade + perf. Se Pilot preferir Sinatra (familiaridade), substitui.
- **Deferred to other tasks:** Paginação, filtros adicionais (liga, time), websockets — YAGNI no MVP (1 user lista dezenas de jogos).
- **Known risks:** Date timezone confusion — usar UTC consistente. `today` é "hoje em UTC ou em Europe/London?". Decisão: UTC pra DB; frontend converte se necessário. Documentar.
