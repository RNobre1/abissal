# Task: Frontend lista de fixtures

> **Session:** Terminal 11 of 12
> **Branch:** `feat/mvp-v1-T11`
> **Status:** `[ ] Planning` `[ ] In progress` `[ ] Tests passing` `[ ] Ready for review`

---

## Objective

Componentes React `<FixturesList />` + `<FixtureCard />` que consomem `GET /api/fixtures?date=today` e renderizam a lista. Inclui toggle today/tomorrow, estado de loading, estado de erro, callback `onSelect(fixture)` pra T12 consumir.

---

## Required context

- **Larger feature:** [00-overview.md](00-overview.md)
- **What other sessions are doing:** Wave 5 paralela com T9 (analyze endpoint). Sem conflito direto, mas a API esperada de T8 (`GET /api/fixtures`) precisa estar funcionando.
- **Decisions already made:** React + TS + Vite (CLAUDE.md). Vitest + Testing Library escolhidos em T10.
- **Relevant CLAUDE.md sections:** "External services and APIs" (API contract), "Data model" (campos da Fixture).

---

## Files ALLOWED to touch

```
web/src/types/fixture.ts                       # interface Fixture (espelha lib/scraper/fixture.rb)
web/src/api/fixtures.ts                        # fetch wrapper
web/src/api/client.ts                          # base fetch (URL, error handling)
web/src/components/FixturesList.tsx
web/src/components/FixtureCard.tsx
web/src/components/DateToggle.tsx              # today / tomorrow buttons
web/src/App.tsx                                # editar pra usar FixturesList
web/src/index.css                              # styles básicos
web/tests/FixturesList.test.tsx
web/tests/FixtureCard.test.tsx
web/tests/api/fixtures.test.ts                 # MSW handler ou fetch mock
```

**Atualizar `web/package.json`** com `msw ^2` (dev) pra mockar API em testes.

---

## Files FORBIDDEN

```
web/src/components/AnalyzePanel.tsx            # T12
web/src/components/ChatMessage.tsx             # T12
web/src/api/analyze.ts                         # T12
lib/**, bin/**, db/**, infra/**                # backend
```

---

## Execution order (TDD mandatory)

### Phase 1 — Tests first (RED)

- [ ] `web/src/types/fixture.ts`: define interface `Fixture { id, match_date, ko_time?, home_team, away_team, league?, source_url? }`
- [ ] `web/tests/FixtureCard.test.tsx`:
  - renderiza nome do time da casa + visitante + horário
  - clicar emite `onSelect(fixture)`
  - sem `ko_time` mostra "TBD"
- [ ] `web/tests/FixturesList.test.tsx`:
  - estado loading inicial mostra spinner/placeholder
  - sucesso renderiza N cards pra N fixtures retornadas
  - lista vazia mostra mensagem "Sem fixtures pra hoje"
  - erro da API mostra mensagem amigável + botão retry
  - toggle today/tomorrow refetch
- [ ] `web/tests/api/fixtures.test.ts`:
  - `getFixtures(date)` chama `/api/fixtures?date=...` com headers corretos
  - retorna parsed JSON em sucesso
  - lança `ApiError` em status não-200
- [ ] Mock via MSW: handler `GET /api/fixtures` retornando 5 fixtures de fixture
- [ ] Red: componentes não existem
- [ ] `git commit -m "test(web): FixturesList + FixtureCard + api client scenarios"`

### Phase 2 — Implementation (GREEN)

- [ ] `web/src/api/client.ts`: helper genérico `apiFetch(path, opts)` com base URL relativa, error handling, JSON parsing
- [ ] `web/src/api/fixtures.ts`: `getFixtures(date: 'today' | 'tomorrow' | string)` → `Promise<Fixture[]>`
- [ ] `web/src/components/FixtureCard.tsx`: card simples com `onSelect` prop
- [ ] `web/src/components/DateToggle.tsx`: 2 botões controlados
- [ ] `web/src/components/FixturesList.tsx`: usa `useState` + `useEffect` (sem react-query ainda — YAGNI), gerencia loading/error/data
- [ ] `web/src/App.tsx`: monta `<FixturesList />` com placeholder de `onSelect` (T12 conecta painel real)
- [ ] CSS básico (flex layout, espaçamento, cores neutras — sem framework)
- [ ] `git commit -m "feat(web): fixtures list with date toggle"`

### Phase 3 — Refactoring (REFACTOR)

- [ ] Extrair hook `useFixtures(date)` se a lógica em FixturesList ficar densa
- [ ] Garantir acessibilidade básica (labels nos botões, role=list nos cards)

### Phase 4 — Final verification

- [ ] `cd web && pnpm test` passa todos os testes
- [ ] `cd web && pnpm typecheck` sem erros
- [ ] `cd web && pnpm dev` + backend rodando (T8): lista carrega no browser
- [ ] Toggle today/tomorrow funciona visualmente

---

## Acceptance criteria

- [ ] Lista renderiza fixtures reais (com API rodando) ou mock (em testes)
- [ ] Loading, error e empty states cobertos
- [ ] Toggle today/tomorrow funcional
- [ ] `onSelect(fixture)` exposto pro T12 consumir
- [ ] Tipos Fixture sincronizados com backend (espelha schema Ruby)

---

## Mandatory test scenarios

```
FixturesList
  - mostra loading inicialmente
  - renderiza N cards após fetch sucesso
  - mostra placeholder em lista vazia
  - mostra erro + retry em fetch fail
  - toggle today/tomorrow dispara refetch

FixtureCard
  - mostra home, away, ko_time
  - "TBD" se ko_time null
  - clicar emite onSelect(fixture)

getFixtures(date)
  - chama URL correta com query param
  - retorna array de Fixture
  - lança ApiError em status não-200
```

---

## Blockers — stop and alert the user if you encounter

- API contract divergir do esperado em T8 — conferir specs e alinhar antes de mockar
- Drift de tipos Fixture (backend mudou e frontend não) — registrar como follow-up

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

- **Trade-offs taken:** `useState` + `useEffect` puros vs react-query — YAGNI. CSS sem framework — adicionar Tailwind/shadcn é trivial depois.
- **Deferred to other tasks:** Filtros (liga, time), busca, ordenação — wishlist pós-MVP.
- **Known risks:** Drift de tipos Fixture entre Ruby e TS (sem shared types — ADR-001). Mitigação: gerar JSON schema do Ruby e validar no client, ou seguir manual nos primeiros meses.
