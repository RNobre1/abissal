# SVG Logo com Bioluminescência + Favicon Moderno — Pesquisa Técnica

**Projeto:** Abissal — Logo "estratos + farol"  
**Data:** 2026-05-29  
**Escopo:** Animação SVG, efeito glow barato, favicons Next.js 16 + CF Workers, SVGO, geometria do mark.

---

## 1. Animação SVG: CSS vs SMIL vs Web Animations API

### Comparação técnica

| Técnica | GPU-friendly | prefers-reduced-motion | Funciona em `<img>` / favicon | Controle JS | Recomendação 2026 |
|---|---|---|---|---|---|
| **CSS `@keyframes`** | Sim (`transform` + `opacity`) | Via `@media` inline no SVG | Não (inline HTML apenas) | Limitado | **Default — use sempre que possível** |
| **SMIL `<animate>`** | Não (layout-bound) | Não nativo | Sim | Não | OK para favicon animado e SVG como `<img>` |
| **Web Animations API (WAAPI)** | Sim (mesmo que CSS) | Via `matchMedia` em JS | Não | Total | Quando CSS não chega (sequence, reverse, etc.) |

### Regra central de performance

Animar `transform` e `opacity` é barato — o browser os despacha para a GPU (compositor layer). Animar `cx`, `cy`, `r`, `x`, `y`, `width`, `height` recalcula layout no SVG a cada frame — **evitar em animações contínuas**.

**Correção obrigatória para `transform-origin` em SVG:**
```css
.pulse-dot {
  transform-origin: center;
  transform-box: fill-box;   /* sem isso, origin é (0,0) do viewport */
}
```

### Padrão para o logo Abissal (página)

```css
/* Dentro do <style> do SVG inline ou em globals.css */

@keyframes abissal-pulse {
  0%   { transform: scale(1);   opacity: 1; }
  50%  { transform: scale(1.35); opacity: 0.7; }
  100% { transform: scale(1);   opacity: 1; }
}

@keyframes abissal-stratum-in {
  from { opacity: 0; transform: scaleX(0); }
  to   { opacity: 1; transform: scaleX(1); }
}

/* Ponto de luz — pulsa via transform+opacity (GPU) */
.abissal-beacon {
  transform-origin: center;
  transform-box: fill-box;
  animation: abissal-pulse 2.4s ease-in-out infinite;
}

/* Estratos surgem em cascata */
.abissal-stratum {
  transform-origin: left center;
  transform-box: fill-box;
  animation: abissal-stratum-in 0.5s ease-out forwards;
}
.abissal-stratum:nth-child(1) { animation-delay: 0s; }
.abissal-stratum:nth-child(2) { animation-delay: 0.08s; }
.abissal-stratum:nth-child(3) { animation-delay: 0.16s; }
.abissal-stratum:nth-child(4) { animation-delay: 0.24s; }
.abissal-stratum:nth-child(5) { animation-delay: 0.32s; }

/* WCAG 2.2 — OBRIGATÓRIO */
@media (prefers-reduced-motion: reduce) {
  .abissal-beacon,
  .abissal-stratum {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}
```

### Para favicon animado (SMIL — único que funciona em `<link rel="icon">`)

Browsers ignoram CSS animations em SVG servido via `<link rel="icon">`. SMIL (`<animate>`, `<animateTransform>`) é a única alternativa que funciona, mas:
- Chrome + Firefox: suportam SMIL em favicons.
- Safari: suporte inconsistente; o animated favicon não é recomendado para produção.
- **Recomendação:** favicon **estático** para produção; animação somente no logo inline na página e no loading state.

```xml
<!-- Beacon pulsando via SMIL (apenas para favicon experimental) -->
<circle cx="16" cy="16" r="3" fill="#c42b2b">
  <animate
    attributeName="r"
    values="2.5;4;2.5"
    dur="2.4s"
    repeatCount="indefinite"
    calcMode="spline"
    keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
  />
  <animate
    attributeName="opacity"
    values="1;0.6;1"
    dur="2.4s"
    repeatCount="indefinite"
  />
</circle>
```

---

## 2. Glow / Bioluminescência — Técnica mais barata

### Custo comparativo

| Técnica | GPU | Custo relativo | Usa no mark |
|---|---|---|---|
| `filter: drop-shadow()` CSS | Sim (compositing) | Baixo | Sim — **primária** |
| `box-shadow` CSS | Sim | Baixo | Não (só elementos com bounding box rectangular) |
| `radial-gradient` de fundo | Sim | Muito baixo | Sim — halos estáticos de atmosfera |
| SVG `feGaussianBlur + feMerge` | **Não** (rasterize frame-a-frame) | Alto se animado | Somente estático/hover |
| `feGaussianBlur` + `feColorMatrix` animados | Não | Muito alto | Evitar |

**Conclusão:** `filter: drop-shadow()` na camada CSS é hardware-accelerated e serve para o glow pulsante no ponto de luz. `feGaussianBlur` fica para efeito estático (sem animação) quando precisar de shape-following exato.

### Glow barato — camadas combinadas (recomendado para Abissal)

A estratégia é empilhar 3 camadas em CSS `drop-shadow` com raios e opacidades distintas, mais um halo radial de fundo — tudo no compositor, zero layout recalc:

```css
/* Ponto vermelho (#c42b2b) com bioluminescência */
.abissal-beacon-dot {
  /* 3 sombras difusas sobrepostas = profundidade de brilho */
  filter:
    drop-shadow(0 0 2px #d43535)
    drop-shadow(0 0 6px rgba(196,43,43,0.7))
    drop-shadow(0 0 14px rgba(196,43,43,0.3));
}

/* Anima só filter+opacity para manter na GPU */
@keyframes abissal-glow-pulse {
  0%   {
    filter:
      drop-shadow(0 0 2px #d43535)
      drop-shadow(0 0 6px rgba(196,43,43,0.7))
      drop-shadow(0 0 14px rgba(196,43,43,0.3));
    opacity: 1;
  }
  50%  {
    filter:
      drop-shadow(0 0 4px #d43535)
      drop-shadow(0 0 12px rgba(196,43,43,0.85))
      drop-shadow(0 0 24px rgba(196,43,43,0.45));
    opacity: 0.85;
  }
  100% {
    filter:
      drop-shadow(0 0 2px #d43535)
      drop-shadow(0 0 6px rgba(196,43,43,0.7))
      drop-shadow(0 0 14px rgba(196,43,43,0.3));
    opacity: 1;
  }
}

.abissal-beacon-dot {
  transform-box: fill-box;
  transform-origin: center;
  animation: abissal-glow-pulse 2.4s ease-in-out infinite;
}
```

> **Nota:** animação de `filter` ainda não é 100% compositor-only em todos os browsers (varia por implementação), mas é ordens de magnitude mais leve do que animar `feGaussianBlur.stdDeviation` a cada frame via JS. Se o Lighthouse detectar jank, fallback para animar apenas `opacity`.

### SVG filter estático para o favicon e versão reduzida

Para o SVG estático (sem animação — favicon, versão `<img>`), usar `feGaussianBlur` é seguro pois o custo é pago uma vez no rasterize:

```xml
<defs>
  <filter id="beacon-glow" x="-60%" y="-60%" width="220%" height="220%">
    <!-- Halo externo difuso -->
    <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur-outer"/>
    <!-- Halo interno mais vivo -->
    <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="blur-inner"/>
    <feMerge>
      <feMergeNode in="blur-outer"/>
      <feMergeNode in="blur-inner"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
</defs>

<circle cx="16" cy="28" r="2.5" fill="#c42b2b" filter="url(#beacon-glow)"/>
```

---

## 3. Estratégia de Favicon Moderna (Next.js 16 + CF Workers)

### Files necessários

Seguindo a recomendação atualizada do Evil Martians (2026):

```
app/
  favicon.ico           → 32×32, ICO, legacy fallback obrigatório
  icon.svg              → SVG com prefers-color-scheme embedded
  apple-icon.png        → 180×180 PNG
  icon-192.png          → 192×192 PNG (manifest Android)
  icon-512.png          → 512×512 PNG (splash Android)
  icon-mask.png         → 512×512, zona segura 409×409 (maskable)
  manifest.webmanifest  → PWA manifest
```

### SVG favicon com dark/light mode (inline CSS no SVG)

```xml
<!-- app/icon.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <style>
    .bg   { fill: #09090f; }
    .line { stroke: #e8e0d4; opacity: 0.6; }
    .dot  { fill: #c42b2b; }

    @media (prefers-color-scheme: light) {
      .bg   { fill: #f5f0eb; }
      .line { stroke: #2a2520; opacity: 0.5; }
      .dot  { fill: #c42b2b; }
    }
  </style>

  <!-- Fundo -->
  <rect class="bg" width="32" height="32" rx="4"/>

  <!-- Estratos: 5 linhas decrescentes, top → bottom, com gap crescente -->
  <line class="line" x1="5"  y1="8"  x2="27" y2="8"  stroke-width="1.5"/>
  <line class="line" x1="6"  y1="13" x2="26" y2="13" stroke-width="1.5"/>
  <line class="line" x1="8"  y1="18" x2="24" y2="18" stroke-width="1.5"/>
  <line class="line" x1="11" y1="22" x2="21" y2="22" stroke-width="1.5"/>
  <line class="line" x1="14" y1="25" x2="18" y2="25" stroke-width="1.5"/>

  <!-- Beacon: ponto de luz no "vórtice" abaixo dos estratos -->
  <circle class="dot" cx="16" cy="28" r="2.2"/>
</svg>
```

> **Safari caveat:** Safari não aplica `prefers-color-scheme` embedded em SVG favicon (mostra sempre o fallback light). Firefox e Chrome aplicam corretamente. Isso é aceitável — o ícone é legível em ambos os modos mesmo sem a troca.

### Next.js 16 — convenção de arquivos (App Router)

```
app/
  favicon.ico           → <link rel="icon" href="/favicon.ico" sizes="any">
  icon.svg              → <link rel="icon" href="/icon.svg" type="image/svg+xml">
  apple-icon.png        → <link rel="apple-touch-icon" href="/apple-icon.png">
```

Next.js gera os `<link>` automaticamente ao detectar esses arquivos. Não precisa de `app/icon.tsx` para o caso estático.

**Quando usar `app/icon.tsx` (ImageResponse):** somente se quiser gerar o PNG 32×32 programaticamente em build time (ex: com dados dinâmicos). Para o mark Abissal (estático), arquivo PNG é mais simples.

```tsx
// app/icon.tsx — exemplo para PNG gerado (opcional)
import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    <div style={{
      width: '100%', height: '100%',
      background: '#09090f',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: 4,
    }}>
      {/* Beacon simplificado */}
      <div style={{
        width: 6, height: 6, borderRadius: '50%',
        background: '#c42b2b',
        boxShadow: '0 0 4px #d43535, 0 0 8px rgba(196,43,43,0.6)',
      }}/>
    </div>,
    { ...size }
  )
}
```

> **Caveat CF Workers com `icon.tsx`:** o `ImageResponse` usa a Edge Runtime internamente. No deploy via `@opennextjs/cloudflare`, geração de ícone dinâmico pode exigir `export const runtime = 'edge'` ou usar arquivo estático como fallback. **Recomendação para Abissal: usar arquivos estáticos (PNG/SVG/ICO) em vez de `icon.tsx`** — zero risco de runtime mismatch no Worker.

### `<head>` completo recomendado (via `app/layout.tsx` metadata)

```tsx
// app/layout.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg',    type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180' }],
  },
  manifest: '/manifest.webmanifest',
  themeColor: [
    { media: '(prefers-color-scheme: dark)',  color: '#09090f' },
    { media: '(prefers-color-scheme: light)', color: '#f5f0eb' },
  ],
}
```

### `manifest.webmanifest`

```json
{
  "name": "Abissal",
  "short_name": "Abissal",
  "icons": [
    { "src": "/icon-192.png",  "sizes": "192x192",  "type": "image/png" },
    { "src": "/icon-512.png",  "sizes": "512x512",  "type": "image/png" },
    { "src": "/icon-mask.png", "sizes": "512x512",  "type": "image/png", "purpose": "maskable" }
  ],
  "theme_color": "#09090f",
  "background_color": "#09090f",
  "display": "standalone"
}
```

---

## 4. SVGO — Configuração recomendada

### svgo.config.mjs (raiz do projeto)

```js
// svgo.config.mjs
export default {
  multipass: true,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          // Manter viewBox — essencial para escalabilidade
          removeViewBox: false,

          // Não colapsar IDs — os IDs são referenciados por filter/animation
          cleanupIds: false,

          // Não remover estilos inline — animations e media queries vivem aqui
          inlineStyles: false,

          // Precisão de float: 2 casas é suficiente para ícones
          convertPathData: { floatPrecision: 2 },
          convertTransform: { floatPrecision: 2 },
        },
      },
    },
    // Remover metadata de editor (Illustrator, Inkscape, Figma)
    'removeEditorsNSData',
    'removeMetadata',
    // Manter title e desc para acessibilidade
    // (NÃO adicionar removeTitle ou removeDesc)
  ],
}
```

> **Plugins a NUNCA ativar em SVGs animados:**
> - `removeUnknownsAndDefaults` (pode remover atributos de animation)
> - `collapseGroups` (pode quebrar `transform-box: fill-box` em `<g>`)
> - `mergePaths` (destrói paths referenciados por animação)
> - `convertShapeToPath` (pode alterar IDs de filter targets)

### Resultado esperado

Um SVG de logo de ~4-8KB bruto → ~1-2KB após SVGO com `multipass: true` e `floatPrecision: 2`. Meta: manter abaixo de **4KB** para ser inlineado no HTML sem penalidade de payload.

### Integração no build (script npm)

```json
// package.json (scripts)
{
  "svg:optimize": "svgo --config svgo.config.mjs -f public/svgs/ --output public/svgs/",
  "svg:check": "svgo --config svgo.config.mjs --dry-run -f public/svgs/"
}
```

---

## 5. Inline vs `<img>` vs `next/image` — Decisão por contexto

| Uso | Método | Por quê |
|---|---|---|
| Logo no `<header>` (above fold, animado) | **Inline SVG** | CSS animation, styling, zero HTTP request |
| Logo em loading state (skeleton) | **Inline SVG** | Controle total de animation state |
| Logo em email / open graph | **PNG** exportado | Clientes de e-mail não suportam SVG |
| Logo em `<img>` sem animação | `<img src="logo.svg">` | Cache de arquivo, sem inflar o HTML |
| Logo hero grande (acima do fold) | **Inline SVG** | LCP benefit — sem round-trip HTTP |
| `next/image` para SVG | **Evitar** | `next/image` não aceita SVG por padrão sem config; nenhum benefício real sobre `<img>` para vetores |

**Regra Abissal:** logo animado no header → inline. Versão static no `<footer>` ou marketing → `<img src="/logo.svg">`.

```tsx
// components/logo/abissal-logo.tsx — exemplo inline
export function AbissalLogo({ animated = false }: { animated?: boolean }) {
  return (
    <svg
      viewBox="0 0 120 40"
      aria-label="Abissal"
      role="img"
      className={animated ? 'abissal-logo-animated' : ''}
    >
      {/* mark + wordmark aqui */}
    </svg>
  )
}
```

---

## 6. Geometria do Mark — Estratos + Farol

### Princípios de construção

**Referências de logos com "profundidade / camadas / ondas sonares":**

1. **Sonar Source** — círculos concêntricos centrados num ponto de radiação. Disponível em SVG via [Brandfetch](https://brandfetch.com/sonarsource.com). Mostra como espaçamento logarítmico cria profundidade de campo.
2. **Topografia / Contour lines** — linhas horizontais de comprimento decrescente que convergem para um ponto central abaixo. Geradores como [topography.blixthalka.com](https://topography.blixthalka.com/) e [illustrations.run/contour](https://illustrations.run/contour/) mostram a linguagem.
3. **Divisão do pingo do "i"** — usar o ponto do "i" em "abissal" como beacon é uma técnica de wordmark integrado. Referência clássica: logo iMac (ponto do "i" como dispositivo visual).
4. **Proporção áurea em ícones** — os círculos concêntricos do logo Apple, Pepsi e Twitter usam razões ≈ 1:1.618 entre raios adjacentes. Para as linhas dos estratos: comprimento[n] ≈ comprimento[n+1] × 1.618 cria ritmo visual natural.
5. **Beacon SVG CSS Animation** — [codepen.io/amiechen](https://codepen.io/amiechen/pen/vmKrKL) mostra beacon com ondas pulsantes em CSS puro (referência de animação).

### Construção geométrica para o mark (viewBox 32×32)

```
Estratos (5 linhas horizontais):
  Linha 1 (topo):    comprimento = W × 0.68  (68% da largura)
  Linha 2:           comprimento = W × 0.52
  Linha 3:           comprimento = W × 0.38
  Linha 4:           comprimento = W × 0.26
  Linha 5 (fundo):   comprimento = W × 0.14

  Espaçamento Y entre linhas: aumenta por razão 1.15 do topo pra baixo
  (cria sensação de afundamento / perspectiva)

Ponto de luz (beacon):
  cx = W/2 (centro horizontal)
  cy = Y_linha5 + gap × 1.8  (abaixo do último estrato)
  r  = ~8% de W (W=32 → r≈2.5px)

  O beacon fica no "vórtice" abaixo dos estratos, como se as camadas
  convergissem para um ponto de luz no fundo do abismo.
```

### Proporções numéricas para viewBox 32×32

```xml
<!-- Mark "estratos + farol" — proporções para 32px -->
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="32" height="32" rx="4" fill="#09090f"/>

  <!-- Estratos: 5 linhas, comprimentos em razão ~0.76 -->
  <!-- Y: 7, 11, 15, 19, 22 (gaps 4,4,4,3 → levemente comprimido ao fundo) -->
  <line x1="5"   y1="7"  x2="27"  y2="7"  stroke="#e8e0d4" stroke-width="1.4" opacity="0.7"/>
  <line x1="6.5" y1="11" x2="25.5" y2="11" stroke="#e8e0d4" stroke-width="1.4" opacity="0.6"/>
  <line x1="8.5" y1="15" x2="23.5" y2="15" stroke="#e8e0d4" stroke-width="1.4" opacity="0.5"/>
  <line x1="11"  y1="19" x2="21"  y2="19" stroke="#e8e0d4" stroke-width="1.4" opacity="0.4"/>
  <line x1="13"  y1="22" x2="19"  y2="22" stroke="#e8e0d4" stroke-width="1.4" opacity="0.3"/>

  <!-- Beacon -->
  <circle cx="16" cy="27" r="2.4" fill="#c42b2b"/>
</svg>
```

### Proporções para hero grande (viewBox 0 0 48 48, versão com glow)

```xml
<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect width="48" height="48" rx="6" fill="#09090f"/>

  <!-- Estratos -->
  <line x1="6"   y1="10" x2="42" y2="10" stroke="#e8e0d4" stroke-width="1.6" opacity="0.7"/>
  <line x1="8"   y1="16" x2="40" y2="16" stroke="#e8e0d4" stroke-width="1.6" opacity="0.6"/>
  <line x1="11"  y1="22" x2="37" y2="22" stroke="#e8e0d4" stroke-width="1.6" opacity="0.5"/>
  <line x1="15"  y1="27" x2="33" y2="27" stroke="#e8e0d4" stroke-width="1.6" opacity="0.4"/>
  <line x1="19"  y1="31" x2="29" y2="31" stroke="#e8e0d4" stroke-width="1.6" opacity="0.3"/>

  <!-- Beacon com glow estático (filter OK aqui — sem animação) -->
  <circle cx="24" cy="40" r="3.5" fill="#c42b2b" filter="url(#glow)"/>
</svg>
```

---

## 7. SVG Completo — Logo Mark Animado (para uso inline)

```xml
<!-- Uso: inline em React/Next.js como JSX -->
<!-- animated prop controla se a animação está ativa -->
<svg
  viewBox="0 0 48 48"
  xmlns="http://www.w3.org/2000/svg"
  aria-label="Abissal"
  role="img"
>
  <style>{`
    .abissal-line {
      transform-box: fill-box;
      transform-origin: left center;
    }
    .abissal-beacon {
      transform-box: fill-box;
      transform-origin: center;
    }

    @keyframes abissal-stratum {
      from { transform: scaleX(0); opacity: 0; }
      to   { transform: scaleX(1); opacity: var(--op); }
    }
    @keyframes abissal-glow-pulse {
      0%   { transform: scale(1);    opacity: 1; }
      50%  { transform: scale(1.4);  opacity: 0.75; }
      100% { transform: scale(1),    opacity: 1; }
    }

    .abissal-line-1 { --op: 0.7; animation: abissal-stratum 0.4s 0.0s ease-out forwards; opacity: 0; }
    .abissal-line-2 { --op: 0.6; animation: abissal-stratum 0.4s 0.08s ease-out forwards; opacity: 0; }
    .abissal-line-3 { --op: 0.5; animation: abissal-stratum 0.4s 0.16s ease-out forwards; opacity: 0; }
    .abissal-line-4 { --op: 0.4; animation: abissal-stratum 0.4s 0.24s ease-out forwards; opacity: 0; }
    .abissal-line-5 { --op: 0.3; animation: abissal-stratum 0.4s 0.32s ease-out forwards; opacity: 0; }

    .abissal-beacon {
      animation: abissal-glow-pulse 2.4s 0.5s ease-in-out infinite;
      filter:
        drop-shadow(0 0 2px #d43535)
        drop-shadow(0 0 6px rgba(196,43,43,0.7))
        drop-shadow(0 0 14px rgba(196,43,43,0.3));
    }

    @media (prefers-reduced-motion: reduce) {
      .abissal-line-1, .abissal-line-2, .abissal-line-3,
      .abissal-line-4, .abissal-line-5 {
        animation: none !important;
        opacity: var(--op) !important;
        transform: none !important;
      }
      .abissal-beacon {
        animation: none !important;
        transform: none !important;
      }
    }
  `}</style>

  <rect width="48" height="48" rx="6" fill="#09090f"/>

  <line class="abissal-line abissal-line-1" x1="6"  y1="10" x2="42" y2="10" stroke="#e8e0d4" stroke-width="1.6"/>
  <line class="abissal-line abissal-line-2" x1="8"  y1="16" x2="40" y2="16" stroke="#e8e0d4" stroke-width="1.6"/>
  <line class="abissal-line abissal-line-3" x1="11" y1="22" x2="37" y2="22" stroke="#e8e0d4" stroke-width="1.6"/>
  <line class="abissal-line abissal-line-4" x1="15" y1="27" x2="33" y2="27" stroke="#e8e0d4" stroke-width="1.6"/>
  <line class="abissal-line abissal-line-5" x1="19" y1="31" x2="29" y2="31" stroke="#e8e0d4" stroke-width="1.6"/>

  <circle class="abissal-beacon" cx="24" cy="40" r="3.5" fill="#c42b2b"/>
</svg>
```

---

## 8. Checklist de implementação

- [ ] Criar `app/favicon.ico` (32×32, exportado do Figma/Inkscape)
- [ ] Criar `app/icon.svg` com dark/light mode via `prefers-color-scheme` inline
- [ ] Criar `app/apple-icon.png` (180×180)
- [ ] Criar `app/icon-192.png` e `app/icon-512.png`
- [ ] Criar `app/icon-mask.png` (maskable, zona segura 409×409)
- [ ] Criar `public/manifest.webmanifest`
- [ ] Adicionar `icons`, `manifest`, `themeColor` ao `metadata` em `app/layout.tsx`
- [ ] Otimizar todos os SVGs com SVGO (`svgo.config.mjs` com `cleanupIds: false`)
- [ ] Verificar que `prefers-reduced-motion` está nos `@keyframes` do logo inline
- [ ] Smoke visual: testar favicon em Chrome (dark + light), Firefox, Safari
- [ ] Smoke animação: validar que pulse para em `prefers-reduced-motion: reduce`

---

## Referências

- [How to Animate SVG — svg.dog](https://svg.dog/learn/how-to-animate-svg/)
- [SVG Browser Compatibility 2026 — SVG AI](https://www.svgai.org/blog/svg-browser-compatibility-2026)
- [SVG SMIL animation — Can I Use](https://caniuse.com/svg-smil)
- [SVG Favicons — Can I Use](https://caniuse.com/link-icon-svg)
- [How to Favicon in 2026 — Evil Martians](https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs)
- [SVG Favicons & prefers-color-scheme — CSS-Tricks](https://css-tricks.com/svg-favicons-and-all-the-fun-things-we-can-do-with-them/)
- [Dark Mode SVG Favicon — Owen Conti](https://owenconti.com/posts/supporting-dark-mode-with-svg-favicons)
- [Animated SVG Favicon com CSS — Natclark](https://natclark.com/tutorials/css-animated-favicon/)
- [SVG Optimization 2026 — VectoSolve](https://vectosolve.com/blog/svg-optimization-web-performance-2025)
- [SVGO GitHub](https://github.com/svg/svgo)
- [filter: drop-shadow vs feGaussianBlur — LogRocket](https://blog.logrocket.com/complete-guide-using-css-filters-svgs/)
- [Creating animated SVG Neon Light — 9elements](https://9elements.com/blog/creating-an-animated-svg-neon-light-effect/)
- [SVG Glow interactive — w3tutorials](https://www.w3tutorials.net/blog/is-it-possible-to-create-a-glow-effect-in-svg/)
- [prefers-reduced-motion — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
- [Sonar Brand SVG — Brandfetch](https://brandfetch.com/sonarsource.com)
- [Topography SVG Generator](https://topography.blixthalka.com/)
- [Contour lines generator](https://illustrations.run/contour/)
- [Next.js App Icons docs](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons)
- [Next.js Favicon Guide 2026 — Braydon Coyer](https://www.braydoncoyer.dev/blog/the-only-nextjs-favicon-guide-youll-need)
- [Minimalist SVG Logo Design — SVG AI](https://www.svgai.org/blog/minimalist-svg-logo-design)
- [SVG Coding Examples — Smashing Magazine 2024](https://www.smashingmagazine.com/2024/09/svg-coding-examples-recipes-writing-vectors-by-hand/)
