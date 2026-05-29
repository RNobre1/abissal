# Identidade visual do Abissal — spec de design (frente D)

> Status: **design aprovado** (decisões cravadas com o Pilot via preview `/brand`). Aguardando revisão do spec antes da implementação.
> Data: 2026-05-29 · Épico: marca/animação (frentes D/E/C/B) · Pesquisa de suporte: `docs/pesquisas/identidade-animacao/`

## 1. Objetivo

Dar ao Abissal uma identidade visual própria — logo (mark + wordmark), favicon e sistema de ícones — derivada da narrativa de marca, escalável de 16px (favicon) a hero, com uma versão **animada** que servirá de base para os loadings on-brand (frente C). Sem peso de runtime no app autenticado (animação 100% CSS).

## 2. Narrativa de marca (aprovada)

"Abissal" = zona abissal do oceano: escuridão total, pressão, e ainda assim **habitada** por vida que **gera a própria luz** (bioluminescência). Tese do produto: apostar é navegar no escuro; o Abissal gera o próprio sinal — análise, edge, disciplina — em vez de esperar sorte. O **farol vermelho** é essa luz própria. Amarra o Vermelho Garantido, o design system "Abismo Habitado" e a profundidade de dados.

## 3. Decisões de design (cravadas)

- **Conceito:** abismo + bioluminescência.
- **Forma do mark:** "estratos + farol" — camadas horizontais afunilando suave (descida ao abismo) + um ponto de luz vermelho ao fundo. Ecoa o `--texture-strata` do `body`.
- **Geometria (viewBox `0 0 100 100`):**
  - 4 estratos (`<line>`), centrados em `x=50`, de `y=26` a `y=68` (espaçamento uniforme).
  - Larguras (topo→fundo, linear): **64 → 34**. `x1 = 50 − w/2`, `x2 = 50 + w/2`.
  - Opacidade do traço (topo→fundo, linear): **0.95 → 0.34**. Cor `#f8f5ef` (ink-display).
  - `stroke-width = 3.2`, `stroke-linecap = round`.
  - Farol: `<circle cx=50 cy=80 r=4>` (12px abaixo do último estrato), `fill #d43535`.
- **Glow (G2):** `drop-shadow` em camadas, animado.
  - Base (estático/repouso): `drop-shadow(0 0 1.5px #d43535) drop-shadow(0 0 6px #d43535)`.
  - Pico (50% do pulso): `scale(1.2)` + `drop-shadow(0 0 3px #d43535) drop-shadow(0 0 13px #d43535) drop-shadow(0 0 24px rgba(196,43,43,.5))`.
  - Ritmo: `2.4s ease-in-out infinite` (delay inicial 1s).
- **Wordmark:** "abissal" em **Fraunces 300 lowercase**, tracking `−0.02em`; o **pingo do "i" é o farol** (`#d43535` com leve glow). No asset final vira **path SVG preciso** (hoje na preview é aproximação CSS com dotless-i + dot posicionado).
- **Cores:** void `#09090f`/`#111118`; ink `#f8f5ef`; vermelho `#c42b2b`/`#d43535`; azul-abismo `#1a5fad`/`#2272c8` (não usado no mark final, reservado).

## 4. Sistema de assets a produzir

| Asset | Formato | Como | Notas |
|---|---|---|---|
| `app/icon.svg` | SVG estático | à mão | favicon moderno; **dark/light** via `prefers-color-scheme` embutido (no claro, estratos escurecem; farol permanece vermelho). Sem animação (favicon estático — recomendação da pesquisa). |
| `app/apple-icon.png` | 180×180 PNG | `rsvg-convert` a partir de um SVG-fonte com fundo void | iOS. |
| `public/icons/icon-192.png` | 192×192 | `rsvg-convert` | **substitui** o "A" velho. |
| `public/icons/icon-512.png` | 512×512 | `rsvg-convert` | idem. |
| `public/icons/icon-512-maskable.png` | 512×512 | `rsvg-convert` | safe-zone (mark dentro de ~80% central). |
| `app/favicon.ico` | 32px ICO | `rsvg-convert` → `magick`/`convert` | legacy. |
| `components/brand/abissal-mark.tsx` | Componente React | à mão | mark reutilizável (props `size`, `animated`, `title`); animação CSS G2 com `prefers-reduced-motion`. **Base da frente C** (loading/header). |
| `components/brand/abissal-lockup.tsx` | Componente React | à mão | mark + wordmark Fraunces (pingo-farol). |

Rasterizador: **`rsvg-convert` já disponível** (`/usr/bin/rsvg-convert`) + ImageMagick (`magick`) pro `.ico`. Nenhuma instalação necessária.

## 5. Integração no app

- `app/layout.tsx`: o Next 16 detecta `app/icon.svg`/`app/apple-icon.png`/`app/favicon.ico` por convenção — remover o `icons.apple` manual do `metadata` se redundante; manter `theme-color`.
- `app/manifest.ts`: apontar para os PNGs novos (mesmos paths) — sem mudança de `start_url`/`scope` agora (a landing virá na frente E e reavaliará isso).
- **Não** trocar o logo dentro do app autenticado nesta frente (header/sidebar) — isso é enraizamento (frente C). Aqui entregamos só os ícones/favicon + os componentes reutilizáveis.

## 6. Plano de implementação (TDD onde aplicável)

1. **SVG-fonte do mark** (`docs/brand/abissal-mark.svg`) com a geometria §3 + glow estático — base pra rasterização.
2. **Componentes** `AbissalMark` + `AbissalLockup` (TDD: testes de render — renderiza `<svg role="img">`, respeita `size`, expõe `aria-label`; CSS de animação não é testado por unit, fica pro smoke visual).
3. **Rasterização** dos PNGs/ICO via `rsvg-convert`/`magick` (script `scripts/brand/build-icons.sh`, idempotente, documentado).
4. **`app/icon.svg`** (dark/light) + ajuste de `layout.tsx`/`manifest.ts`.
5. **Gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
6. **Smoke visual** (pós-deploy): favicon na aba + apple-icon (spot-check do Pilot, já que é visual).
7. **Limpeza:** remover a rota de preview `/brand` (e tirar `/brand` do `PUBLIC_PATHS`) — ou trancá-la atrás de flag; decidir com o Pilot.

## 7. Fora de escopo (specs próprios)

- **Frente E — landing pré-login** (nova `/` pública; animações ricas isoladas).
- **Frente C — enraizamento no app** (loading/skeleton com o mark animado, View Transitions, logo no header, microcopy).
- Animar o logo em Lottie/GIF (skill `wiggle`) — só se precisarmos de formatos fora do SVG/CSS.

## 8. Riscos / notas

- **Pingo do "i":** converter o wordmark em path exige a fonte Fraunces; alternativa é manter o dotless-i + dot como dois elementos SVG posicionados por métrica (testar em tamanhos). Decidir na implementação.
- **dark/light no favicon:** `prefers-color-scheme` dentro do SVG tem bom suporte (2026), mas Safari historicamente ignora em alguns contextos — fallback é o tema escuro (nosso default).
- **Rota `/brand`:** é preview descartável commitada na `main`; não esquecer de removê-la (item 6.7) pra não deixar página órfã em prod.
