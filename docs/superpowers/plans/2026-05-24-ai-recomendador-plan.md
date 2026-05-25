# IA-2 Recomendador Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir os 2 copilots atuais (~2785 linhas) por sistema focado de recomendação pré-jogo: dada uma fixture, IA escolhe mercado/lado/units com cálculo determinístico ancorando julgamento qualitativo.

**Architecture:** 3 camadas: (1) Edge Calculator (TS + Ruby, pure determinístico); (2) Recommender (DeepSeek R1 via OpenRouter, schema rígido); (3) Pipeline orchestrator.rb chama recommender pós-sim, persiste em `ai_recommendations` (migration 0022). Observabilidade obsessiva via `llm_request_logs` estendida (0023): cost_usd, prompt_snapshot, response_raw, prompt_version, edge_table_snapshot.

**Tech Stack:** TypeScript (Next.js 16 app + libs), Ruby 4.0 (scraper pipeline), DeepSeek R1 via OpenRouter, Supabase Postgres, Cloudflare Workers (OpenNext build).

**Reference spec:** `docs/superpowers/specs/2026-05-24-ai-recomendador-design.md`

**Migrations 0022 + 0023 já APLICADAS em prod** (controller fez antes do plan; tabelas criadas e verificadas).

---

## Wave 0 — Pré-execução ✅ JÁ FEITO PELO CONTROLLER

- [x] Migration 0022 (`ai_recommendations`) criada e aplicada em prod
- [x] Migration 0023 (`llm_request_logs` estendida) criada e aplicada em prod
- [x] Schema verificado via Management API

## Wave 1 — Bibliotecas TS puras (1 agente)

Este wave produz as libs determinísticas + recommender TS. Sem rede em testes (mock).

**Files:**
- Create: `lib/ai-reco/pricing.ts`
- Create: `lib/ai-reco/pricing.test.ts`
- Create: `lib/ai-reco/prompts.ts`
- Create: `lib/ai-reco/prompts.test.ts`
- Create: `lib/ai-reco/edge-calculator.ts`
- Create: `lib/ai-reco/edge-calculator.test.ts`
- Create: `lib/ai-reco/recommender.ts`
- Create: `lib/ai-reco/recommender.test.ts`

### Task 1.1: Pricing module

- [ ] **Step 1: Write the failing test**

Create `lib/ai-reco/pricing.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeCostUsd, MODEL_PRICING_USD_PER_1M_TOKENS } from "./pricing";

describe("computeCostUsd", () => {
  it("calcula custo correto pra deepseek-r1", () => {
    // R1: in=$0.55/M, out=$2.19/M
    // 10k input + 2k output = 0.0055 + 0.00438 = 0.00988
    expect(computeCostUsd("deepseek/deepseek-r1", 10_000, 2_000)).toBeCloseTo(0.00988, 5);
  });

  it("retorna 0 pra modelo desconhecido", () => {
    expect(computeCostUsd("foo/bar", 1000, 1000)).toBe(0);
  });

  it("trata 0 tokens", () => {
    expect(computeCostUsd("deepseek/deepseek-r1", 0, 0)).toBe(0);
  });

  it("expõe tabela de preços", () => {
    expect(MODEL_PRICING_USD_PER_1M_TOKENS["deepseek/deepseek-r1"]).toEqual({ in: 0.55, out: 2.19 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/home/rnobre/Área de trabalho/Projetos Git/abissal"
pnpm test lib/ai-reco/pricing.test.ts
# Expected: FAIL (file not found)
```

- [ ] **Step 3: Write minimal implementation**

Create `lib/ai-reco/pricing.ts`:

```typescript
/**
 * Tabela de preços manual dos modelos OpenRouter usados (consultada 2026-05-24).
 * Atualizar quando OpenRouter mudar (raro). Modelo ausente → custo = 0
 * (acceptable degradation: tracking continua, só custo_usd vira null/0).
 */
export const MODEL_PRICING_USD_PER_1M_TOKENS = {
  "deepseek/deepseek-r1": { in: 0.55, out: 2.19 },
  "deepseek/deepseek-v3.2": { in: 0.27, out: 1.10 },
  "anthropic/claude-sonnet-4.5": { in: 3.00, out: 15.00 },
} as const;

export function computeCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const p =
    MODEL_PRICING_USD_PER_1M_TOKENS[
      model as keyof typeof MODEL_PRICING_USD_PER_1M_TOKENS
    ];
  if (!p) return 0;
  return (promptTokens * p.in + completionTokens * p.out) / 1_000_000;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test lib/ai-reco/pricing.test.ts
# Expected: PASS (4/4)
```

- [ ] **Step 5: Commit**

```bash
git add lib/ai-reco/pricing.ts lib/ai-reco/pricing.test.ts
git commit -m "feat(ai-reco): pricing module + cost calculation"
```

### Task 1.2: Edge calculator (TS) — TDD per mercado

**Files:**
- Create: `lib/ai-reco/edge-calculator.ts`
- Create: `lib/ai-reco/edge-calculator.test.ts`

A função `buildEdgeTable` calcula edge pra todos os mercados a partir de uma sim DTO + odds + bankroll. Suporta: 1x2 (home/draw/away), over25, under25, btts-sim, btts-nao. Asian handicap fica V2.

- [ ] **Step 1: Write failing tests pra todos os mercados**

Create `lib/ai-reco/edge-calculator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildEdgeTable, type SimInput, type OddsInput } from "./edge-calculator";

const baseSim: SimInput = {
  p_home: 0.50, p_draw: 0.25, p_away: 0.25,
  p_over_25: 0.60, p_btts: 0.55,
};
const baseOdds: OddsInput = {
  home: 2.10, draw: 3.50, away: 3.80,
  over25: 1.85, under25: 2.00,
  btts_sim: 1.80, btts_nao: 2.10,
};

describe("buildEdgeTable", () => {
  it("gera 7 candidatos quando todas odds presentes", () => {
    const out = buildEdgeTable(baseSim, baseOdds, 1000);
    expect(out.length).toBe(7);
    const markets = out.map(c => c.market + "-" + c.side);
    expect(markets).toContain("1x2-home");
    expect(markets).toContain("1x2-draw");
    expect(markets).toContain("1x2-away");
    expect(markets).toContain("over25-over");
    expect(markets).toContain("over25-under");
    expect(markets).toContain("btts-sim");
    expect(markets).toContain("btts-nao");
  });

  it("calcula edge correto: edge=prob*odd-1", () => {
    const out = buildEdgeTable(baseSim, baseOdds, 1000);
    const home = out.find(c => c.market === "1x2" && c.side === "home")!;
    // p=0.50, odd=2.10 → 0.50*2.10 - 1 = 0.05 = 5%
    expect(home.edge_pct).toBeCloseTo(5.0, 1);
  });

  it("ordena por edge desc", () => {
    const out = buildEdgeTable(baseSim, baseOdds, 1000);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].edge_pct).toBeLessThanOrEqual(out[i - 1].edge_pct);
    }
  });

  it("calcula kelly fracionado (¼ Kelly)", () => {
    // f = (p*b - q) / b onde b = odd-1, q = 1-p
    // pra home: p=0.50, b=1.10, q=0.50; f = (0.55-0.50)/1.10 = 0.045
    // ¼ Kelly = 0.045 / 4 = 0.01125
    // units = 0.01125 * 1000/100 = 0.1125u (bankroll/100 = "unit size")
    // mas spec diz units é absoluto, não fracionário: 0.01125 * 1000 = 11.25 ❌
    // Decisão: 1 unit = bankroll/100 = 10. Então 0.01125 * 100 = 1.125u
    const out = buildEdgeTable(baseSim, baseOdds, 1000);
    const home = out.find(c => c.market === "1x2" && c.side === "home")!;
    expect(home.kelly_units).toBeCloseTo(1.125, 2);
  });

  it("kelly_units = 0 pra edge negativo", () => {
    const negSim: SimInput = { ...baseSim, p_home: 0.30 }; // p*odd = 0.63 → edge -37%
    const out = buildEdgeTable(negSim, baseOdds, 1000);
    const home = out.find(c => c.market === "1x2" && c.side === "home")!;
    expect(home.edge_pct).toBeLessThan(0);
    expect(home.kelly_units).toBe(0);
  });

  it("ignora mercado quando odd ausente", () => {
    const partialOdds: OddsInput = { home: 2.10, draw: 3.50, away: 3.80 };
    const out = buildEdgeTable(baseSim, partialOdds, 1000);
    expect(out.length).toBe(3); // só 1X2
    expect(out.every(c => c.market === "1x2")).toBe(true);
  });

  it("ignora prob ausente", () => {
    const partialSim: SimInput = { p_home: 0.50, p_draw: 0.25, p_away: 0.25 };
    const out = buildEdgeTable(partialSim, baseOdds, 1000);
    expect(out.length).toBe(3); // só 1X2 (over/btts faltando prob)
  });

  it("under25-side é (1 - p_over_25)", () => {
    const out = buildEdgeTable(baseSim, baseOdds, 1000);
    const under = out.find(c => c.market === "over25" && c.side === "under")!;
    // 1 - 0.60 = 0.40; odd 2.00 → 0.40*2.00 - 1 = -0.20 = -20%
    expect(under.edge_pct).toBeCloseTo(-20.0, 1);
  });

  it("btts-nao-side é (1 - p_btts)", () => {
    const out = buildEdgeTable(baseSim, baseOdds, 1000);
    const nao = out.find(c => c.market === "btts" && c.side === "nao")!;
    // 1 - 0.55 = 0.45; odd 2.10 → 0.45*2.10 - 1 = -0.055 = -5.5%
    expect(nao.edge_pct).toBeCloseTo(-5.5, 1);
  });

  it("bankroll afeta kelly_units linearmente", () => {
    const a = buildEdgeTable(baseSim, baseOdds, 1000);
    const b = buildEdgeTable(baseSim, baseOdds, 2000);
    const homeA = a.find(c => c.market === "1x2" && c.side === "home")!;
    const homeB = b.find(c => c.market === "1x2" && c.side === "home")!;
    expect(homeB.kelly_units).toBeCloseTo(homeA.kelly_units * 2, 3);
  });

  it("aplica prob_calibrado quando isotonicLookup fornecido", () => {
    // Quando user passa um lookup que calibra (0.50 → 0.55), edge muda
    const lookup = {
      "1x2-home": (p: number) => p + 0.05,
      "1x2-draw": (p: number) => p,
      "1x2-away": (p: number) => p,
      "over25": (p: number) => p,
    };
    const out = buildEdgeTable(baseSim, baseOdds, 1000, { isotonicLookup: lookup });
    const home = out.find(c => c.market === "1x2" && c.side === "home")!;
    // p_calibrado = 0.55, odd 2.10 → 0.55*2.10 - 1 = 0.155 = 15.5%
    expect(home.prob_calibrated).toBeCloseTo(0.55, 3);
    expect(home.edge_pct).toBeCloseTo(15.5, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test lib/ai-reco/edge-calculator.test.ts
# Expected: FAIL (file not found)
```

- [ ] **Step 3: Write minimal implementation**

Create `lib/ai-reco/edge-calculator.ts`:

```typescript
/**
 * Edge calculator — determinístico, pure function.
 *
 * Pra cada mercado relevante (1x2/over25/btts), calcula:
 *   edge = prob_calibrado * odd - 1
 *   kelly_fracionado (¼ Kelly) = ((prob*odd - 1) / (odd - 1)) / 4
 *   kelly_units = kelly_fracionado * (bankroll / 100)   [1 unit = 1% bankroll]
 *
 * Bankroll convention: 1 unit = bankroll/100. Sem casa decimal "raw money".
 *
 * Isotonic lookup é opcional — se fornecido, prob_calibrado vem dele,
 * senão prob_calibrado = prob_estimated (sem mudança).
 *
 * Spec §3 Camada 1 + §5.
 */

export interface SimInput {
  p_home?: number | null;
  p_draw?: number | null;
  p_away?: number | null;
  p_over_25?: number | null;
  p_btts?: number | null;
}

export interface OddsInput {
  home?: number | null;
  draw?: number | null;
  away?: number | null;
  over25?: number | null;
  under25?: number | null;
  btts_sim?: number | null;
  btts_nao?: number | null;
}

export type Market = "1x2" | "over25" | "btts";
export type Side = "home" | "draw" | "away" | "over" | "under" | "sim" | "nao";

export interface EdgeCandidate {
  market: Market;
  side: Side;
  prob_estimated: number;
  prob_calibrated: number;
  odd: number;
  edge_pct: number;       // ex 8.5 = +8.5%
  kelly_units: number;    // 0 quando edge <= 0
}

export interface BuildOptions {
  /** Map "metric-side" → fn(p) → p_calibrado. Métricas: '1x2-home', '1x2-draw',
   *  '1x2-away', 'over25' (cobre tb 'under25' via 1-p). */
  isotonicLookup?: Partial<Record<string, (p: number) => number>>;
  /** Default ¼ Kelly = 0.25. Pode customizar pra ½ Kelly etc. */
  kellyFraction?: number;
}

const DEFAULT_KELLY_FRACTION = 0.25;

function kellyUnits(prob: number, odd: number, bankroll: number, fraction: number): number {
  const b = odd - 1;
  if (b <= 0) return 0;
  const q = 1 - prob;
  const f = (prob * b - q) / b;
  if (f <= 0) return 0;
  const fractionalF = f * fraction;
  return (fractionalF * bankroll) / 100;
}

function pct(prob: number, odd: number): number {
  return (prob * odd - 1) * 100;
}

function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function calibrate(
  metricKey: string,
  prob: number,
  lookup: BuildOptions["isotonicLookup"],
): number {
  const fn = lookup?.[metricKey];
  if (!fn) return prob;
  const out = fn(prob);
  return Number.isFinite(out) ? Math.max(0, Math.min(1, out)) : prob;
}

export function buildEdgeTable(
  sim: SimInput,
  odds: OddsInput,
  bankroll: number,
  options: BuildOptions = {},
): EdgeCandidate[] {
  const kFrac = options.kellyFraction ?? DEFAULT_KELLY_FRACTION;
  const out: EdgeCandidate[] = [];

  // 1X2
  type Triple = { side: Side; prob?: number | null; odd?: number | null; metricKey: string };
  const oneX2: Triple[] = [
    { side: "home", prob: sim.p_home, odd: odds.home, metricKey: "1x2-home" },
    { side: "draw", prob: sim.p_draw, odd: odds.draw, metricKey: "1x2-draw" },
    { side: "away", prob: sim.p_away, odd: odds.away, metricKey: "1x2-away" },
  ];
  for (const t of oneX2) {
    if (!isFiniteNum(t.prob) || !isFiniteNum(t.odd)) continue;
    const cal = calibrate(t.metricKey, t.prob, options.isotonicLookup);
    out.push({
      market: "1x2",
      side: t.side,
      prob_estimated: t.prob,
      prob_calibrated: cal,
      odd: t.odd,
      edge_pct: pct(cal, t.odd),
      kelly_units: kellyUnits(cal, t.odd, bankroll, kFrac),
    });
  }

  // OVER/UNDER 2.5
  if (isFiniteNum(sim.p_over_25)) {
    const calOver = calibrate("over25", sim.p_over_25, options.isotonicLookup);
    const calUnder = 1 - calOver;
    if (isFiniteNum(odds.over25)) {
      out.push({
        market: "over25",
        side: "over",
        prob_estimated: sim.p_over_25,
        prob_calibrated: calOver,
        odd: odds.over25,
        edge_pct: pct(calOver, odds.over25),
        kelly_units: kellyUnits(calOver, odds.over25, bankroll, kFrac),
      });
    }
    if (isFiniteNum(odds.under25)) {
      out.push({
        market: "over25",
        side: "under",
        prob_estimated: 1 - sim.p_over_25,
        prob_calibrated: calUnder,
        odd: odds.under25,
        edge_pct: pct(calUnder, odds.under25),
        kelly_units: kellyUnits(calUnder, odds.under25, bankroll, kFrac),
      });
    }
  }

  // BTTS (sem isotônica por enquanto — não há curva treinada pra btts)
  if (isFiniteNum(sim.p_btts)) {
    const sim_p = sim.p_btts;
    const nao_p = 1 - sim_p;
    if (isFiniteNum(odds.btts_sim)) {
      out.push({
        market: "btts",
        side: "sim",
        prob_estimated: sim_p,
        prob_calibrated: sim_p,
        odd: odds.btts_sim,
        edge_pct: pct(sim_p, odds.btts_sim),
        kelly_units: kellyUnits(sim_p, odds.btts_sim, bankroll, kFrac),
      });
    }
    if (isFiniteNum(odds.btts_nao)) {
      out.push({
        market: "btts",
        side: "nao",
        prob_estimated: nao_p,
        prob_calibrated: nao_p,
        odd: odds.btts_nao,
        edge_pct: pct(nao_p, odds.btts_nao),
        kelly_units: kellyUnits(nao_p, odds.btts_nao, bankroll, kFrac),
      });
    }
  }

  return out.sort((a, b) => b.edge_pct - a.edge_pct);
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test lib/ai-reco/edge-calculator.test.ts
# Expected: PASS (11/11)
```

- [ ] **Step 5: Commit**

```bash
git add lib/ai-reco/edge-calculator.ts lib/ai-reco/edge-calculator.test.ts
git commit -m "feat(ai-reco): edge calculator pure lib + Kelly fracionado + isotônica opcional"
```

### Task 1.3: Prompts module versionado

**Files:**
- Create: `lib/ai-reco/prompts.ts`
- Create: `lib/ai-reco/prompts.test.ts`

- [ ] **Step 1: Write failing test**

Create `lib/ai-reco/prompts.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildPrompt, PROMPT_VERSION, type PromptInput } from "./prompts";

const baseInput: PromptInput = {
  league: "Premier League",
  league_calibrated: true,
  home_team: "Liverpool",
  away_team: "Tottenham",
  kickoff_utc: "2026-05-25T15:00:00Z",
  referee: "Anthony Taylor",
  candidates: [
    { market: "btts", side: "sim", prob_calibrated: 0.64, edge_pct: 12.0, kelly_units: 1.8, odd: 1.75 },
  ],
  context: {
    top_scorelines: [{ score: "2-1", prob: 0.12 }, { score: "1-1", prob: 0.10 }],
    sim_stats_home: { goals: 2.1, corners: 7.2, sot: 5.4 },
    sim_stats_away: { goals: 1.3, corners: 4.8, sot: 3.2 },
    recent_home: "W W D L W (3-1, 2-0, 1-1, 0-2, 1-0)",
    recent_away: "L W L W L (0-1, 2-1, 0-3, 1-0, 0-2)",
    h2h: "Liv 2-1 Tot (2025-11); Tot 0-0 Liv (2025-05); Liv 4-1 Tot (2024-12)",
  },
};

describe("buildPrompt", () => {
  it("PROMPT_VERSION é semver", () => {
    expect(PROMPT_VERSION).toMatch(/^prompt-v\d+\.\d+$/);
  });

  it("retorna {system, user} strings", () => {
    const { system, user } = buildPrompt(baseInput);
    expect(typeof system).toBe("string");
    expect(typeof user).toBe("string");
    expect(system.length).toBeGreaterThan(100);
    expect(user.length).toBeGreaterThan(100);
  });

  it("inclui cap 2.0u no system prompt", () => {
    const { system } = buildPrompt(baseInput);
    expect(system).toMatch(/2\.0u/);
  });

  it("inclui cap 0.5u (liga não-calibrada) no system prompt", () => {
    const { system } = buildPrompt(baseInput);
    expect(system).toMatch(/0\.5u/);
  });

  it("user prompt inclui edge_table formatada", () => {
    const { user } = buildPrompt(baseInput);
    expect(user).toContain("btts");
    expect(user).toMatch(/12\.0|12%/);
    expect(user).toContain("Liverpool");
    expect(user).toContain("Tottenham");
  });

  it("user prompt rotula liga não-calibrada explicitamente", () => {
    const { user } = buildPrompt({ ...baseInput, league_calibrated: false });
    expect(user).toMatch(/N[ÃA]O-calibrada|confian[çc]a baixa/i);
  });

  it("user prompt inclui referee se fornecido", () => {
    const { user } = buildPrompt(baseInput);
    expect(user).toContain("Anthony Taylor");
  });

  it("user prompt usa '—' quando referee ausente", () => {
    const { user } = buildPrompt({ ...baseInput, referee: null });
    expect(user).toMatch(/[Áa]rbitro:\s*—/);
  });

  it("inclui instrução explícita 'não invente'", () => {
    const { system, user } = buildPrompt(baseInput);
    expect((system + user).toLowerCase()).toMatch(/n[ãa]o invente|n[ãa]o inventar/i);
  });

  it("inclui descrição do schema JSON esperado", () => {
    const { system } = buildPrompt(baseInput);
    expect(system).toMatch(/verdict.*bet.*skip/is);
    expect(system).toContain("market");
    expect(system).toContain("units_final");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test lib/ai-reco/prompts.test.ts
# Expected: FAIL (file not found)
```

- [ ] **Step 3: Implement**

Create `lib/ai-reco/prompts.ts`:

```typescript
/**
 * Prompts versionados pro AI Recommender. Cada mudança no system/user
 * BUMPA `PROMPT_VERSION` (semver-like). A coluna `prompt_version` em
 * `ai_recommendations` + `llm_request_logs` permite A/B retroativo.
 *
 * Spec §6.
 */

export const PROMPT_VERSION = "prompt-v1.0";

export interface PromptCandidate {
  market: string;
  side: string;
  prob_calibrated: number;
  edge_pct: number;
  kelly_units: number;
  odd: number;
}

export interface PromptContext {
  top_scorelines: Array<{ score: string; prob: number }>;
  sim_stats_home: Record<string, number>;
  sim_stats_away: Record<string, number>;
  recent_home: string;
  recent_away: string;
  h2h: string;
}

export interface PromptInput {
  league: string | null;
  league_calibrated: boolean;
  home_team: string;
  away_team: string;
  kickoff_utc: string | null;
  referee: string | null;
  candidates: PromptCandidate[];
  context: PromptContext;
}

const SYSTEM = `Você é um analista de apostas pré-jogo. Tarefa: escolher UMA recomendação entre os candidatos abaixo (já calculados deterministicamente) e justificar em 3-5 parágrafos. Você NÃO pode aumentar units além do Kelly sugerido — só reduzir se houver red flag qualitativo.

CAP ABSOLUTO: 2.0u. Para ligas não-calibradas (flag league_calibrated=false), CAP: 0.5u.

Não invente fatos que não estão no contexto. Se não há contexto pra justificar a aposta com convicção, retorne verdict="skip".

Responda SOMENTE com um JSON válido do schema:
{
  "verdict": "bet" | "skip",
  "market": "1x2" | "over25" | "btts" | null,
  "side": "home" | "draw" | "away" | "over" | "under" | "sim" | "nao" | null,
  "prob_estimated": number 0-1,
  "units_final": number 0-2.0,
  "kelly_pre": number,
  "reduction_reason": string | null,
  "confidence": "alto" | "medio" | "baixo",
  "summary_line": string max 60 chars,
  "reasoning": string 200-800 chars (3-5 parágrafos),
  "red_flags": string[] max 5 items
}`;

function formatCandidates(candidates: PromptCandidate[]): string {
  if (candidates.length === 0) return "(nenhum candidato com edge positivo)";
  return candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.market}/${c.side}: prob=${(c.prob_calibrated * 100).toFixed(1)}% · odd=${c.odd.toFixed(2)} · edge=${c.edge_pct.toFixed(1)}% · kelly=${c.kelly_units.toFixed(2)}u`,
    )
    .join("\n");
}

function formatStats(s: Record<string, number>): string {
  return Object.entries(s)
    .map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(2) : v}`)
    .join(", ");
}

function formatScorelines(arr: Array<{ score: string; prob: number }>): string {
  return arr.map(s => `${s.score} (${(s.prob * 100).toFixed(0)}%)`).join(", ");
}

export function buildPrompt(input: PromptInput): { system: string; user: string } {
  const calLabel = input.league_calibrated
    ? "calibrada"
    : "NÃO-calibrada — confiança baixa";
  const refereeLabel = input.referee ?? "—";

  const user = `# Fixture
Liga: ${input.league ?? "(sem liga)"} (${calLabel})
${input.home_team} vs ${input.away_team}
Kickoff (UTC): ${input.kickoff_utc ?? "—"}
Árbitro: ${refereeLabel}

# Candidatos (ordenados por edge desc; somente com edge >= 5% foram filtrados a montante)
${formatCandidates(input.candidates)}

# Contexto
## Sim Monte Carlo
Top placares: ${formatScorelines(input.context.top_scorelines)}
Stats projetadas mandante: ${formatStats(input.context.sim_stats_home)}
Stats projetadas visitante: ${formatStats(input.context.sim_stats_away)}

## Forma recente (últimos 5)
${input.home_team}: ${input.context.recent_home}
${input.away_team}: ${input.context.recent_away}

## H2H últimos 3
${input.context.h2h}

# Tarefa
Escolha o melhor candidato (ou verdict="skip" se NENHUM convence). Seja específico nos red_flags — não invente nada fora do contexto acima.`;

  return { system: SYSTEM, user };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test lib/ai-reco/prompts.test.ts
# Expected: PASS (10/10)
```

- [ ] **Step 5: Commit**

```bash
git add lib/ai-reco/prompts.ts lib/ai-reco/prompts.test.ts
git commit -m "feat(ai-reco): prompt versionado v1.0 + tests"
```

### Task 1.4: Recommender (chama OpenRouter, schema enforcement, cap)

**Files:**
- Create: `lib/ai-reco/recommender.ts`
- Create: `lib/ai-reco/recommender.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/ai-reco/recommender.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runRecommender, enforceCaps, parseDecision, type AiDecision } from "./recommender";

const validDecisionJson = JSON.stringify({
  verdict: "bet",
  market: "btts",
  side: "sim",
  prob_estimated: 0.64,
  units_final: 1.5,
  kelly_pre: 1.8,
  reduction_reason: "lineup incerta",
  confidence: "medio",
  summary_line: "BTTS · 1.5u · 64%",
  reasoning: "Liverpool teve 5 BTTS consecutivos em casa. Tottenham concedeu pelo menos 1 gol em 8/10 visitas. Árbitro permissivo.",
  red_flags: ["3 desfalques no ataque do TOT"],
});

describe("parseDecision", () => {
  it("parseia JSON válido", () => {
    const d = parseDecision(validDecisionJson);
    expect(d).not.toBeNull();
    expect(d!.verdict).toBe("bet");
    expect(d!.market).toBe("btts");
    expect(d!.units_final).toBe(1.5);
  });

  it("aceita JSON envolto em markdown ```json fence", () => {
    const wrapped = "```json\n" + validDecisionJson + "\n```";
    const d = parseDecision(wrapped);
    expect(d!.verdict).toBe("bet");
  });

  it("aceita JSON com texto antes/depois (extrai bloco)", () => {
    const noisy = `Aqui está minha análise:\n${validDecisionJson}\nFim.`;
    const d = parseDecision(noisy);
    expect(d!.verdict).toBe("bet");
  });

  it("retorna null pra JSON inválido (defensivo)", () => {
    expect(parseDecision("não é json")).toBeNull();
    expect(parseDecision("{ broken }")).toBeNull();
    expect(parseDecision("")).toBeNull();
  });

  it("retorna null se faltar 'verdict' (schema mínimo)", () => {
    expect(parseDecision('{"market":"btts"}')).toBeNull();
  });

  it("aceita verdict='skip' sem market/side/units", () => {
    const skipJson = '{"verdict":"skip","reasoning":"sem valor","confidence":"medio","red_flags":[]}';
    const d = parseDecision(skipJson);
    expect(d!.verdict).toBe("skip");
  });
});

describe("enforceCaps", () => {
  it("cap 2.0u liga calibrada", () => {
    const d: AiDecision = { ...JSON.parse(validDecisionJson), units_final: 2.5 };
    expect(enforceCaps(d, true).units_final).toBe(2.0);
  });

  it("cap 0.5u liga não-calibrada", () => {
    const d: AiDecision = { ...JSON.parse(validDecisionJson), units_final: 1.5 };
    expect(enforceCaps(d, false).units_final).toBe(0.5);
  });

  it("não mexe quando units já abaixo do cap", () => {
    const d: AiDecision = { ...JSON.parse(validDecisionJson), units_final: 0.8 };
    expect(enforceCaps(d, true).units_final).toBe(0.8);
  });

  it("verdict='skip' não tem units pra cappear (passa through)", () => {
    const d: AiDecision = { verdict: "skip", confidence: "medio", reasoning: "sem valor" };
    expect(enforceCaps(d, true).verdict).toBe("skip");
  });
});

describe("runRecommender", () => {
  it("retorna AiDecision quando OpenRouter responde com JSON válido", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: validDecisionJson } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
        model: "deepseek/deepseek-r1",
      }),
    });
    const result = await runRecommender(
      { system: "sys", user: "usr" },
      { model: "deepseek/deepseek-r1", apiKey: "test", leagueCalibrated: true, fetchImpl: mockFetch as any },
    );
    expect(result.ok).toBe(true);
    expect(result.decision!.verdict).toBe("bet");
    expect(result.usage!.total_tokens).toBe(1200);
  });

  it("aplica enforceCaps no resultado", async () => {
    const overCapJson = JSON.stringify({
      verdict: "bet", market: "btts", side: "sim",
      prob_estimated: 0.7, units_final: 3.0, kelly_pre: 3.0, reduction_reason: null,
      confidence: "alto", summary_line: "BTTS 3.0u", reasoning: "...", red_flags: [],
    });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: overCapJson } }],
        usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
      }),
    });
    const result = await runRecommender(
      { system: "s", user: "u" },
      { model: "deepseek/deepseek-r1", apiKey: "t", leagueCalibrated: true, fetchImpl: mockFetch as any },
    );
    expect(result.decision!.units_final).toBe(2.0); // cap aplicado
  });

  it("retorna ok=false quando OpenRouter retorna não-200", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal error",
    });
    const result = await runRecommender(
      { system: "s", user: "u" },
      { model: "deepseek/deepseek-r1", apiKey: "t", leagueCalibrated: true, fetchImpl: mockFetch as any },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
  });

  it("retorna ok=false quando JSON inválido (degrada gracioso)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "isso não é JSON" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
    });
    const result = await runRecommender(
      { system: "s", user: "u" },
      { model: "deepseek/deepseek-r1", apiKey: "t", leagueCalibrated: true, fetchImpl: mockFetch as any },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/parse|JSON|schema/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test lib/ai-reco/recommender.test.ts
# Expected: FAIL (file not found)
```

- [ ] **Step 3: Implement**

Create `lib/ai-reco/recommender.ts`:

```typescript
/**
 * Recommender — chama OpenRouter com prompt versionado, parseia output,
 * valida schema mínimo, aplica caps de units.
 *
 * Defensivo: JSON parse nunca lança (lição copilot-prod-incident).
 * Schema validation rejeita decision sem 'verdict'.
 *
 * Spec §3 Camada 2 + §5.
 */

export interface AiDecision {
  verdict: "bet" | "skip";
  market?: string;
  side?: string;
  prob_estimated?: number;
  units_final?: number;
  kelly_pre?: number;
  reduction_reason?: string | null;
  confidence?: "alto" | "medio" | "baixo";
  summary_line?: string;
  reasoning?: string;
  red_flags?: string[];
}

export interface RunOptions {
  model: string;
  apiKey: string;
  leagueCalibrated: boolean;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  maxTokens?: number;
}

export interface RunResult {
  ok: boolean;
  decision?: AiDecision;
  rawContent?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  modelReturned?: string;
  latencyMs?: number;
  error?: string;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MAX_TOKENS = 4000;

/**
 * Parseia JSON robusto: aceita string crua, ```json fence, ou JSON
 * dentro de texto. Retorna null em qualquer falha (nunca lança).
 */
export function parseDecision(content: string): AiDecision | null {
  if (!content || typeof content !== "string") return null;

  // Strip markdown ```json fence se presente
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  // Tenta direto
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && "verdict" in parsed) {
      return parsed as AiDecision;
    }
  } catch {
    // fall through
  }

  // Extrai primeiro bloco { ... } do texto
  const blockMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!blockMatch) return null;
  try {
    const parsed = JSON.parse(blockMatch[0]);
    if (parsed && typeof parsed === "object" && "verdict" in parsed) {
      return parsed as AiDecision;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Garante que units_final respeita o cap absoluto.
 *  - liga calibrada: 2.0u
 *  - liga NÃO calibrada: 0.5u
 * verdict='skip' não tem units pra cappear (passa through).
 */
export function enforceCaps(d: AiDecision, leagueCalibrated: boolean): AiDecision {
  if (d.verdict !== "bet") return d;
  const cap = leagueCalibrated ? 2.0 : 0.5;
  if (typeof d.units_final !== "number" || !Number.isFinite(d.units_final)) {
    return { ...d, units_final: 0 };
  }
  const capped = Math.max(0, Math.min(d.units_final, cap));
  return { ...d, units_final: Number(capped.toFixed(2)) };
}

export async function runRecommender(
  prompt: { system: string; user: string },
  opts: RunOptions,
): Promise<RunResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const t0 = Date.now();

  try {
    const resp = await fetchFn(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        max_tokens: maxTokens,
        temperature: 0.4,
      }),
    });

    const latencyMs = Date.now() - t0;

    if (!resp.ok) {
      const text = await resp.text().catch(() => "<no body>");
      return {
        ok: false,
        error: `OpenRouter HTTP ${resp.status}: ${text.slice(0, 500)}`,
        latencyMs,
      };
    }

    const body = await resp.json();
    const rawContent: string = body?.choices?.[0]?.message?.content ?? "";
    const usage = body?.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const modelReturned: string | undefined = body?.model;

    const parsed = parseDecision(rawContent);
    if (!parsed) {
      return {
        ok: false,
        error: "Failed to parse decision JSON from LLM response (schema mismatch or invalid JSON)",
        rawContent,
        usage,
        modelReturned,
        latencyMs,
      };
    }

    const decision = enforceCaps(parsed, opts.leagueCalibrated);
    return {
      ok: true,
      decision,
      rawContent,
      usage,
      modelReturned,
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      error: `runRecommender threw: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - t0,
    };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test lib/ai-reco/recommender.test.ts
# Expected: PASS (14/14)
```

- [ ] **Step 5: Commit**

```bash
git add lib/ai-reco/recommender.ts lib/ai-reco/recommender.test.ts
git commit -m "feat(ai-reco): recommender + parse defensivo + enforceCaps"
```

## Wave 2 — Pipeline Ruby (1 agente)

Adiciona o lado Ruby: edge calculator portado, recommender Ruby (Faraday), reconciler, integração no orchestrator.

**Files:**
- Create: `scripts/scraper/lib/scraper/ai_reco/edge_calculator.rb`
- Create: `scripts/scraper/spec/scraper/ai_reco/edge_calculator_spec.rb`
- Create: `scripts/scraper/lib/scraper/ai_reco/pricing.rb`
- Create: `scripts/scraper/spec/scraper/ai_reco/pricing_spec.rb`
- Create: `scripts/scraper/lib/scraper/ai_reco/prompt_builder.rb`
- Create: `scripts/scraper/spec/scraper/ai_reco/prompt_builder_spec.rb`
- Create: `scripts/scraper/lib/scraper/ai_recommender_runner.rb`
- Create: `scripts/scraper/spec/scraper/ai_recommender_runner_spec.rb`
- Create: `scripts/scraper/lib/scraper/ai_recommendation_reconciler.rb`
- Create: `scripts/scraper/spec/scraper/ai_recommendation_reconciler_spec.rb`
- Modify: `scripts/scraper/lib/scraper/orchestrator.rb` — integrar Runner + Reconciler

### Task 2.1: Edge calculator Ruby (espelha TS)

- [ ] **Step 1: Write failing spec**

Create `scripts/scraper/spec/scraper/ai_reco/edge_calculator_spec.rb`:

```ruby
require 'spec_helper'
require 'scraper/ai_reco/edge_calculator'

module AdamStats::Scraper::AiReco
  RSpec.describe EdgeCalculator do
    let(:base_sim) { { p_home: 0.50, p_draw: 0.25, p_away: 0.25, p_over_25: 0.60, p_btts: 0.55 } }
    let(:base_odds) do
      { home: 2.10, draw: 3.50, away: 3.80, over25: 1.85, under25: 2.00, btts_sim: 1.80, btts_nao: 2.10 }
    end

    it 'gera 7 candidatos quando todas odds presentes' do
      out = EdgeCalculator.build(base_sim, base_odds, 1000)
      expect(out.length).to eq(7)
    end

    it 'calcula edge: prob*odd - 1' do
      out = EdgeCalculator.build(base_sim, base_odds, 1000)
      home = out.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
      # 0.50 * 2.10 - 1 = 0.05 → 5%
      expect(home[:edge_pct]).to be_within(0.1).of(5.0)
    end

    it 'ordena por edge desc' do
      out = EdgeCalculator.build(base_sim, base_odds, 1000)
      out.each_cons(2) { |a, b| expect(a[:edge_pct]).to be >= b[:edge_pct] }
    end

    it 'kelly_units zero pra edge negativo' do
      neg = base_sim.merge(p_home: 0.30)
      out = EdgeCalculator.build(neg, base_odds, 1000)
      home = out.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
      expect(home[:edge_pct]).to be < 0
      expect(home[:kelly_units]).to eq(0)
    end

    it 'kelly fracionado ¼' do
      out = EdgeCalculator.build(base_sim, base_odds, 1000)
      home = out.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
      # f = (0.55-0.50)/1.10 = 0.0454; ¼*f = 0.01136; *(1000/100) = 1.136
      expect(home[:kelly_units]).to be_within(0.01).of(1.136)
    end

    it 'ignora mercado sem odd' do
      partial = base_odds.reject { |k, _| %i[over25 under25 btts_sim btts_nao].include?(k) }
      out = EdgeCalculator.build(base_sim, partial, 1000)
      expect(out.all? { |c| c[:market] == '1x2' }).to be true
    end

    it 'aplica isotonic_lookup quando fornecido' do
      lookup = { '1x2-home' => ->(p) { p + 0.05 } }
      out = EdgeCalculator.build(base_sim, base_odds, 1000, isotonic_lookup: lookup)
      home = out.find { |c| c[:market] == '1x2' && c[:side] == 'home' }
      expect(home[:prob_calibrated]).to be_within(0.001).of(0.55)
      # 0.55 * 2.10 - 1 = 15.5%
      expect(home[:edge_pct]).to be_within(0.1).of(15.5)
    end
  end
end
```

- [ ] **Step 2: Run spec to see it fail**

```bash
cd "/home/rnobre/Área de trabalho/Projetos Git/abissal"
cd scripts/scraper && bundle exec rspec spec/scraper/ai_reco/edge_calculator_spec.rb 2>&1 | tail -15
# Expected: FAIL (LoadError on missing file)
```

- [ ] **Step 3: Implement**

Create `scripts/scraper/lib/scraper/ai_reco/edge_calculator.rb`:

```ruby
module AdamStats
  module Scraper
    module AiReco
      # Pure Ruby port do lib/ai-reco/edge-calculator.ts.
      # Specs paralelos: edge_calculator_spec.rb (Ruby) + edge-calculator.test.ts (TS).
      # Comportamento idêntico — mudanças devem ser sincronizadas.
      module EdgeCalculator
        DEFAULT_KELLY_FRACTION = 0.25

        module_function

        def build(sim, odds, bankroll, isotonic_lookup: nil, kelly_fraction: DEFAULT_KELLY_FRACTION)
          out = []

          # 1X2
          one_x2 = [
            { side: 'home', prob: sim[:p_home], odd: odds[:home], metric_key: '1x2-home' },
            { side: 'draw', prob: sim[:p_draw], odd: odds[:draw], metric_key: '1x2-draw' },
            { side: 'away', prob: sim[:p_away], odd: odds[:away], metric_key: '1x2-away' }
          ]
          one_x2.each do |t|
            next unless finite?(t[:prob]) && finite?(t[:odd])

            cal = calibrate(t[:metric_key], t[:prob], isotonic_lookup)
            out << build_candidate('1x2', t[:side], t[:prob], cal, t[:odd], bankroll, kelly_fraction)
          end

          # OVER/UNDER 2.5
          if finite?(sim[:p_over_25])
            cal_over = calibrate('over25', sim[:p_over_25], isotonic_lookup)
            cal_under = 1.0 - cal_over
            out << build_candidate('over25', 'over', sim[:p_over_25], cal_over, odds[:over25], bankroll, kelly_fraction) if finite?(odds[:over25])
            out << build_candidate('over25', 'under', 1.0 - sim[:p_over_25], cal_under, odds[:under25], bankroll, kelly_fraction) if finite?(odds[:under25])
          end

          # BTTS
          if finite?(sim[:p_btts])
            sim_p = sim[:p_btts]
            nao_p = 1.0 - sim_p
            out << build_candidate('btts', 'sim', sim_p, sim_p, odds[:btts_sim], bankroll, kelly_fraction) if finite?(odds[:btts_sim])
            out << build_candidate('btts', 'nao', nao_p, nao_p, odds[:btts_nao], bankroll, kelly_fraction) if finite?(odds[:btts_nao])
          end

          out.sort_by { |c| -c[:edge_pct] }
        end

        def finite?(x)
          x.is_a?(Numeric) && x.finite?
        end

        def calibrate(metric_key, prob, lookup)
          return prob unless lookup.is_a?(Hash)

          fn = lookup[metric_key] || lookup[metric_key.to_sym]
          return prob unless fn

          out = fn.call(prob)
          return prob unless out.is_a?(Numeric) && out.finite?

          [[out, 0.0].max, 1.0].min
        end

        def build_candidate(market, side, prob_est, prob_cal, odd, bankroll, fraction)
          edge = (prob_cal * odd - 1.0) * 100.0
          units = kelly_units(prob_cal, odd, bankroll, fraction)
          {
            market: market, side: side,
            prob_estimated: prob_est, prob_calibrated: prob_cal,
            odd: odd, edge_pct: edge, kelly_units: units
          }
        end

        def kelly_units(prob, odd, bankroll, fraction)
          b = odd - 1.0
          return 0 if b <= 0

          q = 1.0 - prob
          f = (prob * b - q) / b
          return 0 if f <= 0

          (f * fraction * bankroll) / 100.0
        end
      end
    end
  end
end
```

- [ ] **Step 4: Run spec**

```bash
cd scripts/scraper && bundle exec rspec spec/scraper/ai_reco/edge_calculator_spec.rb 2>&1 | tail -10
# Expected: PASS (7/7)
```

- [ ] **Step 5: Commit**

```bash
cd "/home/rnobre/Área de trabalho/Projetos Git/abissal"
git add scripts/scraper/lib/scraper/ai_reco/edge_calculator.rb \
        scripts/scraper/spec/scraper/ai_reco/edge_calculator_spec.rb
git commit -m "feat(ai-reco): edge calculator Ruby (espelha TS, mesmas semânticas)"
```

### Task 2.2: Pricing Ruby + Prompt builder Ruby

(Análogo ao TS — TDD: spec primeiro, implementação minimal, commit. Ver Tasks 1.1 e 1.3 do plan TS pra schema/comportamento idêntico.)

Os 2 arquivos (`pricing.rb` + `prompt_builder.rb`) podem ser commitados juntos pra cortar overhead.

- [ ] Create `scripts/scraper/lib/scraper/ai_reco/pricing.rb` (mesmo PRICING table do TS, `compute_cost_usd` method_function)
- [ ] Create `scripts/scraper/spec/scraper/ai_reco/pricing_spec.rb` (3 testes: cálculo R1, modelo desconhecido → 0, tabela exposta)
- [ ] Create `scripts/scraper/lib/scraper/ai_reco/prompt_builder.rb` (PROMPT_VERSION = 'prompt-v1.0', `build(input)` retorna `{ system:, user: }`)
- [ ] Create `scripts/scraper/spec/scraper/ai_reco/prompt_builder_spec.rb` (testa: PROMPT_VERSION, cap 2.0u/0.5u, lookup liga calibrada/não, referee, "não invente")
- [ ] Run all 4 spec files, ensure GREEN
- [ ] Commit: `feat(ai-reco): pricing.rb + prompt_builder.rb (espelhos Ruby)`

### Task 2.3: AiRecommenderRunner — orchestra edge calc + recommender + persist

**Files:**
- Create: `scripts/scraper/lib/scraper/ai_recommender_runner.rb`
- Create: `scripts/scraper/spec/scraper/ai_recommender_runner_spec.rb`

Esse runner:
1. Carrega bankroll atual da banca (`SELECT current_balance FROM banca_snapshots ORDER BY created_at DESC LIMIT 1` ou env `AI_RECO_BANKROLL`)
2. Carrega curvas isotônicas ativas (`model_calibration WHERE effective_until IS NULL`)
3. Pra cada fixture com sim ativa e detail_json com odds:
   - Chama `EdgeCalculator.build(sim, odds, bankroll, isotonic_lookup:)`
   - Filtra candidatos com `edge_pct >= 5.0`
   - Se nenhum: salva `ai_recommendations` com `verdict='skip'`, sem rodar IA
   - Se ≥1: chama `AdamStats::Scraper::AiReco::Client.call(prompt, model:)` via Faraday → OpenRouter → recebe `AiDecision`
   - Insere `ai_recommendations` + `llm_request_logs` (com cost_usd computed)
4. Rescue por fixture (uma falha não derruba o batch)

- [ ] **Step 1: Write failing spec**

```ruby
# scripts/scraper/spec/scraper/ai_recommender_runner_spec.rb
require 'spec_helper'
require 'scraper/ai_recommender_runner'

module AdamStats::Scraper
  RSpec.describe AiRecommenderRunner do
    let(:conn) { double('PG::Connection') }
    let(:logger) { ->(_msg) {} }
    let(:client) do
      double('OpenRouterClient', call: {
        ok: true,
        decision: { verdict: 'bet', market: 'btts', side: 'sim', units_final: 1.5, prob_estimated: 0.64,
                    kelly_pre: 1.8, reduction_reason: 'lineup', confidence: 'medio',
                    summary_line: 'BTTS 1.5u 64%', reasoning: '...', red_flags: [] },
        raw_content: 'mock',
        usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
        latency_ms: 8500,
        model_returned: 'deepseek/deepseek-r1'
      })
    end

    it 'roda em modo dry_run e não insere nada' do
      allow(conn).to receive(:query).and_return([])
      runner = described_class.new(conn: conn, logger: logger, client: client, dry_run: true)
      expect { runner.run }.not_to raise_error
      expect(conn).not_to have_received(:query).with(/INSERT/)
    end

    it 'pula fixtures sem sim ativa' do
      allow(conn).to receive(:query).with(/SELECT.*fixture_simulations/).and_return([])
      runner = described_class.new(conn: conn, logger: logger, client: client)
      runner.run
      expect(client).not_to have_received(:call)
    end

    it 'gera verdict=skip quando todos candidatos têm edge<5%' do
      # Setup: sim com p_home=0.40, odd home 2.0 → edge=-20%
      sim_row = { 'fixture_id' => '123', 'home_team' => 'A', 'away_team' => 'B', 'league' => 'L',
                  'kickoff_utc' => '2026-05-30T15:00:00Z',
                  'sim_json' => '{"p_home":0.40,"p_draw":0.30,"p_away":0.30,"p_over_25":0.50,"p_btts":0.50}',
                  'odds_json' => '{"home":2.0,"draw":3.0,"away":3.5,"over25":2.0,"under25":1.85,"btts_sim":1.9,"btts_nao":1.9}',
                  'league_calibrated' => 'false' }
      allow(conn).to receive(:query).with(/SELECT.*fixture_simulations/).and_return([sim_row])
      allow(conn).to receive(:query).with(/SELECT.*model_calibration/).and_return([])
      allow(conn).to receive(:query).with(/INSERT INTO llm_request_logs/).and_return(double('Result', getvalue: '0'))
      allow(conn).to receive(:exec_params)
      allow(conn).to receive(:query).with(/INSERT INTO ai_recommendations/).and_return(double('Result', getvalue: '1'))

      runner = described_class.new(conn: conn, logger: logger, client: client)
      runner.run

      expect(client).not_to have_received(:call) # IA não roda em skip
    end

    it 'isola falhas: uma fixture com erro não derruba o batch' do
      sims = [
        { 'fixture_id' => '1', 'sim_json' => 'invalid json' },  # vai dar parse error
        { 'fixture_id' => '2', 'home_team' => 'A', 'away_team' => 'B', 'league' => 'L',
          'kickoff_utc' => '2026-05-30T15:00:00Z',
          'sim_json' => '{"p_home":0.6,"p_draw":0.2,"p_away":0.2,"p_over_25":0.6,"p_btts":0.5}',
          'odds_json' => '{"home":2.0,"draw":3.5,"away":3.8,"over25":1.85,"under25":2.0,"btts_sim":1.8,"btts_nao":2.1}',
          'league_calibrated' => 'true' }
      ]
      allow(conn).to receive(:query).with(/SELECT.*fixture_simulations/).and_return(sims)
      allow(conn).to receive(:query).with(/SELECT.*model_calibration/).and_return([])
      allow(conn).to receive(:exec_params)
      allow(conn).to receive(:query).with(/INSERT/).and_return(double('Result', getvalue: '0'))

      runner = described_class.new(conn: conn, logger: logger, client: client)
      expect { runner.run }.not_to raise_error
    end
  end
end
```

- [ ] **Step 2: Run spec to see it fail**

```bash
cd scripts/scraper && bundle exec rspec spec/scraper/ai_recommender_runner_spec.rb 2>&1 | tail -15
# Expected: FAIL (LoadError)
```

- [ ] **Step 3: Implement**

Create `scripts/scraper/lib/scraper/ai_recommender_runner.rb`:

```ruby
require 'json'
require_relative 'ai_reco/edge_calculator'
require_relative 'ai_reco/pricing'
require_relative 'ai_reco/prompt_builder'

module AdamStats
  module Scraper
    # Roda no fim do scrape diário (após reconcilers).
    # Filtra fixtures futuras com sim ativa + odds, calcula edge, chama IA
    # se houver candidato >= 5%, persiste em ai_recommendations + llm_request_logs.
    #
    # Spec §4.3 + Wave 2 do plan IA-2.
    class AiRecommenderRunner
      EDGE_THRESHOLD = 5.0
      LEAGUE_CAL_THRESHOLD = 30

      # Query: pega fixtures upcoming com sim ativa e detail_json não-purgado
      FIXTURES_QUERY = <<~SQL.freeze
        SELECT s.id, s.fixture_id, s.home_team, s.away_team, s.league, s.kickoff_utc,
               s.model_version, s.p_home, s.p_draw, s.p_away, s.p_over_25, s.p_btts,
               s.top_scorelines, s.sim_stats,
               f.detail_json
        FROM fixture_simulations s
        JOIN fixtures f ON f.source_url = '/fixture/' || s.fixture_id::text
        WHERE s.kickoff_utc > now()
          AND s.kickoff_utc < now() + INTERVAL '48 hours'
          AND s.status IN ('pending')
        ORDER BY s.kickoff_utc ASC
        LIMIT 50
      SQL

      LEAGUES_CAL_QUERY = <<~SQL.freeze
        SELECT DISTINCT league FROM league_parameters
        WHERE effective_until IS NULL
      SQL

      RECO_INSERT_SQL = <<~SQL.freeze
        INSERT INTO ai_recommendations
          (fixture_id, home_team, away_team, league, kickoff_utc,
           reco_version, prompt_version, llm_model, llm_log_id,
           edge_table_snapshot, league_calibrated,
           verdict, market, side, prob_estimated, prob_calibrated, edge_pct, odd_captured,
           kelly_pre, units_final, reduction_reason, confidence,
           summary_line, reasoning_full, red_flags, cost_usd)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
        RETURNING id
      SQL

      LLM_LOG_INSERT_SQL = <<~SQL.freeze
        INSERT INTO llm_request_logs
          (route, fixture_id, model, latency_ms, prompt_tokens, completion_tokens, total_tokens,
           cost_usd, prompt_version, prompt_snapshot, response_raw, error)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id
      SQL

      RECO_VERSION = 'reco-v1'

      def initialize(conn:, logger:, client: nil, dry_run: false, bankroll: nil)
        @conn = conn
        @logger = logger
        @client = client || default_client
        @dry_run = dry_run
        @bankroll = bankroll || (ENV['AI_RECO_BANKROLL']&.to_f || 1000.0)
      end

      def run
        fixtures = @conn.query(FIXTURES_QUERY).to_a
        @logger.call("[ai-reco] processando #{fixtures.length} fixtures upcoming")
        calibrated_leagues = @conn.query(LEAGUES_CAL_QUERY).map { |r| r['league'] }.to_set rescue Set.new

        fixtures.each do |row|
          process_fixture(row, calibrated_leagues)
        rescue StandardError => e
          @logger.call("[ai-reco] fixture #{row['fixture_id']} falhou: #{e.message}")
        end
      end

      private

      def process_fixture(row, calibrated_leagues)
        sim = extract_sim(row)
        odds = extract_odds(row)
        return @logger.call("[ai-reco] fixture #{row['fixture_id']}: sem sim ou odds") unless sim && odds

        league_calibrated = calibrated_leagues.include?(row['league'])

        candidates = AiReco::EdgeCalculator.build(sim, odds, @bankroll)
        bet_candidates = candidates.select { |c| c[:edge_pct] >= EDGE_THRESHOLD }

        return persist_skip(row, candidates, league_calibrated) if bet_candidates.empty?

        return @logger.call("[ai-reco] dry-run skipping IA call for #{row['fixture_id']}") if @dry_run

        run_ia_for(row, candidates, bet_candidates, league_calibrated)
      end

      def run_ia_for(row, all_candidates, bet_candidates, league_calibrated)
        prompt = AiReco::PromptBuilder.build(
          league: row['league'],
          league_calibrated: league_calibrated,
          home_team: row['home_team'],
          away_team: row['away_team'],
          kickoff_utc: row['kickoff_utc'],
          referee: extract_referee(row),
          candidates: bet_candidates,
          context: build_context(row)
        )

        result = @client.call(prompt, model: ENV['AI_RECO_MODEL'] || 'deepseek/deepseek-r1', league_calibrated: league_calibrated)

        cost = AiReco::Pricing.compute_cost_usd(
          result[:model_returned] || 'deepseek/deepseek-r1',
          result.dig(:usage, :prompt_tokens) || 0,
          result.dig(:usage, :completion_tokens) || 0
        )

        log_id = insert_llm_log(row, result, prompt, cost)
        insert_reco(row, all_candidates, league_calibrated, result, log_id, cost)
      end

      def extract_sim(row)
        {
          p_home: row['p_home']&.to_f,
          p_draw: row['p_draw']&.to_f,
          p_away: row['p_away']&.to_f,
          p_over_25: row['p_over_25']&.to_f,
          p_btts: row['p_btts']&.to_f
        }
      rescue StandardError
        nil
      end

      def extract_odds(row)
        detail = JSON.parse(row['detail_json']) rescue nil
        return nil unless detail.is_a?(Hash)

        odds = detail['odds'] || detail['odds_summary'] || {}
        # adamchoi odds: '1' = home, 'X' = draw, '2' = away
        result = {
          home: odds.dig('1X2', '1', 'average')&.to_f,
          draw: odds.dig('1X2', 'X', 'average')&.to_f,
          away: odds.dig('1X2', '2', 'average')&.to_f,
          over25: odds.dig('OVER_UNDER_2_5', 'OVER', 'average')&.to_f,
          under25: odds.dig('OVER_UNDER_2_5', 'UNDER', 'average')&.to_f,
          btts_sim: odds.dig('BTTS', 'YES', 'average')&.to_f,
          btts_nao: odds.dig('BTTS', 'NO', 'average')&.to_f
        }
        result.compact.empty? ? nil : result
      rescue StandardError
        nil
      end

      def extract_referee(row)
        detail = JSON.parse(row['detail_json']) rescue nil
        return nil unless detail.is_a?(Hash)

        detail.dig('referee', 'name') || detail.dig('referee_record', 'name')
      rescue StandardError
        nil
      end

      def build_context(row)
        detail = JSON.parse(row['detail_json']) rescue {}
        sim_stats = JSON.parse(row['sim_stats'] || '{}') rescue {}
        top_scorelines = JSON.parse(row['top_scorelines'] || '[]') rescue []

        {
          top_scorelines: top_scorelines.first(5),
          sim_stats_home: extract_stats_summary(sim_stats['home']),
          sim_stats_away: extract_stats_summary(sim_stats['away']),
          recent_home: summarize_recent(detail.dig('recent_matches', 'home')),
          recent_away: summarize_recent(detail.dig('recent_matches', 'away')),
          h2h: summarize_h2h(detail['h2h'])
        }
      end

      def extract_stats_summary(team_stats)
        return {} unless team_stats.is_a?(Hash)

        %w[goals corners sot cards].each_with_object({}) do |key, acc|
          val = team_stats.dig(key, 'p50') || team_stats.dig(key, 'mean')
          acc[key] = val.to_f.round(2) if val.is_a?(Numeric)
        end
      end

      def summarize_recent(arr)
        return '—' unless arr.is_a?(Array) && !arr.empty?

        arr.first(5).map { |m|
          result = m['result'] || m.dig('outcome', 'result') || '?'
          score = "#{m['home_goals'] || '?'}-#{m['away_goals'] || '?'}"
          "#{result} (#{score})"
        }.join(', ')
      end

      def summarize_h2h(h2h)
        return '—' unless h2h.is_a?(Array) && !h2h.empty?

        h2h.first(3).map { |m|
          "#{m['home_team'] || '?'} #{m['home_goals'] || '?'}-#{m['away_goals'] || '?'} #{m['away_team'] || '?'}"
        }.join('; ')
      end

      def persist_skip(row, candidates, league_calibrated)
        return @logger.call("[ai-reco] dry-run skip persist") if @dry_run

        # Salvar ai_recommendations sem llm_log (não rodou IA)
        @conn.exec_params(
          RECO_INSERT_SQL,
          [
            row['fixture_id'], row['home_team'], row['away_team'], row['league'], row['kickoff_utc'],
            RECO_VERSION, AiReco::PromptBuilder::PROMPT_VERSION, '(no-llm-call)', nil,
            candidates.to_json, league_calibrated,
            'skip', nil, nil, nil, nil, nil, nil,
            nil, nil, nil, 'baixo',
            'Nenhum candidato com edge >= 5%', 'Nenhum mercado com valor; skip.', '[]', 0.0
          ]
        )
        @logger.call("[ai-reco] skip persisted fixture #{row['fixture_id']}")
      end

      def insert_llm_log(row, result, prompt, cost)
        snapshot = { system: prompt[:system], user: prompt[:user] }.to_json
        log_row = @conn.exec_params(
          LLM_LOG_INSERT_SQL,
          [
            'ai-reco', row['fixture_id'], ENV['AI_RECO_MODEL'] || 'deepseek/deepseek-r1',
            result[:latency_ms], result.dig(:usage, :prompt_tokens), result.dig(:usage, :completion_tokens),
            result.dig(:usage, :total_tokens), cost, AiReco::PromptBuilder::PROMPT_VERSION,
            snapshot, result[:raw_content], result[:ok] ? nil : result[:error]
          ]
        ).first
        log_row['id']&.to_i
      end

      def insert_reco(row, all_candidates, league_calibrated, result, log_id, cost)
        d = result[:decision] || { verdict: 'skip', confidence: 'baixo', reasoning: result[:error] }
        chosen = if d[:verdict] == 'bet'
                   all_candidates.find { |c| c[:market] == d[:market] && c[:side] == d[:side] }
                 end

        @conn.exec_params(
          RECO_INSERT_SQL,
          [
            row['fixture_id'], row['home_team'], row['away_team'], row['league'], row['kickoff_utc'],
            RECO_VERSION, AiReco::PromptBuilder::PROMPT_VERSION,
            ENV['AI_RECO_MODEL'] || 'deepseek/deepseek-r1', log_id,
            all_candidates.to_json, league_calibrated,
            d[:verdict], d[:market], d[:side],
            d[:prob_estimated], chosen&.dig(:prob_calibrated), chosen&.dig(:edge_pct), chosen&.dig(:odd),
            d[:kelly_pre] || chosen&.dig(:kelly_units), d[:units_final] || 0,
            d[:reduction_reason], d[:confidence],
            d[:summary_line], d[:reasoning], (d[:red_flags] || []).to_json, cost
          ]
        )
        @logger.call("[ai-reco] persisted #{d[:verdict]} for fixture #{row['fixture_id']} (cost $#{cost.round(5)})")
      end

      def default_client
        require_relative 'ai_reco/openrouter_client'
        AiReco::OpenrouterClient.new(api_key: ENV['OPENROUTER_API_KEY'])
      end
    end
  end
end
```

- [ ] **Step 4: Run spec**

```bash
cd scripts/scraper && bundle exec rspec spec/scraper/ai_recommender_runner_spec.rb 2>&1 | tail -10
# Expected: PASS
```

- [ ] **Step 5: Create OpenRouter Ruby client + spec**

Create `scripts/scraper/lib/scraper/ai_reco/openrouter_client.rb` (espelha lib/ai-reco/recommender.ts mas em Ruby):

```ruby
require 'faraday'
require 'json'

module AdamStats
  module Scraper
    module AiReco
      class OpenrouterClient
        DEFAULT_URL = 'https://openrouter.ai/api/v1/chat/completions'
        DEFAULT_MAX_TOKENS = 4000

        def initialize(api_key:, url: DEFAULT_URL, conn: nil)
          @api_key = api_key
          @url = url
          @conn = conn || Faraday.new
        end

        def call(prompt, model:, league_calibrated:, max_tokens: DEFAULT_MAX_TOKENS)
          t0 = Time.now
          payload = {
            model: model,
            messages: [
              { role: 'system', content: prompt[:system] },
              { role: 'user', content: prompt[:user] }
            ],
            max_tokens: max_tokens,
            temperature: 0.4
          }
          resp = @conn.post(@url) do |req|
            req.headers['Authorization'] = "Bearer #{@api_key}"
            req.headers['Content-Type'] = 'application/json'
            req.body = payload.to_json
          end
          latency_ms = ((Time.now - t0) * 1000).to_i

          return { ok: false, error: "HTTP #{resp.status}: #{resp.body[0..500]}", latency_ms: latency_ms } unless resp.success?

          body = JSON.parse(resp.body) rescue nil
          return { ok: false, error: 'json parse body fail', latency_ms: latency_ms } unless body

          raw_content = body.dig('choices', 0, 'message', 'content') || ''
          usage = body['usage'] || {}
          model_returned = body['model']

          decision = parse_decision(raw_content)
          return { ok: false, error: 'parse decision fail', raw_content: raw_content, usage: usage_h(usage), latency_ms: latency_ms, model_returned: model_returned } unless decision

          decision = enforce_caps(decision, league_calibrated)

          {
            ok: true, decision: decision, raw_content: raw_content,
            usage: usage_h(usage), latency_ms: latency_ms, model_returned: model_returned
          }
        rescue StandardError => e
          { ok: false, error: e.message, latency_ms: ((Time.now - t0) * 1000).to_i }
        end

        private

        def usage_h(u)
          {
            prompt_tokens: u['prompt_tokens'] || 0,
            completion_tokens: u['completion_tokens'] || 0,
            total_tokens: u['total_tokens'] || 0
          }
        end

        def parse_decision(content)
          return nil if content.nil? || content.empty?

          cleaned = content.strip
          if (fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/))
            cleaned = fence[1].strip
          end

          [cleaned, cleaned.match(/\{[\s\S]*\}/)&.[](0)].compact.each do |c|
            parsed = JSON.parse(c) rescue nil
            return symbolize(parsed) if parsed.is_a?(Hash) && parsed.key?('verdict')
          end
          nil
        end

        def symbolize(h)
          h.transform_keys(&:to_sym)
        end

        def enforce_caps(d, league_calibrated)
          return d unless d[:verdict] == 'bet'

          cap = league_calibrated ? 2.0 : 0.5
          u = d[:units_final].to_f
          d.merge(units_final: [[u, 0].max, cap].min.round(2))
        end
      end
    end
  end
end
```

- [ ] **Step 6: Commit Wave 2 (tudo)**

```bash
cd "/home/rnobre/Área de trabalho/Projetos Git/abissal"
bundle exec rspec scripts/scraper/spec/scraper/ai_recommender_runner_spec.rb scripts/scraper/spec/scraper/ai_reco/ 2>&1 | tail
git add scripts/scraper/lib/scraper/ai_recommender_runner.rb \
        scripts/scraper/lib/scraper/ai_reco/ \
        scripts/scraper/spec/scraper/ai_recommender_runner_spec.rb \
        scripts/scraper/spec/scraper/ai_reco/
git commit -m "feat(ai-reco): Ruby runner + OpenRouter client + edge/pricing/prompt portas"
```

### Task 2.4: AiRecommendationReconciler — fecha bets

**Files:**
- Create: `scripts/scraper/lib/scraper/ai_recommendation_reconciler.rb`
- Create: `scripts/scraper/spec/scraper/ai_recommendation_reconciler_spec.rb`

Espelha o `SimulationReconciler` existente — busca rows pendentes, busca resultado em `fixtures`, calcula `bet_won` + `pl_units` por mercado, UPDATE.

Casos de avaliação por mercado:
- `1x2/home` → `home_goals > away_goals`
- `1x2/draw` → `home_goals == away_goals`
- `1x2/away` → `away_goals > home_goals`
- `over25/over` → `home + away > 2`
- `over25/under` → `home + away <= 2`
- `btts/sim` → `home >= 1 && away >= 1`
- `btts/nao` → `home == 0 || away == 0`
- `verdict='skip'` → resolved sem `bet_won`/`pl_units` (null)

PL units: `pl_units = (odd - 1) * units_final` se won, `-units_final` se lost.

- [ ] Implement spec + reconciler com TDD (~20 testes cobrindo cada mercado + skip path + erro robustness)
- [ ] Integrar no `orchestrator.rb` após `SimulationReconciler`:

```ruby
# Após SimulationReconciler:
begin
  require_relative 'ai_recommendation_reconciler'
  AiRecommendationReconciler.new(logger: logger).run(conn)
rescue StandardError => e
  logger.call("[scrape] ai-reco-reconciler failed (non-fatal): #{e.message}")
end
```

- [ ] Integrar `AiRecommenderRunner` no `orchestrator.rb` no FIM (após todos reconcilers):

```ruby
begin
  require_relative 'ai_recommender_runner'
  AiRecommenderRunner.new(conn: conn, logger: logger).run
rescue StandardError => e
  logger.call("[scrape] ai-recommender failed (non-fatal): #{e.message}")
end
```

- [ ] Commit Wave 2 final: `feat(ai-reco): reconciler + integração no orchestrator`

## Wave 3 — Endpoint on-demand `/api/ai-reco/compute` (1 agente)

**Files:**
- Create: `app/api/ai-reco/compute/route.ts`
- Create: `app/api/ai-reco/compute/route.test.ts`

POST com body `{ fixtureId: number }`. Backend:
1. Carrega fixture + sim via repositories existentes
2. Carrega bankroll (mesma fonte do Ruby runner)
3. Roda `buildEdgeTable` + `runRecommender`
4. Persiste em `ai_recommendations` + `llm_request_logs`
5. Retorna o AiDecision pra UI mostrar inline

Auth: gate via mesmo guard das outras APIs (`createAdminClient` server-side).

- [ ] TDD: 5-7 testes (fixture inexistente → 404, sem odds → 400, sem sim → 400, sucesso → 200 + dec retornado, OpenRouter error → 502)
- [ ] Implement
- [ ] Commit: `feat(api): /api/ai-reco/compute on-demand endpoint`

## Wave 4 — UI surfaces (1 agente)

**Files:**
- Create: `app/(dashboard)/fixtures/[id]/_components/ai-reco-panel.tsx`
- Create: `app/(dashboard)/fixtures/[id]/_components/ai-reco-panel.test.tsx`
- Create: `lib/ai-reco/reco-repository.ts` (reader)
- Create: `lib/ai-reco/reco-repository.test.ts`
- Modify: `app/(dashboard)/fixtures/[id]/page.tsx` (incluir o panel)
- Modify: `lib/fixtures/repository.ts` (adicionar `aiHasBet boolean` via subquery scalar)
- Modify: `components/fixtures/fixture-card.tsx` (chip ⚡ quando `aiHasBet`)
- Create: `app/(dashboard)/_components/oportunidades-ia.tsx` (dashboard section)
- Modify: `app/(dashboard)/page.tsx` (incluir oportunidades-ia)

### Task 4.1: reco-repository — reader scalar-only

Pattern análogo a `simulation-repository.ts`. Importante:
- Static guard NÃO pode tocar `detail_json` (lição B12/B14)
- Select escalar dos campos de `ai_recommendations`
- Filtros: por fixture_id (lookup individual), por status='pending'+kickoff>now (lista oportunidades)

- [ ] Implementação + tests (10+ casos: lookup por fixture, lookup vazio, lista oportunidades, ordenação, payload guard)
- [ ] Commit: `feat(ai-reco): repository scalar-only + tests`

### Task 4.2: ai-reco-panel inline

Renderiza:
- Quando `reco.verdict='bet'`: card completo (summary line + units/edge + Kelly comparison + reasoning + red_flags + footer com modelo/custo)
- Quando `reco.verdict='skip'`: card minimalista "IA não vê valor"
- Quando sem reco: botão "[ pedir análise IA ]" → POST `/api/ai-reco/compute` → re-render
- data-attribute `data-ai-reco-verdict={bet|skip|none}` pra E2E

**Crítico (lição B17):** smoke E2E manual obrigatório após deploy. Componente RENDERIZADO em chrome="bare" path do page.tsx — testar visualmente que aparece.

- [ ] TDD: 5+ test cases (bet/skip/none, on-demand fetch loading state, error state)
- [ ] Implement
- [ ] Commit: `feat(ui): ai-reco-panel inline + on-demand button`

### Task 4.3: Badge ⚡ na lista /fixtures + Oportunidades no dashboard

Modificar `fixture-card.tsx`:
- Receber `aiHasBet:boolean` no DTO
- Renderizar `⚡` chip se true, com tooltip "IA recomenda {market} {units}u"

Modificar `lib/fixtures/repository.ts`:
- Subquery scalar: `EXISTS(SELECT 1 FROM ai_recommendations WHERE fixture_id = f.fixture_id AND verdict = 'bet' AND kickoff_utc > now()) as ai_has_bet`
- Update `FIXTURE_COLUMNS` pra incluir esse campo
- Update `FixtureDTO` interface

Criar `oportunidades-ia.tsx`:
- Lê top 5 reco com verdict='bet' + kickoff>now via `reco-repository.fetchTopOpportunities(supabase)`
- Render cards compactos: summary_line + liga + kickoff_brt + link
- Ordenado por `edge_pct * confidence_weight` (alto=1, medio=0.7, baixo=0.4)
- Incluído em `/` (dashboard)

- [ ] TDD + implement (3-4 commits, um por componente)
- [ ] Commit final wave 4: `feat(ui): badge oportunidade + dashboard section`

## Wave 5 — Painéis Observability (1 agente)

**Files:**
- Create: `app/(dashboard)/llm-observability/page.tsx`
- Create: `app/(dashboard)/llm-observability/page.test.tsx`
- Modify: `app/(dashboard)/calibracao/page.tsx` (adicionar seção "IA Recommendations")

### Task 5.1: /llm-observability page

Server component que faz queries:
- Custo cumulativo (1d, 7d, 30d) — agregação SQL
- Latência p50/p90/p99 — `percentile_cont`
- Volume por modelo
- Top 10 logs recentes com link "ver prompt+response" (modal client-side)
- Prompt versions ativos + ROI por version

Wrap dentro de `(dashboard)` pra auth.

- [ ] Implementação com TDD (smoke + render)
- [ ] Commit: `feat(observability): /llm-observability page`

### Task 5.2: /calibracao seção "IA Recommendations"

Adicionar painel novo entre as 6 existentes:
- ROI cumulativo (todos resolved)
- Win rate (count bet_won=true / count resolved bet)
- Brier prob (sobre prob_estimated vs resultado)
- Tabela por liga (ROI/WR/n)
- Tabela por confidence level (alto/medio/baixo)
- data-section="ai-reco-roi", "ai-reco-by-league", "ai-reco-by-confidence"

- [ ] Implementação com TDD (testes querying mock data)
- [ ] Commit: `feat(calibracao): seção IA Recommendations (ROI/WR/Brier)`

## Wave 6 — Cleanup copilots velhos (1 agente)

Após waves 1-5 completas e testes verdes, deletar tudo do copilot velho.

- [ ] Verificar que nenhum dos copilot files é importado fora dele mesmo:
  ```bash
  cd "/home/rnobre/Área de trabalho/Projetos Git/abissal"
  grep -rn "copilot-fab\|copilot-tools\|copilot-scan-tools\|fixture-copilot-tools\|fixture-copilot-drawer\|chat-message\|copilot-tool-steps" --include="*.tsx" --include="*.ts" | grep -v "test\|node_modules"
  ```
- [ ] Deletar files:
  ```bash
  git rm app/api/copilot/route.ts app/api/copilot/route.test.ts 2>/dev/null
  git rm app/api/fixture-copilot/route.ts app/api/fixture-copilot/route.test.ts 2>/dev/null
  git rm -rf app/api/copilot app/api/fixture-copilot
  git rm lib/fixtures/copilot-tools.ts lib/fixtures/copilot-tools.test.ts
  git rm lib/fixtures/copilot-scan-tools.ts lib/fixtures/copilot-scan-tools.test.ts
  git rm lib/fixtures/fixture-copilot-tools.ts lib/fixtures/fixture-copilot-tools.test.ts
  git rm components/fixtures/copilot-fab.tsx
  git rm components/fixtures/fixture-copilot-drawer.tsx
  git rm components/fixtures/copilot-tool-steps.tsx
  git rm components/fixtures/chat-message.tsx
  ```
- [ ] Atualizar `app/(dashboard)/fixtures/page.tsx` — remover `<CopilotFab />`
- [ ] Atualizar `app/(dashboard)/fixtures/[id]/page.tsx` — remover `<FixtureCopilotDrawer />`
- [ ] Run full suite:
  ```bash
  pnpm test
  # Expected: all green (testes do copilot foram removidos)
  ```
- [ ] Commit: `chore(cleanup): remove old copilots (~2785 linhas) — substituídos pelo IA-2 Recomendador`

## Wave 7 — Deploy + E2E ao vivo (controller)

- [ ] Push para main → trigger CF deploy automático
- [ ] Aguardar deploy success via `gh run list --workflow=deploy --limit=1`
- [ ] Smoke E2E ao vivo (Playwright):
  - `/fixtures/<id>` mostra `<AiRecoPanel>` (verifica `data-ai-reco-verdict` attr)
  - `/fixtures` lista tem chip ⚡ em alguma fixture
  - `/` (dashboard) tem seção "Oportunidades IA"
  - `/llm-observability` carrega com dados
  - `/calibracao` tem nova seção "IA Recommendations"
- [ ] Rodar `bin/scrape` manual ao vivo pra disparar ao menos 1 rodada do recommender em prod
- [ ] Verificar via SQL prod: `SELECT count(*) FROM ai_recommendations WHERE created_at > now() - INTERVAL '1 hour'` > 0
- [ ] Atualizar CLAUDE.md com Lição B18 (IA-2 shipped, métricas iniciais, follow-ups)
- [ ] Atualizar memória `sim-melhorias-roadmap.md` e criar `ai-2-shipped.md`
- [ ] Atualizar `docs/backlog/sim-improvements.md` se aplicável (não está no escopo desse backlog, mas mencionar IA-2)

## Out of scope (não fazer nessa rodada)

- ❌ A/B de modelos paralelo (deepseek vs claude) — futuro
- ❌ Web search tool (lesões/news) — futuro
- ❌ Multi-turn chat
- ❌ Notificações push
- ❌ Asian handicap markets (V2)
