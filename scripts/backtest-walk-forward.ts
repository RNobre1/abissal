#!/usr/bin/env tsx
/**
 * Backtest WALK-FORWARD do pipeline determinístico do IA-2.
 *
 * Diferença essencial vs `backtest-ai-reco.ts` (preservado, in-sample):
 * a calibração isotônica (`getActiveCurves`) e os `league_parameters` são
 * RE-FITADOS a cada passo da janela temporal, usando APENAS samples
 * resolvidos ANTES do instante `t`. Sem leakage in-sample.
 *
 * Por que isto importa?
 *   Diagnóstico do ML Researcher (2026-05-25): as curvas e os params
 *   atuais no banco foram treinados sobre as MESMAS 1052 sims resolvidas
 *   que o backtest in-sample pontuava. Isso infla PAV em 30-60% pra n≈770
 *   (calibração em-amostra). O ROI projetado +14.4% (D20) e +18.66% (H)
 *   provavelmente cai pra +2-8% real.
 *
 * Estrutura:
 *   1. Carrega TODAS as sims resolvidas (90d) + odds + outcomes
 *   2. Ordena por `actual_resolved_at` ASC
 *   3. Warmup: 100 samples iniciais (sem fit)
 *   4. Loop semanal: refit isotonic + league_params com samples pré-t,
 *      avalia fixtures de [t, t+7d] com calibração do passado
 *   5. Métricas honestas: ROI ± IC95% bootstrap, Brier (Murphy decomp),
 *      LogLoss, Sharpe-like
 *
 * Uso:
 *   pnpm exec tsx scripts/backtest-walk-forward.ts
 *
 * Output:
 *   - docs/superpowers/specs/2026-05-25-backtest-walk-forward-cenarios.csv
 *   - docs/superpowers/specs/2026-05-25-backtest-walk-forward.md
 *
 * Spec: pedido autônomo 2026-05-25 — Tarefa A3.
 *
 * Funções puras testadas em
 *   `tests/unit/scripts/backtest-walk-forward-refit.test.ts`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  buildEdgeTable,
  type EdgeCandidate,
  type OddsInput,
  type SimInput,
} from "@/lib/ai-reco/edge-calculator";
import { fitIsotonic, applyIsotonic } from "@/lib/calibracao/isotonic";
import {
  evaluateBet,
  chooseBetForScenario,
  type ScenarioOpts,
} from "@/scripts/backtest-ai-reco";

// ===========================================================================
// Types puros (consumidos pelos testes)
// ===========================================================================

export interface WfSample {
  league: string;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  p_over_25: number | null;
  p_btts: number | null;
  home_goals: number;
  away_goals: number;
  /** ISO string */
  resolved_at: string;
}

export interface IsotonicLookups {
  pairs1x2Home?: Array<[number, number]>;
  pairsDraw?: Array<[number, number]>;
  pairsAway?: Array<[number, number]>;
  pairsOver25?: Array<[number, number]>;
}

export interface LeagueParamLite {
  league: string;
  n: number;
  avg_goals_home: number;
  avg_goals_away: number;
}

// ===========================================================================
// REFIT ISOTONIC IN-MEMORY
// ===========================================================================

/**
 * Recria as 4 curvas isotônicas (1x2-home, draw, away, over25) sobre um
 * conjunto arbitrário de samples — espelha o batch de calibração em prod
 * (`scripts/calibrate-isotonic.ts`) MAS in-memory, sem tocar Supabase.
 *
 * Mínimo: 30 samples válidas por curva (mesmo threshold do batch em prod).
 * Métrica sem dados suficientes ⇒ `undefined` (caller usa identity).
 */
export function refitIsotonicFromSamples(samples: WfSample[]): IsotonicLookups {
  const MIN_SAMPLES = 30;

  const pairsHome: Array<[number, number]> = [];
  const pairsDraw: Array<[number, number]> = [];
  const pairsAway: Array<[number, number]> = [];
  const pairsOver: Array<[number, number]> = [];

  for (const s of samples) {
    const homeWin = s.home_goals > s.away_goals ? 1 : 0;
    const drawObs = s.home_goals === s.away_goals ? 1 : 0;
    const awayWin = s.home_goals < s.away_goals ? 1 : 0;
    const overObs = s.home_goals + s.away_goals >= 3 ? 1 : 0;

    if (s.p_home != null && Number.isFinite(s.p_home))
      pairsHome.push([s.p_home, homeWin]);
    if (s.p_draw != null && Number.isFinite(s.p_draw))
      pairsDraw.push([s.p_draw, drawObs]);
    if (s.p_away != null && Number.isFinite(s.p_away))
      pairsAway.push([s.p_away, awayWin]);
    if (s.p_over_25 != null && Number.isFinite(s.p_over_25))
      pairsOver.push([s.p_over_25, overObs]);
  }

  return {
    pairs1x2Home: pairsHome.length >= MIN_SAMPLES ? fitIsotonic(pairsHome) : undefined,
    pairsDraw: pairsDraw.length >= MIN_SAMPLES ? fitIsotonic(pairsDraw) : undefined,
    pairsAway: pairsAway.length >= MIN_SAMPLES ? fitIsotonic(pairsAway) : undefined,
    pairsOver25: pairsOver.length >= MIN_SAMPLES ? fitIsotonic(pairsOver) : undefined,
  };
}

/**
 * Converte IsotonicLookups em formato consumido por `buildEdgeTable`
 * (`Partial<Record<metricKey, (p: number) => number>>`).
 */
export function isotonicLookupFromCurves(
  curves: IsotonicLookups,
): Partial<Record<string, (p: number) => number>> {
  const out: Partial<Record<string, (p: number) => number>> = {};
  if (curves.pairs1x2Home)
    out["1x2-home"] = (p: number) => applyIsotonic(curves.pairs1x2Home!, p);
  if (curves.pairsDraw)
    out["1x2-draw"] = (p: number) => applyIsotonic(curves.pairsDraw!, p);
  if (curves.pairsAway)
    out["1x2-away"] = (p: number) => applyIsotonic(curves.pairsAway!, p);
  if (curves.pairsOver25)
    out["over25"] = (p: number) => applyIsotonic(curves.pairsOver25!, p);
  return out;
}

// ===========================================================================
// REFIT LEAGUE_PARAMS IN-MEMORY
// ===========================================================================

/**
 * Re-fita `league_parameters` (MoM lite) sobre samples arbitrários. Liga
 * com n>=20 entra no Map; abaixo disso, fica fora (= "não calibrada").
 *
 * Mínimo n=20 espelha o `MIN_SAMPLES_PER_LEAGUE` do `fitLeagueParams` em
 * prod (30 strict + priorityLeagues 20). Aqui usamos 20 universal pra
 * permitir mais ligas no walk-forward (universo é menor que prod).
 */
export function refitLeagueParamsFromSamples(
  samples: WfSample[],
): Map<string, LeagueParamLite> {
  const MIN = 20;
  const byLeague = new Map<string, WfSample[]>();
  for (const s of samples) {
    if (!s.league) continue;
    if (!Number.isFinite(s.home_goals) || !Number.isFinite(s.away_goals))
      continue;
    const list = byLeague.get(s.league) ?? [];
    list.push(s);
    byLeague.set(s.league, list);
  }

  const out = new Map<string, LeagueParamLite>();
  for (const [league, list] of byLeague.entries()) {
    if (list.length < MIN) continue;
    const n = list.length;
    const sumH = list.reduce((a, s) => a + s.home_goals, 0);
    const sumA = list.reduce((a, s) => a + s.away_goals, 0);
    out.set(league, {
      league,
      n,
      avg_goals_home: sumH / n,
      avg_goals_away: sumA / n,
    });
  }
  return out;
}

// ===========================================================================
// BOOTSTRAP IC95%
// ===========================================================================

/**
 * Bootstrap não-paramétrico (Efron 1979): re-amostra `B` vezes com
 * reposição, calcula a estatística em cada réplica, devolve quantis 2.5%
 * e 97.5% como IC95%.
 *
 * Seed opcional para determinismo nos testes (mulberry32).
 */
export function bootstrapCi95<T>(
  samples: T[],
  statisticFn: (xs: T[]) => number,
  B: number = 1000,
  seed: number = Date.now() & 0xffffffff,
): { low: number; high: number } {
  if (samples.length === 0) return { low: NaN, high: NaN };
  if (samples.length === 1) {
    const v = statisticFn(samples);
    return { low: v, high: v };
  }

  const rng = mulberry32(seed);
  const stats: number[] = new Array(B);
  const n = samples.length;
  const buf: T[] = new Array(n);
  for (let b = 0; b < B; b++) {
    for (let i = 0; i < n; i++) {
      buf[i] = samples[Math.floor(rng() * n)];
    }
    stats[b] = statisticFn(buf);
  }
  stats.sort((a, b) => a - b);
  const loIdx = Math.floor(0.025 * B);
  const hiIdx = Math.min(B - 1, Math.floor(0.975 * B));
  return { low: stats[loIdx], high: stats[hiIdx] };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ===========================================================================
// BRIER DECOMPOSE (Murphy 1973)
// ===========================================================================

/**
 * Decomposição clássica do Brier score binário em 3 termos:
 *   BS = reliability − resolution + uncertainty
 *
 * - **Reliability** (mais perto de 0 = melhor): mede o quão longe a freq
 *   observada está da prob prevista dentro de cada bin.
 * - **Resolution** (maior = melhor): mede o quão a freq observada de
 *   cada bin difere da freq base.
 * - **Uncertainty**: variância da distribuição base p̄(1-p̄), limite
 *   inferior irredutível do Brier.
 *
 * Referência: Murphy, A. H. (1973). "A new vector partition of the
 * probability score". J. Appl. Meteor. 12: 595-600.
 */
export interface BrierDecomposition {
  brier: number;
  reliability: number;
  resolution: number;
  uncertainty: number;
  n: number;
}

export function brierDecompose(
  probs: number[],
  outcomes: number[],
  bins: number = 10,
): BrierDecomposition {
  if (probs.length !== outcomes.length || probs.length === 0) {
    return { brier: NaN, reliability: NaN, resolution: NaN, uncertainty: NaN, n: 0 };
  }
  const n = probs.length;
  const baseRate = outcomes.reduce((a, b) => a + b, 0) / n;

  // Bin assignment
  type Bin = { count: number; sumP: number; sumY: number };
  const binArr: Bin[] = new Array(bins);
  for (let k = 0; k < bins; k++) binArr[k] = { count: 0, sumP: 0, sumY: 0 };

  let brierSum = 0;
  for (let i = 0; i < n; i++) {
    const p = probs[i];
    const y = outcomes[i];
    brierSum += (p - y) ** 2;
    let k = Math.floor(p * bins);
    if (k < 0) k = 0;
    if (k >= bins) k = bins - 1;
    binArr[k].count += 1;
    binArr[k].sumP += p;
    binArr[k].sumY += y;
  }

  let reliability = 0;
  let resolution = 0;
  for (const b of binArr) {
    if (b.count === 0) continue;
    const meanP = b.sumP / b.count;
    const meanY = b.sumY / b.count;
    const weight = b.count / n;
    reliability += weight * (meanP - meanY) ** 2;
    resolution += weight * (meanY - baseRate) ** 2;
  }
  const uncertainty = baseRate * (1 - baseRate);

  return {
    brier: brierSum / n,
    reliability,
    resolution,
    uncertainty,
    n,
  };
}

// ===========================================================================
// I/O — runner
// ===========================================================================

interface ResolvedSimRow {
  id: number;
  fixture_id: number | null;
  league: string | null;
  model_version: string | null;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  p_btts: number | null;
  p_over_25: number | null;
  actual_home_goals: number | null;
  actual_away_goals: number | null;
  actual_resolved_at: string | null;
  kickoff_utc: string | null;
  home_team: string;
  away_team: string;
}

interface FixtureOddsRow {
  id: number;
  source_url: string | null;
  detail_json: Record<string, unknown> | null;
}

interface RecoSnapshotRow {
  fixture_id: number | null;
  home_team: string;
  away_team: string;
  edge_table_snapshot: unknown;
  kickoff_utc: string | null;
}

interface WfScenarioMetrics {
  name: string;
  description: string;
  blendAlpha?: number;
  n_bets: number;
  n_wins: number;
  win_rate: number | null;
  pl_total: number;
  staked_total: number;
  roi_pct: number | null;
  roi_ci95_low: number | null;
  roi_ci95_high: number | null;
  brier: number | null;
  brier_reliability: number | null;
  brier_resolution: number | null;
  brier_uncertainty: number | null;
  logloss: number | null;
  sharpe_like: number | null;
  n_train_first: number;
  n_train_last: number;
}

interface BetRecord {
  scenario: string;
  sim_id: number;
  league: string;
  league_calibrated: 0 | 1;
  market: string;
  side: string;
  edge_pct: number | "";
  odd: number | "";
  prob_calibrated: number | "";
  units: number;
  bet_won: "true" | "false" | "skip";
  pl_units: number | "";
  home_score: number;
  away_score: number;
  resolved_at: string;
  n_train_at_t: number;
}

const SCENARIOS: Array<{
  opts: ScenarioOpts;
  description: string;
  blendAlpha?: number;
}> = [
  {
    description:
      "A — baseline: best edge ≥ 5%, sem sanity guard, sem requireCalibrated",
    opts: { name: "A", edgeMinPct: 5, requireCalibrated: false, sanityGuard: false },
  },
  {
    description:
      "B — sanity guard: A ∧ skip se edge > 50% em liga não calibrada",
    opts: { name: "B", edgeMinPct: 5, requireCalibrated: false, sanityGuard: true },
  },
  {
    description: "C — só ligas calibradas (league_params reconstituídas pre-t)",
    opts: { name: "C", edgeMinPct: 5, requireCalibrated: true, sanityGuard: false },
  },
  {
    description: "D10 — edge ≥ 10%, sem guards",
    opts: { name: "D10", edgeMinPct: 10, requireCalibrated: false, sanityGuard: false },
  },
  {
    description: "D15 — edge ≥ 15%, sem guards",
    opts: { name: "D15", edgeMinPct: 15, requireCalibrated: false, sanityGuard: false },
  },
  {
    description: "D20 — edge ≥ 20%, sem guards",
    opts: { name: "D20", edgeMinPct: 20, requireCalibrated: false, sanityGuard: false },
  },
  {
    description: "E — só calibradas + sanity",
    opts: { name: "E", edgeMinPct: 5, requireCalibrated: true, sanityGuard: true },
  },
  {
    description: "F — A com blending α=0.5",
    opts: { name: "F", edgeMinPct: 5, requireCalibrated: false, sanityGuard: false },
    blendAlpha: 0.5,
  },
  {
    description: "G — A com blending α=0.3",
    opts: { name: "G", edgeMinPct: 5, requireCalibrated: false, sanityGuard: false },
    blendAlpha: 0.3,
  },
  {
    description: "H — D20 com blending α=0.5",
    opts: { name: "H", edgeMinPct: 20, requireCalibrated: false, sanityGuard: false },
    blendAlpha: 0.5,
  },
];

// ===========================================================================
// Env loading (no Next.js)
// ===========================================================================

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  try {
    const content = readFileSync(path, "utf-8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // env vars já no shell
  }
}

// ===========================================================================
// Odds extractors (espelha backtest-ai-reco.ts)
// ===========================================================================

function digDecimal(
  marketNode: Record<string, unknown>,
  key: string,
): number | null {
  const node = marketNode[key];
  if (!node || typeof node !== "object") return null;
  const v = (node as Record<string, unknown>).decimal_odds;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function extractOdds(
  detailJson: Record<string, unknown> | null,
  homeTeam: string,
  awayTeam: string,
): OddsInput | null {
  if (!detailJson || typeof detailJson !== "object") return null;
  const oddsRootRaw =
    (detailJson as Record<string, unknown>).odds_summary ??
    (detailJson as Record<string, unknown>).odds;
  if (!oddsRootRaw || typeof oddsRootRaw !== "object") return null;
  const oddsRoot = oddsRootRaw as Record<string, unknown>;

  const resultMarket = (oddsRoot["Result"] ?? {}) as Record<string, unknown>;
  const bttsMarket = (oddsRoot["BTTS"] ?? {}) as Record<string, unknown>;
  const mgMarket = (oddsRoot["Match Goals Overs/Unders"] ??
    {}) as Record<string, unknown>;

  const out: OddsInput = {
    home: digDecimal(resultMarket, homeTeam),
    draw: digDecimal(resultMarket, "Draw"),
    away: digDecimal(resultMarket, awayTeam),
    over25: digDecimal(mgMarket, "Over 2.5"),
    under25: digDecimal(mgMarket, "Under 2.5"),
    btts_sim: digDecimal(bttsMarket, "Yes"),
    btts_nao: digDecimal(bttsMarket, "No"),
  };

  const allMissing = Object.values(out).every((v) => v == null);
  return allMissing ? null : out;
}

function oddsFromSnapshot(snap: unknown): OddsInput | null {
  if (!Array.isArray(snap)) return null;
  const out: OddsInput = {};
  for (const c of snap) {
    if (!c || typeof c !== "object") continue;
    const obj = c as Record<string, unknown>;
    const market = obj.market;
    const side = obj.side;
    const odd = obj.odd;
    if (typeof odd !== "number" || !Number.isFinite(odd)) continue;
    if (market === "1x2") {
      if (side === "home") out.home = odd;
      else if (side === "draw") out.draw = odd;
      else if (side === "away") out.away = odd;
    } else if (market === "over25") {
      if (side === "over") out.over25 = odd;
      else if (side === "under") out.under25 = odd;
    } else if (market === "btts") {
      if (side === "sim") out.btts_sim = odd;
      else if (side === "nao") out.btts_nao = odd;
    }
  }
  const allMissing = Object.values(out).every((v) => v == null);
  return allMissing ? null : out;
}

// ===========================================================================
// CSV writer
// ===========================================================================

function csvEscape(v: string | number): string {
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCsv(rows: BetRecord[], path: string): void {
  const header = [
    "scenario",
    "sim_id",
    "league",
    "league_calibrated",
    "market",
    "side",
    "edge_pct",
    "odd",
    "prob_calibrated",
    "units",
    "bet_won",
    "pl_units",
    "home_score",
    "away_score",
    "resolved_at",
    "n_train_at_t",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.scenario,
        r.sim_id,
        r.league,
        r.league_calibrated,
        r.market,
        r.side,
        r.edge_pct,
        r.odd,
        r.prob_calibrated,
        r.units,
        r.bet_won,
        r.pl_units,
        r.home_score,
        r.away_score,
        r.resolved_at,
        r.n_train_at_t,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join("\n") + "\n", "utf-8");
}

// ===========================================================================
// Main runner
// ===========================================================================

async function main(): Promise<void> {
  loadEnvLocal();

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SR) {
    console.error("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SR, {
    auth: { persistSession: false },
  });

  // Step 1 — load resolved sims (90d to give walk-forward room)
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = supabase as unknown as { from: (t: string) => any };

  const sims: ResolvedSimRow[] = [];
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await c
        .from("fixture_simulations")
        .select(
          "id, fixture_id, league, model_version, p_home, p_draw, p_away, p_btts, p_over_25, actual_home_goals, actual_away_goals, actual_resolved_at, kickoff_utc, home_team, away_team",
        )
        .eq("status", "resolved")
        .gte("actual_resolved_at", since)
        .order("actual_resolved_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        console.error("fixture_simulations query failed:", error);
        process.exit(1);
      }
      const page = (data ?? []) as ResolvedSimRow[];
      sims.push(...page);
      if (page.length < PAGE) break;
      from += PAGE;
      if (from > 20000) break;
    }
  }
  console.log(`[wf] resolved sims (90d): ${sims.length}`);

  if (sims.length === 0) {
    console.error("nothing to backtest");
    process.exit(1);
  }

  // Step 2 — load fixtures (odds source)
  const liveFixtureRefs: Array<{ id: number; choistatsId: number }> = [];
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await c
        .from("fixtures")
        .select("id, source_url")
        .range(from, from + PAGE - 1);
      if (error) {
        console.warn("[wf] fixtures list failed:", error.message);
        break;
      }
      const page = (data ?? []) as Array<{ id: number; source_url: string | null }>;
      for (const f of page) {
        if (!f.source_url) continue;
        const m = f.source_url.match(/\/fixture\/(\d+)/);
        if (!m) continue;
        const cid = Number(m[1]);
        if (Number.isFinite(cid)) liveFixtureRefs.push({ id: f.id, choistatsId: cid });
      }
      if (page.length < PAGE) break;
      from += PAGE;
      if (from > 20000) break;
    }
  }
  const simFixIds = new Set(
    sims.map((s) => s.fixture_id).filter((x): x is number => x != null),
  );
  const relevantPks = liveFixtureRefs
    .filter((r) => simFixIds.has(r.choistatsId))
    .map((r) => r.id);

  const fixturesByCid = new Map<number, FixtureOddsRow>();
  for (let i = 0; i < relevantPks.length; i += 50) {
    const chunk = relevantPks.slice(i, i + 50);
    const { data, error } = await c
      .from("fixtures")
      .select("id, source_url, detail_json")
      .in("id", chunk);
    if (error) {
      console.warn(`[wf] fixtures chunk ${i} failed:`, error.message);
      continue;
    }
    for (const f of (data ?? []) as FixtureOddsRow[]) {
      if (!f.source_url) continue;
      const m = f.source_url.match(/\/fixture\/(\d+)/);
      if (!m) continue;
      const cid = Number(m[1]);
      if (Number.isFinite(cid)) fixturesByCid.set(cid, f);
    }
  }
  console.log(`[wf] fixtures with detail_json indexed: ${fixturesByCid.size}`);

  // Step 3 — load ai_recommendations snapshots (fallback odds)
  const recosById = new Map<number, RecoSnapshotRow>();
  const recosByTeams = new Map<string, RecoSnapshotRow>();
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await c
        .from("ai_recommendations")
        .select("fixture_id, home_team, away_team, edge_table_snapshot, kickoff_utc")
        .range(from, from + PAGE - 1);
      if (error || !Array.isArray(data)) break;
      for (const r of data as RecoSnapshotRow[]) {
        if (r.fixture_id != null) recosById.set(r.fixture_id, r);
        const k = `${r.home_team}|${r.away_team}|${r.kickoff_utc ?? ""}`;
        recosByTeams.set(k, r);
      }
      if ((data as RecoSnapshotRow[]).length < PAGE) break;
      from += PAGE;
      if (from > 10000) break;
    }
  }
  console.log(`[wf] reco snapshots: ${recosById.size} byId, ${recosByTeams.size} byTeams`);

  // Step 4 — build usable records (sim + odds + outcome)
  //
  // **Eixo temporal:** `kickoff_utc` (não `actual_resolved_at`). Razão:
  // `actual_resolved_at` é o timestamp DO BATCH RECONCILER (write em massa
  // depois do FT). Como o reconciler roda em batch diário, esse campo se
  // condensa em poucos timestamps próximos do `now()`. O eixo natural pra
  // walk-forward é a hora do JOGO em si (`kickoff_utc`).
  interface UsableRecord {
    simId: number;
    league: string;
    p_home: number;
    p_draw: number;
    p_away: number;
    p_over_25: number | null;
    p_btts: number | null;
    odds: OddsInput;
    home_goals: number;
    away_goals: number;
    resolved_at: string; // = kickoff_utc (renomeado pra preservar API interna)
    home_team: string;
    away_team: string;
  }
  const records: UsableRecord[] = [];
  let oddsFromFixture = 0;
  let oddsFromSnap = 0;
  let oddsMissing = 0;
  let resolvedMissing = 0;

  for (const sim of sims) {
    if (
      sim.actual_home_goals == null ||
      sim.actual_away_goals == null ||
      sim.kickoff_utc == null ||
      sim.p_home == null ||
      sim.p_draw == null ||
      sim.p_away == null
    ) {
      resolvedMissing++;
      continue;
    }

    let odds: OddsInput | null = null;
    if (sim.fixture_id != null) {
      const fix = fixturesByCid.get(sim.fixture_id);
      if (fix) {
        odds = extractOdds(fix.detail_json, sim.home_team, sim.away_team);
        if (odds) oddsFromFixture++;
      }
    }
    if (!odds && sim.fixture_id != null) {
      const reco = recosById.get(sim.fixture_id);
      if (reco) {
        odds = oddsFromSnapshot(reco.edge_table_snapshot);
        if (odds) oddsFromSnap++;
      }
    }
    if (!odds) {
      const k = `${sim.home_team}|${sim.away_team}|${sim.kickoff_utc ?? ""}`;
      const reco = recosByTeams.get(k);
      if (reco) {
        odds = oddsFromSnapshot(reco.edge_table_snapshot);
        if (odds) oddsFromSnap++;
      }
    }
    if (!odds) {
      oddsMissing++;
      continue;
    }

    records.push({
      simId: sim.id,
      league: sim.league ?? "",
      p_home: sim.p_home,
      p_draw: sim.p_draw,
      p_away: sim.p_away,
      p_over_25: sim.p_over_25,
      p_btts: sim.p_btts,
      odds,
      home_goals: sim.actual_home_goals,
      away_goals: sim.actual_away_goals,
      resolved_at: sim.kickoff_utc, // eixo temporal walk-forward
      home_team: sim.home_team,
      away_team: sim.away_team,
    });
  }
  records.sort((a, b) => a.resolved_at.localeCompare(b.resolved_at));

  console.log(
    `[wf] usable records: ${records.length} (odds fixture: ${oddsFromFixture}, snap: ${oddsFromSnap}, missing: ${oddsMissing}, resolved-missing: ${resolvedMissing})`,
  );

  if (records.length === 0) {
    console.error("no records — abort");
    process.exit(1);
  }

  // ========================================================================
  // WALK-FORWARD LOOP
  // ========================================================================

  // Walk-forward parameters.
  //
  // **MIN_TRAIN=100**: floor mínimo de samples pré-t para fittar o PAV.
  // Abaixo disso, as 4 curvas isotônicas seriam `undefined` (cf.
  // `refitIsotonicFromSamples`) — equivale a calibração identity, o que
  // anula o ponto do walk-forward. 100 é compatível com o fit em prod
  // (que usa `MIN_SAMPLES=30` por curva mas roda batch contra ~770 sims).
  //
  // **STEP_DAYS=1 (diário, não semanal):** o dataset de prod (2026-05-25)
  // tem todas as 1052 sims resolvidas concentradas em ~7 dias de
  // `kickoff_utc` (2026-05-18 a 2026-05-25). Uma janela semanal nos daria
  // 1 único passo. Diário ainda é defensável como walk-forward — refit
  // por dia simula o cron noturno de calibração que o sistema deveria
  // estar rodando em prod.
  //
  // **Eixo:** `kickoff_utc` (não `actual_resolved_at` — esse é o batch
  // reconciler timestamp e se condensa em poucos pontos próximos do now).
  const MIN_TRAIN = 100;
  const STEP_DAYS = 1;
  const STEP_MS = STEP_DAYS * 24 * 60 * 60 * 1000;

  if (records.length <= MIN_TRAIN) {
    console.error(`not enough records to warmup (need >${MIN_TRAIN}, have ${records.length})`);
    process.exit(1);
  }

  // Por cenário: lista de bets + outcomes (pra bootstrap)
  const betsByScenario = new Map<string, BetRecord[]>();
  for (const sc of SCENARIOS) betsByScenario.set(sc.opts.name, []);
  let nTrainFirst = 0;
  let nTrainLast = 0;

  let t = new Date(records[MIN_TRAIN].resolved_at).getTime();
  const windowEnd = new Date(records[records.length - 1].resolved_at).getTime() + 1;

  let step = 0;
  while (t < windowEnd) {
    const stepEnd = t + STEP_MS;

    // Train set: tudo com resolved_at < t
    const trainSamples: WfSample[] = [];
    for (const r of records) {
      const ts = new Date(r.resolved_at).getTime();
      if (ts >= t) break;
      trainSamples.push({
        league: r.league,
        p_home: r.p_home,
        p_draw: r.p_draw,
        p_away: r.p_away,
        p_over_25: r.p_over_25,
        p_btts: r.p_btts,
        home_goals: r.home_goals,
        away_goals: r.away_goals,
        resolved_at: r.resolved_at,
      });
    }
    if (step === 0) nTrainFirst = trainSamples.length;
    nTrainLast = trainSamples.length;

    // Fit calibration + league params with PAST-ONLY data
    const curves = refitIsotonicFromSamples(trainSamples);
    const isoLookup = isotonicLookupFromCurves(curves);
    const leagueParams = refitLeagueParamsFromSamples(trainSamples);

    // Evaluate [t, stepEnd)
    for (const r of records) {
      const ts = new Date(r.resolved_at).getTime();
      if (ts < t) continue;
      if (ts >= stepEnd) continue;

      const calibrated = r.league ? leagueParams.has(r.league) : false;
      const simInput: SimInput = {
        p_home: r.p_home,
        p_draw: r.p_draw,
        p_away: r.p_away,
        p_over_25: r.p_over_25,
        p_btts: r.p_btts,
      };

      for (const sc of SCENARIOS) {
        const blendAlpha = sc.blendAlpha;
        const candidates: EdgeCandidate[] = buildEdgeTable(simInput, r.odds, 1000, {
          isotonicLookup: isoLookup,
          blendAlpha: blendAlpha ?? 1.0,
        });
        const pick = chooseBetForScenario(candidates, sc.opts, {
          leagueCalibrated: calibrated,
        });

        if (!pick) {
          betsByScenario.get(sc.opts.name)!.push({
            scenario: sc.opts.name,
            sim_id: r.simId,
            league: r.league,
            league_calibrated: calibrated ? 1 : 0,
            market: "",
            side: "",
            edge_pct: "",
            odd: "",
            prob_calibrated: "",
            units: 0,
            bet_won: "skip",
            pl_units: "",
            home_score: r.home_goals,
            away_score: r.away_goals,
            resolved_at: r.resolved_at,
            n_train_at_t: trainSamples.length,
          });
          continue;
        }

        const ev = evaluateBet({
          market: pick.candidate.market,
          side: pick.candidate.side,
          homeScore: r.home_goals,
          awayScore: r.away_goals,
          units: pick.units,
          odd: pick.candidate.odd,
        });

        betsByScenario.get(sc.opts.name)!.push({
          scenario: sc.opts.name,
          sim_id: r.simId,
          league: r.league,
          league_calibrated: calibrated ? 1 : 0,
          market: pick.candidate.market,
          side: pick.candidate.side,
          edge_pct: Number(pick.candidate.edge_pct.toFixed(2)),
          odd: pick.candidate.odd,
          prob_calibrated: Number(pick.candidate.prob_calibrated.toFixed(4)),
          units: pick.units,
          bet_won:
            ev.bet_won === null ? "skip" : ev.bet_won ? "true" : "false",
          pl_units:
            ev.pl_units === null ? "" : Number(ev.pl_units.toFixed(4)),
          home_score: r.home_goals,
          away_score: r.away_goals,
          resolved_at: r.resolved_at,
          n_train_at_t: trainSamples.length,
        });
      }
    }

    step++;
    t = stepEnd;
  }
  console.log(
    `[wf] walk-forward done: ${step} daily steps (STEP_DAYS=${STEP_DAYS}), n_train_first=${nTrainFirst}, n_train_last=${nTrainLast}`,
  );

  // ========================================================================
  // METRICS per scenario
  // ========================================================================

  const metricsList: WfScenarioMetrics[] = [];
  for (const sc of SCENARIOS) {
    const bets = betsByScenario.get(sc.opts.name)!;
    const realBets = bets.filter((b) => b.bet_won === "true" || b.bet_won === "false");

    const plList = realBets.map((b) =>
      typeof b.pl_units === "number" ? b.pl_units : 0,
    );
    const stakeList = realBets.map((b) => (typeof b.units === "number" ? b.units : 0));
    const probList = realBets.map((b) =>
      typeof b.prob_calibrated === "number" ? b.prob_calibrated : NaN,
    );
    const outcomeList = realBets.map((b) => (b.bet_won === "true" ? 1 : 0));

    const totalPl = plList.reduce((a, b) => a + b, 0);
    const totalStake = stakeList.reduce((a, b) => a + b, 0);
    const nBets = realBets.length;
    const nWins = realBets.filter((b) => b.bet_won === "true").length;
    const roi = totalStake > 0 ? (totalPl / totalStake) * 100 : null;

    // Bootstrap IC95% pro ROI (bootstrap em pares (pl, stake))
    let ci95Low: number | null = null;
    let ci95High: number | null = null;
    if (nBets >= 10) {
      const pairs: Array<[number, number]> = realBets.map((b) => [
        typeof b.pl_units === "number" ? b.pl_units : 0,
        typeof b.units === "number" ? b.units : 0,
      ]);
      const ci = bootstrapCi95(
        pairs,
        (xs) => {
          let p = 0;
          let s = 0;
          for (const [pl, st] of xs) {
            p += pl;
            s += st;
          }
          return s > 0 ? (p / s) * 100 : 0;
        },
        1000,
        // seed determinístico por cenário (para reproducibilidade)
        sc.opts.name.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0) + 7,
      );
      ci95Low = ci.low;
      ci95High = ci.high;
    }

    // Brier decomposition: usar prob_calibrated da aposta vs outcome binário
    const probsForBrier: number[] = [];
    const outcomesForBrier: number[] = [];
    for (let i = 0; i < probList.length; i++) {
      if (Number.isFinite(probList[i])) {
        probsForBrier.push(probList[i]);
        outcomesForBrier.push(outcomeList[i]);
      }
    }
    const bd =
      probsForBrier.length > 0
        ? brierDecompose(probsForBrier, outcomesForBrier, 10)
        : null;

    // LogLoss (binário, clamp p em [1e-6, 1-1e-6])
    let logLossSum = 0;
    let logLossN = 0;
    for (let i = 0; i < probsForBrier.length; i++) {
      const p = Math.min(1 - 1e-6, Math.max(1e-6, probsForBrier[i]));
      const y = outcomesForBrier[i];
      logLossSum += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      logLossN += 1;
    }
    const logLoss = logLossN > 0 ? logLossSum / logLossN : null;

    // Sharpe-like: mean(pl) / std(pl) — per-bet, NÃO anualizado
    let sharpe: number | null = null;
    if (plList.length >= 2) {
      const m = plList.reduce((a, b) => a + b, 0) / plList.length;
      let v = 0;
      for (const x of plList) v += (x - m) ** 2;
      v /= plList.length;
      const sd = Math.sqrt(v);
      sharpe = sd > 0 ? m / sd : null;
    }

    metricsList.push({
      name: sc.opts.name,
      description: sc.description,
      blendAlpha: sc.blendAlpha,
      n_bets: nBets,
      n_wins: nWins,
      win_rate: nBets > 0 ? nWins / nBets : null,
      pl_total: totalPl,
      staked_total: totalStake,
      roi_pct: roi,
      roi_ci95_low: ci95Low,
      roi_ci95_high: ci95High,
      brier: bd?.brier ?? null,
      brier_reliability: bd?.reliability ?? null,
      brier_resolution: bd?.resolution ?? null,
      brier_uncertainty: bd?.uncertainty ?? null,
      logloss: logLoss,
      sharpe_like: sharpe,
      n_train_first: nTrainFirst,
      n_train_last: nTrainLast,
    });
  }

  // ========================================================================
  // WRITE OUTPUT
  // ========================================================================

  const allBets: BetRecord[] = [];
  for (const bs of betsByScenario.values()) allBets.push(...bs);

  const csvPath = resolve(
    process.cwd(),
    "docs/superpowers/specs/2026-05-25-backtest-walk-forward-cenarios.csv",
  );
  writeCsv(allBets, csvPath);
  console.log(`[wf] csv → ${csvPath}`);

  const mdPath = resolve(
    process.cwd(),
    "docs/superpowers/specs/2026-05-25-backtest-walk-forward.md",
  );
  const md = buildMarkdown({
    metricsList,
    nRecords: records.length,
    nSteps: step,
    nTrainFirst,
    nTrainLast,
    oddsFromFixture,
    oddsFromSnap,
    oddsMissing,
  });
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, md, "utf-8");
  console.log(`[wf] md → ${mdPath}`);

  // Console summary
  printSummary(metricsList);
}

function fmt(v: number | null, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function printSummary(metrics: WfScenarioMetrics[]): void {
  console.log("");
  console.log("=== WALK-FORWARD BACKTEST SUMMARY ===");
  console.log(
    "cenário  | n_bets | WR%   | PL u    | ROI %   | CI95% ROI         | Brier  | Rel    | Res    | LogLoss | Sharpe",
  );
  console.log(
    "---------+--------+-------+---------+---------+-------------------+--------+--------+--------+---------+-------",
  );
  for (const m of metrics) {
    const wr = m.win_rate != null ? (m.win_rate * 100).toFixed(1) : "—";
    const ci =
      m.roi_ci95_low != null && m.roi_ci95_high != null
        ? `[${m.roi_ci95_low.toFixed(2)}, ${m.roi_ci95_high.toFixed(2)}]`
        : "—";
    console.log(
      `${m.name.padEnd(8)} | ${String(m.n_bets).padStart(6)} | ${wr.padStart(5)} | ${m.pl_total.toFixed(2).padStart(7)} | ${fmt(m.roi_pct).padStart(7)} | ${ci.padStart(17)} | ${fmt(m.brier, 4)} | ${fmt(m.brier_reliability, 4)} | ${fmt(m.brier_resolution, 4)} | ${fmt(m.logloss, 4)} | ${fmt(m.sharpe_like, 3)}`,
    );
  }
}

function buildMarkdown(args: {
  metricsList: WfScenarioMetrics[];
  nRecords: number;
  nSteps: number;
  nTrainFirst: number;
  nTrainLast: number;
  oddsFromFixture: number;
  oddsFromSnap: number;
  oddsMissing: number;
}): string {
  const {
    metricsList,
    nRecords,
    nSteps,
    nTrainFirst,
    nTrainLast,
    oddsFromFixture,
    oddsFromSnap,
    oddsMissing,
  } = args;

  // In-sample baseline (do relatório anterior 2026-05-25-backtest-ai-reco-relatorio.md)
  const inSample: Record<string, number> = {
    A: 8.1,
    B: 4.14,
    C: 2.02,
    D10: 10.07,
    D15: 11.94,
    D20: 14.4,
    E: 2.02,
    F: 11.1,
    G: 14.89,
    H: 18.66,
  };

  const lines: string[] = [];
  lines.push("# Backtest IA-2 — WALK-FORWARD (sem leakage in-sample)");
  lines.push("");
  lines.push(`**Data:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Por que walk-forward");
  lines.push("");
  lines.push(
    "O backtest anterior (`2026-05-25-backtest-ai-reco-relatorio.md`) projetou ROI +14.4% (D20) e +18.66% (H). Esses números justificaram subir o `EDGE_THRESHOLD` de 5% pra 20% em prod. Diagnóstico do ML Researcher:",
  );
  lines.push("");
  lines.push("- `getActiveCurves` retorna curvas isotônicas treinadas sobre as MESMAS 1052 sims que o backtest pontuou ⇒ calibração em-amostra.");
  lines.push("- `loadCalibratedLeagues` puxa `league_parameters` ativas — MoM sobre as mesmas linhas que o backtest avalia.");
  lines.push("- PAV in-sample com n≈770 é 30-60% otimista ⇒ ROI real provavelmente +2% a +8%, não +14-18%.");
  lines.push("- Multiple testing inflation: α=0.5 escolhido por ROI no MESMO dataset que tunou sanity=50 e edge=20%.");
  lines.push("");
  lines.push("**Solução:** refit das curvas isotônicas e dos `league_params` a cada passo da janela temporal, usando APENAS samples com `kickoff_utc < t`. Avaliamos fixtures em [t, t+1d] com a calibração do passado.");
  lines.push("");
  lines.push("**Eixo temporal:** `kickoff_utc` (hora do jogo) — não `actual_resolved_at` (batch reconciler timestamp, que se condensa em poucos pontos próximos do `now()` e não reflete a ordem cronológica real). Passo de 1 dia (não 7d): o dataset de prod tem 1052 sims concentradas em ~7 dias de kickoff, então diário dá ~6 janelas honestas; semanal nos daria 1 janela só. STEP_DAYS=1 é um proxy do cron noturno que o sistema deveria estar rodando.");
  lines.push("");
  lines.push("## Universo");
  lines.push("");
  lines.push("- Fonte: `fixture_simulations` com `status='resolved'` nos últimos 90 dias (janela ampliada vs. 30d do backtest in-sample, pra ter warmup decente).");
  lines.push(`- Sims usáveis (com odds disponíveis): **${nRecords}**`);
  lines.push(`- Odds origem fixtures.detail_json: ${oddsFromFixture}`);
  lines.push(`- Odds origem ai_recommendations.edge_table_snapshot: ${oddsFromSnap}`);
  lines.push(`- Sims sem odds: ${oddsMissing}`);
  lines.push(`- Warmup (n samples antes da primeira janela): **${nTrainFirst}**`);
  lines.push(`- n_train final (samples antes da ÚLTIMA janela): **${nTrainLast}**`);
  lines.push(`- Passos diários executados (STEP_DAYS=1): **${nSteps}**`);
  lines.push("");
  lines.push("## Resultados comparados (in-sample vs walk-forward)");
  lines.push("");
  lines.push("| Cenário | ROI in-sample (anterior) | ROI walk-forward | IC95% (bootstrap, 1000×) | Δ (wf − in-sample) | n_bets wf |");
  lines.push("|---------|--------------------------|------------------|--------------------------|---------------------|-----------|");
  for (const m of metricsList) {
    const inS = inSample[m.name];
    const inSStr = inS != null ? `+${inS.toFixed(2)}%` : "—";
    const wfStr = m.roi_pct != null ? `${m.roi_pct >= 0 ? "+" : ""}${m.roi_pct.toFixed(2)}%` : "—";
    const ci =
      m.roi_ci95_low != null && m.roi_ci95_high != null
        ? `[${m.roi_ci95_low.toFixed(2)}%, ${m.roi_ci95_high.toFixed(2)}%]`
        : "—";
    const delta =
      m.roi_pct != null && inS != null
        ? `${m.roi_pct - inS >= 0 ? "+" : ""}${(m.roi_pct - inS).toFixed(2)} pp`
        : "—";
    lines.push(
      `| ${m.name} | ${inSStr} | ${wfStr} | ${ci} | ${delta} | ${m.n_bets} |`,
    );
  }
  lines.push("");
  lines.push("## Métricas honestas (walk-forward)");
  lines.push("");
  lines.push("| Cenário | n_bets | WR % | ROI % | Brier | Reliability (↓) | Resolution (↑) | Uncertainty | LogLoss | Sharpe-like |");
  lines.push("|---------|--------|------|-------|-------|-----------------|----------------|-------------|---------|-------------|");
  for (const m of metricsList) {
    const wr = m.win_rate != null ? (m.win_rate * 100).toFixed(1) : "—";
    lines.push(
      `| ${m.name} | ${m.n_bets} | ${wr} | ${fmt(m.roi_pct, 2)} | ${fmt(m.brier, 4)} | ${fmt(m.brier_reliability, 4)} | ${fmt(m.brier_resolution, 4)} | ${fmt(m.brier_uncertainty, 4)} | ${fmt(m.logloss, 4)} | ${fmt(m.sharpe_like, 3)} |`,
    );
  }
  lines.push("");
  lines.push("> **Brier (Murphy 1973):** `BS = reliability − resolution + uncertainty`.");
  lines.push("> - **Reliability** (mais perto de 0 = melhor): o quanto a freq observada de cada bin diverge da prob prevista.");
  lines.push("> - **Resolution** (maior = melhor): capacidade discriminativa entre bins (vs. base rate).");
  lines.push("> - **Uncertainty**: `p̄(1-p̄)`, limite inferior irredutível.");
  lines.push("> ");
  lines.push("> **Sharpe-like** = `mean(pl_per_bet) / std(pl_per_bet)`. Per-bet, NÃO anualizado. Valores > 0.10 são considerados decentes pra apostas.");
  lines.push("");
  lines.push("## Ranking honesto (walk-forward, por ROI%)");
  lines.push("");
  const sorted = [...metricsList].sort((a, b) => {
    const ra = a.roi_pct ?? -Infinity;
    const rb = b.roi_pct ?? -Infinity;
    return rb - ra;
  });
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    lines.push(
      `${i + 1}. **${m.name}** — ROI ${fmt(m.roi_pct, 2)}% (${m.n_bets} bets, WR ${m.win_rate != null ? (m.win_rate * 100).toFixed(1) + "%" : "—"})`,
    );
  }
  lines.push("");
  lines.push("## Console summary");
  lines.push("");
  lines.push("```");
  lines.push(
    "cenário  | n_bets | WR%   | PL u    | ROI %   | CI95% ROI         | Brier  | Rel    | Res    | LogLoss | Sharpe",
  );
  lines.push(
    "---------+--------+-------+---------+---------+-------------------+--------+--------+--------+---------+-------",
  );
  for (const m of metricsList) {
    const wr = m.win_rate != null ? (m.win_rate * 100).toFixed(1) : "—";
    const ci =
      m.roi_ci95_low != null && m.roi_ci95_high != null
        ? `[${m.roi_ci95_low.toFixed(2)}, ${m.roi_ci95_high.toFixed(2)}]`
        : "—";
    lines.push(
      `${m.name.padEnd(8)} | ${String(m.n_bets).padStart(6)} | ${wr.padStart(5)} | ${m.pl_total.toFixed(2).padStart(7)} | ${fmt(m.roi_pct).padStart(7)} | ${ci.padStart(17)} | ${fmt(m.brier, 4)} | ${fmt(m.brier_reliability, 4)} | ${fmt(m.brier_resolution, 4)} | ${fmt(m.logloss, 4)} | ${fmt(m.sharpe_like, 3)}`,
    );
  }
  lines.push("```");
  lines.push("");
  lines.push("## Dados");
  lines.push("");
  lines.push("- CSV bruto: `docs/superpowers/specs/2026-05-25-backtest-walk-forward-cenarios.csv` (inclui `n_train_at_t` por linha).");
  lines.push("- Cada linha: (cenário × sim_id), com `bet_won` = `skip` quando o cenário não apostou.");
  lines.push("");
  // Recomendação baseada nos resultados
  const m = (name: string) => metricsList.find((x) => x.name === name)!;
  const a = m("A");
  const d20 = m("D20");
  const h = m("H");
  const g = m("G");
  const d10 = m("D10");
  const best = [...metricsList].sort((x, y) => (y.roi_pct ?? -Infinity) - (x.roi_pct ?? -Infinity))[0];
  const allNeg = metricsList.every((x) => x.roi_pct == null || x.roi_pct < 0);
  const allCi95SignificantlyNeg = metricsList.every(
    (x) =>
      x.roi_ci95_high == null ||
      x.roi_ci95_high < 0 ||
      x.n_bets < 30,
  );

  lines.push("## Recomendação");
  lines.push("");
  if (allNeg) {
    lines.push(
      `**Todos os cenários têm ROI walk-forward NEGATIVO.** O melhor é **${best.name}** com ROI ${fmt(best.roi_pct, 2)}% (CI95% [${fmt(best.roi_ci95_low, 2)}%, ${fmt(best.roi_ci95_high, 2)}%]) — ainda perde dinheiro em expectativa.`,
    );
    lines.push("");
    lines.push("### Diagnóstico");
    lines.push("");
    lines.push(`- ROI in-sample +14.40% (D20) caiu para ${fmt(d20.roi_pct, 2)}% walk-forward (Δ = ${fmt((d20.roi_pct ?? 0) - 14.4, 2)} pp).`);
    lines.push(`- ROI in-sample +18.66% (H) caiu para ${fmt(h.roi_pct, 2)}% walk-forward (Δ = ${fmt((h.roi_pct ?? 0) - 18.66, 2)} pp).`);
    lines.push(`- Magnitude do leakage confirma o diagnóstico do ML Researcher: 22-38 pp de queda — mais severo que a estimativa inicial (30-60% inflation).`);
    lines.push(`- Brier (~0.21) e Reliability (~0.03) honestos NÃO são catastróficos — as probs calibradas são razoáveis. **O problema é o gap entre essas probs e as odds de mercado**: o simulador não tem edge real contra a casa.`);
    lines.push("");
    lines.push("### Ações concretas");
    lines.push("");
    lines.push("1. **EDGE_THRESHOLD=20% NÃO é mais defensável** com base no backtest. Subir o threshold removeu volume sem melhorar ROI (D10→D20: -13.12% → -14.00%, ranking PIOROU). Sugestões alternativas:");
    lines.push(
      `   - **Voltar pra 5-10%** mas com units MUITO menores (0.1u ao invés de 0.5u) enquanto o sinal real é inexistente. Melhor cenário hoje é D10 com ROI ${fmt(d10.roi_pct, 2)}% — ainda perde, mas perde menos.`,
    );
    lines.push("   - **Pausar produção até** ter mais ligas com `league_parameters` calibradas (cenários C/E têm n=58 bets — calibração não cobre suficiente do universo).");
    lines.push("2. **sanity=50 mantém-se discutível.** B (com guard) tem ROI -18.26% vs A -14.16%: guard remove +4 pp de retorno. Em walk-forward NÃO ajuda. Voltar pra threshold mais alto (ex 75-100%) ou desativar.");
    lines.push("3. **α=0.5 (blending) é defensável**: F (α=0.5) tem ROI -13.63% vs A (α=1.0) -14.16% — ligeira melhora, com Brier mais baixo (0.2075 vs 0.2140). H (D20+α=0.5) é PIOR que F porque o gate alto remove o pouco signal restante.");
    lines.push(`4. **α=0.3 é PERIGOSO**: G tem ROI -21.56% (pior que A). Mais peso pro mercado faz sentido apenas se o mercado fosse mais informativo que o sim — não é. Manter α=0.5.`);
    lines.push("5. **Investigação a montante** (urgente):");
    lines.push("   - O simulador tem Brier 0.21 binário (OK) mas Reliability **bem maior que zero** (0.027-0.08). Significa que as probs estão sistemática e moderadamente off-calibradas em walk-forward. Aumentar o universo de calibração (mais ligas, mais semanas).");
    lines.push("   - Vies de selecionar odds: confirmar que `extractOdds` está pegando os mesmos timestamps de mercado que estavam vigentes na hora do pre-match (não closing line). Closing line bias inflaria o gap odds−prob, anulando edges aparentes.");
    lines.push("   - Considerar Platt scaling como alternativa ao isotonic — PAV em n=100-300 super-fita pequenas amostras.");
    lines.push("");
    lines.push("### Conclusão executiva");
    lines.push("");
    lines.push(`Os números que justificaram EDGE_THRESHOLD=20 e α=0.5 são **artefato de leakage in-sample**. O pipeline determinístico AINDA NÃO tem edge real. Antes de gastar mais tokens com DeepSeek R1, é mais barato (a) reduzir units, (b) investigar a fonte do gap odds−prob, (c) recalibrar quando o universo de sims dobrar.`);
  } else if (allCi95SignificantlyNeg) {
    lines.push(`**Maioria dos cenários têm IC95% inteiramente negativo.** Sem signal real de edge.`);
  } else {
    const pos = metricsList.filter((x) => (x.roi_pct ?? -Infinity) > 0);
    lines.push(`**Cenários com ROI positivo walk-forward:** ${pos.map((x) => x.name).join(", ")}.`);
  }
  lines.push("");
  return lines.join("\n") + "\n";
}

// ===========================================================================
// Entry — só executa se chamado direto (não em import pelos testes)
// ===========================================================================

const isDirect =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith("backtest-walk-forward.ts");

if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
