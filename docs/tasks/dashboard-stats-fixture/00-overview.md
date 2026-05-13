# Dashboard de Stats por Fixture — Overview

**Date:** 2026-05-13
**Status:** COMPLETED on 2026-05-13
**Objective:** Construir `/fixtures/[id]/stats` — dashboard denso "Trading Terminal + Stadium Wall" que substitui a consulta manual ao adamchoi/choistats, expõe TODAS as métricas do `detail_json` em painéis especializados, e adiciona análise estatística derivada (correlações, tendências, padrões condicionais, outliers) usando libs já instaladas.

> Pesquisa formal de fundamentação: [`docs/pesquisas/dashboard-stats-fixture-arquitetura.md`](../../pesquisas/dashboard-stats-fixture-arquitetura.md) (tier L2, research-critic adversarial em 2 iterações).
>
> Data dictionary do payload: [`docs/pesquisas/detail-json-inventario.md`](../../pesquisas/detail-json-inventario.md).

---

## Diagnosis

| Aspecto | Hoje | Target |
|---|---|---|
| Visualização do `detail_json` | só prompt textual pra IA (`prompt-builder.ts`) | 11 painéis denso s + insights derivados |
| Rotas relacionadas | `/fixtures/[id]` (AnalyzePanel IA) | + `/fixtures/[id]/stats` (rota irmã) |
| Uso do `player_stats` | 0% | Painel G+ com ranking + scatter min×eff |
| Uso de `simple-statistics` / `regression` | 0% | Painel N · Insights computa top correlações + trends |
| Charts no codebase | sparkline básico | recharts (sparkline+ranking+radar+scatter) + lightweight-charts (séries) + CSS heatmap |
| Filtro de streaks | nenhum (todas as 119 entradas no prompt da IA) | chips de grupo + slider `overall_perc` + ⌘K cmdk + virtualizer |
| Mobile UX | UI atual scroll-vertical sem hierarquia | Tabs Radix abaixo de 768px (visão / streaks / jogos / players / odds) |

---

## Decisão visual

**Direção:** Hero "Stadium Wall" (placar tipo LED com glow vermelho — kickoff, 1X2 odds, 5-6 KPIs) + corpo "Match Telemetry" (cards refinados com hierarquia clara, dark mode com tokens Abismo Habitado).

**Stack:**
- `recharts` 2.15 — sparkline, radar, scatter, line multi-series, ranking
- `lightweight-charts` 4.2.3 — séries temporais densas (PPG rolling, booking_points trend) [bundle medido 51 KB gzip]
- CSS Grid puro — heatmap de streaks (promover a `@visx/heatmap` só se necessário)
- Tailwind v4 `@container` queries built-in — layout responsivo
- `simple-statistics` + `regression` — analytics server-side
- `cmdk` + `@tanstack/react-virtual` + `@radix-ui/react-slider/tabs/dialog` — UX de filtros

**NÃO adicionar:** ECharts, Nivo, Chart.js, react-financial-charts, react-grid-layout, dnd-kit, react-window. DuckDB-WASM fica em `/explore` (já é usada lá).

---

## Anatomia (11 painéis)

| ID | Painel | Layer | Lib chart | Visibilidade |
|---|---|---|---|---|
| ⓪ | Hero · Stadium Wall | Client (leve hover) | CSS glow (`--shadow-glow-vermelho`) | always |
| A | Ficha home + away (`team_record`) | Server | form-bar CSS | always |
| B | Momentum (PPG rolling 10) | **Client** | lightweight-charts | always |
| C+ | Recent matches multi-series + sparkline | **Client** | recharts LineChart | always |
| D | H2H timeline | Server | mini CSS cards | always |
| E | Splits 1H vs 2H | Server | CSS bars | always |
| F | Streaks heatmap (109-194 entries × 10 grupos) | **Client** | CSS Grid heatmap | always |
| G+ | Players ranking + scatter min×eff | **Client** | recharts ScatterChart | always |
| K | Radar comparativo home vs away (6-axis) | **Client** | recharts RadarChart | always |
| L | Scatter playground (X/Y configuráveis + regression) | **Client** | recharts ScatterChart + `regression` | always |
| M | Distribuições (boxplots min/Q1/median/Q3/max) | Server | CSS boxplot custom | always |
| N | Insights estatísticos (correlações, trends, patterns, outliers) | Server | texto cards | always |
| H | Markets browser (odds_summary 0-39 mercados) | **Client** | drawer Radix | **opt** (≈56%) |
| I | Árbitro | Server | card | **opt** (≈4%) |
| J | Predictions choistats | Server | card | **opt** (≈11%) |

**Regra:** painéis `opt` somem inteiros quando dado vazio (sem placeholder morto).

**Mobile (<768px):** Tabs Radix (visão / streaks / jogos / players / odds) ao invés de stack vertical infinito. Heatmap em `overflow-x-auto`; charts single-column.

---

## Data flow

```
GET /fixtures/[id]/stats
  ↓
page.tsx (Server Component, edge Worker)
  ├── Supabase admin.from("fixtures").eq("id",id).maybeSingle() → row
  ├── derive.ts (puras, ~1ms total)
  │   ├── deriveTeamRecord(detail_json.team_record)
  │   ├── deriveRecentMatchStats(detail_json.recent_matches, perspectiveTeam)
  │   ├── deriveSplits1h2h(recent)
  │   ├── deriveStreakIndex(detail_json.streaks)
  │   ├── derivePlayerRankings(detail_json.player_stats)
  │   ├── deriveOddsCategories(detail_json.odds_summary)
  │   ├── deriveDistributions(recent)
  │   └── deriveRadarAxes(home_derived, away_derived)
  ├── insights.ts (~2-5ms, simple-statistics + regression)
  │   ├── computeCorrelations() → r ≥ 0.5
  │   ├── computeTrends() → regressão linear, slope significativo
  │   ├── computePatterns() → BTTS streak ≥70% + ref BP >45 ⇒ Z%
  │   └── computeOutliers() → desvio ≥ 2σ
  ├── rankInsights() → topN=6 por confiança
  └── render(<StatsLayout hero={...} panels={[...]} insights={[...]} />)
       ├── Server children renderizam direto
       └── Client children hidratam c/ props sólidas
```

**Cache:** `export const dynamic = "force-dynamic"`. Scraper roda 1×/dia; uso pessoal/baixo tráfego não justifica ISR.

**Streaming:** hero render imediato; painéis em `<Suspense>` com skeleton de mesma altura (zero CLS).

**Error handling:**
- `notFound()` se ID inválido
- `detail_json === null` → renderiza hero + msg "stats em breve"
- malformed → guard runtime nos derivers; painel afetado retorna `null`; `console.error`
- Chart crash → `<ChartErrorBoundary>` local com fallback "gráfico indisponível"

---

## Interações principais

### URL state (deep-link)

```
?streaks=Goals,Cards&min_perc=70&player_rank=cards
&scatter_x=sot&scatter_y=goals_ft&recent_stat=corners&tab=streaks
```

Mexer no filtro → `router.replace(...)` sem scroll. Server lê `searchParams` pra pre-filtrar streaks na hidratação.

### Filtros F · streaks (3 camadas, AND entre / OR dentro)

1. Chips dos 10 grupos (Result, BTTS, Goals, Half, Cards, Booking Points, Corners, Shots, Fouls, Offsides)
2. Slider `overall_perc ≥ N` (Radix Slider, range 0-100, default 60)
3. ⌘K cmdk fuzzy match `stat_type` + `desc`

### Keyboard

- ⌘K abre cmdk em F
- ESC fecha drawer/cmdk
- (opcional v2: 1-9 foca painel N)

---

## File tree (26 arquivos novos)

```
app/(dashboard)/fixtures/[id]/stats/
└── page.tsx                       (Server)

lib/fixtures/stats/
├── detail-json-types.ts           (types refletindo inventário)
├── derive.ts + derive.test.ts     (funções puras)
└── insights.ts + insights.test.ts (analytics)

components/fixtures/stats/
├── stats-layout.tsx
├── hero.tsx
└── panels/
    ├── team-record.tsx          (A — Server)
    ├── momentum-chart.tsx       (B — Client lightweight-charts)
    ├── recent-matches.tsx       (C+ — Client recharts LineChart)
    ├── h2h.tsx                  (D — Server)
    ├── splits-1h-2h.tsx         (E — Server)
    ├── streaks-heatmap.tsx      (F — Client + chips/slider/cmdk/virtualizer)
    ├── players.tsx              (G+ — Client ranking + scatter)
    ├── markets-browser.tsx      (H — Client drawer)
    ├── referee.tsx              (I — Server, opt)
    ├── predictions.tsx          (J — Server, opt)
    ├── radar-comparison.tsx     (K — Client RadarChart)
    ├── scatter-playground.tsx   (L — Client ScatterChart + regression)
    ├── distributions.tsx        (M — Server CSS boxplot)
    └── insights.tsx             (N — Server cards)

components/charts/
├── sparkline.tsx                (existente — reusar)
├── form-bar.tsx                 (W/D/L mini)
└── time-series-line.tsx         (LineChart genérico)

tests/integration/
├── stats-page.test.tsx          (happy path)
└── stats-page-empty.test.tsx    (detail_json null fallback)

tests/e2e/
└── stats-page.spec.ts           (Playwright: desktop + mobile)

tests/fixtures/detail-json/
├── epl-chelsea-tottenham.json   (sample completo)
├── liga-mx-prediction.json      (sample com predictions populado)
└── brazil-serieB-noref.json     (sample sem referee_record/odds_summary)
```

---

## Tasks (execution order) — DRAFT

> Decomposição preliminar; ajustar quando `writing-plans` consolidar.

| Task | Name | Dependency | Estimate | Status |
|------|------|------------|----------|--------|
| [T1](T1-detail-json-types-and-derivers.md) | TS types + derivers puros (lib/fixtures/stats/) | None | M | [ ] Pending |
| [T2](T2-insights-engine.md) | Insights engine (correlations + trends + patterns + outliers) | T1 | M | [ ] Pending |
| [T3](T3-stats-page-skeleton.md) | page.tsx + layout grid + hero | T1 | S | [ ] Pending |
| [T4](T4-panels-server-batch.md) | Painéis Server: A, D, E, I, J, M, N | T1, T2 | M | [ ] Pending |
| [T5](T5-panels-client-charts.md) | Painéis Client (charts): B, C+, K, L | T1 | M | [ ] Pending |
| [T6](T6-panel-streaks-and-players.md) | Painéis Client interativos: F (streaks), G+ (players) | T1, T3 | L | [ ] Pending |
| [T7](T7-panel-markets-browser.md) | Painel H · markets browser (drawer opt) | T1 | S | [ ] Pending |
| [T8](T8-mobile-tabs-responsive.md) | Mobile tabs Radix + container queries refinement | T3-T7 | M | [ ] Pending |
| [T9](T9-e2e-and-a11y.md) | Playwright E2E + axe-core a11y | T3-T8 | S | [ ] Pending |
| [T10](T10-bundle-and-launch.md) | bundle-analyzer baseline+delta, ADR no CLAUDE.md, smoke test prod | T9 | S | [ ] Pending |

### Wave possible parallelism

| Wave | Parallel tasks | Prereq |
|------|----------------|--------|
| 1 | T1 | — |
| 2 | T2 + T3 | T1 |
| 3 | T4 + T5 | T1, T2, T3 |
| 4 | T6 + T7 | T1, T3 |
| 5 | T8 | T3-T7 |
| 6 | T9 → T10 | T8 |

---

## Bundle budget

- Baseline (atual): **não medido** — primeiro passo de T10 é rodar `@next/bundle-analyzer` antes de implementar.
- Delta esperado: 0 a +35 KB gzip.
- Budget auto-imposto: **+150 KB gzip** sobre baseline. Bem além do delta esperado.

---

## How to execute

**Start a task em terminal isolado** (após writing-plans consolidar):

```
Read docs/tasks/dashboard-stats-fixture/T{N}-{name}.md and execute it.
Branch: feat/dashboard-stats-T{N}. TDD mandatory. PR to main when done.
```

**Parallelism allowed** — ver tabela "Wave possible parallelism" acima. T1 é gargalo; T2/T3 paralelizam após.

---

## General rules

- **TDD absoluto** — tests first, code after. Cobertura mínima 100% nos derivers e insights (lógica de negócio).
- **One branch per task:** `feat/dashboard-stats-T{N}`.
- **Conventional commits** matching change type: `feat:` para painéis, `test:` para spec-only, `chore:` para infra.
- **Não tocar código fora do declared scope**.
- **CI passa antes de PR aprovado**: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`.
- **NÃO usar `Co-Authored-By: Claude`** nas mensagens de commit (regra global do user, CLAUDE.md§commit-conventions).
- **PR não é self-merge** — Rafael revisa e mergea.

---

## On feature completion

Quando ALL tasks `[x] Completed`:

1. Atualizar header: `**Status:** COMPLETED on YYYY-MM-DD`.
2. Criar `PROGRESS.md` com snapshot de métricas finais (bundle, cobertura testes, lighthouse).
3. Adicionar ADR ao `CLAUDE.md` do Abissal:
   > Charts por papel: recharts (sparkline+radar+scatter+ranking) → lightweight-charts (séries temporais densas) → CSS Grid (heatmap simples) → @visx/heatmap (opcional). NÃO adicionar ECharts/Nivo/Chart.js/react-financial-charts. DuckDB-WASM only em /explore.
4. **NÃO deletar a pasta** — vide archival policy.

---

## Open questions / Decisões TBD

1. **Habilitar React Compiler** (`experimental.reactCompiler: true` em `next.config.ts`)? Decisão cross-route, fora do escopo de `/stats`. Recomendação: avaliar como follow-up autônomo.
2. **Promoção a `@visx/heatmap`** vs CSS Grid puro: decidir após implementar T6 e medir polish/perf.
3. **Investigar `predictions` e `trends` no scraper** (89% empty / 100% empty respectivamente): paralelo, não-blocking.
4. **A11y agressiva (axe-core no CI)** vs apenas validação local: pode entrar em T9 ou ficar como follow-up condicional.

---

## Related artifacts

- Pesquisa formal L2: [`docs/pesquisas/dashboard-stats-fixture-arquitetura.md`](../../pesquisas/dashboard-stats-fixture-arquitetura.md)
- Data dictionary: [`docs/pesquisas/detail-json-inventario.md`](../../pesquisas/detail-json-inventario.md)
- Brainstorm mockups (gitignored): `.superpowers/brainstorm/70751-1778693920/content/*.html`
- Página IA atual: `app/(dashboard)/fixtures/[id]/page.tsx`
- Tokens do design system: `app/globals.css`
