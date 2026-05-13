# Bundle Report — Dashboard de Stats por Fixture

**Data:** 2026-05-13
**Branch:** `feat/dashboard-stats-T10`
**Baseline commit:** `e33b7b0` (`fix(logs): await recordLlmRequest + force-dynamic on /logs`) — último commit antes da feature começar.
**Feature commit:** `bffc0af` (`merge: T9 — E2E + a11y`) — branch atual T10 sobre todos os T1-T9 merged.
**Ferramenta:** `@next/bundle-analyzer ^16.2.6` (devDep adicionada nesta task). Build com Next.js **16.2.6 (Turbopack)**.

---

## Metodologia

1. **Baseline:** worktree separado em `e33b7b0` (sem o feature), build com `OPENROUTER_API_KEY=sk-stub-build pnpm build`.
2. **Feature:** worktree T10 com analyzer wrap + T1-T9 merged, mesmo comando de build.
3. **Métrica primária:** somatório de `.js` + `.css` em `.next/static/`, raw + gzip (`gzip -c <file> | wc -c`).
4. **HTML visual report** (`@next/bundle-analyzer` `report.html`): **não gerado**. O analyzer só hooka no **Webpack**; Next 16 + Turbopack ignora o env `ANALYZE=true` silenciosamente. Wrap mantido pra quando voltar pro Webpack ou pra `next build --turbopack=false` ad-hoc. Medições por chunk file size cobrem a necessidade primária (delta vs budget).

---

## Resumo (totais `static/`)

| Métrica | Baseline | Feature | Delta |
|---|---:|---:|---:|
| JS+CSS raw | 998.3 KB | 1677.5 KB | **+679.2 KB** |
| JS+CSS gzip | 286.0 KB | 472.9 KB | **+186.9 KB** |
| Nº de chunks | 26 | 28 | +2 |

**Veredito:** **fora do budget +150 KB gzip por ~37 KB**. Não-blocking conforme spec da T10. Justificativa abaixo.

---

## Maior contribuidor único

| Chunk | Raw | Gzip | Notas |
|---|---:|---:|---|
| `static/chunks/05-.rli7-gvf5.js` | 684.2 KB | **188.2 KB** | Único chunk novo grande. Contém **recharts** + **lightweight-charts** (strings confirmadas via `grep`). É o bundle do `/fixtures/[id]/stats` agrupando os 11 painéis client (radar, scatter, line, sparkline, momentum series, players ranking, markets browser). Chunk só é baixado quando o usuário navega pra rota `/stats` — **não impacta a rota raiz nem `/fixtures`**. |

Todos os outros chunks mantêm-se ≈ idênticos entre baseline e feature (variações de 0-200 bytes, ruído da hash de filename do Turbopack). Confirmação via `diff` ordenado por tamanho gzip: apenas **1 valor novo** > 1 KB de delta (`188154`); o resto é deslocamento natural.

---

## Tabela detalhada — top chunks lado-a-lado (gzip)

| # | Baseline chunk | Baseline gzip | Feature chunk equiv. | Feature gzip | Delta |
|---|---|---:|---|---:|---:|
| 1 | `0_nw2zu2sxq~d.js` | 69.2 KB | `0ufu_sse3lqzp.js` | 69.2 KB | ~0 |
| 2 | `08r_obn57uhp~.js` | 43.6 KB | `08r_obn57uhp~.js` | 43.6 KB | ~0 |
| 3 | `0e5dh9oxgi2iw.js` | 30.2 KB | `00qai.o93-0c8.js` | 30.2 KB | ~0 |
| 4 | `03~yq9q893hmn.js` | 38.6 KB | `03~yq9q893hmn.js` | 38.6 KB | ~0 |
| 5 | `0d7r~zt8vmsy6.js` | 12.5 KB | `0n3eaan-d-5xj.js` | 12.5 KB | ~0 |
| 6 | `0nw2eqw4dy.~4.js` | 15.9 KB | `0k163vat_2lm3.js` | 14.5 KB | -1.4 KB |
| 7 | `02xifch18ffsg.css` | 8.3 KB | `0o58hw5j3~mcv.css` | 9.4 KB | +1.1 KB (CSS extra do `/stats` — tokens de grid, glow do hero, animations) |
| — | — | — | **`05-.rli7-gvf5.js`** (novo) | **188.2 KB** | **+188.2 KB (entry chunk de `/stats`)** |
| — | — | — | `04ne96c~2_o5v.js` (novo) | 6.7 KB | +6.7 KB (provavelmente client component split — tabs/cmdk) |

> Nomes de chunk são hashes Turbopack content-addressable — chunks "equivalentes" pareados por **gzip size match** (mesma lib/módulo emite o mesmo conteúdo).

---

## Breakdown estimado do chunk `/stats` (188 KB gzip)

Análise indireta (sem source-map; `@next/bundle-analyzer` não gerou HTML por causa do Turbopack):

| Componente | Estimativa gzip | Justificativa |
|---|---:|---|
| `recharts` 2.15.1 (LineChart, RadarChart, ScatterChart, ResponsiveContainer, axes, tooltips, recharts-scale) | ~90-100 KB | Maior dep do chunk; usada nos painéis B (LineChart fallback), C+ (line multi-series), G+ (scatter min×eff), K (radar 6-axis), L (scatter playground). Pesquisa L2 §6.1 estimou ~85-95 KB gzip baseado em medição de `npm view recharts dist`. |
| `lightweight-charts` 4.2.3 (createChart + IChartApi + ISeriesApi) | ~51 KB | Empiricamente medido em pesquisa L2 §6.2; usada só no painel B (momentum PPG rolling). |
| `cmdk` 1.1.1 (Command palette) | ~5-8 KB | Painel F streaks. |
| `@tanstack/react-virtual` 3.x | ~6-8 KB | Painel F (heatmap rows virtualizadas) e G+ (players ranking). |
| `@radix-ui/react-slider` 1.2 | ~4-6 KB | Painel F (slider de `overall_perc`). |
| `@radix-ui/react-tabs` (re-exportado) | já no baseline | T8 mobile tabs; usa instância de bundle existente. |
| `simple-statistics` + `regression` | (lado server) | Painéis N e L derivam server-side em RSC; **não vão para bundle client**. |
| Código próprio dos 14 painéis + StatsLayout + helpers | ~15-20 KB | Hooks, util de URL state (`useUrlPatcher`), derive helpers usados client-side. |

**Total estimado:** ~170-190 KB gzip — consistente com o medido (188 KB).

---

## Por que está fora do budget?

A pesquisa L2 (`docs/pesquisas/dashboard-stats-fixture-arquitetura.md` §10) projetou "+0 a +35 KB gzip" baseando-se no pressuposto de que `recharts` + `lightweight-charts` já estariam no bundle de alguma rota anterior. **Empiricamente não estavam** — ambos os pacotes existiam em `package.json` desde a unificação adam-stats↔abissal (ADR-001), mas nenhuma rota os importava, então Turbopack/Webpack os tree-shakeou pra zero. A rota `/stats` é o primeiro consumidor real.

Estimativa real **vs.** budget conservador:
- Projetado: +0 a +35 KB gzip.
- Real: **+187 KB gzip**.
- Budget formal: ≤ +150 KB gzip → **estouro de ~37 KB (~25% acima do budget)**.

**Mitigações consideradas (não aplicadas nesta task):**

1. **Lazy-load por painel:** quebrar `05-.rli7-gvf5.js` em sub-chunks via `next/dynamic` por painel (radar, scatter, line). Ganho esperado: 30-60 KB no first paint do `/stats`, custo: 1 extra request por painel. Decisão YAGNI: já está numa rota dedicada; usuário entra com intenção; usabilidade ganha mais com tudo pré-carregado.
2. **Substituir `recharts` por charts CSS+SVG puros:** painéis simples (sparkline, form-bar) já são CSS — só radar/scatter/line ainda usam recharts. Refator possível em follow-up (estimativa: -80 KB gzip). Trade-off: perde axis labels automáticos, tooltips, responsive math. Decisão: out-of-scope T10.
3. **Trocar `recharts` por `lightweight-charts` exclusivo:** lightweight-charts não suporta radar nem scatter. Não-viável.

**Justificativa do estouro:**

- Budget formal foi auto-imposto sem benchmark empírico das libs no bundle final.
- Pesquisa L2 alertou que tree-shaking de recharts é parcial (importa subset de `Cartesian*`, `Polar*`, `Scatter*`).
- Rota é **dedicada** (`/fixtures/[id]/stats`) — usuário só baixa o chunk quando navega explicitamente; nenhuma página de entrada (login, fixtures list, dashboard) é afetada.
- Uso pessoal, baixíssimo tráfego, sem custo de cold-start em CF Workers Free (chunk é static, servido por edge cache).
- LCP/INP da rota não foi medido em produção ainda; **se Lighthouse Performance < 85** no smoke test pós-deploy, abrir follow-up de splitting.

**Veredito final:** delta de **+186.9 KB gzip** é aceito **com follow-up condicional** (lazy split por painel se LCP > 2.5s no real device test).

---

## Comandos pra reproduzir

```bash
# Baseline
git worktree add .worktrees/baseline e33b7b0
cd .worktrees/baseline
ln -s ../../node_modules node_modules
cp ../../.env.local .
OPENROUTER_API_KEY=sk-stub-build pnpm build
find .next/static -name "*.js" -exec sh -c 'echo "$(wc -c < "$1") $(gzip -c "$1" | wc -c) $1"' _ {} \;

# Feature
cd ../../.worktrees/t10
OPENROUTER_API_KEY=sk-stub-build pnpm build
find .next/static -name "*.js" -exec sh -c 'echo "$(wc -c < "$1") $(gzip -c "$1" | wc -c) $1"' _ {} \;
```

---

## Anexos

- `/tmp/baseline-chunks.txt` (raw,gzip,filename) — 26 linhas.
- `/tmp/feature-chunks.txt` (raw,gzip,filename) — 28 linhas.

Ambos descartáveis; gerar de novo via comandos acima se precisar.
