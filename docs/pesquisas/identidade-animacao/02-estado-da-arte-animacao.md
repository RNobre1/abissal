# Estado-da-arte: Animação Web Premium com Custo Mínimo

**Contexto:** Abissal — Next.js 16 (App Router + RSC), React 19, Tailwind v4, TypeScript, Cloudflare Workers via OpenNext.
**Data:** 2026-05-29
**Tipo:** Pesquisa técnica (read-only). Decisões de implementação dependem de aprovação do Pilot.

---

## 1. O que faz um site "awwwards-grade" parecer premium

Sites premiados (Awwwards, Webflow Showcase, Locomotive demos, Bruno Simon) compartilham um conjunto de **10–12 efeitos** que criam a percepção de qualidade. A tabela abaixo mapeia cada efeito, a técnica cara (como a maioria implementa) e a **técnica barata equivalente** viável no nosso stack.

---

## 2. Tabela mestre: efeito × técnica × custo × suporte 2026

| # | Efeito premium | O que comunica | Técnica cara (tradicional) | Técnica barata equivalente | Custo JS (barata) | Suporte browser 2026 | Risco Worker 1101 |
|---|---|---|---|---|---|---|---|
| 1 | **Scroll choreography / reveal-on-scroll** | Profundidade, ritmo editorial | GSAP ScrollTrigger (27 KB core + plugin) | CSS `animation-timeline: view()` + `@keyframes` | 0 KB | ✅ Baseline 2026: Chrome 115+, Firefox (unflagged), **Safari 26** | Nenhum (CSS puro) |
| 2 | **Parallax multi-camada** | Ilusão de 3-D, peso | `background-position` em scroll event (JS) ou Lottie | CSS 3D: `perspective` no container + `translateZ` + `scale` nos filhos; ou scroll-driven `translateY` via `animation-timeline: scroll()` | 0 KB | ✅ Mesma baseline que #1 para scroll-driven; CSS 3D suportado há anos | Nenhum (CSS puro); evitar scroll listener JS |
| 3 | **Smooth scroll (momentum)** | Fluência de interface "premium" | Locomotive Scroll (15 KB) ou GSAP ScrollSmoother (depende de Club) | Lenis 3.x (~3 KB gzip); ou `scroll-behavior: smooth` nativo (sem momentum) | ~3 KB | ✅ Lenis funciona em todos; `scroll-behavior` nativo tem suporte universal mas sem física | Baixo (só recalcula rAF, sem payload pesado) |
| 4 | **Sticky pin / progress bar** | Narrativa sequencial, progresso | GSAP ScrollTrigger `pin:true` | CSS `position: sticky` + `animation-timeline: scroll()` para progresso | 0 KB | ✅ Baseline 2026 | Nenhum |
| 5 | **Text scramble / matrix reveal** | Tecnologia, dados, identidade digital | GSAP SplitText + scramble plugin (SplitText = plugin pago Club) | `Splitting.js` (1 KB) pra wrapping de chars + `@keyframes` com `animation-delay` stagger por `--i` CSS custom prop + `IntersectionObserver` para trigger | <2 KB | ✅ Universal (IO suportado desde 2018) | Baixo |
| 6 | **Split-text word/line reveal** (clip-path reveal) | Elegância editorial | GSAP SplitText + `clip-path` tween | `Splitting.js` + CSS `clip-path: inset(0 100% 0 0)` → `inset(0)` com stagger via `--i`; ou `animation-timeline: view()` com `animation-range` | <2 KB | ✅ `clip-path` em todos os browsers modernos | Nenhum |
| 7 | **Magnetic button / cursor attraction** | Interatividade premium, branding tátil | GSAP + cursor library (20–40 KB combinados) | Vanilla JS: `mousemove` → `getBoundingClientRect` → `transform: translate(x, y)` com `will-change: transform`; apenas transform/opacity, zero layout | <1 KB inline | ✅ Universal | Baixo (só em landing; jamais no app autenticado) |
| 8 | **Custom cursor** | Identidade de marca, imersão | Cursor.js, Magic Cursor, Motion+ Cursor (5–15 KB) | CSS `:root { cursor: none }` + `div` seguindo `mousemove` com `translate(x,y)` e `will-change: transform`; opcional blending com `mix-blend-mode: difference` | <1 KB inline | ✅ Universal | Baixo (apenas landing) |
| 9 | **Page/route transitions** | Continuidade narrativa entre rotas | Barba.js (25 KB) ou Framer Motion `AnimatePresence` (34 KB full) | **View Transitions API + React 19 `<ViewTransition>`** (0 KB extra, nativo). Ativar em `next.config.ts` com `experimental.viewTransition: true`. Morphing shared elements, directional slides, crossfades — tudo declarativo | 0 KB | ✅ Chrome/Edge/Safari 18+; Firefox 129+ unflagged esperado 2026. Fallback gracioso: sem suporte = sem animação, app funciona normalmente | Nenhum (renderizado no browser) |
| 10 | **WebGL hero / shader background** | "Wow factor" visual, bioluminescência | Three.js/R3F full (155 KB gzip Three.js sozinho; ~600 KB total com R3F) | **CSS `background: conic-gradient` + `@property` para interpolação suave de cores** + `filter: blur()` + `mix-blend-mode` para efeito bioluminescente; ou `<canvas>` 2D minimalista (<5 KB) com partículas via `OffscreenCanvas` + Worker | 0–5 KB | ✅ `@property` Chrome/Edge; Safari 15.4+; Firefox 128+. `conic-gradient` universal | **ALTO para Three.js/R3F** (155+ KB gzip estoura o budget 10 MB Worker facilmente; quebra o princípio bundle-apertado) |
| 11 | **Particle system / bioluminescence dots** | Atmosfera, profundidade, tema oceânico | tsParticles / Particles.js (30–80 KB) | CSS `radial-gradient` + `@keyframes` pulsando `opacity` e `scale` em elementos pseudo; ou `<canvas>` 2D puro com RAF e apenas `fillRect` circles (< 3 KB) | 0–3 KB | ✅ Universal | Baixo se CSS; Médio se canvas minimalista |
| 12 | **Marquee / infinite ticker** | Energia, movimento contínuo | GSAP `gsap.to` loop ou libs de marquee (5–15 KB) | CSS puro: `@keyframes marquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }` em container duplicado; zero JS | 0 KB | ✅ Universal | Nenhum |
| 13 | **Number ticker / counter** | Dashboard financeiro premium, impacto de dados | `countUp.js` (6 KB) ou GSAP tween | CSS `@property` (`syntax: "<integer>"`) + `counter-set` + `animation` de 0→N; ou digit-roller com `steps(10)` | 0 KB | ⚠️ `@property` + `counter-set`: Chrome/Edge. Firefox/Safari: fallback para JS `requestAnimationFrame` com `textContent` (< 1 KB) | Nenhum |
| 14 | **Loading skeleton / Suspense reveal** | Percepção de velocidade, polish | Framer Motion `AnimatePresence` (34 KB) | **React `<Suspense>` + `<ViewTransition exit="slide-down" enter="slide-up">`** (0 KB extra); CSS `@keyframes` para pulse/shimmer skeleton | 0 KB | ✅ View Transitions + React 19 | Nenhum |

---

## 3. Técnicas nativas de alto impacto (2026 — já são Baseline)

### CSS Scroll-Driven Animations (`animation-timeline`)
- **Status 2026:** Baseline recente. Chrome 115+, Firefox unflagged, **Safari 26 shiped** (Abril 2026). Sem polyfill necessário para fallback gracioso.
- **Como funciona:** `animation-timeline: scroll()` liga o progresso de animação ao scroll do documento; `animation-timeline: view()` liga à visibilidade do elemento na viewport — ambas rodam no **compositor thread**, paralelo ao main thread JS.
- **GPU-only seguro:** `transform`, `opacity`, `filter`. Não animar `width`, `height`, `margin`, `padding` — causam layout recalc a cada frame.
- **Receita básica:**

```css
/* Reveal ao entrar na viewport — zero JS */
@media (prefers-reduced-motion: no-preference) {
  .reveal {
    animation: fade-up linear both;
    animation-timeline: view();
    animation-range: entry 0% entry 40%;
  }

  @keyframes fade-up {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }
}
```

### CSS `@property` — animação de custom properties
- **Status 2026:** Chrome/Edge (desde 2021), Safari 15.4+, Firefox 128+. Suporte universal moderno.
- **Uso chave:** Animar gradientes, cores, counters numéricos, glows — coisas que CSS sem `@property` não interpola.

```css
@property --glow-opacity {
  syntax: "<number>";
  inherits: false;
  initial-value: 0;
}

.biolum {
  --glow-opacity: 0;
  box-shadow: 0 0 40px rgba(0,255,180, var(--glow-opacity));
  transition: --glow-opacity 0.6s ease;
}
.biolum:hover { --glow-opacity: 0.7; }
```

### View Transitions API + React 19 `<ViewTransition>`
- **Status 2026:** Chrome/Edge (2023), Safari 18+ (mesmo-doc), Firefox 129+ (esperado unflagged).
- **Integração Next.js 16:** Ativar em `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  experimental: { viewTransition: true },
}
```

- Importar `import { ViewTransition } from 'react'` — zero dependências extras.
- Padrões cobertos: shared element morph, Suspense reveal (skeleton → conteúdo), directional slides (nav-forward/nav-back), same-route crossfade.
- Fallback gracioso: sem suporte o app funciona normalmente, sem animação.

### `content-visibility: auto`
- **Status 2026:** Baseline (Setembro 2025 — todos os browsers). Redução de até 7× no rendering inicial de listas longas.
- Aplicar em seções abaixo do fold nas listas de fixtures:

```css
.fixture-card { content-visibility: auto; contain-intrinsic-size: 0 80px; }
```

### Web Animations API (WAAPI)
- Para animações imperativas JS (ex: magnetic button), preferir WAAPI nativa a libs:

```typescript
element.animate([
  { transform: 'translate(0,0)' },
  { transform: `translate(${dx}px,${dy}px)` }
], { duration: 300, fill: 'forwards', easing: 'cubic-bezier(0.2,1,0.4,1)' })
```

---

## 4. Quando CSS puro basta vs quando vale uma lib JS

| Cenário | Usar CSS puro / nativo | Usar lib JS (Motion/GSAP) |
|---|---|---|
| Hover states, focus rings, shimmer skeleton | ✅ CSS | — |
| Reveal-on-scroll simples (fade/slide) | ✅ `animation-timeline: view()` | — |
| Parallax suave (1–2 camadas) | ✅ CSS 3D perspective | — |
| Sticky progress bar | ✅ `animation-timeline: scroll()` | — |
| Marquee/ticker | ✅ CSS `@keyframes` | — |
| Route transitions (morph, slide, crossfade) | ✅ `<ViewTransition>` React 19 | — |
| Text scramble / split reveal (stagger complexo) | Splitting.js (1 KB) + CSS | — |
| Smooth scroll com momentum real | Lenis 3.x (~3 KB) | — |
| Magnetic button (cálculo de posição do cursor) | — | ✅ WAAPI nativa (< 1 KB inline) ou Motion `useAnimate` (2.3 KB) |
| Sequências complexas multi-step com timeline | — | ✅ GSAP core (27 KB) — apenas na landing isolada |
| WebGL shader hero | EVITAR no Worker | ✅ Apenas com `next/dynamic` + route isolada + canvas 2D minimalista |
| Number counter avançado cross-browser | — | ✅ rAF + `textContent` (< 1 KB inline) como fallback |

---

## 5. Recomendações por contexto

### Contexto A — Landing pré-login (`/` ou `/(marketing)/`)

A landing é uma **rota isolada** do route group do app autenticado. Pode ter um bundle dedicado sem contaminar o dashboard.

**Estratégia:**
1. Criar route group `(marketing)` com seu próprio `layout.tsx` (sem importar nenhum component do dashboard autenticado).
2. Usar `next/dynamic` com `ssr: false` apenas para os componentes com animação JS pesada (ex: canvas, Lenis).
3. Budget de animação JS para a landing: **máximo +30 KB gzip total de libs de animação**. Não há restrição de "Error 1101" para assets estáticos servidos pelo CDN do Cloudflare Pages — o limite de 3/10 MB é do **Worker** (o server-side bundle SSR). CSS e assets estáticos da landing não afetam o Worker.

**Paleta de efeitos recomendados para a landing (tema abismo/bioluminescência):**

- **Hero:** CSS `conic-gradient` animado via `@property` (brilho bioluminescente) + CSS `radial-gradient` pulsante. Custo: 0 KB.
- **Partículas oceânicas:** `<canvas>` 2D minimalista com `requestAnimationFrame` + `OffscreenCanvas` (Web Worker) para não bloquear main thread. < 3 KB inline.
- **Scroll reveal editorial:** `animation-timeline: view()` em todos os blocos de texto/cards.
- **Smooth scroll:** Lenis 3.x (~3 KB) para a landing inteira.
- **Títulos (Fraunces serif):** `clip-path: inset(0 100% 0 0)` reveal com `Splitting.js` (1 KB) pra stagger por palavra.
- **Magnetic CTA button:** WAAPI nativa (< 1 KB inline).
- **Route transition para `/login`:** `<ViewTransition>` crossfade.

**O que NÃO usar na landing:**
- Three.js / react-three-fiber (155+ KB gzip — viola budget e pode estoura o Worker SSR bundle).
- GSAP full suite (27 KB core + plugins) — se precisar de sequência, usar só o core com ScrollTrigger (adiciona ~10 KB) e apenas para um efeito específico, via `dynamic import`.
- Locomotive Scroll (15 KB) — Lenis é equivalente e mais leve.
- tsParticles (30–80 KB) — canvas manual é < 3 KB.

### Contexto B — App autenticado (dashboard financeiro)

**Princípio:** animação deve ter **peso zero**. O app autenticado já está sob pressão de bundle (DuckDB-WASM, recharts, lightweight-charts, TanStack Query).

**O que usar:**

| Elemento | Técnica |
|---|---|
| Loading states / skeletons | CSS `@keyframes` shimmer (`background-position` animado em linear-gradient) |
| Route transitions entre `/banca`, `/fixtures`, `/calibracao` | `<ViewTransition>` crossfade (0 KB extra) |
| Shared element entre fixture list → fixture detail | `<ViewTransition name={...}>` morph nativo |
| Número na dashboard (saldo, ROI) | CSS digit-roller com `steps()` ou rAF < 1 KB inline |
| Hover em cards/botões | `transition: transform 120ms ease` (CSS puro) |
| Feedback de ação (bet placed, alert) | CSS `@keyframes` fade-in (0 KB) |
| `content-visibility: auto` | Em listas de fixtures, histórico de bets, tabelas longas |
| INP (Interaction to Next Paint) | Usar `useTransition`/`useDeferredValue` do React 19 para marcar updates como não-urgentes |

**O que NÃO colocar no app autenticado:**
- Framer Motion / Motion full (34 KB) — viola o budget.
- GSAP — qualquer linha que importe GSAP no app autenticado.
- Smooth scroll lib (Lenis, etc.) — native scroll no dashboard.
- Custom cursor — fora de contexto em dashboard financeiro.
- Parallax — não tem narrativa de scroll no app; cria confusão em UI densa.
- `will-change: transform` espalhado sem critério — cada `will-change` cria uma nova GPU layer, pode consumir 100–200 MB extras em device fraco.

---

## 6. `prefers-reduced-motion` como cidadão de primeira classe

**Não é opcional — é WCAG 2.3.3 (AAA) e WCAG 2.2.2 (AA).**

### Padrão recomendado: "no-motion-first"

```css
/* Começa estático — anima só quando motion é aceito */
.reveal {
  opacity: 0;
  transform: translateY(24px);
}

@media (prefers-reduced-motion: no-preference) {
  .reveal {
    animation: fade-up 0.5s ease both;
    animation-timeline: view();
    animation-range: entry 0% entry 40%;
  }
}

/* Garante que o elemento aparece para quem prefere sem motion */
@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1; transform: none; }
}
```

### Para View Transitions (directional slides = risco vestibular):

```css
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(*),
  ::view-transition-new(*),
  ::view-transition-group(*) {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
  }
}
```

### Para libs JS (Motion, GSAP):

```typescript
// Motion (motion.dev)
import { useReducedMotion } from 'motion/react'

function AnimatedCard() {
  const prefersReducedMotion = useReducedMotion()
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      initial={{ opacity: prefersReducedMotion ? 1 : 0, y: prefersReducedMotion ? 0 : 24 }}
    />
  )
}
```

**Regra:** Crossfades e opacity transitions são baixo risco. Translações horizontais/verticais grandes e parallax são **alto risco vestibular** — sempre desativar em `prefers-reduced-motion: reduce`.

---

## 7. Checklist de performance: o que NUNCA fazer no Worker

O Cloudflare Worker (via OpenNext) tem limite de **3 MB (Free) / 10 MB (Paid)** para o bundle do Worker SSR. O Error 1101 pode ser bundle overflow, RAM overflow em runtime, ou JS exception não capturado.

### Nunca fazer:

- [ ] **Importar Three.js / react-three-fiber em qualquer Server Component ou Route Handler** — Three.js é ~155 KB gzip; R3F soma ~600 KB total. Mesmo com `next/dynamic`, se aparecer no bundle SSR do Worker, estoura.
- [ ] **Importar libs de animação JS em Server Components** — `motion/react`, GSAP, Framer Motion só fazem sentido em Client Components (`"use client"`). Nunca devem aparecer no bundle server-side.
- [ ] **Animar `width`, `height`, `margin`, `padding`, `top`, `left`** — trigam layout recalc a cada frame (Tier D/F). Sempre preferir `transform` e `opacity`.
- [ ] **Adicionar `will-change: transform` em muitos elementos simultaneamente** — cada elemento cria uma GPU layer. Em device com 2 GB RAM, 50+ layers simultâneos = crash.
- [ ] **Scroll listeners com `getBoundingClientRect()` inline (sem debounce/throttle)** — causa layout thrashing (Tier F). Usar `IntersectionObserver` ou `ResizeObserver`.
- [ ] **`document.querySelectorAll` massivo em animações** — O(n) sync no main thread. Preferir atributos `data-*` com `Splitting.js`.
- [ ] **Importar Lottie para animações decorativas** — arquivo JSON de Lottie + runtime (~40 KB) é excessivo. Preferir CSS ou SVG `<animateTransform>`.
- [ ] **Carregar `tsParticles` ou equivalente no bundle do Worker** — import direto de libs de partículas no SSR = bundle overflow imediato.
- [ ] **Usar `background-attachment: fixed` para parallax** — força repaint em CADA scroll event. Proibido.
- [ ] **Usar `setInterval` para animar** — vazamento de memória em Workers de longa vida. Sempre `cancelAnimationFrame` / `clearTimeout` no cleanup.
- [ ] **Importar GSAP no bundle compartilhado** — se GSAP for usado na landing, deve ficar em `next/dynamic({ ssr: false })` isolado naquela rota.

### Sempre fazer:

- [x] Animações CSS em propriedades compositor-safe: `transform`, `opacity`, `filter`.
- [x] `next/dynamic` com `ssr: false` para qualquer componente com lib de animação JS pesada.
- [x] Route group `(marketing)` isolado para a landing — zero vazamento de bundle pro app autenticado.
- [x] `content-visibility: auto` em listas longas (fixtures, bets history).
- [x] `prefers-reduced-motion` em toda animação, CSS e JS.
- [x] Medir payload real (chunk sizes via `find .next/static -name "*.js" -exec wc -c`) antes de declarar "não afeta bundle" (ver Lição B9 e B12 do CLAUDE.md).

---

## 8. Stack de animação recomendado por camada

```
┌─────────────────────────────────────────────────────────────────┐
│  Landing (rota isolada, bundle dedicado, lazy-loaded)           │
│                                                                  │
│  CSS scroll-driven animations      ← reveals, parallax, sticky  │
│  CSS @property + conic-gradient    ← bioluminescência hero       │
│  <ViewTransition> React 19         ← route transition pra login  │
│  Lenis 3.x (~3 KB, dynamic import) ← smooth scroll momentum     │
│  Splitting.js (1 KB)               ← split text stagger          │
│  WAAPI nativa (<1 KB inline)       ← magnetic button             │
│  <canvas> 2D manual (<3 KB inline) ← partículas oceânicas        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  App Autenticado (budget zero de libs extras)                    │
│                                                                  │
│  CSS transitions (transform/opacity) ← hover, focus, feedback   │
│  CSS @keyframes                      ← skeletons, toasts, badges │
│  <ViewTransition> React 19           ← route e shared element    │
│  animation-timeline: view()          ← nada por ora (app é denso)│
│  content-visibility: auto            ← listas de fixtures/bets   │
│  useTransition / useDeferredValue    ← INP: updates não-urgentes  │
│  rAF inline (<1 KB)                  ← number ticker no dashboard │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Fontes e referências

- [MDN: CSS Scroll-Driven Animations](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations) — referência canônica
- [WebKit Blog: Scroll-Driven Animations with just CSS (Safari 26)](https://webkit.org/blog/17101/a-guide-to-scroll-driven-animations-with-just-css/) — Safari 26 shiped
- [Chrome for Developers: Scroll Animation Performance Case Study](https://developer.chrome.com/blog/scroll-animation-performance-case-study) — CSS vs JS no compositor
- [Chrome for Developers: Performant Parallaxing](https://developer.chrome.com/blog/performant-parallaxing) — técnica CSS 3D perspective
- [motion.dev: Web Animation Performance Tier List](https://motion.dev/magazine/web-animation-performance-tier-list) — S/A/B/C/D/F tier por técnica
- [Next.js 16: View Transitions Guide](https://nextjs.org/docs/app/guides/view-transitions) — `<ViewTransition>`, morphing, Suspense reveals, directional nav
- [pkgpulse: Framer Motion vs GSAP bundle comparison 2026](https://www.pkgpulse.com/compare/framer-motion-vs-gsap) — ~34 KB vs ~27 KB gzip
- [WCAG 2.3.3: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) — referência WCAG
- [W3C: C39 — prefers-reduced-motion technique](https://www.w3.org/WAI/WCAG21/Techniques/css/C39)
- [OpenNext Cloudflare: Troubleshooting](https://opennext.js.org/cloudflare/troubleshooting) — Worker bundle limits
- [CSS-Tricks: Touring New CSS Features in Safari 26](https://css-tricks.com/touring-new-css-features-in-safari-26/)
- [LogRocket: Best React Animation Libraries 2026](https://blog.logrocket.com/best-react-animation-libraries/)
- [Darkroomengineering: Lenis](https://github.com/darkroomengineering/lenis) — smooth scroll 3 KB
