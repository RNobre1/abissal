# Comparação de Bibliotecas de Animação Web — 2026

> **Objetivo:** Decidir a stack mínima de animação para o projeto Abissal (Next.js 16, React 19, Tailwind v4, Cloudflare Workers via OpenNext).
>
> **Restrições críticas:** bundle gzip apertado (~150 KB/rota), histórico de Error 1101 por JS pesado no Worker, INP/CWV importam, RSC/SSR = a maioria das libs é client-only.
>
> **Dois contextos distintos:**
> - **LANDING** — rota isolada pré-login, pode aceitar lib mais pesada via `next/dynamic`
> - **APP autenticado** — preferir CSS puro / peso ~zero; evitar impacto em rotas já no limite

---

## 1. Estado da arte: CSS nativo (custo zero)

Antes de qualquer lib, o CSS moderno cobre uma fatia significativa dos casos de uso:

| Recurso CSS | Suporte (mai/2026) | O que resolve |
|---|---|---|
| `@keyframes` + `transition` | Universal | Micro-interações, hover, fade, slide |
| `animation-timeline: scroll()` / `view()` (Scroll-Driven Animations) | Chrome/Edge 115+, Safari 17.5+, Firefox 130+ (~92% global) | Scroll progress bars, fade-in-on-view, parallax simples |
| View Transitions API (`@starting-style`) | Chrome/Edge 111+, Safari 18+, Firefox 144+ (Baseline 2025) | Page transitions, SPA navegação |
| Tailwind v4 `animate-*` + `@theme { --animate-... }` | v4.x (CSS-first) | Tokens de animação definíveis no CSS, zero JS |

**Regra prática para o Abissal:** se o efeito pode ser descrito como "entra, sai, faz scroll, muda de rota" sem interação de arrastar, física ou sequência complexa, CSS nativo + Tailwind basta. Ver complementar em `01-estado-da-arte.md` (se existir).

---

## 2. Tabela Comparativa

> **Pesos:** valores gzip medidos em mai/2026. Fontes: Bundlephobia, pkgpulse.com, documentação oficial.  
> **RSC/SSR:** a lib pode ser importada em Server Components? (não significa "roda no servidor" — significa "não vai quebrar a build ou injetar `use client` invisível no bundle do servidor").  
> **Worker-safe:** o JS gerado pelo bundle roda no Cloudflare Worker runtime (sem `window`, sem `document`, sem WebGL/canvas no lado do servidor)?  

| Lib | Versão atual | Gzip (core / otimizado) | RSC/SSR | Worker-safe¹ | DOM/Canvas/WebGL | Licença | Manutenção |
|---|---|---|---|---|---|---|---|
| **CSS nativo** (Tailwind v4) | — | **0 KB** | Sim | Sim | DOM | — | Excelente |
| **motion** (`motion/react`) | 12.40+ | 34 KB (full) / **4.6 KB** (LazyMotion+`m`) / **2.3 KB** (useAnimate mini) | Não² | Não² | DOM | MIT | Muito ativa (Matt Perry / independente desde 2024) |
| **framer-motion** | 12.x (alias de `motion`) | 59.1 KB (full, sem otimização) | Não² | Não² | DOM | MIT | = motion acima |
| **GSAP** | 3.15 | **26.7 KB** (core+ScrollTrigger ~+8 KB) | Não² | Não² | DOM | MIT (gratuito, incl. plugins — ver §3) |  Ativa (Webflow) |
| **@react-spring/web** | 10.0.4 | **24.6 KB** | Não² | Não² | DOM | MIT | Moderada (pmndrs) |
| **@formkit/auto-animate** | 0.9.0 | **~3 KB** (min+gz estimado) / 55 KB install | Não² | Não² | DOM | MIT | Baixa (último release ~9 meses atrás) |
| **animejs** | 4.2.2 | **~17 KB** (tree-shaken) | Não² | Não² | DOM | MIT | Ativa (Julian Garnier) |
| **lottie-web** | 5.12.2 | **~60 KB** | Não² | Não² | Canvas/SVG/HTML | MIT | Baixa (Airbnb, manutenção mínima) |
| **@lottiefiles/dotlottie-web** | — | **~51 KB** (0.8.x adiante) | Não² | Não² | Canvas+WASM | MIT | Ativa (LottieFiles) |
| **@lottiefiles/dotlottie-react** | 0.19.2 | **~51 KB** | Não² | Não² | Canvas+WASM | MIT | Ativa |
| **@rive-app/react-canvas** | 4.28 | **~3 KB** JS + **78 KB WASM** (lazy) | Não² | Não² | Canvas+WASM | MIT | Muito ativa (Rive Inc.) |
| **@rive-app/react-canvas-lite** | — | ~2 KB JS + 78 KB WASM (lazy) | Não² | Não² | Canvas+WASM | MIT | Muito ativa |
| **lenis** | 1.3.23 | **~4 KB** | Não² | Não² | DOM | MIT | Ativa (darkroom.engineering) |
| **theatre.js** (`@theatre/core`) | 0.7.x | **~20 KB** | Não² | Não² | DOM / Three.js | Apache 2.0 | Baixa (dev em repo privado para v1.0) |
| **three.js** | r175 | **~155 KB** | Não² | Não² | WebGL | MIT | Muito ativa |
| **@react-three/fiber** | 9.6.1 | +three.js + ~5 KB overhead | Não² | Não² | WebGL | MIT | Muito ativa (pmndrs) |
| **ogl** | 0.0.42 | **~8 KB** | Não² | Não² | WebGL | MIT | Moderada (oframe) |

> ¹ "Worker-safe" no sentido de SSR/edge: todas as libs de animação precisam de DOM/Canvas — devem sempre viver em Client Components (`"use client"`) e nunca ser importadas em RSC. A distinção real é: podem ser inicializadas em SSR sem crashar? A resposta é "com cuidado" para todas — usar `next/dynamic` + `ssr: false` quando necessário.  
> ² Precisa de `"use client"` — todas as libs de animação são client-only na prática.

---

## 3. GSAP — Mudança de Licença (Detalhe Importante)

A **Webflow adquiriu o GreenSock (GSAP) em outubro de 2024**. Em 2025:

- **Todos os plugins premium** (ScrollTrigger, SplitText, MorphSVG, Flip, Draggable, MotionPath, etc.) passaram a ser **gratuitos para uso comercial**.
- O repositório privado do Club GSAP foi deprecado em **junho de 2025** — tudo migrou para o pacote npm público `gsap`.
- **SplitText foi reescrito** do zero na v3.13: 50% menor, acessibilidade melhorada, 14 novas features.
- Licença: **MIT-like (Standard License expandida para comercial)**. Verificar `gsap.com/licensing` para edge cases (sub-licenciar em SaaS que *vende* o GSAP a terceiros ainda requer contato).

**Resumo: GSAP + ScrollTrigger + SplitText são gratuitos e livres para uso comercial desde 2025.**

---

## 4. Análise por Caso de Uso

### 4.1 Micro-interações (hover, focus, fade, slide)
**→ CSS Tailwind v4 + `transition` / `@keyframes`**

Custo: 0 KB. Exemplos: botões, cards, tooltips, badges entrando. Regra: se é previsível e não depende de estado React, é CSS.

### 4.2 Animações de entrada controladas por scroll (fade-in-view, parallax simples)
**→ CSS `animation-timeline: view()` (nativo) ou motion `useInView` + `m` com LazyMotion**

CSS scroll-driven tem suporte ~92% global em mai/2026 e custo zero. Para iOS Safari < 17.5 ou Firefox < 130, usar `motion/react` com LazyMotion (~4.6 KB) como progressive enhancement.

### 4.3 Transições de rota (page transitions, SPA navigation)
**→ View Transitions API nativa ou `motion/react` `AnimatePresence`**

View Transitions API Baseline 2025 — funciona nativamente no App Router do Next.js 16 com `next/navigation`. Para casos mais complexos (cross-fade de elementos específicos), `AnimatePresence` + LazyMotion é ~6 KB total.

### 4.4 Animações de entrada orquestradas, sequências, stagger (landing/hero)
**→ GSAP (26.7 KB) ou motion/react com LazyMotion (4.6–17 KB)**

GSAP é mais poderoso para sequências complexas + timeline + ScrollTrigger. `motion/react` é mais ergonômico no React. Para a landing isolada, GSAP via `next/dynamic` é a escolha mais poderosa sem custo na rota principal.

### 4.5 Smooth scroll (scroll suavizado no body)
**→ lenis (~4 KB)**

O `@studio-freight/lenis` foi renomeado para `lenis`. Integra limpo com GSAP ScrollTrigger. Para uso no app autenticado considerar se realmente necessário (CWV: não introduzir jank onde não existe).

### 4.6 Animações de lista / reordenação de DOM (add/remove items)
**→ @formkit/auto-animate (~3 KB gzip)**

Uma linha de código, zero configuração. Ideal para listas de apostas, fixtures cards. Atenção: manutenção lenta — testar antes de adotar.

### 4.7 Animações complexas baseadas em arquivo (design exportado do After Effects)
**→ @rive-app/react-canvas-lite (WASM 78 KB, lazy) ou dotLottie (~51 KB)**

Rive é mais performático (C++ WASM vs JSON runtime) e arquivos menores. dotLottie (formato `.lottie`) é mais fácil de obter de designers AE. Ambos **obrigatoriamente via `next/dynamic` + `ssr: false`** — WASM não carrega no Worker.

### 4.8 Animações 3D / WebGL na landing
**→ ogl (~8 KB) para efeitos pontuais, three.js + R3F para cenas completas**

ogl é ideal para um shader/plano de fundo animado sem arrastar 155 KB de three.js. R3F faz sentido se já há three.js no projeto.

### 4.9 Sequenciador visual / motion design ferramenta interna
**→ theatre.js**

Overkill para o Abissal. Manutenção preocupante (dev movida para repo privado desde 2025, sem ETA de v1.0 público). Não recomendar.

### 4.10 Física de molas / gestos (drag, fling)
**→ motion/react (`useSpring`, `useDragControls`) ou @react-spring/web**

react-spring (24.6 KB) tem física mais rica mas API mais verbosa. motion/react (`domMax` +25 KB) cobre a maioria dos casos com API declarativa mais limpa para React 19.

---

## 5. Recomendação de Stack

### 5.1 Landing pré-login (rota isolada `/`)

```
motion/react   (LazyMotion + domAnimation = ~4.6 + 15 = ~20 KB)
GSAP           (26.7 KB via next/dynamic — scroll sequences, SplitText hero text)
lenis          (~4 KB — smooth scroll body, opcional)
```

Carregamento: **`next/dynamic({ ssr: false })`** para tudo. O bundle da landing fica ~50 KB gzip adicional num chunk isolado — não contamina rotas autenticadas.

**Quando usar GSAP vs motion/react na landing:**
- GSAP + ScrollTrigger: timelines complexas, pinning de seções, scrub, SplitText em headings grandes.
- motion/react: componentes React animados com estado, AnimatePresence, hover que precisam de props declarativas.
- Os dois podem coexistir: GSAP para a timeline/scroll, motion para componentes interativos menores.

### 5.2 App autenticado (rotas `/fixtures`, `/banca`, `/calibracao`, etc.)

```
CSS nativo (Tailwind v4 + @keyframes)   → 0 KB  (preferência absoluta)
motion/react useAnimate mini            → 2.3 KB (transições de estado imperativas)
@formkit/auto-animate                   → ~3 KB  (listas dinâmicas, se manutenção OK)
lenis                                   → ~4 KB  (smooth scroll global, só se necessário)
```

**Teto total aceitável:** ~10 KB gzip para animações no app autenticado. Nada de GSAP, Lottie, Rive ou Three.js sem `next/dynamic` explícito e justificativa de produto.

### 5.3 Iconografia animada / ilustrações exportadas

- **Rive** (`.riv`): se tiver designer que usa Rive — performance superior, menor arquivo, WASM lazy.
- **dotLottie** (`.lottie`): se o designer exporta do AE — mais acessível de obter.
- Ambos: `next/dynamic({ ssr: false })` obrigatório, carregamento lazy por Intersection Observer.

### 5.4 Background 3D na landing (se houver)

- `ogl` (~8 KB): para um plano de fundo com shader simples, partículas ou gradiente animado.
- `three.js + R3F` (155 KB+): só se a landing evoluir para uma cena 3D real — `next/dynamic` + chunk separado.

---

## 6. O que NÃO usar no Abissal

| Lib | Motivo |
|---|---|
| `framer-motion` (nome antigo) | Renomeada para `motion` — migrar a import se aparecer |
| `lottie-web` (legado Airbnb) | Manutenção mínima, bundle ~60 KB, substituir por dotLottie ou Rive |
| `theatre.js` | Manutenção preocupante, overkill, baixo adoção (~434 downloads/semana) |
| `three.js` / `@react-three/fiber` no app | 155 KB+ fora de qualquer budget; só na landing via dynamic |
| `@react-spring/web` no app | 24.6 KB razoável mas sem vantagem vs motion/react mini (2.3 KB) para os casos do Abissal |

---

## 7. Decisão por Contexto — Resumo Visual

```
LANDING (chunk isolado, ~50 KB budget extra OK):
  ├── scroll sequences, hero text    → GSAP 3.15 (26.7 KB, MIT free, ScrollTrigger incluso)
  ├── componentes React animados     → motion/react LazyMotion (20 KB)
  ├── smooth scroll (opcional)       → lenis (4 KB)
  └── background 3D (se necessário)  → ogl (8 KB) ou three.js+R3F (155 KB, chunk dedicado)

APP AUTENTICADO (budget ~10 KB total):
  ├── hover, fade, slide, entrada    → CSS Tailwind v4 (0 KB)
  ├── transições de estado/rota      → View Transitions API nativa (0 KB)
  ├── animações imperativas pontuais → motion useAnimate mini (2.3 KB)
  └── listas dinâmicas               → @formkit/auto-animate (~3 KB, testar manutenção)

ASSETS ANIMADOS (sempre next/dynamic + ssr:false):
  ├── designer usa Rive              → @rive-app/react-canvas-lite (WASM 78 KB lazy)
  └── designer usa After Effects     → @lottiefiles/dotlottie-react (~51 KB lazy)
```

---

## 8. Referências

- [motion/react — Reduce Bundle Size](https://motion.dev/docs/react-reduce-bundle-size)
- [GSAP agora gratuito — Webflow Blog](https://webflow.com/blog/gsap-becomes-free)
- [GSAP 3.13 Release Notes](https://gsap.com/blog/3-13/)
- [Framer Motion vs GSAP Bundle Comparison (pkgpulse)](https://www.pkgpulse.com/compare/framer-motion-vs-gsap)
- [dotLottie bundle size issue #357](https://github.com/LottieFiles/dotlottie-web/issues/357)
- [Rive React Optimizations — Pixel Point](https://pixelpoint.io/blog/rive-react-optimizations/)
- [CSS Scroll-Driven Animations — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations)
- [View Transitions 2025 Update — Chrome Developers](https://developer.chrome.com/blog/view-transitions-in-2025)
- [ogl — Minimal WebGL Library](https://github.com/oframe/ogl)
- [lenis npm](https://www.npmjs.com/package/lenis)
- [bundlephobia: @react-spring/web](https://bundlephobia.com/package/@react-spring/web)
- [anime.js v4 docs](https://animejs.com/documentation/getting-started/installation/)
- [Theatre.js releases](https://www.theatrejs.com/docs/latest/releases)
- [Rive WASM + React Optimization](https://pixelpoint.io/blog/rive-react-optimizations/)
- [Codrops: GSAP SplitText + ScrollTrigger demos gratuitos](https://tympanus.net/codrops/2025/05/14/from-splittext-to-morphsvg-5-creative-demos-using-free-gsap-plugins/)

---

*Gerado em 2026-05-29. Re-executar pesquisa se houver mudança de major version em motion, GSAP ou Rive.*
