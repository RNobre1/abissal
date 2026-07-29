# Desempenho do modelo por liga — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar, dentro de `/fixtures/[id]`, quanto a simulação acerta naquela liga por mercado, em linguagem de apostador — e traduzir cada projeção da simulação num sinal `+`/`−` de lado de aposta.

**Architecture:** Uma lib pura (`lib/calibracao/market-accuracy.ts`) define o que é "acerto" a partir de `sim_stats` + `actual_*`, reusando as linhas canônicas e o `poissonProbOver` que o recomendador já usa. Um repositório busca as linhas resolvidas filtrando por liga **no Postgres**. Um Server Component recolhido renderiza o agregado. O símbolo `+`/`−` no painel de simulação sai da mesma lib, então sinal e histórico nunca divergem.

**Tech Stack:** TypeScript 5, React 19 (Server Components), Next.js 16 App Router, Vitest, Playwright, Supabase (service_role via `createAdminClient`).

**Spec:** `docs/superpowers/specs/2026-07-29-desempenho-modelo-por-liga-design.md`

## Global Constraints

- **Sem migration.** Nenhuma task cria ou altera schema. O dado já existe.
- **Chave `sot`**, nunca `shots_on_target`, ao ler `sim_stats`. O produtor grava `sot` (`scripts/scraper/lib/scraper/ai_recommender_runner.rb:488`).
- **Limiar de chamada:** `P ≥ 0.55` → over · `P ≤ 0.45` → under · entre os dois → sem chamada (fora do denominador). Convicção alta = `P ≥ 0.70`.
- **Linhas canônicas** (idênticas a `lib/ai-reco/edge-calculator.ts`): escanteios `8.5 · 9.5 · 10.5` · cartões `3.5 · 4.5 · 5.5` · finalizações `7.5 · 9.5 · 10.5` · gols `2.5`.
- **Taxa-base obrigatória.** Todo percentual de acerto vem acompanhado do acerto de "chutar sempre o lado majoritário", e o painel destaca o **lift** (`rate − baseRate`), nunca o acerto cru.
- **Corte de amostra:** liga com `calls < 30` → usa o agregado global, com `sampleTier: "global"` e rótulo explícito na UI.
- **Worker Cloudflare é frágil com payload** (outages 1101/1102 — lições B12/B14/B21/B23). Filtrar por liga no Postgres; **jamais** trazer `fixtures.detail_json`. Nada de `export const runtime = "edge"` (B22).
- **Vitest só coleta** `lib/**/*.test.ts(x)`, `tests/unit/`, `tests/api/`, `tests/integration/`. Teste de componente vai em `tests/unit/`, nunca ao lado do `.tsx`.
- **Sem `Co-Authored-By`** em nenhum commit.
- Comandos de gate: `pnpm test` · `pnpm lint` · `pnpm typecheck`.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `lib/calibracao/market-accuracy.ts` (criar) | Lib pura: o que é chamada, o que é acerto, agregação com baseline e IC. Sem I/O. |
| `lib/calibracao/market-accuracy.test.ts` (criar) | Unitários da lib. |
| `lib/calibracao/market-accuracy.fixtures.ts` (criar) | Uma linha real de `fixture_simulations`, congelada — teste contra o shape do produtor, não contra um shape inventado. |
| `lib/calibracao/sim-reliability.ts` (modificar:421) | Conserto: `shots_on_target` → `sot`. |
| `lib/calibracao/league-accuracy-repository.ts` (criar) | Busca as linhas resolvidas por liga; memoiza o global. |
| `components/fixtures/model-performance-panel.tsx` (criar) | Server Component recolhido com o agregado. |
| `tests/unit/model-performance-panel.test.tsx` (criar) | Testes de render do painel. |
| `app/(dashboard)/fixtures/[id]/page.tsx` (modificar) | Injeta o painel como `PanelSlot`. |
| `app/(dashboard)/fixtures/[id]/_components/simulation-panel.tsx` (modificar:~156-350) | Coluna do sinal `+`/`−`. |
| `tests/e2e/model-performance.spec.ts` (criar) | E2E read-only. |

---

### Task 1: Lib pura — chamada e resultado

**Files:**
- Create: `lib/calibracao/market-accuracy.ts`
- Test: `lib/calibracao/market-accuracy.test.ts`

**Interfaces:**
- Consumes: `poissonProbOver`, `poissonProbUnder` de `lib/ai-reco/dist-helpers.ts`; `DistKMap` de `lib/ai-reco/dist-k-repository.ts`
- Produces:
  - `type CountMarket = "corners" | "cards" | "sot"`
  - `const MARKET_LINES: Record<CountMarket, readonly number[]>`
  - `const CALL_THRESHOLD = 0.55` · `const STRONG_THRESHOLD = 0.7`
  - `interface AccuracyRow` (shape de leitura de `fixture_simulations`)
  - `interface MarketCall { side: "over" | "under" | null; prob: number | null }`
  - `function countTotalMean(simStats: unknown, metric: CountMarket): number | null`
  - `function marketCall(simStats: unknown, metric: CountMarket, line: number, distK?: DistKMap): MarketCall`
  - `function countOutcome(row: AccuracyRow, metric: CountMarket, line: number): boolean | null`

- [ ] **Step 1: Write the failing test**

```ts
// lib/calibracao/market-accuracy.test.ts
import { describe, it, expect } from "vitest";
import {
  countTotalMean,
  marketCall,
  countOutcome,
  MARKET_LINES,
  CALL_THRESHOLD,
  type AccuracyRow,
} from "./market-accuracy";

const simStats = {
  home: { corners: { p10: 3, p50: 6, p90: 10 }, cards: { p10: 0, p50: 1, p90: 4 }, sot: { p10: 2, p50: 5, p90: 8 } },
  away: { corners: { p10: 2, p50: 4, p90: 8 }, cards: { p10: 0, p50: 2, p90: 4 }, sot: { p10: 0, p50: 2, p90: 4 } },
};

function row(over: Partial<AccuracyRow> = {}): AccuracyRow {
  return {
    league: "Serie B",
    sim_stats: simStats,
    p_home: 0.45, p_draw: 0.28, p_away: 0.27,
    p_over_25: 0.52, p_btts: 0.48,
    actual_home_goals: 1, actual_away_goals: 1,
    actual_corners_home: 6, actual_corners_away: 5,
    actual_cards_home: 2, actual_cards_away: 1,
    actual_sot_home: 4, actual_sot_away: 3,
    actual_btts: true,
    correct_winner: false,
    ...over,
  };
}

describe("countTotalMean", () => {
  it("soma o p50 dos dois lados", () => {
    expect(countTotalMean(simStats, "corners")).toBe(10);
    expect(countTotalMean(simStats, "cards")).toBe(3);
    expect(countTotalMean(simStats, "sot")).toBe(7);
  });

  it("usa a chave `sot`, nunca `shots_on_target`", () => {
    const alien = { home: { shots_on_target: { p50: 5 } }, away: { shots_on_target: { p50: 3 } } };
    expect(countTotalMean(alien, "sot")).toBeNull();
  });

  it("cai pra `mean` quando não há p50", () => {
    const m = { home: { corners: { mean: 5 } }, away: { corners: { mean: 4 } } };
    expect(countTotalMean(m, "corners")).toBe(9);
  });

  it("devolve null com um dos lados ausente, malformado ou não-numérico", () => {
    expect(countTotalMean({ home: { corners: { p50: 5 } } }, "corners")).toBeNull();
    expect(countTotalMean({ home: { corners: { p50: "x" } }, away: { corners: { p50: 4 } } }, "corners")).toBeNull();
    expect(countTotalMean(null, "corners")).toBeNull();
    expect(countTotalMean("lixo", "corners")).toBeNull();
    expect(countTotalMean({}, "corners")).toBeNull();
  });
});

describe("marketCall", () => {
  it("chama over quando P >= 0.55", () => {
    // média 10 contra linha 8.5 ⇒ P(over) alto
    const c = marketCall(simStats, "corners", 8.5);
    expect(c.side).toBe("over");
    expect(c.prob).toBeGreaterThanOrEqual(CALL_THRESHOLD);
  });

  it("chama under quando P <= 0.45", () => {
    const c = marketCall(simStats, "cards", 5.5); // média 3 contra 5.5
    expect(c.side).toBe("under");
  });

  it("não chama quando a probabilidade fica na zona morta", () => {
    // média 10 contra linha 9.5 ⇒ Poisson(10) P(>9.5) ≈ 0.542 — dentro de [0.45, 0.55)
    const c = marketCall(simStats, "corners", 9.5);
    expect(c.side).toBeNull();
    expect(c.prob).toBeCloseTo(0.542, 2);
  });

  it("aplica o k de distribuição quando fornecido", () => {
    const semK = marketCall(simStats, "corners", 10.5);
    const comK = marketCall(simStats, "corners", 10.5, { corners: 1.2 });
    expect(comK.prob!).toBeGreaterThan(semK.prob!);
  });

  it("ignora k inválido (zero, negativo, NaN)", () => {
    const base = marketCall(simStats, "corners", 10.5).prob;
    for (const k of [0, -1, NaN]) {
      expect(marketCall(simStats, "corners", 10.5, { corners: k }).prob).toBe(base);
    }
  });

  it("devolve side e prob nulos quando a média não é derivável", () => {
    expect(marketCall(null, "corners", 9.5)).toEqual({ side: null, prob: null });
  });
});

describe("countOutcome", () => {
  it("true quando o total supera a linha", () => {
    expect(countOutcome(row(), "corners", 9.5)).toBe(true); // 6+5=11
  });

  it("false quando o total fica abaixo", () => {
    expect(countOutcome(row(), "corners", 10.5)).toBe(false); // 11 > 10.5 → true
    expect(countOutcome(row({ actual_corners_home: 4, actual_corners_away: 4 }), "corners", 9.5)).toBe(false);
  });

  it("resolve os adjacentes da linha sem ambiguidade", () => {
    const r = (t: number) => row({ actual_corners_home: t, actual_corners_away: 0 });
    expect(countOutcome(r(9), "corners", 9.5)).toBe(false);
    expect(countOutcome(r(10), "corners", 9.5)).toBe(true);
  });

  it("devolve null quando qualquer lado do actual falta", () => {
    expect(countOutcome(row({ actual_corners_home: null }), "corners", 9.5)).toBeNull();
    expect(countOutcome(row({ actual_corners_away: null }), "corners", 9.5)).toBeNull();
  });
});

describe("MARKET_LINES", () => {
  it("espelha as linhas canônicas do edge-calculator", () => {
    expect(MARKET_LINES.corners).toEqual([8.5, 9.5, 10.5]);
    expect(MARKET_LINES.cards).toEqual([3.5, 4.5, 5.5]);
    expect(MARKET_LINES.sot).toEqual([7.5, 9.5, 10.5]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/calibracao/market-accuracy.test.ts`
Expected: FAIL — `Failed to resolve import "./market-accuracy"`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/calibracao/market-accuracy.ts
/**
 * Define o que é ACERTO da simulação, mercado a mercado, em termos de aposta:
 * "quando ela apontou menos de 9.5 escanteios, quantas vezes bateu?".
 *
 * Reusa as linhas canônicas e a conversão média→probabilidade do
 * `lib/ai-reco/edge-calculator.ts`, de propósito: o número que aparece no painel
 * de acerto é o MESMO que entra no edge da recomendação. Duas definições de
 * acerto divergentes seriam pior que nenhuma.
 *
 * Puro — sem I/O, sem Supabase, sem React. Serve o painel do jogo, /calibracao
 * e qualquer backtest futuro.
 */
import { poissonProbOver, poissonProbUnder } from "@/lib/ai-reco/dist-helpers";
import type { DistKMap } from "@/lib/ai-reco/dist-k-repository";

/** Mercados de contagem — os que precisam de linha pra virar binário. */
export type CountMarket = "corners" | "cards" | "sot";

/**
 * Linhas canônicas. IDÊNTICAS às de `lib/ai-reco/edge-calculator.ts`
 * (cornerLines/cardLines/sotLines). Se uma mudar lá, muda aqui.
 */
export const MARKET_LINES: Record<CountMarket, readonly number[]> = {
  corners: [8.5, 9.5, 10.5],
  cards: [3.5, 4.5, 5.5],
  sot: [7.5, 9.5, 10.5],
};

/** Convicção mínima pra a simulação "chamar" um lado. Abaixo disso não conta. */
export const CALL_THRESHOLD = 0.55;
/** Convicção alta — vira `++`/`−−` na UI. */
export const STRONG_THRESHOLD = 0.7;

/** Linha resolvida de `fixture_simulations`, só as colunas que a lib usa. */
export interface AccuracyRow {
  league: string | null;
  sim_stats: unknown;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  p_over_25: number | null;
  p_btts: number | null;
  actual_home_goals: number | null;
  actual_away_goals: number | null;
  actual_corners_home: number | null;
  actual_corners_away: number | null;
  actual_cards_home: number | null;
  actual_cards_away: number | null;
  actual_sot_home: number | null;
  actual_sot_away: number | null;
  actual_btts: boolean | null;
  correct_winner: boolean | null;
}

export interface MarketCall {
  side: "over" | "under" | null;
  prob: number | null;
}

const ACTUAL_KEYS: Record<CountMarket, [keyof AccuracyRow, keyof AccuracyRow]> = {
  corners: ["actual_corners_home", "actual_corners_away"],
  cards: ["actual_cards_home", "actual_cards_away"],
  sot: ["actual_sot_home", "actual_sot_away"],
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function sideMean(simStats: unknown, side: "home" | "away", metric: CountMarket): number | null {
  if (!simStats || typeof simStats !== "object") return null;
  const bucket = (simStats as Record<string, unknown>)[side];
  if (!bucket || typeof bucket !== "object") return null;
  const node = (bucket as Record<string, unknown>)[metric];
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  return num(n.p50) ?? num(n.mean);
}

/**
 * Média esperada do TOTAL do jogo (casa + fora), a partir do p50 de cada lado.
 * Espelha `secondary_stat_total_mean` do ai_recommender_runner.rb — inclusive a
 * chave `sot` (NÃO `shots_on_target`; ver Global Constraints).
 */
export function countTotalMean(simStats: unknown, metric: CountMarket): number | null {
  const h = sideMean(simStats, "home", metric);
  const a = sideMean(simStats, "away", metric);
  if (h === null || a === null) return null;
  return h + a;
}

function positiveK(distK: DistKMap | undefined, metric: CountMarket): number | null {
  const v = distK?.[metric];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Que lado a simulação chama nessa linha, e com que convicção.
 * `side: null` = zona morta (|P − 0.5| < 0.05): não conta como acerto nem erro.
 */
export function marketCall(
  simStats: unknown,
  metric: CountMarket,
  line: number,
  distK?: DistKMap,
): MarketCall {
  const raw = countTotalMean(simStats, metric);
  if (raw === null) return { side: null, prob: null };
  const k = positiveK(distK, metric);
  const mean = k === null ? raw : raw * k;
  const prob = poissonProbOver(mean, line);
  if (prob >= CALL_THRESHOLD) return { side: "over", prob };
  if (prob <= 1 - CALL_THRESHOLD) return { side: "under", prob };
  return { side: null, prob };
}

/** O total real passou da linha? `null` quando o actual não está disponível. */
export function countOutcome(
  row: AccuracyRow,
  metric: CountMarket,
  line: number,
): boolean | null {
  const [hk, ak] = ACTUAL_KEYS[metric];
  const h = num(row[hk]);
  const a = num(row[ak]);
  if (h === null || a === null) return null;
  return h + a > line;
}

// `poissonProbUnder` fica reexportado para o consumidor que precisa do
// complemento explícito sem recalcular 1 − p (evita erro de arredondamento).
export { poissonProbUnder };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/calibracao/market-accuracy.test.ts`
Expected: PASS — todos os blocos verdes.

Se `marketCall(simStats, "corners", 9.5)` não cair na zona morta, **não mude o limiar**: confira `poissonProbOver(10, 9.5)` no console e ajuste o valor esperado do teste para o real, mantendo a asserção de que fica em `[0.45, 0.55)`.

- [ ] **Step 5: Commit**

```bash
git add lib/calibracao/market-accuracy.ts lib/calibracao/market-accuracy.test.ts
git commit -m "feat(calibracao): lib pura de acerto por mercado e linha"
```

---

### Task 2: Agregação com taxa-base e IC

**Files:**
- Modify: `lib/calibracao/market-accuracy.ts`
- Modify: `lib/calibracao/market-accuracy.test.ts`

**Interfaces:**
- Consumes: `wilsonInterval(successes, n, z?) → { lo, hi, center }` de `lib/calibracao/wilson-ic.ts`; tudo da Task 1
- Produces:
  - `interface MarketAccuracy { market: string; label: string; line: number | null; dominantSide: "over" | "under" | null; calls: number; hits: number; rate: number; baseRate: number; lift: number; ci95: { lo: number; hi: number }; sampleTier: "liga" | "global" }`
  - `function marketAccuracies(rows: AccuracyRow[], opts?: { distK?: DistKMap; tier?: "liga" | "global" }): MarketAccuracy[]`
  - `const MIN_LEAGUE_CALLS = 30`

- [ ] **Step 1: Write the failing test**

```ts
// append em lib/calibracao/market-accuracy.test.ts
import { marketAccuracies, MIN_LEAGUE_CALLS, type MarketAccuracy } from "./market-accuracy";

/** Linha com escanteios controlados: sim aponta X, real dá `total`. */
function cornersRow(homeP50: number, awayP50: number, total: number): AccuracyRow {
  return row({
    sim_stats: {
      home: { corners: { p50: homeP50 }, cards: { p50: 1 }, sot: { p50: 4 } },
      away: { corners: { p50: awayP50 }, cards: { p50: 1 }, sot: { p50: 3 } },
    },
    actual_corners_home: total,
    actual_corners_away: 0,
  });
}

describe("marketAccuracies", () => {
  it("conta acerto só sobre as chamadas, não sobre o universo", () => {
    const rows = [
      cornersRow(7, 7, 20), // média 14 vs 8.5 ⇒ over, real 20 ⇒ acerto
      cornersRow(7, 7, 2), //  over, real 2 ⇒ erro
      cornersRow(5, 5, 20), // média 10 vs 9.5 ⇒ zona morta, não conta
    ];
    const out = marketAccuracies(rows).find((m) => m.market === "corners")!;
    expect(out.calls).toBe(2);
    expect(out.hits).toBe(1);
    expect(out.rate).toBeCloseTo(0.5, 6);
  });

  it("calcula a taxa-base sobre o universo, não sobre as chamadas", () => {
    // 4 jogos: 3 under, 1 over ⇒ taxa-base = 0.75 (chutar sempre under)
    const rows = [cornersRow(7, 7, 2), cornersRow(7, 7, 2), cornersRow(7, 7, 2), cornersRow(7, 7, 20)];
    const out = marketAccuracies(rows).find((m) => m.market === "corners")!;
    expect(out.baseRate).toBeCloseTo(0.75, 6);
    expect(out.lift).toBeCloseTo(out.rate - out.baseRate, 6);
  });

  it("escolhe a linha com mais chamadas quando várias qualificam", () => {
    const rows = Array.from({ length: 10 }, () => cornersRow(2, 2, 3)); // média 4: chama under em todas
    const out = marketAccuracies(rows).find((m) => m.market === "corners")!;
    expect(MARKET_LINES.corners).toContain(out.line!);
    expect(out.calls).toBe(10);
    expect(out.dominantSide).toBe("under");
  });

  it("devolve IC95 de Wilson coerente com o acerto", () => {
    const rows = Array.from({ length: 40 }, (_, i) => cornersRow(7, 7, i < 30 ? 20 : 2));
    const out = marketAccuracies(rows).find((m) => m.market === "corners")!;
    expect(out.rate).toBeCloseTo(0.75, 2);
    expect(out.ci95.lo).toBeLessThan(out.rate);
    expect(out.ci95.hi).toBeGreaterThan(out.rate);
    expect(out.ci95.lo).toBeGreaterThanOrEqual(0);
    expect(out.ci95.hi).toBeLessThanOrEqual(1);
  });

  it("marca o tier recebido e não inventa dado", () => {
    const out = marketAccuracies([cornersRow(7, 7, 20)], { tier: "global" });
    expect(out.every((m) => m.sampleTier === "global")).toBe(true);
  });

  it("omite mercado sem nenhuma chamada", () => {
    const semCards = [row({ sim_stats: { home: { corners: { p50: 7 } }, away: { corners: { p50: 7 } } } })];
    const out = marketAccuracies(semCards);
    expect(out.find((m) => m.market === "cards")).toBeUndefined();
  });

  it("cobre 1x2, gols e btts sem depender de linha de contagem", () => {
    const rows = [
      row({ correct_winner: true, p_over_25: 0.8, actual_home_goals: 2, actual_away_goals: 2, p_btts: 0.9, actual_btts: true }),
      row({ correct_winner: false, p_over_25: 0.8, actual_home_goals: 0, actual_away_goals: 0, p_btts: 0.9, actual_btts: false }),
    ];
    const out = marketAccuracies(rows);
    const m1x2 = out.find((m) => m.market === "1x2")!;
    expect(m1x2.calls).toBe(2);
    expect(m1x2.hits).toBe(1);
    const gols = out.find((m) => m.market === "goals")!;
    expect(gols.line).toBe(2.5);
    expect(gols.calls).toBe(2);
    expect(gols.hits).toBe(1); // 4 gols acerta over, 0 gol erra
    const btts = out.find((m) => m.market === "btts")!;
    expect(btts.calls).toBe(2);
    expect(btts.hits).toBe(1);
  });

  it("não conta linha sem actual", () => {
    const out = marketAccuracies([row({ actual_corners_home: null, actual_corners_away: null })]);
    expect(out.find((m) => m.market === "corners")).toBeUndefined();
  });

  it("MIN_LEAGUE_CALLS é 30", () => {
    expect(MIN_LEAGUE_CALLS).toBe(30);
  });

  it("aguenta lista vazia", () => {
    expect(marketAccuracies([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/calibracao/market-accuracy.test.ts`
Expected: FAIL — `marketAccuracies is not a function`

- [ ] **Step 3: Write minimal implementation**

```ts
// append em lib/calibracao/market-accuracy.ts
import { wilsonInterval } from "@/lib/calibracao/wilson-ic";

/** Abaixo disso a liga não sustenta número próprio — cai pro global. */
export const MIN_LEAGUE_CALLS = 30;

export interface MarketAccuracy {
  /** "corners" | "cards" | "sot" | "goals" | "1x2" | "btts" */
  market: string;
  /** Rótulo pronto pra UI, em PT-BR. Ex: "escanteios · menos de 9.5". */
  label: string;
  line: number | null;
  dominantSide: "over" | "under" | null;
  calls: number;
  hits: number;
  rate: number;
  /** Acerto de chutar sempre o lado majoritário do universo. */
  baseRate: number;
  /** rate − baseRate. É o que a UI destaca. */
  lift: number;
  ci95: { lo: number; hi: number };
  sampleTier: "liga" | "global";
}

const MARKET_LABEL: Record<string, string> = {
  corners: "escanteios",
  cards: "cartões",
  sot: "finalizações no alvo",
  goals: "gols",
  "1x2": "resultado (1x2)",
  btts: "ambos marcam",
};

interface Tally {
  calls: number;
  hits: number;
  overs: number;
  universe: number;
  side: { over: number; under: number };
}

const emptyTally = (): Tally => ({ calls: 0, hits: 0, overs: 0, universe: 0, side: { over: 0, under: 0 } });

function finish(
  market: string,
  line: number | null,
  t: Tally,
  tier: "liga" | "global",
): MarketAccuracy | null {
  if (t.calls === 0) return null;
  const rate = t.hits / t.calls;
  const overRate = t.universe ? t.overs / t.universe : 0;
  const baseRate = Math.max(overRate, 1 - overRate);
  const ci = wilsonInterval(t.hits, t.calls);
  const dominantSide =
    t.side.over === t.side.under ? null : t.side.over > t.side.under ? "over" : "under";
  const lineLabel =
    line === null
      ? ""
      : ` · ${dominantSide === "under" ? "menos de" : "mais de"} ${line}`;
  return {
    market,
    label: `${MARKET_LABEL[market] ?? market}${lineLabel}`,
    line,
    dominantSide,
    calls: t.calls,
    hits: t.hits,
    rate,
    baseRate,
    lift: rate - baseRate,
    ci95: { lo: ci.lo, hi: ci.hi },
    sampleTier: tier,
  };
}

/** Acumula uma decisão binária genérica (chamada + resultado) num tally. */
function record(t: Tally, side: "over" | "under" | null, outcome: boolean | null) {
  if (outcome === null) return;
  t.universe++;
  if (outcome) t.overs++;
  if (side === null) return;
  t.calls++;
  t.side[side]++;
  if ((side === "over") === outcome) t.hits++;
}

/**
 * Agrega o acerto por mercado. Para os mercados de contagem, avalia TODAS as
 * linhas canônicas e devolve a com mais chamadas — é a que a liga de fato
 * oferece decisão, e olhar as três na UI seria ruído.
 */
export function marketAccuracies(
  rows: AccuracyRow[],
  opts?: { distK?: DistKMap; tier?: "liga" | "global" },
): MarketAccuracy[] {
  const tier = opts?.tier ?? "liga";
  const out: MarketAccuracy[] = [];

  for (const metric of Object.keys(MARKET_LINES) as CountMarket[]) {
    let best: { line: number; t: Tally } | null = null;
    for (const line of MARKET_LINES[metric]) {
      const t = emptyTally();
      for (const r of rows) {
        record(t, marketCall(r.sim_stats, metric, line, opts?.distK).side, countOutcome(r, metric, line));
      }
      if (best === null || t.calls > best.t.calls) best = { line, t };
    }
    const acc = best && finish(metric, best.line, best.t, tier);
    if (acc) out.push(acc);
  }

  // gols — p_over_25 já é a probabilidade da linha 2.5, sem Poisson no meio
  const gols = emptyTally();
  for (const r of rows) {
    const p = num(r.p_over_25);
    const h = num(r.actual_home_goals);
    const a = num(r.actual_away_goals);
    const outcome = h === null || a === null ? null : h + a > 2.5;
    const side = p === null ? null : p >= CALL_THRESHOLD ? "over" : p <= 1 - CALL_THRESHOLD ? "under" : null;
    record(gols, side, outcome);
  }
  const golsAcc = finish("goals", 2.5, gols, tier);
  if (golsAcc) out.push(golsAcc);

  // btts — "over" = ambos marcam
  const btts = emptyTally();
  for (const r of rows) {
    const p = num(r.p_btts);
    const outcome = typeof r.actual_btts === "boolean" ? r.actual_btts : null;
    const side = p === null ? null : p >= CALL_THRESHOLD ? "over" : p <= 1 - CALL_THRESHOLD ? "under" : null;
    record(btts, side, outcome);
  }
  const bttsAcc = finish("btts", null, btts, tier);
  if (bttsAcc) out.push(bttsAcc);

  // 1x2 — a chamada é sempre o lado de maior probabilidade; o reconciler já
  // gravou o veredito em correct_winner, então não recomputamos o resultado.
  const um = emptyTally();
  for (const r of rows) {
    if (typeof r.correct_winner !== "boolean") continue;
    const ps = [num(r.p_home), num(r.p_draw), num(r.p_away)];
    if (ps.some((p) => p === null)) continue;
    um.universe++;
    um.calls++;
    um.side.over++;
    if (r.correct_winner) {
      um.hits++;
      um.overs++;
    }
  }
  // taxa-base do 1x2 = acertar sempre o favorito seria circular; usamos o
  // chute uniforme de 3 vias, que é a régua honesta pra um mercado ternário.
  if (um.calls > 0) {
    const rate = um.hits / um.calls;
    const ci = wilsonInterval(um.hits, um.calls);
    out.push({
      market: "1x2",
      label: MARKET_LABEL["1x2"],
      line: null,
      dominantSide: null,
      calls: um.calls,
      hits: um.hits,
      rate,
      baseRate: 1 / 3,
      lift: rate - 1 / 3,
      ci95: { lo: ci.lo, hi: ci.hi },
      sampleTier: tier,
    });
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/calibracao/market-accuracy.test.ts && pnpm typecheck`
Expected: PASS + typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add lib/calibracao/market-accuracy.ts lib/calibracao/market-accuracy.test.ts
git commit -m "feat(calibracao): agrega acerto por mercado com taxa-base e IC95"
```

---

### Task 3: Teste contra o shape real + conserto do `sotCrps`

O projeto já perdeu tempo com quatro bugs da mesma classe (chave/símbolo divergindo do shape real do produtor). Esta task trava a lib contra uma linha real e conserta o `sotCrps`, que sofre exatamente disso.

**Files:**
- Create: `lib/calibracao/market-accuracy.fixtures.ts`
- Modify: `lib/calibracao/market-accuracy.test.ts`
- Modify: `lib/calibracao/sim-reliability.ts:17,42,310,415,421`
- Modify: `lib/calibracao/sim-reliability.test.ts` (se existir teste de `sotCrps`)

**Interfaces:**
- Produces: `const REAL_SIM_STATS: unknown` — cópia literal de uma linha de produção.

- [ ] **Step 1: Write the failing test**

```ts
// lib/calibracao/market-accuracy.fixtures.ts
/**
 * `sim_stats` copiado LITERALMENTE de uma linha de `fixture_simulations` em
 * produção (2026-07-29). Não editar à mão: é a defesa contra a classe de bug
 * "código lê uma chave que o produtor nunca gravou" — a mesma que deixou
 * `sotCrps()` devolvendo null desde que foi escrito.
 *
 * Note a chave `sot` (NÃO `shots_on_target`) e a presença de fouls/tackles/
 * offsides, que não têm linha de mercado.
 */
export const REAL_SIM_STATS = {
  away: {
    sot: { p10: 0, p50: 2, p90: 4 },
    cards: { p10: 0, p50: 2, p90: 4 },
    fouls: { p10: 3, p50: 10, p90: 22 },
    goals: { p10: 0, p50: 1, p90: 3 },
    corners: { p10: 3, p50: 6, p90: 10, p10_1h: 0, p10_2h: 0, p50_1h: 0, p50_2h: 0, p90_1h: 0, p90_2h: 0 },
    tackles: { p10: 1, p50: 4, p90: 11 },
    offsides: { p10: 0, p50: 1, p90: 3 },
  },
  home: {
    sot: { p10: 2, p50: 5, p90: 8 },
    cards: { p10: 0, p50: 1, p90: 4 },
    fouls: { p10: 3, p50: 10, p90: 22 },
    goals: { p10: 0, p50: 1, p90: 3 },
    corners: { p10: 3, p50: 6, p90: 10, p10_1h: 0, p10_2h: 0, p50_1h: 0, p50_2h: 0, p90_1h: 0, p90_2h: 0 },
    tackles: { p10: 1, p50: 4, p90: 11 },
    offsides: { p10: 0, p50: 1, p90: 3 },
  },
} as const;
```

```ts
// append em lib/calibracao/market-accuracy.test.ts
import { REAL_SIM_STATS } from "./market-accuracy.fixtures";

describe("shape real do produtor", () => {
  it("deriva média dos três mercados de contagem numa linha de produção", () => {
    expect(countTotalMean(REAL_SIM_STATS, "corners")).toBe(12);
    expect(countTotalMean(REAL_SIM_STATS, "cards")).toBe(3);
    expect(countTotalMean(REAL_SIM_STATS, "sot")).toBe(7);
  });

  it("produz chamada em todos os mercados de contagem", () => {
    for (const metric of ["corners", "cards", "sot"] as const) {
      const anyCall = MARKET_LINES[metric].some((l) => marketCall(REAL_SIM_STATS, metric, l).side !== null);
      expect(anyCall, `nenhuma chamada em ${metric}`).toBe(true);
    }
  });
});
```

```ts
// append em lib/calibracao/sim-reliability.test.ts
import { sotCrps } from "./sim-reliability";
import { REAL_SIM_STATS } from "./market-accuracy.fixtures";

describe("sotCrps contra o shape real", () => {
  it("não devolve null quando sim_stats e actuals existem (regressão: lia shots_on_target)", () => {
    const rows = [
      {
        league: "Serie B", sim_stats: REAL_SIM_STATS,
        p_home: 0.4, p_draw: 0.3, p_away: 0.3, p_over_25: 0.5, p_btts: 0.5, market_anchor: null,
        actual_home_goals: 1, actual_away_goals: 1, actual_resolved_at: "2026-07-01T00:00:00Z",
        actual_btts: true, actual_corners_home: 6, actual_corners_away: 5,
        actual_cards_home: 2, actual_cards_away: 1, actual_sot_home: 4, actual_sot_away: 3,
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(sotCrps(rows as any)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/calibracao/market-accuracy.test.ts lib/calibracao/sim-reliability.test.ts`
Expected: o teste de `sotCrps` FALHA com `expected null not to be null` — a prova de que a chave errada mata a métrica.

- [ ] **Step 3: Write minimal implementation**

Em `lib/calibracao/sim-reliability.ts`, trocar a chave lida. Quatro pontos:

```ts
// linha 17 — comentário do shape
// sim_stats JSON shape: { home: { corners: {p10,p50,p90}, cards: {...}, sot: {...} },

// linha 42 — campo da interface SimStatsSide
  sot?: SimStatsMetric | null;

// linha 310 — docstring
 * @param simMetric - key in sim_stats (e.g. "corners", "cards", "sot")

// linha 415 — docstring de sotCrps
 * Mean CRPS for shots-on-target (home + away total) vs sim_stats.*.sot.

// linha 421 — A CORREÇÃO
    "sot",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/calibracao/ && pnpm typecheck`
Expected: PASS. Se outro teste referenciava `shots_on_target` num mock, ajuste o mock para `sot` — o mock é que estava errado.

- [ ] **Step 5: Commit**

```bash
git add lib/calibracao/market-accuracy.fixtures.ts lib/calibracao/market-accuracy.test.ts lib/calibracao/sim-reliability.ts lib/calibracao/sim-reliability.test.ts
git commit -m "fix(calibracao): sotCrps lia shots_on_target; produtor grava sot"
```

---

### Task 4: Repositório

**Files:**
- Create: `lib/calibracao/league-accuracy-repository.ts`
- Test: `tests/unit/league-accuracy-repository.test.ts`

**Interfaces:**
- Consumes: `marketAccuracies`, `MIN_LEAGUE_CALLS`, `AccuracyRow` da Task 2; `getDistK` de `lib/ai-reco/dist-k-repository.ts`
- Produces:
  - `interface LeaguePerformance { league: string | null; tier: "liga" | "global"; leagueCalls: number; markets: MarketAccuracy[]; window: { from: string | null; to: string | null } }`
  - `function getLeaguePerformance(league: string | null, modelVersion: string | null, supabase: AnySupabase): Promise<LeaguePerformance | null>`
  - `function __resetGlobalCache(): void` (só para teste)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/league-accuracy-repository.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  getLeaguePerformance,
  __resetGlobalCache,
} from "@/lib/calibracao/league-accuracy-repository";

const SIM = {
  home: { corners: { p50: 7 }, cards: { p50: 1 }, sot: { p50: 4 } },
  away: { corners: { p50: 7 }, cards: { p50: 1 }, sot: { p50: 3 } },
};

function rows(n: number, league: string) {
  return Array.from({ length: n }, () => ({
    league, sim_stats: SIM,
    p_home: 0.5, p_draw: 0.25, p_away: 0.25, p_over_25: 0.6, p_btts: 0.5,
    actual_home_goals: 2, actual_away_goals: 1,
    actual_corners_home: 12, actual_corners_away: 4,
    actual_cards_home: 2, actual_cards_away: 1,
    actual_sot_home: 5, actual_sot_away: 4,
    actual_btts: true, correct_winner: true,
    kickoff_utc: "2026-07-01T00:00:00Z",
  }));
}

/** Stub mínimo do supabase-js: só o encadeamento que o repo usa. */
function stub(byLeague: Record<string, unknown[]>, all: unknown[]) {
  const calls: { table: string; league?: string }[] = [];
  return {
    calls,
    from(table: string) {
      const q: Record<string, unknown> = {};
      let pickedLeague: string | undefined;
      const chain = {
        select: () => chain,
        eq: (col: string, val: string) => {
          if (col === "league") pickedLeague = val;
          return chain;
        },
        is: () => chain,
        not: () => chain,
        limit: () => chain,
        then: (res: (v: unknown) => void) => {
          calls.push({ table, league: pickedLeague });
          const data = pickedLeague ? (byLeague[pickedLeague] ?? []) : all;
          return Promise.resolve({ data, error: null }).then(res);
        },
      };
      void q;
      return chain;
    },
  };
}

describe("getLeaguePerformance", () => {
  beforeEach(() => __resetGlobalCache());

  it("usa o número da própria liga quando há chamadas suficientes", async () => {
    const sb = stub({ "Serie B": rows(60, "Serie B") }, rows(200, "X"));
    const out = await getLeaguePerformance("Serie B", "sim-v7", sb);
    expect(out!.tier).toBe("liga");
    expect(out!.league).toBe("Serie B");
    expect(out!.markets.every((m) => m.sampleTier === "liga")).toBe(true);
  });

  it("cai pro global quando a liga tem menos de 30 chamadas", async () => {
    const sb = stub({ "Liga Pequena": rows(5, "Liga Pequena") }, rows(200, "X"));
    const out = await getLeaguePerformance("Liga Pequena", "sim-v7", sb);
    expect(out!.tier).toBe("global");
    expect(out!.leagueCalls).toBeLessThan(30);
    expect(out!.markets.every((m) => m.sampleTier === "global")).toBe(true);
  });

  it("filtra por liga NO POSTGRES, não em memória", async () => {
    const sb = stub({ "Serie B": rows(60, "Serie B") }, rows(200, "X"));
    await getLeaguePerformance("Serie B", "sim-v7", sb);
    expect(sb.calls.some((c) => c.league === "Serie B")).toBe(true);
  });

  it("memoiza o agregado global entre chamadas", async () => {
    const sb = stub({ A: rows(2, "A"), B: rows(2, "B") }, rows(200, "X"));
    await getLeaguePerformance("A", "sim-v7", sb);
    const before = sb.calls.filter((c) => c.league === undefined).length;
    await getLeaguePerformance("B", "sim-v7", sb);
    const after = sb.calls.filter((c) => c.league === undefined).length;
    expect(after).toBe(before);
  });

  it("devolve null quando não há liga", async () => {
    const sb = stub({}, []);
    expect(await getLeaguePerformance(null, "sim-v7", sb)).toBeNull();
  });

  it("degrada pra null sem lançar quando a query falha", async () => {
    const boom = {
      from: () => ({
        select: () => ({ eq: () => ({ is: () => ({ not: () => ({ limit: () => ({
          then: (r: (v: unknown) => void) => Promise.resolve({ data: null, error: { message: "boom" } }).then(r),
        }) }) }) }) }),
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await getLeaguePerformance("Serie B", "sim-v7", boom as any)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/league-accuracy-repository.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/calibracao/league-accuracy-repository.ts
/**
 * Leitura das simulações resolvidas para o painel de desempenho por liga.
 *
 * RESTRIÇÃO DE PLATAFORMA (B12/B14/B21/B23): o Worker Cloudflare já caiu duas
 * vezes por payload (outages 1101/1102). Aqui isso significa: filtrar por liga
 * NO POSTGRES, selecionar só as colunas usadas, e JAMAIS tocar
 * `fixtures.detail_json`. Uma liga mediana devolve ~32 linhas; a maior, 162.
 *
 * O agregado global (fallback de amostra baixa) varreria os ~2.3k jogos a cada
 * request — por isso é memoizado por processo. Se medir pesado em produção, o
 * passo seguinte é empurrar a agregação pra SQL no molde de `fixture_badges_view`,
 * NÃO aumentar o payload.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDistK, type DistKMap } from "@/lib/ai-reco/dist-k-repository";
import {
  marketAccuracies,
  MIN_LEAGUE_CALLS,
  type AccuracyRow,
  type MarketAccuracy,
} from "@/lib/calibracao/market-accuracy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any> | any;

const COLUMNS =
  "league,sim_stats,p_home,p_draw,p_away,p_over_25,p_btts," +
  "actual_home_goals,actual_away_goals,actual_corners_home,actual_corners_away," +
  "actual_cards_home,actual_cards_away,actual_sot_home,actual_sot_away," +
  "actual_btts,correct_winner,kickoff_utc";

/** Teto de linhas por liga — a maior liga tem 162; 600 é folga larga. */
const LEAGUE_LIMIT = 600;
/** Teto do agregado global. */
const GLOBAL_LIMIT = 4000;

export interface LeaguePerformance {
  league: string | null;
  tier: "liga" | "global";
  /** Chamadas encontradas na liga — mostrado mesmo quando o tier é global. */
  leagueCalls: number;
  markets: MarketAccuracy[];
  window: { from: string | null; to: string | null };
}

type RowWithKickoff = AccuracyRow & { kickoff_utc: string | null };

let globalCache: { markets: MarketAccuracy[]; window: LeaguePerformance["window"] } | null = null;

/** Só para teste — zera a memoização do agregado global. */
export function __resetGlobalCache(): void {
  globalCache = null;
}

function windowOf(rows: RowWithKickoff[]): LeaguePerformance["window"] {
  const ks = rows.map((r) => r.kickoff_utc).filter((k): k is string => typeof k === "string").sort();
  return { from: ks[0] ?? null, to: ks[ks.length - 1] ?? null };
}

function totalCalls(markets: MarketAccuracy[]): number {
  return markets.reduce((s, m) => s + m.calls, 0);
}

async function fetchRows(
  supabase: AnySupabase,
  league: string | null,
  limit: number,
): Promise<RowWithKickoff[] | null> {
  try {
    let q = supabase
      .from("fixture_simulations")
      .select(COLUMNS)
      .eq("status", "resolved")
      .not("sim_stats", "is", null)
      .limit(limit);
    if (league !== null) q = q.eq("league", league);
    const { data, error } = await q;
    if (error || !Array.isArray(data)) return null;
    return data as RowWithKickoff[];
  } catch {
    return null;
  }
}

async function globalPerformance(
  supabase: AnySupabase,
  distK: DistKMap,
): Promise<{ markets: MarketAccuracy[]; window: LeaguePerformance["window"] } | null> {
  if (globalCache) return globalCache;
  const rows = await fetchRows(supabase, null, GLOBAL_LIMIT);
  if (!rows) return null;
  globalCache = {
    markets: marketAccuracies(rows, { distK, tier: "global" }),
    window: windowOf(rows),
  };
  return globalCache;
}

/**
 * Desempenho do modelo na liga. Cai pro agregado global quando a liga não
 * sustenta amostra (< MIN_LEAGUE_CALLS chamadas somadas). Nunca lança.
 */
export async function getLeaguePerformance(
  league: string | null,
  modelVersion: string | null,
  supabase: AnySupabase,
): Promise<LeaguePerformance | null> {
  if (!league) return null;

  const distK = await getDistK(modelVersion ?? "", supabase);
  const rows = await fetchRows(supabase, league, LEAGUE_LIMIT);
  if (!rows) return null;

  const leagueMarkets = marketAccuracies(rows, { distK, tier: "liga" });
  const leagueCalls = totalCalls(leagueMarkets);

  if (leagueCalls >= MIN_LEAGUE_CALLS) {
    return { league, tier: "liga", leagueCalls, markets: leagueMarkets, window: windowOf(rows) };
  }

  const global = await globalPerformance(supabase, distK);
  if (!global) return null;
  return { league, tier: "global", leagueCalls, markets: global.markets, window: global.window };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/league-accuracy-repository.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/calibracao/league-accuracy-repository.ts tests/unit/league-accuracy-repository.test.ts
git commit -m "feat(calibracao): repositorio de desempenho por liga com fallback global"
```

---

### Task 5: Painel na tela do jogo

**Files:**
- Create: `components/fixtures/model-performance-panel.tsx`
- Test: `tests/unit/model-performance-panel.test.tsx`
- Modify: `app/(dashboard)/fixtures/[id]/page.tsx`

**Interfaces:**
- Consumes: `LeaguePerformance` da Task 4; `PanelSlot` de `components/fixtures/stats/stats-layout.tsx`
- Produces: `function ModelPerformancePanel(props: { perf: LeaguePerformance | null }): ReactNode`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/model-performance-panel.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModelPerformancePanel } from "@/components/fixtures/model-performance-panel";
import type { LeaguePerformance } from "@/lib/calibracao/league-accuracy-repository";
import type { MarketAccuracy } from "@/lib/calibracao/market-accuracy";

function market(over: Partial<MarketAccuracy> = {}): MarketAccuracy {
  return {
    market: "corners", label: "escanteios · menos de 9.5", line: 9.5, dominantSide: "under",
    calls: 52, hits: 33, rate: 0.635, baseRate: 0.54, lift: 0.095,
    ci95: { lo: 0.5, hi: 0.75 }, sampleTier: "liga", ...over,
  };
}

function perf(over: Partial<LeaguePerformance> = {}): LeaguePerformance {
  return {
    league: "Serie B", tier: "liga", leagueCalls: 104, markets: [market()],
    window: { from: "2026-05-18T00:00:00Z", to: "2026-07-29T00:00:00Z" }, ...over,
  };
}

describe("ModelPerformancePanel", () => {
  it("mostra o mercado, o n e o acerto", () => {
    render(<ModelPerformancePanel perf={perf()} />);
    expect(screen.getByText(/escanteios/)).toBeTruthy();
    expect(screen.getByText(/52/)).toBeTruthy();
    expect(screen.getByText(/64%|63%/)).toBeTruthy();
  });

  it("mostra o lift ao lado do acerto, nunca o acerto sozinho", () => {
    render(<ModelPerformancePanel perf={perf()} />);
    expect(screen.getByText(/\+10pp|\+9pp/)).toBeTruthy();
  });

  it("avisa quando caiu pro global por amostra baixa", () => {
    render(<ModelPerformancePanel perf={perf({ tier: "global", leagueCalls: 12 })} />);
    expect(screen.getByText(/poucos jogos/i)).toBeTruthy();
    expect(screen.getByText(/12/)).toBeTruthy();
  });

  it("mostra lift negativo em vez de esconder o mercado ruim", () => {
    render(<ModelPerformancePanel perf={perf({ markets: [market({ rate: 0.49, baseRate: 0.55, lift: -0.06 })] })} />);
    expect(screen.getByText(/−6pp|-6pp/)).toBeTruthy();
  });

  it("não renderiza nada sem dado", () => {
    const { container } = render(<ModelPerformancePanel perf={null} />);
    expect(container.textContent?.trim()).toBe("");
  });

  it("não renderiza nada com lista de mercados vazia", () => {
    const { container } = render(<ModelPerformancePanel perf={perf({ markets: [] })} />);
    expect(container.textContent?.trim()).toBe("");
  });

  it("declara a janela de medição", () => {
    render(<ModelPerformancePanel perf={perf()} />);
    expect(screen.getByText(/18\/05.*29\/07|desde/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/model-performance-panel.test.tsx`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/fixtures/model-performance-panel.tsx
/**
 * "O modelo acerta o quê, nesta liga?" — a ponte entre /calibracao (tela de
 * analista) e o momento da decisão.
 *
 * Regra de honestidade: o acerto NUNCA aparece sozinho. Vem sempre com a
 * taxa-base (chutar o lado majoritário) e o lift. Sem isso, 71% num mercado
 * enviesado pro under parece competência sem ser — a armadilha documentada em
 * docs/pesquisas/tendencia-recente-poder-preditivo.md.
 *
 * Sem Brier, sem log-loss, sem curva de calibração: isso continua em /calibracao.
 */
import type { LeaguePerformance } from "@/lib/calibracao/league-accuracy-repository";
import type { MarketAccuracy } from "@/lib/calibracao/market-accuracy";

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function pp(x: number): string {
  const v = Math.round(x * 100);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}pp`;
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Barra de 10 blocos — leitura rápida sem depender de lib de chart. */
function Bar({ rate }: { rate: number }) {
  const filled = Math.max(0, Math.min(10, Math.round(rate * 10)));
  return (
    <span aria-hidden className="num text-[var(--color-ink-faint)]">
      {"▓".repeat(filled)}
      {"░".repeat(10 - filled)}
    </span>
  );
}

function headline(markets: MarketAccuracy[]): string {
  const ranked = [...markets].sort((a, b) => b.lift - a.lift);
  const bom = ranked[0];
  const ruim = ranked[ranked.length - 1];
  if (!bom) return "";
  if (ranked.length === 1 || bom.market === ruim.market) {
    return bom.lift > 0 ? `vai bem em ${bom.label}` : `fraco em ${bom.label}`;
  }
  const parts: string[] = [];
  if (bom.lift > 0.02) parts.push(`vai bem em ${bom.label}`);
  if (ruim.lift < -0.02) parts.push(`fraco em ${ruim.label}`);
  return parts.join(" · ") || "sem destaque claro nesta liga";
}

export function ModelPerformancePanel({ perf }: { perf: LeaguePerformance | null }) {
  if (!perf || perf.markets.length === 0) return null;

  const from = shortDate(perf.window.from);
  const to = shortDate(perf.window.to);
  const escopo =
    perf.tier === "liga"
      ? `${perf.league} · ${perf.leagueCalls} apostas medidas`
      : "todas as ligas";

  return (
    <details className="rounded-lg border border-[var(--color-line)] p-4">
      <summary className="cursor-pointer list-none">
        <span className="label text-[var(--color-ink-muted)]">
          desempenho do modelo nesta liga ({escopo})
        </span>
        <p className="mt-1 text-sm">{headline(perf.markets)}</p>
      </summary>

      {perf.tier === "global" ? (
        <p className="label mt-3 text-[var(--color-ink-faint)]">
          poucos jogos em {perf.league} ({perf.leagueCalls}) — mostrando o geral de todas as ligas
        </p>
      ) : null}

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="label text-[var(--color-ink-faint)]">
            <th className="py-1 text-left font-normal">mercado</th>
            <th className="py-1 text-right font-normal">chamou</th>
            <th className="py-1 text-right font-normal">acertou</th>
            <th className="py-1 text-right font-normal">vs chutar</th>
          </tr>
        </thead>
        <tbody>
          {perf.markets.map((m) => (
            <tr key={`${m.market}-${m.line ?? "x"}`} title={`IC95 ${pct(m.ci95.lo)}–${pct(m.ci95.hi)}`}>
              <td className="py-1">{m.label}</td>
              <td className="num py-1 text-right">{m.calls}</td>
              <td className="num py-1 text-right">
                {pct(m.rate)} <Bar rate={m.rate} />
              </td>
              <td
                className={`num py-1 text-right ${m.lift < 0 ? "text-[var(--color-vermelho)]" : ""}`}
              >
                {pp(m.lift)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {from && to ? (
        <p className="label mt-2 text-[var(--color-ink-faint)]">medido de {from} a {to}</p>
      ) : null}
    </details>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/model-performance-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire no page.tsx**

Em `app/(dashboard)/fixtures/[id]/page.tsx`, junto dos outros fetches (perto de onde `shadowCards` é buscado, ~linha 278), adicionar o fetch e o slot. Segue o padrão degradação-graciosa já usado ali:

```tsx
import { getLeaguePerformance } from "@/lib/calibracao/league-accuracy-repository";
import { ModelPerformancePanel } from "@/components/fixtures/model-performance-panel";

// … junto dos demais fetches:
let leaguePerf: Awaited<ReturnType<typeof getLeaguePerformance>> = null;
try {
  leaguePerf = await getLeaguePerformance(
    fixture.league ?? null,
    sim?.model_version ?? null,
    supabase,
  );
} catch {
  leaguePerf = null; // painel some; nunca derruba a página
}
```

E em `buildPanels(...)`, um slot novo — colocado logo após o slot da simulação para cair entre a zona de decisão e os painéis técnicos:

```tsx
const perfSlot: PanelSlot = {
  id: "MODEL_PERF",
  colSpan: "span 12 / span 12",
  label: "desempenho do modelo nesta liga",
  node: <ModelPerformancePanel perf={leaguePerf} />,
};
```

Adicionar `perfSlot` ao array retornado por `buildPanels`, imediatamente após `simSlot`. `leaguePerf` precisa entrar na assinatura de `buildPanels` como parâmetro — siga o padrão de `shadowCards`.

- [ ] **Step 6: Verify build + gates**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: tudo verde. `pnpm build` é obrigatório aqui: `typecheck` + `test` não pegam regressão de bundle/Client Component (lição da Wave N).

- [ ] **Step 7: Commit**

```bash
git add components/fixtures/model-performance-panel.tsx tests/unit/model-performance-panel.test.tsx "app/(dashboard)/fixtures/[id]/page.tsx"
git commit -m "feat(fixtures): painel de desempenho do modelo por liga"
```

---

### Task 6: Sinal `+`/`−` na tabela da simulação

**Files:**
- Modify: `app/(dashboard)/fixtures/[id]/_components/simulation-panel.tsx` (STAT_ROWS ~156, tabela ~325-360)
- Test: `tests/unit/simulation-signal.test.ts`

**Interfaces:**
- Consumes: `marketCall`, `MARKET_LINES`, `STRONG_THRESHOLD`, `CountMarket` da Task 1
- Produces: `function signalFor(simStats: unknown, metric: CountMarket, distK?: DistKMap): { symbol: string; text: string } | null` — exportada do `simulation-panel.tsx` para teste

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/simulation-signal.test.ts
import { describe, it, expect } from "vitest";
import { signalFor } from "@/app/(dashboard)/fixtures/[id]/_components/simulation-panel";

const sim = (corners: number) => ({
  home: { corners: { p50: corners / 2 }, cards: { p50: 1 }, sot: { p50: 4 } },
  away: { corners: { p50: corners / 2 }, cards: { p50: 1 }, sot: { p50: 3 } },
});

describe("signalFor", () => {
  it("devolve − com convicção normal", () => {
    const s = signalFor(sim(4), "corners");
    expect(s!.symbol).toBe("−");
    expect(s!.text).toMatch(/menos de/);
  });

  it("devolve −− com convicção alta", () => {
    const s = signalFor(sim(2), "corners"); // média 2 vs linha 8.5 ⇒ P(under) ~1
    expect(s!.symbol).toBe("−−");
  });

  it("devolve ++ quando a projeção passa folgado da linha", () => {
    const s = signalFor(sim(20), "corners");
    expect(s!.symbol).toBe("++");
    expect(s!.text).toMatch(/mais de/);
  });

  it("devolve ≈ na zona morta", () => {
    const s = signalFor(sim(10), "corners"); // média 10 vs 9.5 ⇒ ~0.54
    expect(s!.symbol).toBe("≈");
    expect(s!.text).toMatch(/sem chamada/);
  });

  it("devolve null pra métrica sem linha canônica", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(signalFor(sim(10), "fouls" as any)).toBeNull();
  });

  it("devolve null quando sim_stats não dá média", () => {
    expect(signalFor(null, "corners")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/simulation-signal.test.ts`
Expected: FAIL — `signalFor` não exportada.

- [ ] **Step 3: Write minimal implementation**

Em `simulation-panel.tsx`, adicionar acima de `STAT_ROWS`:

```tsx
import {
  marketCall,
  MARKET_LINES,
  STRONG_THRESHOLD,
  type CountMarket,
} from "@/lib/calibracao/market-accuracy";
import type { DistKMap } from "@/lib/ai-reco/dist-k-repository";

/**
 * Traduz a projeção da simulação no LADO que ela apostaria, na linha padrão de
 * mercado. Mesma conta do painel de desempenho por liga (Task 5): o "−" que
 * aparece aqui é o mesmo "−" cujo acerto histórico o painel mede.
 *
 * Escolhe a linha canônica mais próxima da média projetada — é a que a casa de
 * fato oferece pro jogo. Métrica sem linha (faltas, impedimentos, desarmes) não
 * recebe símbolo.
 */
export function signalFor(
  simStats: unknown,
  metric: CountMarket,
  distK?: DistKMap,
): { symbol: string; text: string } | null {
  const lines = MARKET_LINES[metric];
  if (!lines) return null;
  const mean = countTotalMean(simStats, metric);
  if (mean === null) return null;

  const line = lines.reduce((best, l) =>
    Math.abs(l - mean) < Math.abs(best - mean) ? l : best,
  );
  const { side, prob } = marketCall(simStats, metric, line, distK);
  if (prob === null) return null;

  if (side === null) {
    return { symbol: "≈", text: `sem chamada · ${Math.round(prob * 100)}%` };
  }
  const conf = side === "over" ? prob : 1 - prob;
  const strong = conf >= STRONG_THRESHOLD;
  const symbol = side === "over" ? (strong ? "++" : "+") : strong ? "−−" : "−";
  const rotulo = side === "over" ? "mais de" : "menos de";
  return { symbol, text: `${rotulo} ${line} · ${Math.round(conf * 100)}%` };
}
```

Importar também `countTotalMean` da lib (junto do `marketCall`).

Na tabela (após a célula do total, ~linha 352), acrescentar a célula do sinal. Cada `SimStatRow` de contagem ganha o sinal; as demais renderizam vazio:

```tsx
const SIGNAL_METRICS = new Set<string>(["corners", "cards", "sot"]);

// … dentro do map de STAT_ROWS, nova <td> ao final da linha:
<td className="num py-1 text-right">
  {SIGNAL_METRICS.has(r.key)
    ? (() => {
        const s = signalFor(sim.sim_stats, r.key as CountMarket);
        return s ? (
          <span title={s.text}>
            <span aria-hidden>{s.symbol}</span>
            <span className="sr-only">{s.text}</span>
          </span>
        ) : null;
      })()
    : null}
</td>
```

Acrescentar um `<th>` vazio correspondente no `<thead>` para não desalinhar as colunas.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/simulation-signal.test.ts && pnpm test && pnpm typecheck && pnpm build`
Expected: PASS em tudo. Se algum teste existente do `simulation-panel` quebrar por contagem de colunas, atualize o teste — a coluna nova é intencional.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/fixtures/[id]/_components/simulation-panel.tsx" tests/unit/simulation-signal.test.ts
git commit -m "feat(fixtures): sinal +/- de lado de aposta na tabela da simulacao"
```

---

### Task 7: E2E

**Files:**
- Create: `tests/e2e/model-performance.spec.ts`

**Interfaces:**
- Consumes: `loginAsTestUser` de `tests/e2e/helpers/auth.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/e2e/model-performance.spec.ts
import { test, expect } from "@playwright/test";
import { loginAsTestUser } from "./helpers/auth";

/**
 * Read-only: navega até um jogo real e confere que o painel de desempenho
 * existe, abre, e mostra número coerente. NÃO escreve na banca.
 */
test.describe("desempenho do modelo por liga", () => {
  test("painel abre e mostra acerto com lift", async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto("/fixtures");

    const primeiroJogo = page.locator('a[href^="/fixtures/"]').first();
    await expect(primeiroJogo).toBeVisible({ timeout: 15_000 });
    await primeiroJogo.click();

    const painel = page.locator("details", { hasText: /desempenho do modelo/i });
    // Jogo de liga sem nenhuma simulação resolvida não renderiza o painel —
    // é degradação esperada, não falha.
    if ((await painel.count()) === 0) test.skip(true, "fixture sem histórico de liga");

    await expect(painel).toBeVisible();
    await painel.locator("summary").click();

    const tabela = painel.locator("table");
    await expect(tabela).toBeVisible();
    // toda linha traz acerto E lift — a regra de honestidade do spec
    await expect(tabela.locator("tbody tr").first()).toContainText(/%/);
    await expect(tabela.locator("tbody tr").first()).toContainText(/pp/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec playwright test tests/e2e/model-performance.spec.ts --project=desktop-chromium`
Expected: FAIL se o painel não estiver deployado localmente; roda contra o dev server.

- [ ] **Step 3: Nenhuma implementação nova**

O E2E exercita o que as Tasks 5 e 6 já entregaram. Se falhar, o defeito está lá — conserte na origem, não afrouxe o E2E.

- [ ] **Step 4: Run full E2E**

Run: `pnpm exec playwright test --grep-invert "live OCR"`
Expected: suíte verde (é o que o CI roda).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/model-performance.spec.ts
git commit -m "test(e2e): painel de desempenho do modelo por liga"
```

---

## Gate final

Antes de abrir o PR, rodar e **colar a saída real** (evidência antes de afirmação):

```bash
pnpm test        # vitest — unit + api + integration
pnpm lint        # eslint
pnpm typecheck   # tsc --noEmit
pnpm build       # next build — pega regressão de bundle que os anteriores não pegam
pnpm exec playwright test --grep-invert "live OCR"
```

E uma verificação manual contra produção, porque o painel só tem valor se o número
estiver certo:

```bash
pnpm exec tsx scripts/analysis/backtest-trend.ts --window 6 --metric corners
```

Não valida a feature diretamente, mas confirma que o acesso a prod segue de pé.
Para conferir o painel de verdade: abrir um jogo de liga grande (Serie B,
Primera B Nacional, Europa Conference League — as de maior n) e checar que o
número bate com uma consulta manual em `fixture_simulations` para aquela liga.

## Ordem e paralelismo

Tasks 1 → 2 → 3 são sequenciais (cada uma constrói sobre a anterior no mesmo arquivo).
Task 4 depende da 2. Tasks 5 e 6 dependem da 4 e da 1 respectivamente, e **podem correr em
paralelo** — tocam arquivos diferentes. Task 7 fecha, depois de 5 e 6.
