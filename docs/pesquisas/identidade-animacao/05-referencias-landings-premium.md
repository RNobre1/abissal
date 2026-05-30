# Dossiê: Referências de Landings Premium Animadas

> Contexto: alimentar personas de design para avaliar a landing "poema vertical" do Abissal — tema abismo oceânico/bioluminescência, fundo WebGL (shader caustics + farol vermelho), partículas canvas 2D, 6 cenas scroll-driven (CSS `animation-timeline`), tipografia Fraunces, Cloudflare Worker (orçamento de animação ≤30 KB).

---

## 1. Critérios Oficiais do Awwwards

| Critério | Peso | O que avalia |
|---|---|---|
| **Design** | 40% | Composição, uso de cor e tipografia, hierarquia visual, coesão estética — se parece um produto finito e intencional, não um experimento |
| **Usability** | 30% | Navegabilidade, clareza de UI, velocidade de carga, responsividade, a11y — usuário encontra o que precisa sem friction |
| **Creativity** | 20% | Inovação conceitual e técnica, se vai além dos padrões vigentes, ousadia editorial e de interação |
| **Content** | 10% | Qualidade e relevância do conteúdo, copywriting, coerência da mensagem com o design |

**O que separa um SOTY de um SOTD comum:**

- **Sem falha nos quatro critérios ao mesmo tempo.** A maioria das sites perdem pontos em Usability (jank, carregamento, mobile) ou Content (copy genérico). SOTY tem 9/10+ nos quatro.
- **Conceito + execução inseparáveis.** A ideia e a implementação técnica são a mesma coisa — a "ideia" não seria possível em outro meio.
- **Atenção ao detalhe em micro-interactions.** Jury nota o que acontece nos estados hover/focus/transition/error, não só o scroll principal.
- **Funciona em mobile com excelência,** não apenas "não quebra". Mobile Excellence Award é separado por uma razão.
- **Jury vote de consenso.** Os 3 votos mais extremos são descartados automaticamente. Sites controversos (adorados por uns, odiados por outros) raramente ganham SOTY.

---

## 2. Referências: 10 Sites Premium

### 2.1 Lusion — `lusion.co`

**URL:** https://lusion.co  
**Prêmios:** Awwwards SOTM Maio 2023 · The One Show Silver Pencil 2024 (UX/UI, Websites, Visual Craft)

**O que a torna excepcional:**
Portfólio construído como demonstração de capacidade real-time. Em vez de vídeo pré-renderizado, tudo roda em Three.js com animações de vértice geradas em Houdini FX e exportadas como vertex animation textures (16-bit integer com divisor — de 1.9 MB para 246 KB no mobile). Cloth simulation ao vivo, generative animations, e um modelo Beethoven translúcido com dois estados dinâmicos via matcap + normal/AO/thickness pré-renderizados. O scroll ativa revelações de projeto com transições WebGL.

**Técnicas-chave:** Three.js, Houdini FX, vertex animation textures, matcap shading, scroll-triggered WebGL transitions, generative cloth sim.

**Lição roubável para o Abissal:** vertex animation textures como substituto de física em tempo real — excelente para a camada de bioluminescência. Armazenar animações de partículas como VAT em vez de calcular em JS a cada frame reduz bundle e CPU. A otimização 16-bit → arquivos minúsculos é diretamente aplicável ao orçamento do Worker.

---

### 2.2 Igloo Inc — `igloo.inc`

**URL:** https://www.igloo.inc  
**Prêmios:** Awwwards SOTY 2024 (vencedor) · SOTM Julho 2024 · Developer Award

**O que a torna excepcional:**
Void matte-preto cortado por gelo iridescente. O scroll rotaciona um shard de gelo WebGL com reflexos HDRI; gradientes árticos mantêm a paleta fria mas legível. Construído por **abeto studio** com Three.js, three-mesh-bhv (BVH acelerado), Svelte, GSAP e vanilla JS. A combinação de "experiência 3D totalmente imersiva + navegação por scroll fácil" foi o principal argumento do júri. Animações "infinite scroll" como categoria vencedora mostram a relevância do scroll-storytelling contínuo.

**Técnicas-chave:** Three.js + BVH raycast, HDRI reflections, aurora flare hover, GSAP scroll integration, Svelte reativo.

**Lição roubável para o Abissal:** O padrão "void escuro + objeto luminoso como âncora" é essencialmente idêntico ao "abismo + farol vermelho pulsante". A resolução do Igloo é manter 60fps mesmo com reflections HDRI usando BVH (bounding volume hierarchy) para raycasting eficiente. Para o Abissal: o farol pode usar uma técnica similar de light cone calculado no shader sem raycasting completo.

---

### 2.3 Active Theory — Prometheus Fuels

**URL:** https://www.prometheusbrands.com (2021, Active Theory)  
**Prêmios:** Awwwards SOTM Maio 2021 · CSS Design Awards

**O que a torna excepcional:**
Scroll-storytelling dividido em dois capítulos — câmera em terceira pessoa seguindo um carro pelos capítulos "Birth of a New Era" e "World of Possibilities". Blenda elementos fotográficos e ilustrativos em meshes 3D (estética colagem retrofuturista inspirada em Frank Moth). Técnica de ping-pong rendering: durante transições onde duas cenas são visíveis, o sistema alterna qual cena renderiza por frame — mantém 60fps mesmo em dispositivos medianos. Frame rate diferenciado: efeitos de suporte rodam a 12fps (aspecto "desenhado à mão") enquanto a câmera principal mantém 60fps.

**Técnicas-chave:** WebGL ping-pong rendering, câmera scriptada por artistas (parâmetros in-browser), frame-rate diferenciado por camada, screen-space noise + step functions para bordas orgânicas de textura.

**Lição roubável para o Abissal:** frame-rate diferenciado por camada é perfeito para o Abissal — o shader de caustics roda a 30fps, as partículas de bioluminescência a 24fps, o farol pulsa em 60fps. Diferença imperceptível para o usuário, ganho real de GPU. O screen-space noise blended com step functions é exatamente a técnica para grain orgânico nas transições de cena.

---

### 2.4 Immersive Garden — `immersive-g.com`

**URL:** https://immersive-g.com  
**Prêmios:** Awwwards SOTM Fevereiro 2025 · Agency of the Year 2025 · SOTD para múltiplos projetos (Hatom, Montfort)

**O que a torna excepcional:**
Estúdio parisiense que constrói o próprio portfólio como showcase técnico ao extremo. Filosofia explícita de "remover mais do que adicionar" — elementos bas-relief 3D (tácteis, naturais), numeração romana 3D como waypoints de navegação, e a seção "Backstage" que expõe o processo técnico (otimizações KTX, channel packing, pipelines Blender + JS). Asset pipeline: KTX compression server-side, gltf-transform automation, exports combinando JS scripting com Blender scripting.

**Técnicas-chave:** Three.js + Nuxt + GSAP + Lenis, bas-relief 3D, KTX texture compression, Houdini/ZBrush/Blender para assets, channel packing, gltf-transform automation.

**Lição roubável para o Abissal:** KTX2 para texturas do shader de caustics — pode reduzir o .ktx de profundidade oceânica em 5-10x vs PNG. O "Backstage" é uma ideia editorial potente: o Abissal poderia ter uma seção scrollable de créditos técnicos (shader source, libs usadas), reforçando autenticidade de projeto pessoal sem diluir o poema.

---

### 2.5 Obys Agency — `obys.agency`

**URL:** https://obys.agency  
**Prêmios:** Awwwards Studio of the Year 2023 · CSS Design Awards Studio of the Year (4x) · Red Dot Best of the Best

**O que a torna excepcional:**
A transição narrativa é o design: o site registra a passagem do antigo para o novo Obys, de dark para light, como uma "entrada para uma nova era". Tipografia como protagonista (OTF Obys NG, neo-grotesque customizado). Todas as interações — virtual scroll, SPA routing, page transitions, hover effects — em TypeScript puro sem frameworks de animação pesados. Kinetic typography + revelações de texto em scroll + transições de página sem flash.

**Técnicas-chave:** TypeScript SPA, custom virtual scroll, kinetic typography, dark-to-light narrative transition, page transitions sem re-render full.

**Lição roubável para o Abissal:** a transição dark-to-light como metáfora narrativa é inversamente útil — o Abissal vai de surface (luminoso?) para abismo (void). As revelações de texto cinético em scroll do Obys são implementadas em TypeScript puro, sem GSAP, o que é relevante dado o orçamento ≤30 KB do Worker.

---

### 2.6 Lusion v3 — variante do portfólio

**URL:** https://www.awwwards.com/sites/lusion-v3  
**Nota:** versão distinta do portfólio citado em 2.1; SOTD separado

**Destaque técnico:** scroll navigation com WebGL — as thumbnails de projeto são pintadas em canvas WebGL e respondem ao scroll com distorção de shader; a navegação lateral usa spring physics puro em JS sem lib. Demonstra que custom easing sem dependência é exequível em menos de 10 KB.

**Lição roubável para o Abissal:** spring physics em JS raw para a inércia do scroll (alternativa ao Lenis no orçamento do Worker). Distorção de shader nas imagens durante o scroll pode ser aplicada nos blocos de texto das 6 cenas — texto aparece "emergindo da água" via deslocamento UV.

---

### 2.7 Resn — `resn.co.nz`

**URL:** https://resn.co.nz  
**Prêmios:** Awwwards Agency of the Year (2x) · FWA Hall of Fame · CSS Design Awards Agency of the Year · The One Show

**O que a torna excepcional:**
O "Resn Gem" — diamante interativo no centro da tela que, ao ser pressionado, implode em um "design haven" 3D com UI e UX em camadas. Background animado com dark reds e logo aquamarina. Easter eggs e experimentos WebGL espalhados. O diferencial é "sem nenhum padrão reconhecível" — a UI não segue nenhum template e cada visita tem micro-surpresas. Mobile sem sacrifício da experiência.

**Técnicas-chave:** WebGL gem simulation, dark reds + aquamarine accent palette, easter eggs como layer de descoberta, mobile-first responsivo.

**Lição roubável para o Abissal:** o modelo "objeto central interativo que esconde um mundo interno" é o equivalente do farol pulsante como ponto de entrada. A paleta crimson + acento frio do Resn é quase idêntica à do Abissal (vermelho #d43535 + void + azul-abismo). Pesquisar easter eggs no scroll do Abissal: cena secreta que só aparece se o usuário parar de scrollar por 5 segundos.

---

### 2.8 Prometheus / Active Theory — Active Theory V6

**URL:** https://www.awwwards.com/sites/active-theory-v6  
**Nota:** versão mais recente do portfólio do estúdio (SOTD)

**Destaque:** particle systems reativos ao cursor com spatial hashing para colisão eficiente; custom Hydra framework (proprietário) que divide o pipeline em graph nodes, permitindo compositing por camadas independentes na GPU. AI-powered navigation como conceito.

**Lição roubável para o Abissal:** spatial hashing para as partículas bioluminescentes — evita O(n²) de verificação de proximidade. Para 200-500 partículas, um grid de células de 50px já elimina a maior parte dos checks.

---

### 2.9 LVCIDIA — `lvcidia.com`

**URL:** https://lvcidia.com  
**Prêmios:** Awwwards SOTD, múltiplos reconhecimentos

**O que a torna excepcional:**
Plataforma de arte web3 com navegação inusual — o espaço é percorrido como um ambiente 3D, não como uma página linear. "Dreamlike experiences" com WebGL de baixo nível. Dark com acentos de bioluminescência (glows cian/violeta). Custom cursor como extensão do ambiente (o cursor carrega uma aura luminosa que ilumina o fundo ao passar).

**Técnicas-chave:** WebGL ambiente navegável, custom cursor com aura bioluminescente, navegação não-linear, glows por shader.

**Lição roubável para o Abissal:** o cursor com aura luminosa que "ilumina" o fundo é uma das técnicas mais ressonantes para um tema de bioluminescência. Implementável em canvas 2D overlay com radial gradient no mouse position — zero WebGL, ≈200 bytes de JS, comportamento imersivo altíssimo.

---

### 2.10 Igloo Inc / abeto Studio — Case Study (técnico)

**URL:** https://www.awwwards.com/igloo-inc-case-study.html  
**Nota:** aprofundamento técnico do SOTY 2024 (entrada 2.2)

**Destaque técnico adicional:** three-mesh-bhv (BVH acelerado) para raycasting do shard de gelo evita dropped frames em hover. O WebGL é inicializado *após* o LCP (Largest Contentful Paint) — o conteúdo textual carrega primeiro, o 3D complementa. Hero canvas ocupa 100vw × 100vh sem bloquear o thread principal (Web Worker para geometria).

**Lição roubável para o Abissal:** inicializar o shader WebGL após o LCP é uma regra de ouro para Worker/CF. O hero textual (wordmark Fraunces + primeira estrofe do poema) deve renderizar como HTML puro enquanto o WebGL carrega em background. Isso protege o Core Web Vitals e evita flash em conexões lentas.

---

## 3. Técnicas Recorrentes em Landings Dark/Profundidade/Oceano/Scroll-Telling

| Técnica | Descrição | Cabe no Abissal (≤30KB CF Worker)? |
|---|---|---|
| **Depth layers / parallax Z** | Múltiplos planos com velocidades distintas de scroll, criando sensação de profundidade. Implementação CSS `transform: translateZ` + `perspective` ou WebGL múltiplos planos. | ✅ CSS puro — zero custo de bundle |
| **Shader caustics / profundidade oceânica** | Fragment shader que simula luz refratada através de água em movimento. Normalmente ~5-15 KB de GLSL raw (sem lib). | ✅ Se escrito em raw GLSL; ❌ se via Babylon.js/Three.js inteiro |
| **Grain / noise overlay** | Texture de ruído filmico (`filter: url(#grain)` SVG ou canvas noise) sobreposta a toda a página. Cria materialidade, esconde artefatos de compressão. | ✅ SVG feTurbulence é zero-bundle; canvas noise ≈ 200 bytes |
| **Custom cursor** | Cursor substituto em canvas ou div que pode reagir ao conteúdo (aura luminosa, shape-shift em hover). | ✅ ≈500 bytes JS; mas ⚠ desabilitar em touch devices |
| **Smooth scroll (inércia)** | Lenis (~7 KB gzip) ou spring physics raw. Cria sensação de flutuação. Lenis é a escolha padrão do ecossistema 2024-2025. | ✅ Lenis ≈7 KB; raw spring ≈500 bytes. Cabe no orçamento |
| **Split text reveals (Splitting.js ou CSS)** | Texto dividido em spans por letra/palavra, revelado via CSS `animation-timeline` ou GSAP. Cada palavra/letra como elemento independente. | ✅ CSS `animation-timeline` é zero-bundle; Splitting.js ≈2 KB |
| **Scroll-driven (CSS `animation-timeline`)** | `scroll()` e `view()` timelines nativas — zero JS, off-main-thread em Chrome. Safari sem suporte nativo (precisa polyfill ≈8 KB ou degradar graciosamente). | ✅ Zero bundle em Chrome/FF; ⚠ Safari polyfill necessário |
| **Page/loader transitions** | Overlay que sai antes do primeiro conteúdo aparecer. Cria suspense, esconde LCP. | ✅ CSS + mínimo JS; mas ⚠ pode inflar TTFB percebido |
| **Vertex Animation Textures (VAT)** | Animar meshes 3D via textura PNG pré-baked em vez de cálculo runtime. Drástica redução de CPU. | ✅ Para partículas 3D: sim. Mas exige pipeline Houdini/Blender — não é live dev |
| **Spring physics para scroll** | Easing com `velocity` e `damping` (ao invés de `ease-out` fixo). Sensação de peso e inércia orgânica. | ✅ ≈200 bytes raw; ou via Lenis |
| **Spatial hashing para partículas** | Divide espaço 2D em células para evitar O(n²) em N partículas. Necessário para N > 300. | ✅ ≈500 bytes JS; obrigatório se partículas > 300 |
| **Sound design** | Áudio ambiente (profundidade oceânica), clicks discretos, hover tones. Cria presença. | ⚠ Autoplay proibido por browsers modernos; gate de user gesture obrigatório. Pode ser feature de toggle, não default |
| **Color grading / duotone** | Overlays de cor (geralmente via CSS `mix-blend-mode: color`), grading do vídeo/shader pós-processado. | ✅ CSS blend modes zero-bundle; WebGL post-processing via custom shader ≈2 KB |
| **Baked lighting / matcap** | Iluminação pré-calculada como textura aplicada ao mesh (matcap). Resultado premium sem custo de iluminação dinâmica. | ✅ Uma matcap PNG ~20-50 KB + sampling no shader ≈1 KB |
| **Three.js / WebGL completo** | Framework 3D completo. | ❌ Three.js ≈600 KB minificado. Fora do orçamento. Alternativa: raw WebGL2 + glMatrix (~50 KB) ou shader standalone (<30 KB) |
| **GSAP (completo)** | Library de animação. Core ~30 KB, ScrollTrigger plugin +15 KB. | ⚠ Borderline. GSAP core + ScrollTrigger ≈45 KB gzip. Acima do orçamento. Alternativa: CSS `animation-timeline` nativo |
| **Lottie** | JSON animations player (~40 KB). | ❌ Fora do orçamento se já há WebGL |
| **Canvas particle systems complexos** | Thousands of particles com física completa (gravity, wind, turbulence). | ⚠ OK se < 500 partículas e sem colisão. Grid hash obrigatório para > 300 |

---

## 4. Armadilhas Clássicas

### 4.1 Firula sem propósito narrativo
Sites que empilham WebGL + paralax + cursor custom + loader + SFX sem que nenhum elemento diga algo sobre o conteúdo. O juri do Awwwards penaliza em **Creativity** quando a técnica não serve a ideia. **Regra:** cada efeito deve justificar sua existência na metáfora. No Abissal, o farol vermelho pulsante = presença humana no abismo. As partículas = bioluminescência. Se não couber na metáfora, corta.

### 4.2 Jank / performance no mobile
A classe de erro mais punida em Usability (30% do score). Scroll jank (< 60fps), layout shifts visíveis (CLS > 0.1), LCP > 2.5s, input delay > 100ms. WebGL em mobile pode cair de 60 para 15fps facilmente. **Regra para o Abissal:** detectar `navigator.hardwareConcurrency <= 2` ou `deviceMemory <= 2` e reduzir partículas de 400 para 50; desativar grain overlay; reduzir resolução do shader para 0.5x DPR.

### 4.3 Motion sickness / acessibilidade
Parallax e animações de câmera em zoom/rotação afetam ~35% de usuários com sensibilidade vestibular. WCAG 2.3 AA exige `prefers-reduced-motion` respeitado. **Regra para o Abissal:** todo `animation-timeline` envolto em `@media (prefers-reduced-motion: no-preference)`. Fallback: texto visível, sem transições de posição. O shader WebGL deve pausar (não freeze) — background sólido #09090f é suficiente como fallback.

### 4.4 Tempo até o primeiro conteúdo
Loaders chamativos que escondem o conteúdo por > 3s são penalizados em Usability. Nenhum usuário aguarda 5 segundos de partículas antes de ver o título. **Regra:** wordmark Fraunces + primeira estrofe do poema devem ser visíveis em < 1.5s (HTML puro). WebGL entra como enhancement, não como portão.

### 4.5 Mobile sem tratamento específico
Custom cursors no touch (irrelevante), hover effects sem equivalente touch, layouts horizontais que quebram em < 380px. O Awwwards tem um **Mobile Excellence Award** separado justamente porque a maioria dos sites premiados no desktop falha no mobile. **Regra:** testar em Galaxy S23 FE (412px) antes de qualquer SOTD submission.

### 4.6 Tentar fazer tudo ao mesmo tempo
WebGL + GSAP + Lottie + Three.js + Barba.js + GSAP ScrollTrigger + SoundManager em uma única página = bundle de 1.5 MB, 4s de LCP, CLS visível. Sites premiados escolhem UMA abordagem técnica de alto impacto e executam com excelência. **Para o Abissal:** o stack certo é raw WebGL (shader standalone) + CSS `animation-timeline` + Lenis (ou spring raw). Nada mais.

### 4.7 Contraste insuficiente em dark
79.1% dos top 1M sites do WebAIM têm falha WCAG em contraste. Dark mode com #09090f de fundo exige texto com luminância suficiente. Branco puro (#ffffff) em void preto tem contraste 21:1 — ótimo. Mas textos em cinza médio (#888) ou off-white acinzentado podem cair abaixo de 4.5:1 em fundos não-completamente-pretos (caustics com partes mais claras). **Regra:** testar contraste dinâmico contra o frame mais claro do shader, não apenas o void estático.

### 4.8 Easter eggs inacessíveis ou frustrantes
Easter eggs que não são encontráveis sem documentação, ou que bloqueiam a navegação principal quando descobertos acidentalmente. **Regra:** easter egg deve ser descobrível organicamente (parar de scrollar, hover específico), deve ter saída clara, e nunca deve ser o único caminho para ver algo importante.

---

## 5. Stack de Referência: O Que os Melhores Usam

| Camada | Solução dominante (2024-2025) | Alternativa leve (≤30 KB) |
|---|---|---|
| 3D / shader | Three.js + custom shaders | raw WebGL2 + glMatrix |
| Scroll suave | Lenis (~7 KB gzip) | Spring physics raw (200 bytes) |
| Scroll-driven animation | GSAP ScrollTrigger | CSS `animation-timeline` nativo |
| Text reveals | Splitting.js + CSS | CSS puro + `animation-timeline` |
| Partículas | Three.js PointsMaterial | Canvas 2D + spatial hash |
| Page transitions | Barba.js + GSAP | CSS `@view-transition` (2025) |
| Textura de grain | SVG `feTurbulence` | Canvas noise (200 bytes) |
| Loader | GSAP timeline | CSS animation + JS flag |
| Assets 3D | glTF + KTX2 compression | VAT em PNG16 ou RGBE |
| Custom cursor | Div CSS + JS mousemove | Canvas overlay (recomendado) |

---

## Fontes

- [Awwwards — Evaluation System](https://www.awwwards.com/about-evaluation/)
- [Awwwards — Site of the Year 2024](https://www.awwwards.com/annual-awards-2024/site-of-the-year)
- [Igloo Inc — Case Study (abeto studio)](https://www.awwwards.com/igloo-inc-case-study.html)
- [Lusion — Awwwards SOTM Case Study](https://www.awwwards.com/case-study-for-lusion-by-lusion-winner-of-site-of-the-month-may.html)
- [Lusion.co — The One Show 2024](https://www.oneclub.org/awards/theoneshow/-award/52698/lusionco/)
- [Active Theory — Prometheus Case Study (Medium)](https://medium.com/active-theory/prometheus-2d3c05b88ec0)
- [Immersive Garden — Awwwards Case Study](https://www.awwwards.com/case-study-immersive-gardens-new-website.html)
- [Immersive Garden — SOTD](https://www.awwwards.com/sites/immersive-garden-website)
- [Obys Agency — Awwwards](https://www.awwwards.com/obys_agency/)
- [Resn.co.nz — Portfolio](https://resn.co.nz)
- [CSS Scroll-Driven Animations + Accessibility — css-scroll-driven.com](https://www.css-scroll-driven.com/accessibility-inclusive-motion-standards/)
- [Smashing Magazine — Intro to CSS Scroll-Driven Animations](https://www.smashingmagazine.com/2024/12/introduction-css-scroll-driven-animations/)
- [10 Award-Winning Dark Websites — Orpetron](https://medium.com/orpetron/10-award-winning-dark-websites-with-striking-designs-f23f75a07de2)
- [10 Award-Winning Landing Pages — Orpetron](https://medium.com/orpetron/10-award-winning-landing-pages-that-redefine-first-impressions-be5e76b1bf67)
- [Utsubo — Award-Winning Website Design Guide](https://www.utsubo.com/blog/award-winning-website-design-guide)
- [Webexpo — Scroll-Driven Animations Performance](https://webexpo.net/blog/scroll-driven-animations-with-css-performance-focused-web-interactivity/)
