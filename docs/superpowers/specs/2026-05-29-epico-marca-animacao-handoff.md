# Épico marca/animação — HANDOFF de estado (p/ retomar pós-/compact)

> 2026-05-29. Ler isto + a memória `epico-marca-animacao.md` ao retomar. Tudo em prod (branch `main`, último commit `b072fb6`), working tree limpo.

## Resumo de 1 parágrafo

Sessão entregou um épico de identidade visual + landing animada pro Abissal. **Frentes D (logo/identidade), E (landing pré-login) e B (skills de design) CONCLUÍDAS e em produção.** Frente **C (enraizar a marca no app autenticado) NÃO foi iniciada**. O Pilot mandou salvar o estado e disse que vai querer **continuar** depois do compact.

## O que está em prod (commits, ordem cronológica)

- `9d51e22`→`6706937` — preview `/brand` de conceitos de logo + fix pública no middleware
- `5c5d616`,`bc47ef0` — 10 variações do logo + afinação do glow (Pilot escolheu **estratos serenos, glow G2**)
- `d60256c` — **Frente D**: identidade "estratos + farol" — `components/brand/abissal-mark.tsx` (+5 testes TDD), `app/icon.svg` dark/light, favicon.ico/apple-icon/PWA via `scripts/brand/build-icons.sh`, keyframes em `globals.css`
- `6115fa1` — **Frente E F1+F2**: roteamento (landing na `/`, dashboard → `/painel`, política pura `lib/supabase/redirect-policy.ts` +7 testes) + casca SSR do poema de 6 cenas
- `38ea706` — F3-F5: scroll-driven CSS + `ParticlesCanvas` + `AbyssShader` (WebGL via `ogl`, lazy+fallback)
- `87d8d5a` — **fix "fundo preto"**: z-index negativo sob `<body>` opaco + hydration mismatch (diagnóstico via Playwright contexto limpo)
- `08868da` — **W1** (perf/clareza/robustez)
- `fa15635` — **W2** (cursor bioluminescente)
- `2a6dc2f` — **W3+W4** (motion/narrativa + shader/acabamento)
- `b072fb6` — **W5** (copy + ética)

## Arquivos-chave da landing/identidade

- `app/(marketing)/page.tsx` — a landing (6 cenas, split-word, depth markers, CTAs, copy)
- `app/(marketing)/landing.css` — animações scroll-driven (reveal/rise/word/darken/depth, easings)
- `components/marketing/abyss-shader.tsx` — shader WebGL (gradiente, caustics campânula, farol+god-ray, aura do cursor `u_mouse`, vinheta+grão; fallback CSS no SSR; ogl lazy via requestIdleCallback; gate device fraco)
- `components/marketing/particles-canvas.tsx` — partículas (fps-cap 30, shadowBlur, device degrade)
- `components/brand/abissal-mark.tsx` + `app/globals.css` (keyframes abissal-rise/pulse)
- `lib/supabase/redirect-policy.ts` — `/` pública, `/brand` pública, logado→`/painel`
- Pesquisa: `docs/pesquisas/identidade-animacao/01..06` (06 = síntese do persona-brainstorm)

## Como ITERAR visualmente (o ciclo que funciona — importante)

1. `pnpm dev` em background (sobe na :3000). Deslogado vê a landing em `/`.
2. Screenshot via Playwright em **contexto limpo (deslogado)** — script padrão:
   ```js
   import { chromium } from "@playwright/test";
   const b = await chromium.launch();
   const p = await (await b.newContext({ viewport:{width:1440,height:900} })).newPage();
   await p.goto("http://localhost:3000/", { waitUntil:"load" });
   await p.waitForTimeout(2500);
   // opcional: await p.mouse.move(440,300) p/ ver a aura; window.scrollTo p/ cenas
   await p.screenshot({ path:"/tmp/landing-shot.png" }); await b.close();
   ```
   Rodar de DENTRO do projeto (resolve `@playwright/test`). Eu (Claude) consigo VER o png via Read. Remover o script após usar.
3. Gate por mudança: `pnpm typecheck && pnpm lint && pnpm test` (1509 testes) + `pnpm build`.
4. Deploy = commit + push na `main` → `deploy.yml` publica (wrangler local NÃO autenticado). Acompanhar com `gh run watch <id>`.

## Gotchas críticos (já custaram tempo)

- **z-index negativo é proibido pros fundos**: o `<body>`/`<html>` têm `background` opaco (#09090f) que pinta DEPOIS de filhos com z negativo → fundos somem. Use z POSITIVOS (0/1/2) + conteúdo z-10.
- **Hydration mismatch**: nunca decidir markup com `typeof window`/`webglAvailable()` no `useState` inicial (server≠client). Markup idêntico SSR/client; decisão no `useEffect`.
- **`pkill` do next dev corta a cadeia do shell** (exit 1/144): rode `pnpm test`/`build` em comando SEPARADO depois de matar o dev. `sleep` em foreground é bloqueado.
- **`next dev` às vezes reporta exit 1 mas o `next-server` sobe** na :3000 — checar com `pgrep -f next-server`.
- **`CSSProperties` importa de `react`**, não de `next`.
- **`.next` stale** dá false-positive no `tsc` (validator aponta página movida) — some após `pnpm build` regenerar.

## PRÓXIMOS PASSOS (o que o Pilot vai querer continuar)

> Perguntar ao Pilot qual destes ao retomar (ele disse "continue sem perder nada").

### Frente C — enraizar a marca no app autenticado (a 4ª frente, NÃO iniciada)
- Logo `AbissalMark` no header/sidebar do `(dashboard)/layout.tsx` (hoje é texto "abissal"; o link já vai pra `/painel`).
- **Criar `AbissalLockup`** (mark + wordmark Fraunces, pingo do "i" = farol) — adiado da frente D, estreia aqui.
- Loadings/skeletons on-brand (o farol pulsando / estratos surgindo) — reusar keyframes de `globals.css`.
- View Transition login→`/painel` (Next 16 `experimental.viewTransition` + skill `react-view-transitions` instalada).
- Microcopy do abismo com parcimônia (estados vazios, tooltips) — sem atrapalhar números.

### Limpeza
- Remover a rota `/brand` (`app/(marketing)`? não — está em `app/brand/page.tsx`) e tirar `"/brand"` de `PUBLIC_PREFIXES` em `lib/supabase/redirect-policy.ts`.

### Opcionais do persona-brainstorm (síntese `06-...md`)
- Fraunces `opsz`/`SOFT`/`WONK` (exige trocar o carregamento da fonte em `app/layout.tsx` p/ variable+axes — afeta o app todo; testar).
- Magnetic button no CTA; sound design com toggle (Web Audio, gesto-gated); contraste a11y dos tokens `--color-ink-faint/muted` (~4.0:1, falha AA — global); seção "backstage" técnica.

### Comandos sensíveis pendentes (do scout, NÃO rodados — pedir OK)
- `sudo dnf install librsvg2-tools` (rsvg-convert JÁ existe) / export PNG; `pip install "lottie[all]" pycairo` + cairo (wiggle); `playwright install chromium` (anydesign); `logoloom` MCP (não inspecionado).

## Pendências do Pilot (humano)
- Spot-check visual da landing no device dele (desktop + **mobile** — WebGL→fallback).
- Decidir se remove a `/brand`.

## Diretrizes ativas a respeitar
- **Hibernação IA/sim/calibração** (~até 2026-06-03): NÃO mexer em modelo/prompt/walk-forward/calibração. Design/animação NÃO toca isso (ok). Confirmar a data com o Pilot.
- Commits: Conventional Commits, **sem `Co-Authored-By`**. Branch é `main` (deploy só no push pra main).
