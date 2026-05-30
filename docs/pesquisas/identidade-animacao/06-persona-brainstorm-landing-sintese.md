# Persona-brainstorm da landing — síntese (frente E)

> 2026-05-29 · 19/20 personas (Loader/Transition falhou o briefing; ângulo coberto por outras). Alimentadas com o dossiê `05-referencias-landings-premium.md`. Cada persona leu o código real da landing.

## Convergências fortes (≥3 personas independentes)

1. **A página é PASSIVA ao toque — falta reatividade ao cursor/input.** (Awwwards Judge, Art Director, Interaction Designer, UI Senior) — o mouse se move e nada reage. Solução de altíssimo impacto/baixo custo, tema-perfeito ("você gera luz no escuro"): **cursor-aura bioluminescente** (LVCIDIA, ~200 B) + **mouse como uniform no shader** (o farol "segue" o cursor, `mix(..., u_mouse, 0.04)`, ~10 linhas) + partículas iluminando perto do cursor. **É o diferencial decisivo pra sair de "scroll-telling" e virar "presença imersiva".**

2. **WebGL depois do LCP / hero clicável sem depender de animação** (Awwwards Judge, UX Researcher, Mobile UX, Performance Eng, Time-on-Task, Design Systems — Igloo SOTY). Riscos reais hoje: o `FALLBACK_BG` só é aplicado no `useEffect` (client) → **flash de preto** antes do shader montar em conexão lenta; e o CTA do hero usa `landing-reveal` (pode nascer invisível antes do 1º scroll). Adiar `import("ogl")` com `requestIdleCallback`.

3. **O copy é poético demais e não comunica o produto** (Naive, UX Researcher, Behavioral Economist, Content Designer). A Naive achou "marca de roupa/perfume"; a função ("gestão de banca · análise pré-jogo") só aparece na cena 5, miúda. Adicionar **uma linha funcional discreta no hero** + repensar o CTA. Tensão arte × clareza.

4. **Reveal monolítico (translateY 48px) é o padrão mais batido de 2025** (Awwwards Judge, Motion Designer, Art Director — Obys). Trocar por **split-word stagger** (`<span>` por palavra + `--i` delay, CSS puro, 0 bundle) — texto emergindo palavra a palavra.

5. **Dois CTAs "entrar" idênticos diluem a hierarquia** (UI Senior, Behavioral Economist, Awwwards Judge). Hero = ghost-border, final = vermelho-cheio = dois primários disfarçados. **Definir UM primário** (vermelho no hero, que 80% verá).

6. **`landing-darken` (0.55) apaga o farol no clímax** (Awwwards Judge, Motion Designer, Scroll-telling). Reduzir cap p/ ~0.35 e **reverter o escurecimento na cena 4** (o fundo "abre" = farol acende = "luz própria" literalizada no ambiente).

7. **Perf: remover gsap (dep morta), pôr fps-cap nas partículas, e o `shadowBlur` é caro** (Performance Eng, Devil's Advocate, Mobile UX). Partículas rodam a 60-120fps sem cap; `shadowBlur=radius*10` derrete GPU mid-range. `pnpm remove gsap`.

8. **A descida é declarada mas não SENTIDA — linear demais** (Art Director, Scroll-telling, Shader Artist). Profundidade não-linear: depth markers (0m→6000m, CSS puro), compressão de cenas, caustics em curva de campânula (terço médio).

## Conflitos (tensão real)

- **Devil's Advocate vs Art Director/Judge/Shader Artist:** "delete o shader e as partículas — é vaidade pra um produto single-user `noindex`, e já tivemos outage 1101" **vs** "o shader é o coração, eleve-o (god-rays, grain)". → O Pilot já decidiu que quer (expressão de marca). Meio-termo: **manter, blindar perf, não inflar mais**.
- **Som (Sound Designer: "vale, cirúrgico") vs minimalismo (Devil's/Time-on-Task: over-engineering).**
- **Expressão vs função:** Time-on-Task/Devil's ("é demais pra 1 usuário") vs Judge/Art Director ("leve às últimas consequências").

## Surpresas isoladas notáveis

- **⚠️ Risco ÉTICO (Behavioral Economist):** "aposte com luz própria" pode ancorar *ilusão de controle* — o viés #1 do apostador problemático. O produto prega DISCIPLINA, mas a landing é 100% aspiracional. Adicionar honestidade ("edge não é garantia · variância vence no curto prazo") AUMENTA confiança (efeito pratfall). **Único e importante.**
- **Backstage técnico (Behavioral + Immersive Garden):** micro-seção expondo o motor (Monte Carlo, Dixon-Coles, CLV) = prova de autenticidade sem prometer dinheiro.
- **a11y:** `--color-ink-faint`/`-muted` (~4.0:1) FALHAM AA 4.5:1; testar contraste contra o farol (pixel mais claro), não só o void.
- **Shader Artist (GLSL concreto):** light cone/god-ray vertical no farol; pulse com 2º harmônico (orgânico); grain + vignette; caustics em curva de campânula.
- **Typography:** Fraunces tem eixos `opsz`/`SOFT`/`WONK` não usados — 1 linha de CSS "transforma a marca"; leading apertado demais.
- **Scroll-telling:** cena 5 repete o hero — virar uma "respirada" (só o CTA), não repetição.

## Top ações priorizadas (waves propostas)

- **Wave 1 — Robustez & clareza (P0, baixo custo, alta convergência):** FALLBACK_BG no SSR (mata o flash), CTA hero sempre clicável + um primário, linha funcional no hero, `requestIdleCallback` pro ogl, **remover gsap**, fps-cap + reduzir shadowBlur nas partículas, degradar por device fraco. Contraste a11y (tokens).
- **Wave 2 — O diferencial (P1, o "uau"):** cursor-aura bioluminescente + mouse-uniform no shader (farol segue o cursor) + partículas reagindo. Magnetic button no CTA.
- **Wave 3 — Motion & narrativa (P1):** split-word reveal, `landing-darken` menor + reverter no clímax, easing não-linear, compressão/ritmo das cenas, depth markers.
- **Wave 4 — Shader & acabamento (P2):** god-ray/light cone, pulse harmônico, grain + vignette, caustics campânula, Fraunces opsz/SOFT/WONK, leading.
- **Wave 5 — Copy & ética (P1-ético):** reescritas do Content Designer, linha de honestidade (anti-ilusão-de-controle), mantra-assinatura, microcopy do CTA; opcional: seção backstage.
- **Som:** decisão à parte (cirúrgico, com toggle/gesto) — opcional.
