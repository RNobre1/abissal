# Scout: Skills, Plugins e MCPs para Identidade Visual e Animação Web

**Data:** 2026-05-29
**Escopo:** pesquisa read-only de candidatos para os 3 objetivos do épico de identidade Abissal:
(a) logo "estratos + farol" + favicon + identidade animada;
(b) landing page pré-login com animações ricas (isolada/lazy, peso aceitável);
(c) microcopy, loadings/skeletons on-brand, View Transitions — peso ~zero.

---

## Tabela de Candidatos

| # | Nome | Tipo | Fonte | O que faz | Relevância | Risco |
|---|------|------|-------|-----------|------------|-------|
| 1 | **neonwatty/logo-designer-skill** | Skill | [github.com/neonwatty/logo-designer-skill](https://github.com/neonwatty/logo-designer-skill) | Entrevista de marca → gera 3–5 conceitos SVG → refina → exporta PNG em 7 tamanhos (16→2048px). Dep. local `resvg` ou Inkscape para rasterizar. v1.0.0, mai/2026. | **Alta** — fluxo completo logo+favicon via conversa; zero credencial; outputs são arquivos locais | Baixo — exige instalar `resvg` globalmente (`npm i -g @aspect-build/resvg`); sem scripts externos; MIT |
| 2 | **rknall/svg-logo-designer** | Skill | [github.com/rknall/claude-skills/svg-logo-designer](https://github.com/rknall/claude-skills/blob/main/svg-logo-designer/README.md) | Gera 3–5 direções de logo SVG + variações (horizontal/vertical/ícone/mono), documentação de design, guidelines de uso. v1.0.0, out/2025. | **Alta** — excelente para a fase de exploração de conceito; sem execução de scripts; outputs são SVG+docs | Muito baixo — skill puro texto/código, sem deps externas; recomenda exportadores online (CloudConvert) opcionalmente |
| 3 | **mcpware/logoloom** | MCP server | [github.com/mcpware/logoloom](https://github.com/mcpware/logoloom) | MCP nativo que gera logo SVG + kit completo de marca: 31 arquivos (SVG light/dark/mono, PNG 16–1024px, ICO, WebP, OG, Twitter header) + `BRAND.md`. Usa opentype.js + SVGO + sharp + vtracer. **Sem credencial**. v1.0.1, mar/2026. | **Alta** — entrega o kit inteiro de marca de uma vez, localmente, no formato que o Abissal precisa | Baixo — sem API key; deps são OSS conhecidas; 9 stars (jovem mas funcional); MIT |
| 4 | **talknerdytome-labs/wiggle-claude-skill** | Skill | [github.com/talknerdytome-labs/wiggle-claude-skill](https://github.com/talknerdytome-labs/wiggle-claude-skill) | Converte logo estático (PNG/SVG/JPG) em animação: Lottie JSON, GIF, MP4. "Motion philosophy framework" que mapeia personalidade de marca para easing/timing. Gerencia ambiente Python automaticamente. | **Alta** — perfeito para criar o "farol pulsando" como Lottie reutilizável | Médio — roda scripts Python; MIT; parte da coleção oficial Anthropic; 3 commits (jovem) |
| 5 | **claudskills.com/web-design** | Skill | [claudskills.com/skills/web-design](https://claudskills.com/skills/web-design/) | Skill "Awwwards-tier": React 19 + Next 15/16, Tailwind v4, GSAP, Motion (motion.dev), Lenis, View Transitions API, View Timeline API, scroll-driven animations, cursores customizados, parallax. Atualizado 2026-05-21. | **Alta** — stack idêntica ao Abissal; cobre todos os efeitos da landing page de uma vez | Médio — distribuído via ClaudSkills (registry terceiro); sem evidência de auditoria de segurança; verificar SKILL.md antes de instalar |
| 6 | **freshtechbro/claudedesignskills** — `motion-framer` + `gsap-scrolltrigger` | Skills | [github.com/freshtechbro/claudedesignskills](https://github.com/freshtechbro/claudedesignskills) | Coleção de 22 skills: Framer Motion, GSAP ScrollTrigger, Three.js, React Three Fiber, Lottie, Rive, Vanta, Locomotive Scroll, React Spring, Anime.js, AOS, entre outros. MIT, ~nov/2025. | **Alta** — cada skill pode ser instalada individualmente; `motion-framer` e `gsap-scrolltrigger` são os mais relevantes para o Abissal | Médio-alto — contém 50+ scripts Python geradores de boilerplate; "Python 3 stdlib only" mas não auditado externamente; baixa atividade recente (nov/2025) |
| 7 | **Schoepplake/framer-motion-skill** | Skill | [github.com/Schoepplake/framer-motion-skill](https://github.com/Schoepplake/framer-motion-skill) | Motion (ex-Framer Motion) para React/Next.js: componentes, scroll, gestos, acessibilidade, receitas prontas (progress bars, page transitions). MIT. | **Alta** — específico para Framer Motion + Next.js; focado em acessibilidade; sem scripts externos | Baixo — skill puro; MIT; 2 commits (mínimo, mas parece estável) |
| 8 | **delphi-ai/animate-skill** | Skill | [github.com/delphi-ai/animate-skill](https://github.com/delphi-ai/animate-skill) | Padrões de animação React/Next.js baseados no curso "Animations on the Web" de Emil Kowalski: CSS animations, Framer Motion, micro-interações (hover, toast, modal, text-reveal, step-wizard). 8 exemplos reais. | **Alta** — micro-interações e loadings on-brand (objetivo c); sem scripts; 22 stars | Baixo — skill puro texto/exemplos; sem deps externas; MIT |
| 9 | **vercel-labs/agent-skills — react-view-transitions** | Skill (oficial Vercel) | [github.com/vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | Implementação da View Transition API com React 19 `<ViewTransition>` e Next.js 16 (`next/link` + `transitionTypes`). CSS animation recipes (fade, slide, scale, flip). 27k stars, 231 commits, oficialmente mantido. | **Alta** — exatamente o objetivo (c) de View Transitions; fonte primária; stack = Abissal | Muito baixo — repo oficial Vercel; auditado continuamente |
| 10 | **uxKero/anydesign** | Skill | [github.com/uxKero/anydesign](https://github.com/uxKero/anydesign) | Analisa imagem/URL/Figma e gera `design.md` (sistema + tokens + componentes) + `design-tokens.json` (W3C DTCG) + `design-a11y.md` (WCAG). v0.4.0, mai/2026. **Sem Figma obrigatório.** | **Média-Alta** — útil para codificar o design system "Abismo Habitado" em tokens consumíveis | Baixo — sem scripts perigosos; usa Playwright para screenshots de URL; MIT; 10 commits, atualizado mai/2026 |
| 11 | **MengTo/Skills — gsap** | Skill | [github.com/MengTo/Skills/agent-skills/web-design/gsap/SKILL.md](https://github.com/MengTo/Skills/blob/main/agent-skills/web-design/gsap/SKILL.md) | GSAP completo: timelines, ScrollTrigger (pin, scrub, snap), stagger, easing, integração React com `gsap.context()` e cleanup patterns. | **Média-Alta** — skill limpo, focado, sem scripts; boa alternativa ao freshtechbro/claudedesignskills pra GSAP | Muito baixo — arquivo SKILL.md único; sem deps |
| 12 | **motion.dev AI Kit** | Skill + MCP (pago) | [motion.dev/docs/ai-kit](https://motion.dev/docs/ai-kit) | Docs live da Motion lib, 370+ exemplos premium, MotionScore (auditoria de performance de animação), edição de easing em tempo real. Requer Motion+. | **Média** — útil se adotar Motion como lib principal; MotionScore é diferencial para performance | Baixo técnico; **custo**: requer Motion+ (compra única). Vale pós-ship se Motion for escolhido como lib padrão |
| 13 | **b1rdmania/claude-lottie-skill** | Skill | [github.com/b1rdmania/claude-lottie-skill](https://github.com/b1rdmania/claude-lottie-skill) | Busca animações no LottieFiles alinhadas ao contexto de marca + embute no projeto com `@lottiefiles/dotlottie-react`. Framework-aware (Next.js, React). | **Média** — útil para loadings on-brand com Lottie prontos (objetivo c); depende do LottieFiles estar disponível | Baixo — sem scripts externos; usa WebFetch/WebSearch internos ao Claude; MIT; 1 star (muito jovem) |
| 14 | **Figma MCP Server** (oficial) | MCP server | [figma.com/blog/introducing-figma-mcp-server](https://www.figma.com/blog/introducing-figma-mcp-server/) | Traz contexto de arquivos Figma (tokens, componentes, layouts, assets SVG) pro Claude Code. Exige conta Figma. Free tier: **6 tool calls/mês** (inutilizável para uso regular). Dev seat: sem limite por chamada. | **Média** — só vale com Dev seat pago; excelente se o Pilot já usar Figma | Baixo tecnicamente; **bloqueio**: free tier tem cota mínima; requer arquivo Figma prévio |
| 15 | **tadasant/mcp-server-stability-ai** | MCP server | [github.com/tadasant/mcp-server-stability-ai](https://github.com/tadasant/mcp-server-stability-ai) | 12 ferramentas Stability AI: gera imagem, edita (search-replace, remove BG, recolor), upscale 4K, style transfer, sketch→imagem. Requer API key Stability AI (~$0.01/crédito, 25 créditos free). | **Média** — útil para gerar assets de fundo/textura da landing page (ex: "bioluminescência oceânica") | Baixo; credencial necessária ($); 83 stars, v0.2.0, mar/2025; ativo |
| 16 | **Canva MCP** (já conectado) | MCP server | [canva.dev/docs/mcp](https://www.canva.dev/docs/mcp/) | Cria/edita designs via linguagem natural, exporta PNG/JPG/PDF/MP4, gerencia assets e pastas. Brand kit e brand templates requerem Enterprise. **Já instalado.** | **Média** — sub-aproveitado atualmente; ver seção dedicada abaixo | Muito baixo — MCP oficial da Canva; OAuth |
| 17 | **Context7 MCP** (já conectado) | MCP server | [github.com/upstash/context7](https://github.com/upstash/context7) | Injeta docs live de bibliotecas no contexto: GSAP, Motion, Three.js, Tailwind, Next.js, React. **Já instalado.** | **Alta** — sub-aproveitado; chamar para evitar alucinação de API em libs de animação | Muito baixo — uso read-only de docs |
| 18 | **Abhishekrajpurohit/motion-dev-mcp** | MCP server | [github.com/Abhishekrajpurohit/motion-dev-mcp](https://github.com/Abhishekrajpurohit/motion-dev-mcp) | Docs offline da Motion lib (351 exemplos, 26 páginas), geração de código multi-framework, busca full-text. Sem API key. 11 stars. | **Baixa** — Context7 já cobre Motion; este seria redundante e menos maduro | Baixo técnico; jovem (11 stars, 9 commits) |
| 19 | **uopsdod/claude_code_icon_generator_mcp_server** | MCP server | [github.com/uopsdod/claude_code_icon_generator_mcp_server](https://github.com/uopsdod/claude_code_icon_generator_mcp_server) | Gera ícones PNG 1024px flat/outlined via DALL-E 3. Requer OpenAI API key. Estilo fixo (azul #5B9BD5, fundo branco). | **Baixa** — estilo fixo incompatível com "Abismo Habitado" (dark/void + vermelho); requer OpenAI key extra | Baixo; 0 stars, 4 commits (imaturo) |
| 20 | **ComposioHQ — canvas-design / theme-factory / brand-guidelines** | Skills | [github.com/ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | Skills genéricas da Composio: canvas-design (arte visual PNG/PDF), theme-factory (temas de fonte/cor em artefatos), brand-guidelines (cores/tipografia Anthropic). | **Baixa** — brand-guidelines é específico da Anthropic; theme-factory é genérico demais | Baixo; mas pouco relevante para o Abissal |

---

## Top 5 Recomendações Priorizadas

### P0 — Instalar agora (zero risco, impacto direto)

#### 1. `vercel-labs/agent-skills: react-view-transitions`
**Por que P0:** Repo oficial Vercel, 27k stars, 231 commits, mantido ativamente. Cobre exatamente o objetivo (c): View Transitions entre páginas/estados do app com React 19 `<ViewTransition>` e Next.js 16. Stack 100% alinhada. Sem scripts, sem deps externas.

**Instalação:**
```bash
# Copiar o SKILL.md para ~/.claude/skills/react-view-transitions/
# ou para .claude/skills/ do projeto
gh api repos/vercel-labs/agent-skills/contents/skills/react-view-transitions/SKILL.md \
  --jq '.content' | base64 -d > ~/.claude/skills/react-view-transitions/SKILL.md
```

#### 2. `delphi-ai/animate-skill`
**Por que P0:** Skill puro (sem scripts), baseado no curso de Emil Kowalski (referência de qualidade em animação web), cobre micro-interações (hover, toast, modal, text-reveal, step-wizard) + performance + acessibilidade. Exatamente o objetivo (c) de loadings/skeletons on-brand + micro-interações. 8 exemplos reais incluídos.

**Instalação:**
```bash
gh api repos/delphi-ai/animate-skill/contents/SKILL.md \
  --jq '.content' | base64 -d > ~/.claude/skills/animate/SKILL.md
```

#### 3. `rknall/svg-logo-designer` + `neonwatty/logo-designer-skill`
**Por que P0 (par):** Os dois são complementares e têm risco zero. O `rknall` faz exploração de conceito (3–5 direções, documentação de design), o `neonwatty` faz o fluxo produção (entrevista → conceitos → exportação PNG em 7 tamanhos). Usar `rknall` para decidir direção visual; `neonwatty` para o output final. Pré-requisito: `npm install -g @aspect-build/resvg`.

---

### P1 — Instalar após confirmar direção visual do logo

#### 4. `mcpware/logoloom` (MCP server)
**Por que P1:** Entrega o kit completo (31 arquivos: SVG, PNG, ICO, WebP, OG, BRAND.md) sem nenhuma credencial, localmente, em uma única chamada. Se o objetivo for ter tudo pronto pra produção de uma vez (logo + favicon + OG image), este MCP é a opção mais eficiente. Requer `mcp add` no Claude Code. Jovem (9 stars, v1.0.1 mar/2026) mas funcional.

**Instalação:**
```bash
claude mcp add logoloom npx mcpware/logoloom
```

#### 5. `talknerdytome-labs/wiggle-claude-skill` (animação do logo)
**Por que P1:** Uma vez que o SVG do farol estiver pronto, o Wiggle converte em Lottie JSON (usado no loading on-brand do app) + GIF/MP4 (para o hero da landing page). Roda scripts Python — verificar o SKILL.md antes, mas é parte da coleção oficial Anthropic.

---

### P2 — Usar pontualmente / condicionalmente

- **`claudskills.com/web-design`** — para a landing page pré-login com GSAP + parallax + scroll-driven; verificar o SKILL.md antes de instalar (distribuidor terceiro).
- **`freshtechbro/claudedesignskills` (`gsap-scrolltrigger` apenas)** — alternativa ao claudskills; instalar só este skill individual, não o bundle inteiro (que tem scripts Python).
- **`Schoepplake/framer-motion-skill`** — se Motion for adotado como lib de animação principal em vez de GSAP.
- **`uxKero/anydesign`** — para codificar o design system "Abismo Habitado" em `design-tokens.json` W3C DTCG (exportável para CSS custom properties).
- **`tadasant/mcp-server-stability-ai`** — para gerar backgrounds/texturas da landing page (bioluminescência, abismo oceânico). Requer Stability AI key.
- **Figma MCP** — só vale instalar se o Pilot tiver Dev seat ($) ou criar um arquivo Figma com o design system. Com free tier (6 calls/mês) é inutilizável para iteração.

---

## Como Aproveitar Melhor o Canva MCP e o Context7 Que Já Temos

### Canva MCP (já instalado, sub-aproveitado)

O Canva MCP está conectado mas provavelmente pouco usado para design. O que ele pode fazer agora **sem custo adicional** no plano atual:

| Ação | Como pedir ao Claude | Uso no Abissal |
|------|---------------------|----------------|
| Gerar conceito visual do logo | `"Crie um design no Canva: logo 'Abissal', tema abismo oceânico, farol vermelho (#c42b2b), fundo #09090f, tipografia serif"` | Exploração rápida de direção visual antes de commitar em SVG |
| Exportar assets em múltiplos formatos | `"Exporte o design ID X como PNG 512px e como SVG"` | Favicon, OG image, social assets |
| Criar variações de marca | `"Crie uma versão light e uma dark do logo, exporte ambas"` | Dark/light do "Abismo Habitado" |
| Hero da landing page | `"Gere uma imagem de fundo: zona abissal do oceano, bioluminescência azul/verde, gradiente para #09090f"` | Background hero (exportar PNG, não SVG) |

**Limitação importante:** Brand kit e brand templates requerem **Canva Enterprise**. No plano atual, o Canva não "conhece" automaticamente as cores e fontes do Abissal — você precisa fornecê-las no prompt a cada vez, ou criar um arquivo de referência no Canva e passá-lo via `get-design`.

**Workaround:** Criar um design "palette de referência" no Canva com as cores (#09090f, #c42b2b, #f5f5f0) e tipografia (Fraunces, DM Sans, JetBrains Mono) e passar o ID via `get-design` em cada nova sessão.

### Context7 MCP (já instalado, zero aproveitamento para animação)

O Context7 consegue injetar docs live de **qualquer lib de animação** antes de Claude gerar código — isso elimina alucinações de API (ex: usar `useAnimation` deprecated do Framer Motion, ou `gsap.registerPlugin` na ordem errada).

**Padrão de uso para animação:**

```
# Antes de gerar código de animação, sempre resolver a lib:
mcp__context7__resolve-library-id: "motion" (ou "gsap", "three.js", "lottie")
→ retorna ID canônico

mcp__context7__get-library-docs: <id> topic:"scroll animations" OR "view transitions" OR "reduced motion"
→ injeta docs atuais no contexto
```

**Libs de animação disponíveis no Context7 (verificadas):**
- `motion` (Motion / Framer Motion) — documentação v12+
- `gsap` — GreenSock, incluindo ScrollTrigger
- `three` — Three.js
- `@lottiefiles/dotlottie-react` — player moderno
- `tailwindcss` — inclui `animate-*` utilities e `prefers-reduced-motion` patterns

**Regra operacional:** Em qualquer wave que toque animação, começar a sessão com `resolve-library-id` para a lib escolhida antes de gerar qualquer código. Custo: zero (já está instalado).

---

## Observações de Segurança Gerais

1. **Skills sem scripts (texto/instruções apenas):** risco baixo; verificar o SKILL.md antes de instalar para confirmar ausência de `<bash>` ou chamadas de sistema.
2. **Skills com scripts Python (freshtechbro/claudedesignskills, wiggle):** risco médio; ler o script antes de deixar o Claude executá-lo; preferir instalar apenas a skill individual, não o bundle.
3. **MCPs terceiros:** verificar se pedem credenciais além do necessário; logoloom e motion-dev-mcp não pedem nenhuma.
4. **MCPs que pedem API keys ($):** Stability AI, OpenAI icon generator — ponderar custo antes de instalar.
5. **ClaudSkills registry:** distribui SKILL.md via iframe/embed; sempre inspecionar o conteúdo do SKILL.md antes de colocar em produção.

---

## Referências (URLs consultadas)

- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)
- [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills)
- [neonwatty/logo-designer-skill](https://github.com/neonwatty/logo-designer-skill)
- [talknerdytome-labs/wiggle-claude-skill](https://github.com/talknerdytome-labs/wiggle-claude-skill)
- [mcpware/logoloom](https://github.com/mcpware/logoloom)
- [freshtechbro/claudedesignskills](https://github.com/freshtechbro/claudedesignskills)
- [delphi-ai/animate-skill](https://github.com/delphi-ai/animate-skill)
- [Schoepplake/framer-motion-skill](https://github.com/Schoepplake/framer-motion-skill)
- [rknall/claude-skills svg-logo-designer](https://github.com/rknall/claude-skills/blob/main/svg-logo-designer/README.md)
- [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)
- [uxKero/anydesign](https://github.com/uxKero/anydesign)
- [b1rdmania/claude-lottie-skill](https://github.com/b1rdmania/claude-lottie-skill)
- [tadasant/mcp-server-stability-ai](https://github.com/tadasant/mcp-server-stability-ai)
- [Figma MCP server guide](https://www.figma.com/blog/introducing-figma-mcp-server/)
- [Canva MCP docs](https://www.canva.dev/docs/mcp/)
- [Motion AI Kit](https://motion.dev/docs/ai-kit)
- [claudskills.com/web-design](https://claudskills.com/skills/web-design/)
- [MengTo/Skills gsap SKILL.md](https://github.com/MengTo/Skills/blob/main/agent-skills/web-design/gsap/SKILL.md)
- [Abhishekrajpurohit/motion-dev-mcp](https://github.com/Abhishekrajpurohit/motion-dev-mcp)
- [mcpmarket.com svg-animation-expert](https://mcpmarket.com/tools/skills/svg-animation-expert)
- [blockchain-council Top 50 Claude Skills 2026](https://www.blockchain-council.org/claude-ai/top-50-claude-skills-and-github-repos/)
