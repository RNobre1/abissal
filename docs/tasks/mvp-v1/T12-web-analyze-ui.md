# Task: Frontend análise IA + chat

> **Session:** Terminal 12 of 12
> **Branch:** `feat/mvp-v1-T12`
> **Status:** `[ ] Planning` `[ ] In progress` `[ ] Tests passing` `[ ] Ready for review`

---

## Objective

Componente `<AnalyzePanel />` que abre ao selecionar uma fixture na lista (T11), chama `POST /api/analyze`, mostra resposta IA, e permite follow-up tipo chat (turnos adicionais preservando histórico). Markdown da resposta renderizado.

---

## Required context

- **Larger feature:** [00-overview.md](00-overview.md)
- **What other sessions are doing:** Última task (Wave 6). Sem paralela.
- **Decisions already made:** API `POST /api/analyze` (T9), `<FixturesList onSelect>` (T11), React+TS+Vite (T10).
- **Relevant CLAUDE.md sections:** "External services and APIs" (OpenRouter), "Data model" (Fixture).

---

## Files ALLOWED to touch

```
web/src/components/AnalyzePanel.tsx
web/src/components/ChatMessage.tsx
web/src/components/MarkdownRenderer.tsx        # wrapper de react-markdown ou similar
web/src/api/analyze.ts
web/src/types/chat.ts                          # interfaces Message, AnalyzeResponse
web/src/App.tsx                                # conectar onSelect → AnalyzePanel
web/src/index.css                              # styles do painel/chat
web/tests/AnalyzePanel.test.tsx
web/tests/ChatMessage.test.tsx
web/tests/api/analyze.test.ts
```

**Atualizar `web/package.json`** com `react-markdown ^9` (renderização) + `remark-gfm ^4` (tabelas/listas).

---

## Files FORBIDDEN

```
web/src/components/FixturesList.tsx, FixtureCard.tsx, DateToggle.tsx   # T11 (não tocar)
web/src/api/fixtures.ts                                                  # T11
lib/**, bin/**, db/**, infra/**                                          # backend
```

---

## Execution order (TDD mandatory)

### Phase 1 — Tests first (RED)

- [ ] `web/src/types/chat.ts`: `Message { role: 'user' | 'assistant' | 'system', content: string }`, `AnalyzeResponse { content, model, usage }`
- [ ] `web/tests/api/analyze.test.ts`:
  - `analyzeFixture(fixtureId, messages)` POSTs em `/api/analyze` com body correto
  - retorna `AnalyzeResponse` em sucesso
  - lança `ApiError` em status não-200
- [ ] `web/tests/ChatMessage.test.tsx`:
  - role=user renderiza alinhado à direita com bg neutro
  - role=assistant renderiza com markdown (negrito, listas, code blocks)
  - content vazio → não renderiza (ou placeholder loading)
- [ ] `web/tests/AnalyzePanel.test.tsx`:
  - mount com `fixture={...}` → chama API imediatamente
  - mostra loading enquanto request pending
  - mostra análise renderizada em markdown após sucesso
  - mostra erro amigável + retry em fail
  - input + botão "enviar" pra follow-up
  - submeter follow-up adiciona mensagem do usuário + chama API com history + adiciona resposta
  - history preservado entre turnos (3+ turnos OK)
  - botão "close" emite callback `onClose`
- [ ] Mock MSW `POST /api/analyze` retornando análise fixture
- [ ] Red: componentes não existem
- [ ] `git commit -m "test(web): AnalyzePanel + ChatMessage + analyze api scenarios"`

### Phase 2 — Implementation (GREEN)

- [ ] `web/src/api/analyze.ts`: `analyzeFixture(fixtureId: number, messages: Message[] = []) → Promise<AnalyzeResponse>`
- [ ] `web/src/components/MarkdownRenderer.tsx`: thin wrapper de `<ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>` (centraliza config; permite trocar lib depois)
- [ ] `web/src/components/ChatMessage.tsx`: renderiza um Message com styling por role
- [ ] `web/src/components/AnalyzePanel.tsx`:
  - `useState<Message[]>` pra history
  - `useEffect(fixture.id)` dispara primeira chamada (sem messages history)
  - handler submit do input → adiciona user message → chama API com history → adiciona assistant message
  - loading state durante request
  - error state com retry
  - botão close
- [ ] `web/src/App.tsx`: estado `selectedFixture`, passa pra `<AnalyzePanel>` quando set
- [ ] CSS: side panel (right drawer ou modal); ChatMessages scrollable; input fixo no bottom
- [ ] `git commit -m "feat(web): analyze panel with chat follow-up and markdown"`

### Phase 3 — Refactoring (REFACTOR)

- [ ] Extrair hook `useAnalysis(fixtureId)` se a lógica em AnalyzePanel ficar densa
- [ ] Acessibilidade: labels nos inputs, aria-live na área de mensagens, foco volta pro input após resposta
- [ ] Sanitização: react-markdown escapa HTML por default; **proibido habilitar `rehype-raw`** ou injetar HTML cru em qualquer componente

### Phase 4 — Final verification

- [ ] `cd web && pnpm test` passa todos os testes
- [ ] `cd web && pnpm typecheck` sem erros
- [ ] `cd web && pnpm build` produz bundle
- [ ] Manual com API rodando: clicar fixture → painel abre → análise carrega → enviar follow-up → resposta vem com markdown OK

---

## Acceptance criteria

- [ ] Análise renderiza em markdown (tabelas, listas, ênfase)
- [ ] Chat follow-up funciona (3+ turnos preserva contexto)
- [ ] Loading, error e retry implementados
- [ ] Acessibilidade básica (foco, aria-live, labels)
- [ ] Sem XSS (markdown sanitizado pelo padrão do react-markdown)

---

## Mandatory test scenarios

```
AnalyzePanel
  - mount → fetch automático da análise
  - mostra loading durante request
  - renderiza markdown após sucesso
  - mostra erro + retry em fail
  - submit follow-up adiciona Message do user e dispara API com history
  - history preservado entre turnos
  - close button emite onClose

ChatMessage
  - role=user com alinhamento e style adequado
  - role=assistant renderiza markdown (negrito, listas, headers, code blocks)

analyzeFixture(fixtureId, messages)
  - POSTs em /api/analyze com body correto
  - retorna AnalyzeResponse parseada
  - lança ApiError em status não-200
```

---

## Blockers — stop and alert the user if you encounter

- API `POST /api/analyze` retornando schema diferente do esperado (T9 contract mismatch)
- Análise IA muito longa (>10k tokens) — UI pode ficar lenta. Mitigação: virtualização de mensagens (YAGNI no MVP)
- Custo de tokens explodindo durante dev (testes manuais reais) — usar mock 99% do tempo; teste com API real só 1-2x antes do PR

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

- **Trade-offs taken:** Sem streaming (JSON completo) — alinhado com T9. react-markdown + remark-gfm padrão. Side panel (não modal) — mais natural pra workflow "comparar análise olhando lista".
- **Deferred to other tasks:** Streaming de tokens (UX premium), persistir histórico de chats (sem backend pra isso ainda), múltiplos modelos (escolha pelo user) — wishlist pós-MVP.
- **Known risks:** Markdown malicioso vindo do LLM (improvável mas possível). Mitigação: react-markdown safe-by-default; nunca habilitar `rehype-raw` ou injetar HTML cru. Documentar em security notes.

---

## On completion of T12 = completion of MVP v1

Marcos finais:

- [ ] Atualizar `00-overview.md` header: `**Status:** COMPLETED on YYYY-MM-DD`
- [ ] `PROGRESS.md` snapshot final
- [ ] Demo end-to-end: scraper rodando (cron systemd no VPS) → API responde → frontend mostra fixtures + análise IA — gravar/printar
- [ ] Decidir se vira `mvp-v1` archived ou fica in-place
- [ ] Próxima feature provável: `mvp-v1-polish` (CI/CD via ADR-006, observabilidade real, hardening segurança) ou `feature-streaming-analysis` (UX upgrade)
