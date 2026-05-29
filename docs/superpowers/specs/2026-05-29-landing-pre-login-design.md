# Landing pré-login do Abissal — spec de design (frente E)

> Status: **design aprovado** (decisões estruturais cravadas com o Pilot). Aguardando revisão do spec (especialmente o copy) antes da implementação.
> Data: 2026-05-29 · Épico: marca/animação · Depende de: frente D (identidade, shipped) · Pesquisa: `docs/pesquisas/identidade-animacao/`

## 1. Objetivo

Uma **landing pré-login** na raiz pública (`/`) que seja uma **experiência de marca cinematográfica** — uma descida ao abismo em scroll, terminando no farol e no convite a entrar. É single-user (não é landing de conversão): sem pricing, sem depoimentos, sem features de venda. É um **portal poético** que encarna a narrativa antes do trabalho começar. Toda a animação rica vive aqui, **isolada e lazy**, sem tocar o bundle do app autenticado (protege contra a classe de outage 1101).

## 2. Roteamento (cravado) e migração

- **`/` = landing pública** (route group novo `app/(marketing)/`). Adicionar `/` (exato) e assets da landing a `PUBLIC_PATHS` no middleware.
- **Dashboard move de `/` para `/painel`:** `app/(dashboard)/page.tsx` → `app/(dashboard)/painel/page.tsx`.
- **Logado que acessa `/` → redireciona pra `/painel`** (no Server Component da landing: checa sessão; se autenticado, `redirect("/painel")`). Deslogado vê a landing. (A landing fica revisitável deslogando, ou via link direto se quisermos depois.)
- **Atualizar refs de `/` → `/painel`:**
  - `(dashboard)/layout.tsx`: nav `{ href: "/", label: "overview" }` → `/painel`.
  - Redirect pós-login (`app/(auth)/login/actions.ts` e o middleware `user && path === "/login" → "/"`) → `/painel`.
  - `app/manifest.ts`: `start_url`/`scope` → `/painel` (PWA abre direto no app).
  - Varredura de `href="/"` internos (Link) no app → `/painel`. **Guard:** grep estático em CI/teste pra não sobrar link pro lugar errado.
- **Risco:** quebrar navegação interna. Mitigação: teste de roteamento (middleware redireciona não-auth de `/painel`→`/login`, auth de `/`→`/painel`) + grep dos `href`.

## 3. Roteiro do poema (cenas / beats da descida)

Scroll vertical = descida. Cada cena ocupa ~1 viewport, com pin/reveal. O fundo escurece e a pressão "aumenta" conforme desce; partículas bioluminescentes surgem no meio; o farol acende no clímax.

| Cena | Beat | Visual | Copy (rascunho — Pilot ajusta) |
|---|---|---|---|
| 0 — superfície (hero) | abertura | wordmark grande, farol distante pulsando, leve ondulação | **abissal** · "A maioria aposta no escuro." · ↓ role para descer |
| 1 — a queda | entra no abismo | superfície some no topo, estratos começam a passar | "O mercado é um abismo. Sem fundo. Sob pressão." |
| 2 — o escuro | zona afótica | quase preto, estratos lentos, frio | "Abaixo de certa profundidade, a luz do sol não chega. A maioria afunda." |
| 3 — a vida | bioluminescência | partículas de luz surgem no escuro | "Mas o abismo é habitado. O que vive aqui não espera a luz vir de fora—" |
| 4 — o farol (clímax) | a luz própria | o farol acende forte, o mark "estratos + farol" se forma/monta | "—gera a própria. Análise. Edge. Disciplina. Sua luz no escuro." |
| 5 — convite | CTA | o lockup montado, calmo, o farol pulsando | **abissal** · botão **entrar** · "gestão de banca + análise pré-jogo" |

## 4. Stack de animação (camadas, progressive enhancement)

Cada camada é aditiva e degradável. **Base sempre funciona; o topo enriquece.**

1. **Base — CSS scroll-driven** (`animation-timeline: view()/scroll()`, 0 KB): reveals de texto por cena, parallax dos estratos, escurecimento progressivo do fundo. Já entrega o poema sem nenhum JS.
2. **Canvas 2D** (`<3 KB` próprio): partículas bioluminescentes (cena 3+) — pontos de luz subindo, leve drift. `requestAnimationFrame` com cap, pausa fora de viewport (`IntersectionObserver`).
3. **GSAP + ScrollTrigger** (~26 KB, MIT, **dynamic import** só na landing): orquestração fina — pin de cenas, sincronia texto↔fundo, a "montagem" do mark no clímax. Realça a base; se não carregar, o CSS scroll-driven sustenta.
4. **WebGL shader via `ogl`** (~8 KB, **dynamic import + `ssr:false`**): fundo procedural de água/profundidade (gradiente de pressão, caustics sutis, drift). Lazy, atrás de um `<canvas>` com **fallback CSS** (gradiente animado) se WebGL indisponível/`prefers-reduced-motion`/mobile fraco.

**`prefers-reduced-motion: reduce`:** versão estática elegante — sem parallax/partículas/shader; o poema vira um documento legível com o logo estático e o CTA. Cidadão de primeira classe.

## 5. Arquitetura técnica

- **Route group isolado** `app/(marketing)/` com seu próprio `layout.tsx` (não herda o chrome do dashboard). `page.tsx` = Server Component que faz o gate (auth→redirect `/painel`) e renderiza a landing.
- **Componentes client** só onde há interatividade/animação JS (`"use client"` nas camadas canvas/gsap/ogl), carregados via `next/dynamic` com `ssr:false` e `loading` fallback. O conteúdo (texto/SVG/CSS) é SSR (SEO/ء acessível/funciona sem JS).
- **Reuso da frente D:** `AbissalMark`/`AbissalLockup` (o lockup será criado aqui, já que é onde ele estreia) + tokens do design system.
- **Isolamento de bundle:** as libs (gsap, ogl) entram só no chunk da landing (dynamic import). Guard de bundle: medir o chunk da `/` e confirmar que gsap/ogl **não** vazam pro app autenticado.

## 6. Performance (budget e regras)

- Libs JS de animação na landing: **≤ 30 KB gzip** (gsap ~26 + ogl ~8 entram via dynamic, não no first paint; o hero pinta com CSS+SVG).
- Só `transform/opacity/filter` (GPU). Nada de layout thrashing. `content-visibility` nas cenas abaixo da dobra.
- Canvas/WebGL: cap de fps, pausa fora de viewport, `devicePixelRatio` limitado, destrói contexto ao desmontar.
- Fallback CSS para WebGL ausente; teto de partículas menor em telas pequenas.
- Meta: hero LCP rápido (texto+SVG, sem esperar JS); shader/partículas entram depois (enhancement).

## 7. Acessibilidade

- Texto real (SSR), hierarquia de headings, contraste AA. CTA "entrar" é um `<Link>`/`<a>` real, navegável por teclado, foco visível.
- `prefers-reduced-motion` → versão estática. `aria-hidden` nos canvas decorativos. Sem flashes/estímulo vestibular forte (respeitar WCAG 2.3).

## 8. Plano de implementação (fases + TDD + subagentes)

> O Pilot autorizou subagent-driven-development quando ganha eficiência sem perder qualidade. Aplico nas partes **independentes**; o craft visual coeso (integração das camadas) faço com cuidado.

1. **F1 — Roteamento** (base, serial, TDD): mover overview→`/painel`, atualizar nav/redirects/manifest/href, middleware (`/` público, auth→`/painel`), criar `(marketing)`. Testes: redirect middleware + grep de `href`. Gate verde.
2. **F2 — Casca da landing** (SSR): estrutura das 6 cenas, copy, lockup, CTA, CSS base (sem scroll-anim ainda). Acessível e funcional sem JS.
3. **F3 — CSS scroll-driven**: reveals, parallax de estratos, escurecimento. (paralelizável vs F4/F5 após F2)
4. **F4 — Canvas 2D partículas** (componente isolado, dynamic). (paralelizável)
5. **F5 — WebGL shader ogl** (componente isolado, dynamic, fallback). (paralelizável)
6. **F6 — GSAP ScrollTrigger**: orquestração/pin/clímax sobre F3. (depende de F2/F3)
7. **F7 — reduced-motion + perf + a11y**: fallbacks, IntersectionObserver pause, bundle guard, teste mobile (Galaxy S23 FE no Playwright).
8. **Gate** (typecheck/lint/test/build + bundle guard) → **deploy** (commit+push→CI) → **smoke visual** do Pilot (desktop + mobile).

Deps a instalar: `gsap`, `ogl` (Pilot já autorizou). Confirmar versões/peso no install.

## 9. Fora de escopo / riscos

- **Fora:** frente C (enraizamento no app — header/loadings/microcopy) é spec separado.
- **Risco WebGL mobile:** fallback CSS obrigatório; testar no Galaxy S23 FE. Se pesar, shader degrada pra canvas 2D/gradiente.
- **Risco roteamento:** o move `/`→`/painel` toca várias refs; o grep-guard + testes de redirect protegem.
- **Copy:** o rascunho da §3 é ponto de partida — o Pilot é o dono da voz; ajustar antes/durante F2.
- **`/brand`:** remover quando a identidade fechar 100% (item pendente da frente D).
