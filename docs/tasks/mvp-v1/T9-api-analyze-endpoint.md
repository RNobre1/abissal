# Task: API POST /api/analyze + OpenRouter client

> **Session:** Terminal 9 of 12
> **Branch:** `feat/mvp-v1-T9`
> **Status:** `[ ] Planning` `[ ] In progress` `[ ] Tests passing` `[ ] Ready for review`

---

## Objective

Expor endpoint `POST /api/analyze` que recebe `fixture_id` + opcional `messages` (chat history) e chama OpenRouter (modelo `deepseek/deepseek-v3.2`) usando o `detail_json` da fixture como contexto. Retorna análise IA. Streaming nice-to-have, JSON-completo MVP.

---

## Required context

- **Larger feature:** [00-overview.md](00-overview.md)
- **What other sessions are doing:** Wave 5 paralela com T11 (web fixtures list). Sem conflito.
- **Decisions already made:** OpenRouter + `deepseek/deepseek-v3.2` (CLAUDE.md). Web framework escolhido em T8.
- **Relevant CLAUDE.md sections:** "External services and APIs" (OpenRouter), "Environment variables" (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`).

---

## Files ALLOWED to touch

```
lib/api/routes/analyze.rb
lib/openrouter_client.rb
lib/api/prompt_builder.rb                      # monta system + user prompts a partir de detail_json
spec/api/analyze_spec.rb
spec/openrouter_client_spec.rb
spec/api/prompt_builder_spec.rb
```

**Atualizar Gemfile** com `faraday ~> 2` (HTTP client) + `faraday-retry` (opcional).

---

## Files FORBIDDEN

```
lib/api/routes/fixtures.rb                     # T8 já criou (não tocar)
lib/api/app.rb                                 # T8 — adicionar nova rota via require, não reescrever
lib/scraper/**                                 # outras tasks
web/**, infra/**, db/**                        # outras tasks
```

---

## Execution order (TDD mandatory)

### Phase 1 — Tests first (RED)

- [ ] `spec/openrouter_client_spec.rb` com WebMock/VCR (mock HTTP):
  - `client.chat(messages:, model:)` faz POST em `https://openrouter.ai/api/v1/chat/completions` com Bearer auth
  - retorna `{content: String, model: String, usage: Hash}` extraído da resposta
  - 401/403 → `OpenRouterAuthError`
  - 429 → `OpenRouterRateLimitError` (com `retry_after` se header presente)
  - 5xx → `OpenRouterServerError`
  - timeout → `OpenRouterTimeoutError`
- [ ] `spec/api/prompt_builder_spec.rb`:
  - `build(fixture, detail_json, messages: [])` retorna array de messages no formato OpenAI/OpenRouter
  - System prompt menciona contexto futebol pré-jogo
  - User prompt (primeiro turno) inclui `detail_json` formatado legível
  - Chat history (`messages` adicionais) é appendado preservando roles
- [ ] `spec/api/analyze_spec.rb` (Rack::Test):
  - `POST /api/analyze` sem `fixture_id` → 400
  - `POST /api/analyze` com `fixture_id` inexistente → 404
  - `POST /api/analyze` com `fixture_id` válido → 200 + JSON `{content, model, usage}`
  - `POST /api/analyze` com OpenRouter retornando 500 → 502 (bad gateway) + JSON error
  - `POST /api/analyze` com chat history → passa pro client corretamente
  - CORS preservado
- [ ] Red: routes/analyze, openrouter_client, prompt_builder não existem
- [ ] `git commit -m "test: POST /api/analyze + openrouter client scenarios"`

### Phase 2 — Implementation (GREEN)

- [ ] `lib/openrouter_client.rb`: Faraday connection com `Authorization: Bearer #{ENV.fetch('OPENROUTER_API_KEY')}`, base URL OpenRouter. `chat(messages:, model: ENV['OPENROUTER_MODEL'])` → Hash normalized.
- [ ] `lib/api/prompt_builder.rb`: serializa Fixture + detail_json em prompt humano legível. System prompt: "Você é um analista de futebol focado em estatística pré-jogo. Use APENAS os dados fornecidos. Não invente."
- [ ] `lib/api/routes/analyze.rb`: handler POST, valida input, busca fixture no DB (reusar `db_repository` de T8), monta prompt, chama client, retorna JSON.
- [ ] Mount no `lib/api/app.rb`: `require_relative 'routes/analyze'` + adicionar rota.
- [ ] `git commit -m "feat(api): POST /api/analyze with OpenRouter integration"`

### Phase 3 — Refactoring (REFACTOR)

- [ ] Considerar caching da análise (chave: fixture_id + hash do detail_json). YAGNI no MVP, deixar comentário.
- [ ] Error handling consistente (mesma forma JSON da T8).

### Phase 4 — Final verification

- [ ] `bundle exec rspec spec/openrouter_client_spec.rb spec/api/prompt_builder_spec.rb spec/api/analyze_spec.rb` passa
- [ ] Teste manual: `curl -X POST http://localhost:$API_PORT/api/analyze -d '{"fixture_id":1}'` retorna análise IA real (precisa `OPENROUTER_API_KEY` configurada)
- [ ] Logging não vaza API key

---

## Acceptance criteria

- [ ] Endpoint integra com OpenRouter real (testado manual antes do PR)
- [ ] Erros do upstream traduzidos pra status HTTP sensatos (502 pra 5xx upstream)
- [ ] Chat history funciona (segundo turno preserva contexto)
- [ ] API key NUNCA é logada nem retornada em error responses
- [ ] Spec usa mock HTTP — sem chamadas reais em CI

---

## Mandatory test scenarios

```
POST /api/analyze
  - sem body → 400
  - fixture_id inexistente → 404
  - fixture válida → 200 + content da análise
  - chat history preservada
  - OpenRouter 401 → 502 + erro genérico (sem vazar key)
  - OpenRouter 429 → 429 client-side com Retry-After

OpenRouterClient
  - chat() retorna {content, model, usage}
  - timeout, 401, 429, 5xx → exceções específicas
  - User-Agent header configurado

PromptBuilder
  - system prompt presente
  - detail_json formatado humano-legível
  - chat history appendada na ordem correta
```

---

## Blockers — stop and alert the user if you encounter

- `OPENROUTER_API_KEY` não disponível em dev — usar mock em todos os testes; testar real só uma vez antes do PR com key temporária
- detail_json muito grande (>50KB) — pode estourar context window do modelo. Mitigação: limitar campos enviados (só recent_matches + h2h + streak), ou comprimir.
- Modelo `deepseek/deepseek-v3.2` indisponível em OpenRouter (renomeado/deprecated) — alertar; fallback documentado em CLAUDE.md ou pesquisa derivada

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

- **Trade-offs taken:** JSON-completo no MVP (sem streaming). Streaming dobra complexidade pro frontend e backend; YAGNI.
- **Deferred to other tasks:** Cache de respostas (mesmo fixture+detail = mesma análise) — agenda como follow-up. Rate limit client-side. Múltiplos modelos.
- **Known risks:** Custo. Cada análise pode custar US$ 0.001-0.01. Free tier OpenRouter cobre dev. Pilot configura cap mensal na conta.
