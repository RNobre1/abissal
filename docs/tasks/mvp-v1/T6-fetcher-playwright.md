# Task: Fetcher Playwright (Ruby)

> **Session:** Terminal 6 of 12
> **Branch:** `feat/mvp-v1-T6`
> **Status:** `[ ] Planning` `[ ] In progress` `[ ] Tests passing` `[ ] Ready for review`

---

## Objective

Implementar o fetcher Ruby que orquestra `playwright-ruby-client`: abre URL, espera seletor canônico carregar, retorna HTML cru. Não parseia, não persiste. Testes unit com mock + 1 integration test (rede real) marcado `:slow`.

---

## Required context

- **Larger feature:** [00-overview.md](00-overview.md)
- **What other sessions are doing:** Wave 2 paralela com T2 (migration), T3 (parser), T10 (web). Sem conflito.
- **Decisions already made:** `playwright-ruby-client` 1.59.1 (POC validou). `PLAYWRIGHT_CLI_EXECUTABLE_PATH` env var aponta pra Playwright Node CLI em path ASCII-only.
- **Relevant CLAUDE.md sections:** "Tech stack" (Playwright driver), "Environment variables" (`PLAYWRIGHT_CLI_EXECUTABLE_PATH`, `SCRAPER_TARGET_BASE_URL`, `SCRAPER_USER_AGENT`), "Lessons learned" (#3 bug do path com espaços).

---

## Files ALLOWED to touch

```
lib/scraper/fetcher.rb
lib/scraper/playwright_session.rb              # wrapper de inicialização/cleanup
spec/scraper/fetcher_spec.rb
spec/scraper/fetcher_integration_spec.rb       # marcado :slow + :network
```

---

## Files FORBIDDEN

```
lib/scraper/parser.rb, persister.rb, detail_parser.rb   # outras tasks
.poc/**                                                   # POCs read-only
infra/**, web/**, lib/api/**                              # outras tasks
```

---

## Execution order (TDD mandatory)

### Phase 1 — Tests first (RED)

- [ ] `spec/scraper/fetcher_spec.rb` com **Playwright stub** (não usa rede):
  - `fetch(url, wait_selector:)` chama `page.goto(url)` com `waitUntil: 'domcontentloaded'`
  - chama `page.wait_for_selector(wait_selector, timeout: 15_000)` antes de retornar HTML
  - `page.content` é retornado
  - timeout em `wait_for_selector` levanta `AdamStats::Scraper::FetchTimeoutError`
  - HTTP 4xx/5xx levanta `AdamStats::Scraper::FetchError` com status code
  - browser é fechado em ensure (mesmo em erro)
- [ ] `spec/scraper/fetcher_integration_spec.rb` (marcado `:slow, :network`):
  - rodar APENAS se `RUN_NETWORK_TESTS=1` set
  - chama fetcher contra `SCRAPER_TARGET_BASE_URL || https://www.adamchoi.co.uk` + `/fixtures`
  - assert status 200, HTML > 100KB, contém `<fixture-team-home>` selector
- [ ] Red: fetcher não existe
- [ ] `git commit -m "test: fetcher specs (unit + slow network integration)"`

### Phase 2 — Implementation (GREEN)

- [ ] `lib/scraper/playwright_session.rb`: encapsula `Playwright.create(playwright_cli_executable_path: ENV['PLAYWRIGHT_CLI_EXECUTABLE_PATH'])` + `chromium.launch(headless: true)` + `new_context(userAgent:, locale:, timezone_id:, viewport:)` + `new_page`. Block-yielding API com cleanup automático.
- [ ] `lib/scraper/fetcher.rb`:
  - `fetch(url, wait_selector: '.fixture-ko-time', timeout_ms: 30_000) → String (HTML)`
  - usa `PlaywrightSession`
  - logs estruturados (URL, status, timing)
  - mapeia exceções de `playwright-ruby-client` pra hierarchy de erros do app
- [ ] `git commit -m "feat(scraper): playwright fetcher with structured error mapping"`

### Phase 3 — Refactoring (REFACTOR)

- [ ] Extrair UA / locale / timezone como constantes ou ler de env
- [ ] Confirmar que cleanup roda em todos os caminhos (incluindo timeout)

### Phase 4 — Final verification

- [ ] `bundle exec rspec spec/scraper/fetcher_spec.rb` passa (unit)
- [ ] `RUN_NETWORK_TESTS=1 bundle exec rspec spec/scraper/fetcher_integration_spec.rb` passa (1x manual, antes do PR)
- [ ] Verificar manualmente que processo Chromium NÃO fica zumbi após `Ctrl+C` mid-fetch (cleanup OK)

---

## Acceptance criteria

- [ ] Unit tests passam sem rede
- [ ] Integration test passa contra adamchoi.co.uk real (uma vez antes do PR)
- [ ] Erros estruturados (FetchTimeoutError, FetchError) — não vazam stack do gem
- [ ] Browser fecha sempre (mesmo em exceção)
- [ ] Documentado em `CLAUDE.md#lessons-learned` se algum novo bug aparecer

---

## Mandatory test scenarios

```
AdamStats::Scraper::Fetcher.fetch
  - happy path: HTML retornado quando selector aparece
  - timeout do selector → FetchTimeoutError
  - status 404 → FetchError(404)
  - exceção do Playwright → cleanup garantido (page.close, context.close, browser.close)
  - re-entrante: chamar 2x em sequência funciona
  - [integration :slow] real fetch /fixtures retorna HTML > 100KB
```

---

## Blockers — stop and alert the user if you encounter

- Playwright CLI não encontrado em `PLAYWRIGHT_CLI_EXECUTABLE_PATH` (precisa T1 ter setado direito)
- Path com espaços (re-encontrar bug documentado em CLAUDE.md#lessons-learned 3) — workaround: instalar Playwright Node CLI em `/tmp/pw-ruby-driver/` ou similar
- adamchoi começa a disparar Cloudflare challenge (POC mostrou que não dispara hoje, mas pode mudar) → detectar `Just a moment` / Turnstile, alertar

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

- **Trade-offs taken:** Wait por seletor específico (`fixture-ko-time`) em vez de `networkidle` — porque analytics/ads ficam em loop (POC confirmou). Documentado em pesquisa §9.7.
- **Deferred to other tasks:** Retry com backoff em falhas transitórias — T7 orchestrator pode envolver retry external. Pool de browser warm — YAGNI no MVP (1 scrape/dia).
- **Known risks:** Memory leak em runs longos (Chromium). Mitigação MVP: cada scrape diário spawn novo processo via systemd, cleanup automático.
