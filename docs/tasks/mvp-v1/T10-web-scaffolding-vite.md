# Task: Web scaffolding Vite + React + TS

> **Session:** Terminal 10 of 12
> **Branch:** `feat/mvp-v1-T10`
> **Status:** `[ ] Planning` `[ ] In progress` `[ ] Tests passing` `[ ] Ready for review`

---

## Objective

Scaffolding mínimo do frontend em `web/`: React 18+ + TypeScript + Vite + Vitest + Testing Library. Inclui smoke test (`<App />` renderiza) e configuração de proxy pra API (`/api/*` → `http://localhost:$API_PORT`). Sem componentes de domínio ainda.

---

## Required context

- **Larger feature:** [00-overview.md](00-overview.md)
- **What other sessions are doing:** Wave 2 paralela com T2 (migration), T3 (parser), T6 (fetcher). Sem conflito (todos em pastas diferentes).
- **Decisions already made:** React + TS + Vite + pnpm (CLAUDE.md). web/ é package isolado, não pnpm workspace.
- **Relevant CLAUDE.md sections:** "Tech stack" (Frontend), "Directory structure" (web/), "Commands".

---

## Files ALLOWED to touch

```
web/package.json                               # T1 deixou stub; expandir
web/pnpm-lock.yaml                             # gerado por pnpm install
web/tsconfig.json
web/tsconfig.node.json
web/vite.config.ts
web/vitest.config.ts                           # ou incluído em vite.config.ts
web/index.html
web/src/main.tsx
web/src/App.tsx                                # placeholder "Adam Stats"
web/src/index.css
web/tests/setup.ts
web/tests/App.test.tsx
web/.gitignore                                 # node_modules/, dist/
web/.eslintrc.json (opcional) ou web/eslint.config.js
```

---

## Files FORBIDDEN

```
web/src/components/**                          # T11, T12
web/src/api/**                                 # T11
web/src/types/**                               # T11
lib/**, bin/**, db/**, infra/**                # backend
```

---

## Execution order (TDD mandatory)

### Phase 1 — Tests first (RED)

- [ ] `web/tests/App.test.tsx` smoke test:
  ```tsx
  import { render, screen } from '@testing-library/react'
  import App from '../src/App'
  test('renders app heading', () => {
    render(<App />)
    expect(screen.getByText(/Adam Stats/i)).toBeInTheDocument()
  })
  ```
- [ ] Red: App.tsx não existe / vitest não configurado
- [ ] `git commit -m "test(web): smoke test for App component"`

### Phase 2 — Implementation (GREEN)

- [ ] `web/package.json` com deps:
  - `react ^18`, `react-dom ^18`
  - `vite ^6`, `@vitejs/plugin-react ^4`
  - `typescript ^5`, `@types/react`, `@types/react-dom`, `@types/node`
  - `vitest ^2`, `@testing-library/react ^16`, `@testing-library/jest-dom ^6`, `jsdom`
  - scripts: `dev`, `build`, `preview`, `test`, `typecheck`
- [ ] `web/vite.config.ts` com React plugin + proxy `/api → http://localhost:4567`
- [ ] `web/vitest.config.ts` (ou inline em vite.config) com `environment: 'jsdom'`, `setupFiles: ['./tests/setup.ts']`
- [ ] `web/tests/setup.ts` com `import '@testing-library/jest-dom'`
- [ ] `web/tsconfig.json` strict + jsx react-jsx
- [ ] `web/src/main.tsx` ReactDOM mount
- [ ] `web/src/App.tsx` placeholder `<h1>Adam Stats</h1>`
- [ ] `web/index.html` shell HTML com `<div id="root">`
- [ ] `pnpm install` na pasta web
- [ ] `git commit -m "feat(web): vite + react + ts + vitest scaffold"`

### Phase 3 — Refactoring (REFACTOR)

- [ ] Configurar path alias `@/` → `src/` (vite + tsconfig consistentes) — opcional, decide se justifica

### Phase 4 — Final verification

- [ ] `cd web && pnpm test` passa o smoke test
- [ ] `cd web && pnpm typecheck` (tsc --noEmit) sem erros
- [ ] `cd web && pnpm dev` sobe Vite em http://localhost:5173 e renderiza "Adam Stats"
- [ ] `cd web && pnpm build` gera `dist/` sem erros

---

## Acceptance criteria

- [ ] Smoke test passa
- [ ] TypeScript strict mode habilitado
- [ ] Vite dev server roda + proxy `/api` configurado pra API local
- [ ] `pnpm build` produz bundle válido
- [ ] Linter/formatter mínimo (decide entre ESLint+Prettier ou Biome; recomendado: Biome por simplicidade)

---

## Mandatory test scenarios

```
App component
  - renderiza heading "Adam Stats"
  - smoke test passa em ambiente jsdom
```

---

## Blockers — stop and alert the user if you encounter

- Node version não compatível (precisa Node 22+; T1 setou no mise.toml)
- pnpm não instalado globalmente — pode rodar via `npx pnpm` ou pedir `npm install -g pnpm`

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

- **Trade-offs taken:** Vitest sobre Jest (config Vite-friendly, mais rápido). Sem Tailwind no MVP — CSS puro/módulos primeiro; estilização cresce em T11/T12 se demandar.
- **Deferred to other tasks:** UI lib (shadcn? Mantine?), routing (react-router), state management (Zustand?) — YAGNI até precisar.
- **Known risks:** Vite/Vitest evoluem rápido; pinar versões major exatas no MVP pra estabilidade.
