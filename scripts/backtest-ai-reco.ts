#!/usr/bin/env tsx
/**
 * Backtest do pipeline determinístico do IA-2 (SEM chamar a IA real).
 *
 * Lê fixtures resolvidas dos últimos 30 dias, roda `buildEdgeTable` por sim
 * com calibração isotônica ativa, aplica 5 regras determinísticas
 * substitutas da IA, calcula ROI/WR/Brier projetado, exporta CSV e
 * markdown. Read-only — não escreve em lugar nenhum no banco.
 *
 * Uso:
 *   pnpm exec tsx scripts/backtest-ai-reco.ts
 *
 * Pré-requisitos (env):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Output:
 *   - docs/superpowers/specs/2026-05-25-backtest-ai-reco-cenarios.csv
 *   - docs/superpowers/specs/2026-05-25-backtest-ai-reco-relatorio.md
 *   - console: tabela sumário ao final
 *
 * Spec: pedido autônomo 2026-05-25 — validar se pipeline determinístico
 * gera ROI positivo antes de continuar gastando tokens com DeepSeek R1.
 *
 * Regra TDD (CLAUDE.md global): as funções puras `evaluateBet` e
 * `chooseBetForScenario` têm testes em `tests/unit/scripts/`.
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
import {
  getActiveCurves,
  type ActiveCurves,
} from "@/lib/calibracao/active-curves-repository";
import { applyIsotonic } from "@/lib/calibracao/isotonic";

// ---------------------------------------------------------------------------
// Types públicos (consumidos pelos testes)
// ---------------------------------------------------------------------------

export type BetMarket = "1x2" | "over25" | "btts";
export type BetSide =
  | "home"
  | "draw"
  | "away"
  | "over"
  | "under"
  | "sim"
  | "nao";

export interface EvaluateBetInput {
  market: BetMarket | string;
  side: BetSide | string;
  homeScore: number | null;
  awayScore: number | null;
  units: number;
  odd: number;
}

export interface EvaluateBetResult {
  bet_won: boolean | null;
  pl_units: number | null;
}

/**
 * Pure-function: dado um veredito (mercado/lado), placar final, stake e odd,
 * retorna { bet_won, pl_units }. `bet_won = null` quando placar ausente ou
 * market/side desconhecido (NÃO conta como aposta — passada adiante pelo
 * caller). `pl_units = null` quando bet_won é null.
 *
 * Convenção:
 *   - 1x2/home: home > away
 *   - 1x2/draw: home == away
 *   - 1x2/away: home < away
 *   - over25/over:  home+away ≥ 3 (NB: spec original disse "≥ 3" pra over,
 *     que equivale a "> 2.5". Empate em exatamente 2.5 é impossível em
 *     futebol — gols são int).
 *   - over25/under: home+away ≤ 2
 *   - btts/sim: home > 0 E away > 0
 *   - btts/nao: home == 0 OU away == 0
 */
export function evaluateBet(input: EvaluateBetInput): EvaluateBetResult {
  const { market, side, homeScore, awayScore, units, odd } = input;
  if (
    homeScore == null ||
    awayScore == null ||
    !Number.isFinite(homeScore) ||
    !Number.isFinite(awayScore)
  ) {
    return { bet_won: null, pl_units: null };
  }

  let bet_won: boolean | null = null;
  if (market === "1x2") {
    if (side === "home") bet_won = homeScore > awayScore;
    else if (side === "draw") bet_won = homeScore === awayScore;
    else if (side === "away") bet_won = homeScore < awayScore;
  } else if (market === "over25") {
    const total = homeScore + awayScore;
    if (side === "over") bet_won = total >= 3;
    else if (side === "under") bet_won = total <= 2;
  } else if (market === "btts") {
    if (side === "sim") bet_won = homeScore > 0 && awayScore > 0;
    else if (side === "nao") bet_won = homeScore === 0 || awayScore === 0;
  }

  if (bet_won === null) return { bet_won: null, pl_units: null };
  const pl_units = bet_won ? units * (odd - 1) : -units;
  return { bet_won, pl_units };
}

// ---------------------------------------------------------------------------
// Scenario rules
// ---------------------------------------------------------------------------

export interface ScenarioOpts {
  name: string;
  /** Edge mínimo para apostar (ex: 5 = 5%). */
  edgeMinPct: number;
  /** Se true, só aposta quando a liga tem `league_parameters` ativa. */
  requireCalibrated: boolean;
  /** Se true, ignora candidatos com edge > 30 em ligas NÃO calibradas. */
  sanityGuard: boolean;
}

export interface ChosenBet {
  candidate: EdgeCandidate;
  units: number;
}

/**
 * Threshold do sanity guard no backtest — mirror de
 * `SANITY_EDGE_THRESHOLD` em lib/ai-reco/recommender.ts. v2 = 50 desde
 * 2026-05-25 (backtest histórico mostrou que 30-50% contém winners).
 */
const SANITY_GUARD_MAX_EDGE_PCT = 50;

/**
 * Implementa as 5 regras substitutas da IA — pure function.
 *
 * Convenção de units (espelha enforceCaps do recommender):
 *   - liga calibrada → 2.0u
 *   - liga não calibrada → 0.5u
 *
 * Retorna null = SKIP (não aposta).
 */
export function chooseBetForScenario(
  candidates: EdgeCandidate[],
  opts: ScenarioOpts,
  ctx: { leagueCalibrated: boolean },
): ChosenBet | null {
  // Gate 1: requireCalibrated
  if (opts.requireCalibrated && !ctx.leagueCalibrated) return null;

  // Gate 2: edge mínimo
  let pool = candidates.filter((c) => c.edge_pct >= opts.edgeMinPct);

  // Gate 3: sanity guard
  if (opts.sanityGuard && !ctx.leagueCalibrated) {
    pool = pool.filter((c) => c.edge_pct <= SANITY_GUARD_MAX_EDGE_PCT);
  }

  if (pool.length === 0) return null;

  // Best edge (pool já vem ordenada por edge_pct desc de buildEdgeTable,
  // mas reordenamos defensivamente — filter() pode mudar a ordem se a
  // implementação interna mudar)
  pool.sort((a, b) => b.edge_pct - a.edge_pct);
  const best = pool[0];

  const units = ctx.leagueCalibrated ? 2.0 : 0.5;
  return { candidate: best, units };
}

// ---------------------------------------------------------------------------
// I/O — runner
// ---------------------------------------------------------------------------

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
}

interface FixtureOddsRow {
  id: number;
  source_url: string | null;
  detail_json: Record<string, unknown> | null;
}

interface ScenarioMetrics {
  name: string;
  description: string;
  n_total: number;        // fixtures consideradas
  n_bets: number;         // não-skip
  n_resolved: number;     // bet_won não-null
  n_wins: number;
  win_rate: number | null;
  pl_units_total: number;
  units_staked_total: number;
  roi_pct: number | null;
  brier_avg: number | null;
}

interface FixtureRecord {
  simId: number;
  league: string | null;
  leagueCalibrated: boolean;
  homeScore: number | null;
  awayScore: number | null;
  candidates: EdgeCandidate[];
  resolvedAt: string | null;
}

// ---------------------------------------------------------------------------
// Env loading (no Next.js)
// ---------------------------------------------------------------------------

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
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env.local missing — caller already set env in shell
  }
}

// ---------------------------------------------------------------------------
// Odds extractor (espelha lib/api/ai-reco/compute/route.ts#extractOdds, sem
// importar a route — route.ts puxa NextResponse e env do Next que não roda
// fora do Next.js).
// ---------------------------------------------------------------------------

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

function digDecimal(
  marketNode: Record<string, unknown>,
  key: string,
): number | null {
  const node = marketNode[key];
  if (!node || typeof node !== "object") return null;
  const v = (node as Record<string, unknown>).decimal_odds;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Odds from ai_recommendations.edge_table_snapshot — fallback when fixture
// foi purgada e o sim resolvido ainda tem reco no banco.
// ---------------------------------------------------------------------------

interface RecoSnapshotRow {
  fixture_id: number | null;
  home_team: string;
  away_team: string;
  edge_table_snapshot: unknown;
  kickoff_utc: string | null;
}

function oddsFromSnapshot(
  snap: unknown,
): OddsInput | null {
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

// ---------------------------------------------------------------------------
// Calibração: isotonic lookup + league parameters
// ---------------------------------------------------------------------------

async function buildIsotonicLookup(
  modelVersion: string | null,
  supabase: SupabaseClient,
): Promise<Partial<Record<string, (p: number) => number>>> {
  if (!modelVersion) return {};
  const { curves } = await getActiveCurves(modelVersion, supabase);
  const lookup: Partial<Record<string, (p: number) => number>> = {};
  if (curves.oneX2Home) {
    lookup["1x2-home"] = (p: number) =>
      applyIsotonic(curves.oneX2Home as Array<[number, number]>, p);
  }
  if (curves.draw) {
    lookup["1x2-draw"] = (p: number) =>
      applyIsotonic(curves.draw as Array<[number, number]>, p);
  }
  if (curves.away) {
    lookup["1x2-away"] = (p: number) =>
      applyIsotonic(curves.away as Array<[number, number]>, p);
  }
  if (curves.over25) {
    lookup["over25"] = (p: number) =>
      applyIsotonic(curves.over25 as Array<[number, number]>, p);
  }
  void (null as unknown as ActiveCurves);
  return lookup;
}

async function loadCalibratedLeagues(
  supabase: SupabaseClient,
): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = supabase as unknown as { from: (t: string) => any };
    const { data, error } = await c
      .from("league_parameters")
      .select("league")
      .is("effective_until", null);
    if (error || !Array.isArray(data)) return out;
    for (const row of data as Array<{ league?: string }>) {
      if (row?.league) out.add(row.league);
    }
  } catch {
    // table missing → empty set
  }
  return out;
}

// ---------------------------------------------------------------------------
// Brier (multiclass 1x2 + binário over25)
// ---------------------------------------------------------------------------

function brier1x2(
  pHome: number,
  pDraw: number,
  pAway: number,
  outcome: "home" | "draw" | "away",
): number {
  const o = { home: 0, draw: 0, away: 0 };
  o[outcome] = 1;
  const dh = pHome - o.home;
  const dd = pDraw - o.draw;
  const da = pAway - o.away;
  return dh * dh + dd * dd + da * da;
}

function brierOver25(pOver: number, observed: 0 | 1): number {
  const d = pOver - observed;
  return d * d;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const SCENARIOS: Array<{ opts: ScenarioOpts; description: string }> = [
  {
    description:
      "A — baseline: best edge ≥ 5%, sem sanity guard, sem requireCalibrated",
    opts: {
      name: "A",
      edgeMinPct: 5,
      requireCalibrated: false,
      sanityGuard: false,
    },
  },
  {
    description:
      "B — sanity guard: A ∧ skip se edge > 50% em liga não calibrada (v2, era 30)",
    opts: {
      name: "B",
      edgeMinPct: 5,
      requireCalibrated: false,
      sanityGuard: true,
    },
  },
  {
    description: "C — só ligas calibradas (league_parameters ativa)",
    opts: {
      name: "C",
      edgeMinPct: 5,
      requireCalibrated: true,
      sanityGuard: false,
    },
  },
  {
    description: "D10 — edge ≥ 10%, sem guards",
    opts: {
      name: "D10",
      edgeMinPct: 10,
      requireCalibrated: false,
      sanityGuard: false,
    },
  },
  {
    description: "D15 — edge ≥ 15%, sem guards",
    opts: {
      name: "D15",
      edgeMinPct: 15,
      requireCalibrated: false,
      sanityGuard: false,
    },
  },
  {
    description: "D20 — edge ≥ 20%, sem guards",
    opts: {
      name: "D20",
      edgeMinPct: 20,
      requireCalibrated: false,
      sanityGuard: false,
    },
  },
  {
    description: "E — combinação: só calibradas + sanity",
    opts: {
      name: "E",
      edgeMinPct: 5,
      requireCalibrated: true,
      sanityGuard: true,
    },
  },
];

// ---------------------------------------------------------------------------
// CSV writer
// ---------------------------------------------------------------------------

interface CsvRow {
  scenario: string;
  sim_id: number;
  league: string;
  league_calibrated: 0 | 1;
  market: string;
  side: string;
  edge_pct: number | "";
  odd: number | "";
  prob_calibrated: number | "";
  units: number | "";
  bet_won: "" | "true" | "false" | "skip";
  pl_units: number | "";
  home_score: number | "";
  away_score: number | "";
}

function csvEscape(v: string | number): string {
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCsv(rows: CsvRow[], path: string): void {
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
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join("\n") + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  loadEnvLocal();

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SR) {
    console.error(
      "missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SR, {
    auth: { persistSession: false },
  });

  // 1. Fetch resolved sims from last 30 days — paginate em chunks de 1000
  // (default supabase é 1000; bump via range pra cobrir o universo cheio).
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = supabase as unknown as { from: (t: string) => any };
  const sims: Array<
    ResolvedSimRow & { home_team: string; away_team: string }
  > = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data: simsRaw, error: simsErr } = await c
      .from("fixture_simulations")
      .select(
        "id, fixture_id, league, model_version, p_home, p_draw, p_away, p_btts, p_over_25, actual_home_goals, actual_away_goals, actual_resolved_at, kickoff_utc, home_team, away_team",
      )
      .eq("status", "resolved")
      .gte("actual_resolved_at", since)
      .order("actual_resolved_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (simsErr) {
      console.error("fixture_simulations query failed:", simsErr);
      process.exit(1);
    }
    const page = (simsRaw ?? []) as Array<
      ResolvedSimRow & { home_team: string; away_team: string }
    >;
    sims.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
    if (from > 20000) break; // safety
  }
  console.log(`[backtest] resolved sims (30d): ${sims.length}`);

  if (sims.length === 0) {
    console.log("nothing to backtest — exit 0");
    process.exit(0);
  }

  // 2. Fetch fixtures (only those still alive — purge 3-4d) for odds.
  // GOTCHA: `fixtures.id` is an internal PK; `fixture_simulations.fixture_id`
  // is the choistats id (from source_url). Match via source_url LIKE.
  // Step A: list ALL live fixtures (source_url only — detail_json is huge,
  // pulling it bulk gives statement timeout). Step B: filter to those we
  // need (overlap com sims.fixture_id), Step C: fetch detail_json em
  // chunks pequenos.
  const liveFixtureRefs: Array<{ id: number; choistatsId: number }> = [];
  {
    const fxPage = 1000;
    let fxFrom = 0;
    for (;;) {
      const { data: fxs, error: fxErr } = await c
        .from("fixtures")
        .select("id, source_url")
        .range(fxFrom, fxFrom + fxPage - 1);
      if (fxErr) {
        console.warn("[backtest] fixtures list failed:", fxErr.message);
        break;
      }
      const page = (fxs ?? []) as Array<{ id: number; source_url: string | null }>;
      for (const f of page) {
        if (!f.source_url) continue;
        const m = f.source_url.match(/\/fixture\/(\d+)/);
        if (!m) continue;
        const cid = Number(m[1]);
        if (Number.isFinite(cid)) {
          liveFixtureRefs.push({ id: f.id, choistatsId: cid });
        }
      }
      if (page.length < fxPage) break;
      fxFrom += fxPage;
      if (fxFrom > 20000) break;
    }
  }
  const simFixIds = new Set(
    sims.map((s) => s.fixture_id).filter((x): x is number => x != null),
  );
  const relevantFixturePks = liveFixtureRefs
    .filter((r) => simFixIds.has(r.choistatsId))
    .map((r) => r.id);
  console.log(
    `[backtest] live fixtures total: ${liveFixtureRefs.length}; relevant (overlap with sims): ${relevantFixturePks.length}`,
  );

  const fixturesByChoistatsId = new Map<number, FixtureOddsRow>();
  // Fetch detail_json em chunks de 50 — payload é multi-MB por row, IN
  // muito grande dá statement timeout (lição: detail_json bulk pull).
  for (let i = 0; i < relevantFixturePks.length; i += 50) {
    const chunk = relevantFixturePks.slice(i, i + 50);
    const { data: fxs, error: fxErr } = await c
      .from("fixtures")
      .select("id, source_url, detail_json")
      .in("id", chunk);
    if (fxErr) {
      console.warn(
        `[backtest] fixtures detail chunk ${i} failed:`,
        fxErr.message,
      );
      continue;
    }
    for (const f of (fxs ?? []) as FixtureOddsRow[]) {
      if (!f.source_url) continue;
      const m = f.source_url.match(/\/fixture\/(\d+)/);
      if (!m) continue;
      const cid = Number(m[1]);
      if (Number.isFinite(cid)) fixturesByChoistatsId.set(cid, f);
    }
  }
  console.log(
    `[backtest] fixtures indexed by choistats id (with detail_json): ${fixturesByChoistatsId.size}`,
  );

  // 3. Fetch ALL ai_recommendations edge_table_snapshot — indexamos por
  // fixture_id E por (home_team, away_team, kickoff_utc) pra maximizar
  // match com sims. AR foi recém-lançado (2026-05-25), poucas centenas
  // de rows totais — pull completo cabe em uma query.
  const recosById = new Map<number, RecoSnapshotRow>();
  const recosByTeams = new Map<string, RecoSnapshotRow>();
  {
    const arPage = 1000;
    let arFrom = 0;
    for (;;) {
      const { data: recoRaw, error: recoErr } = await c
        .from("ai_recommendations")
        .select(
          "fixture_id, home_team, away_team, edge_table_snapshot, kickoff_utc",
        )
        .range(arFrom, arFrom + arPage - 1);
      if (recoErr || !Array.isArray(recoRaw)) break;
      for (const r of recoRaw as RecoSnapshotRow[]) {
        if (r.fixture_id != null) recosById.set(r.fixture_id, r);
        const k = `${r.home_team}|${r.away_team}|${r.kickoff_utc ?? ""}`;
        recosByTeams.set(k, r);
      }
      if ((recoRaw as RecoSnapshotRow[]).length < arPage) break;
      arFrom += arPage;
      if (arFrom > 10000) break;
    }
  }
  console.log(
    `[backtest] ai_recommendations snapshots indexed: byId=${recosById.size}, byTeams=${recosByTeams.size}`,
  );

  // 4. Calibrated leagues set
  const calibratedLeagues = await loadCalibratedLeagues(supabase);
  console.log(
    `[backtest] calibrated leagues (league_parameters ativa): ${calibratedLeagues.size}`,
  );

  // 5. Build per-fixture record (with edge table)
  const records: FixtureRecord[] = [];
  const isoLookupByVersion = new Map<
    string,
    Partial<Record<string, (p: number) => number>>
  >();

  let oddsFromFixture = 0;
  let oddsFromSnap = 0;
  let oddsMissing = 0;

  for (const sim of sims) {
    if (
      sim.actual_home_goals == null ||
      sim.actual_away_goals == null ||
      sim.p_home == null ||
      sim.p_draw == null ||
      sim.p_away == null
    ) {
      continue;
    }

    // Odds: try fixture detail_json first, fallback to reco snapshot
    // (lookup por choistats id, depois por teams+kickoff)
    let odds: OddsInput | null = null;
    if (sim.fixture_id != null) {
      const fix = fixturesByChoistatsId.get(sim.fixture_id);
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

    // Isotonic per model_version (cached)
    const mv = sim.model_version ?? "";
    let lookup = isoLookupByVersion.get(mv);
    if (!lookup) {
      lookup = await buildIsotonicLookup(mv || null, supabase);
      isoLookupByVersion.set(mv, lookup);
    }

    const simInput: SimInput = {
      p_home: sim.p_home,
      p_draw: sim.p_draw,
      p_away: sim.p_away,
      p_over_25: sim.p_over_25,
      p_btts: sim.p_btts,
    };

    // Bankroll constante: 1000 (não temos snapshot histórico de banca por
    // fixture, então usamos referência fixa; só afeta `kelly_units` no
    // candidato, que NÃO é usado nas regras determinísticas — units vem
    // do cap fixo).
    const candidates = buildEdgeTable(simInput, odds, 1000, {
      isotonicLookup: lookup,
    });

    records.push({
      simId: sim.id,
      league: sim.league,
      leagueCalibrated: sim.league
        ? calibratedLeagues.has(sim.league)
        : false,
      homeScore: sim.actual_home_goals,
      awayScore: sim.actual_away_goals,
      candidates,
      resolvedAt: sim.actual_resolved_at,
    });
  }

  console.log(
    `[backtest] records usable: ${records.length} (odds from fixture: ${oddsFromFixture}, from reco snap: ${oddsFromSnap}, missing: ${oddsMissing})`,
  );

  if (records.length === 0) {
    console.error(
      "no records with odds available — backtest needs `fixtures.detail_json.odds_summary` OR `ai_recommendations.edge_table_snapshot` for resolved sims. Cannot proceed.",
    );
    process.exit(1);
  }

  // 6. Brier baseline (independente do cenário)
  let brier1x2Sum = 0;
  let brier1x2N = 0;
  let brierOverSum = 0;
  let brierOverN = 0;
  for (const r of records) {
    if (r.homeScore == null || r.awayScore == null) continue;
    const outcome: "home" | "draw" | "away" =
      r.homeScore > r.awayScore
        ? "home"
        : r.homeScore < r.awayScore
          ? "away"
          : "draw";
    // Use prob_calibrated from candidates (1x2)
    const home = r.candidates.find(
      (c) => c.market === "1x2" && c.side === "home",
    );
    const draw = r.candidates.find(
      (c) => c.market === "1x2" && c.side === "draw",
    );
    const away = r.candidates.find(
      (c) => c.market === "1x2" && c.side === "away",
    );
    if (home && draw && away) {
      brier1x2Sum += brier1x2(
        home.prob_calibrated,
        draw.prob_calibrated,
        away.prob_calibrated,
        outcome,
      );
      brier1x2N += 1;
    }
    const over = r.candidates.find(
      (c) => c.market === "over25" && c.side === "over",
    );
    if (over) {
      const observed: 0 | 1 = r.homeScore + r.awayScore >= 3 ? 1 : 0;
      brierOverSum += brierOver25(over.prob_calibrated, observed);
      brierOverN += 1;
    }
  }
  const brier1x2Avg = brier1x2N > 0 ? brier1x2Sum / brier1x2N : null;
  const brierOverAvg = brierOverN > 0 ? brierOverSum / brierOverN : null;
  console.log(
    `[backtest] baseline Brier 1x2 (multiclass, n=${brier1x2N}): ${brier1x2Avg?.toFixed(4) ?? "—"} | Brier over2.5 (n=${brierOverN}): ${brierOverAvg?.toFixed(4) ?? "—"}`,
  );

  // 7. Run each scenario
  const allCsv: CsvRow[] = [];
  const metricsList: ScenarioMetrics[] = [];

  for (const { opts, description } of SCENARIOS) {
    let nBets = 0;
    let nWins = 0;
    let nResolved = 0;
    let plTotal = 0;
    let unitsStaked = 0;
    let brierScenarioSum = 0;
    let brierScenarioN = 0;

    for (const rec of records) {
      const pick = chooseBetForScenario(rec.candidates, opts, {
        leagueCalibrated: rec.leagueCalibrated,
      });

      if (!pick) {
        allCsv.push({
          scenario: opts.name,
          sim_id: rec.simId,
          league: rec.league ?? "",
          league_calibrated: rec.leagueCalibrated ? 1 : 0,
          market: "",
          side: "",
          edge_pct: "",
          odd: "",
          prob_calibrated: "",
          units: "",
          bet_won: "skip",
          pl_units: "",
          home_score: rec.homeScore ?? "",
          away_score: rec.awayScore ?? "",
        });
        continue;
      }

      const ev = evaluateBet({
        market: pick.candidate.market,
        side: pick.candidate.side,
        homeScore: rec.homeScore,
        awayScore: rec.awayScore,
        units: pick.units,
        odd: pick.candidate.odd,
      });

      nBets += 1;
      unitsStaked += pick.units;

      if (ev.bet_won !== null && ev.pl_units !== null) {
        nResolved += 1;
        if (ev.bet_won) nWins += 1;
        plTotal += ev.pl_units;

        // Brier per bet (binário: prob_calibrated do candidato vs observed)
        const observed: 0 | 1 = ev.bet_won ? 1 : 0;
        const dB = pick.candidate.prob_calibrated - observed;
        brierScenarioSum += dB * dB;
        brierScenarioN += 1;
      }

      allCsv.push({
        scenario: opts.name,
        sim_id: rec.simId,
        league: rec.league ?? "",
        league_calibrated: rec.leagueCalibrated ? 1 : 0,
        market: pick.candidate.market,
        side: pick.candidate.side,
        edge_pct: Number(pick.candidate.edge_pct.toFixed(2)),
        odd: pick.candidate.odd,
        prob_calibrated: Number(pick.candidate.prob_calibrated.toFixed(4)),
        units: pick.units,
        bet_won:
          ev.bet_won === null ? "" : ev.bet_won ? "true" : "false",
        pl_units: ev.pl_units === null ? "" : Number(ev.pl_units.toFixed(4)),
        home_score: rec.homeScore ?? "",
        away_score: rec.awayScore ?? "",
      });
    }

    metricsList.push({
      name: opts.name,
      description,
      n_total: records.length,
      n_bets: nBets,
      n_resolved: nResolved,
      n_wins: nWins,
      win_rate: nResolved > 0 ? nWins / nResolved : null,
      pl_units_total: plTotal,
      units_staked_total: unitsStaked,
      roi_pct: unitsStaked > 0 ? (plTotal / unitsStaked) * 100 : null,
      brier_avg:
        brierScenarioN > 0 ? brierScenarioSum / brierScenarioN : null,
    });
  }

  // 8. Output files
  const csvPath = resolve(
    process.cwd(),
    "docs/superpowers/specs/2026-05-25-backtest-ai-reco-cenarios.csv",
  );
  writeCsv(allCsv, csvPath);
  console.log(`[backtest] csv written → ${csvPath}`);

  const mdPath = resolve(
    process.cwd(),
    "docs/superpowers/specs/2026-05-25-backtest-ai-reco-relatorio.md",
  );
  const md = buildMarkdownReport({
    records,
    metricsList,
    brier1x2Avg,
    brierOverAvg,
    counts: { oddsFromFixture, oddsFromSnap, oddsMissing, totalSims: sims.length },
    calibratedLeagues,
  });
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, md, "utf-8");
  console.log(`[backtest] markdown written → ${mdPath}`);

  // 9. Console summary
  printConsoleSummary(metricsList);
}

function printConsoleSummary(metrics: ScenarioMetrics[]): void {
  console.log("");
  console.log("=== BACKTEST SUMMARY ===");
  console.log(
    "scenario   | n_bets | n_wins | WR%    | PL units | staked | ROI%    | Brier",
  );
  console.log(
    "-----------+--------+--------+--------+----------+--------+---------+--------",
  );
  for (const m of metrics) {
    const wr = m.win_rate != null ? (m.win_rate * 100).toFixed(1) : "—";
    const roi = m.roi_pct != null ? m.roi_pct.toFixed(2) : "—";
    const brier = m.brier_avg != null ? m.brier_avg.toFixed(4) : "—";
    console.log(
      `${m.name.padEnd(10)} | ${String(m.n_bets).padStart(6)} | ${String(m.n_wins).padStart(6)} | ${wr.padStart(6)} | ${m.pl_units_total.toFixed(2).padStart(8)} | ${m.units_staked_total.toFixed(2).padStart(6)} | ${roi.padStart(7)} | ${brier}`,
    );
  }
}

function buildMarkdownReport(args: {
  records: FixtureRecord[];
  metricsList: ScenarioMetrics[];
  brier1x2Avg: number | null;
  brierOverAvg: number | null;
  counts: {
    oddsFromFixture: number;
    oddsFromSnap: number;
    oddsMissing: number;
    totalSims: number;
  };
  calibratedLeagues: Set<string>;
}): string {
  const { records, metricsList, brier1x2Avg, brierOverAvg, counts, calibratedLeagues } = args;
  const lines: string[] = [];
  lines.push("# Backtest IA-2 (pipeline determinístico, sem LLM)");
  lines.push("");
  lines.push(`**Data:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Contexto");
  lines.push("");
  lines.push(
    "IA-2 entrou em prod em 2026-05-25 com performance preocupante: 6 bets resolved, 0 wins, ROI -100%. Edges absurdos (até 114%) detectados. Antes de continuar gastando tokens com DeepSeek R1, validar se o pipeline determinístico (sem chamar a IA) já produz ROI positivo. Se NÃO produzir, a IA não vai consertar — o problema é o simulador / edge calculator a montante.",
  );
  lines.push("");
  lines.push("## Universo");
  lines.push("");
  lines.push("- Fonte: `fixture_simulations` com `status='resolved'` nos últimos 30 dias.");
  lines.push(`- Sims resolvidas no período: **${counts.totalSims}**`);
  lines.push(
    `- Sims usáveis (com odds disponíveis): **${records.length}**`,
  );
  lines.push(`- Odds origem \`fixtures.detail_json.odds_summary\`: ${counts.oddsFromFixture}`);
  lines.push(`- Odds origem \`ai_recommendations.edge_table_snapshot\`: ${counts.oddsFromSnap}`);
  lines.push(`- Sims sem odds (fixture purgada e sem reco): ${counts.oddsMissing}`);
  lines.push(`- Ligas calibradas (\`league_parameters\` ativa): ${calibratedLeagues.size}`);
  lines.push(
    `  - ${[...calibratedLeagues].slice(0, 20).join(", ")}${calibratedLeagues.size > 20 ? "…" : ""}`,
  );
  lines.push("");
  lines.push("## Métricas baseline");
  lines.push("");
  lines.push(
    `- **Brier 1x2 (multiclass)**: ${brier1x2Avg != null ? brier1x2Avg.toFixed(4) : "—"} ${brier1x2Avg != null ? (brier1x2Avg < 0.6 ? "(razoável)" : "(ruim)") : ""}`,
  );
  lines.push(
    `- **Brier Over 2.5 (binário)**: ${brierOverAvg != null ? brierOverAvg.toFixed(4) : "—"} ${brierOverAvg != null ? (brierOverAvg < 0.25 ? "(razoável)" : "(ruim)") : ""}`,
  );
  lines.push("");
  lines.push("> Referência Brier: <0.25 (binário) ou <0.6 (multiclass 1x2) indica calibração utilizável. >0.30 binário sinaliza que as probs do simulador estão sistematicamente off.");
  lines.push("");
  lines.push("## Regras determinísticas substitutas da IA");
  lines.push("");
  lines.push("Para cada `fixture_simulations` resolvida, rodamos `buildEdgeTable(sim, odds, bankroll=1000)` aplicando as curvas isotônicas ativas (`model_calibration`) e aplicamos 7 regras de escolha de aposta — todas determinísticas, ZERO chamada à IA.");
  lines.push("");
  lines.push("| Cenário | Descrição |");
  lines.push("|---------|-----------|");
  for (const m of metricsList) {
    lines.push(`| **${m.name}** | ${m.description.replace(`${m.name} — `, "")} |`);
  }
  lines.push("");
  lines.push("Units por aposta: liga calibrada → 2.0u, não calibrada → 0.5u (mesmo cap do recommender em prod).");
  lines.push("");
  lines.push("## Resultados");
  lines.push("");
  lines.push("| Cenário | n_bets | n_wins | WR % | PL (u) | Staked (u) | ROI % | Brier (bet) |");
  lines.push("|---------|--------|--------|------|--------|------------|-------|-------------|");
  for (const m of metricsList) {
    const wr = m.win_rate != null ? (m.win_rate * 100).toFixed(1) : "—";
    const roi = m.roi_pct != null ? m.roi_pct.toFixed(2) : "—";
    const brier = m.brier_avg != null ? m.brier_avg.toFixed(4) : "—";
    lines.push(
      `| ${m.name} | ${m.n_bets} | ${m.n_wins} | ${wr} | ${m.pl_units_total.toFixed(2)} | ${m.units_staked_total.toFixed(2)} | ${roi} | ${brier} |`,
    );
  }
  lines.push("");

  // Best ROI
  const withRoi = metricsList.filter((m) => m.roi_pct != null && m.n_bets > 0);
  withRoi.sort((a, b) => (b.roi_pct as number) - (a.roi_pct as number));
  const best = withRoi[0];
  const positive = withRoi.filter((m) => (m.roi_pct as number) > 0);
  lines.push("## Conclusão");
  lines.push("");
  if (best) {
    lines.push(
      `- **Melhor cenário:** **${best.name}** com ROI = **${(best.roi_pct as number).toFixed(2)}%** (${best.n_bets} apostas, WR ${(best.win_rate! * 100).toFixed(1)}%)`,
    );
  } else {
    lines.push("- Nenhum cenário gerou apostas.");
  }
  if (positive.length === 0) {
    lines.push("- **Nenhum cenário fechou ROI positivo.** Isso indica que o problema NÃO é a IA — o pipeline a montante (simulador + edge calculator + calibração isotônica) está sistematicamente sobre-estimando edges. A IA estaria amplificando o erro.");
    lines.push("- **Ação sugerida:** pausar gasto com DeepSeek R1; investigar (a) simulador (Brier ruim?), (b) odds extraction (mercado errado/devigging?), (c) calibração (insuficiente data ou liga não calibrada dominante).");
  } else {
    lines.push(`- **Cenários com ROI positivo:** ${positive.map((m) => m.name).join(", ")}.`);
    lines.push("- A IA real terá que **superar o melhor cenário determinístico** para justificar custo (~$0.03/bet em DeepSeek R1).");
  }
  lines.push("");
  lines.push("## Insights");
  lines.push("");
  const cenA = metricsList.find((m) => m.name === "A");
  const cenB = metricsList.find((m) => m.name === "B");
  const cenC = metricsList.find((m) => m.name === "C");
  if (cenA && cenB) {
    const delta = cenB.pl_units_total - cenA.pl_units_total;
    lines.push(
      `- **Sanity guard (edge > ${SANITY_GUARD_MAX_EDGE_PCT}% em liga não calibrada):** delta PL = ${delta.toFixed(2)}u (${delta > 0 ? "✅ guard ajuda" : "❌ guard remove apostas vencedoras"}).`,
    );
  }
  if (cenA && cenC) {
    const wrDelta =
      cenA.win_rate != null && cenC.win_rate != null
        ? (cenC.win_rate - cenA.win_rate) * 100
        : null;
    lines.push(
      `- **Filtrar só ligas calibradas:** WR delta = ${wrDelta != null ? wrDelta.toFixed(1) + " pp" : "—"} (${(wrDelta ?? 0) > 0 ? "calibração ajuda" : "calibração não ajuda WR"}).`,
    );
  }
  const dEdges = metricsList.filter((m) => m.name.startsWith("D"));
  if (dEdges.length > 0) {
    lines.push("- **Threshold de edge:**");
    for (const m of dEdges) {
      lines.push(
        `  - ${m.name}: ${m.n_bets} bets, ROI ${m.roi_pct != null ? m.roi_pct.toFixed(2) + "%" : "—"}, WR ${m.win_rate != null ? (m.win_rate * 100).toFixed(1) + "%" : "—"}`,
      );
    }
  }
  lines.push("");
  lines.push("## Dados");
  lines.push("");
  lines.push("- CSV bruto: `docs/superpowers/specs/2026-05-25-backtest-ai-reco-cenarios.csv` — uma linha por (cenário × sim_id), com `bet_won` = `skip` quando o cenário não apostou.");
  lines.push("");

  // Console summary in fixed-width — útil pra cole/paste no PR.
  lines.push("## Sumário console");
  lines.push("");
  lines.push("```");
  lines.push(
    "scenario   | n_bets | n_wins | WR%    | PL units | staked | ROI%    | Brier",
  );
  lines.push(
    "-----------+--------+--------+--------+----------+--------+---------+--------",
  );
  for (const m of metricsList) {
    const wr = m.win_rate != null ? (m.win_rate * 100).toFixed(1) : "—";
    const roi = m.roi_pct != null ? m.roi_pct.toFixed(2) : "—";
    const brier = m.brier_avg != null ? m.brier_avg.toFixed(4) : "—";
    lines.push(
      `${m.name.padEnd(10)} | ${String(m.n_bets).padStart(6)} | ${String(m.n_wins).padStart(6)} | ${wr.padStart(6)} | ${m.pl_units_total.toFixed(2).padStart(8)} | ${m.units_staked_total.toFixed(2).padStart(6)} | ${roi.padStart(7)} | ${brier}`,
    );
  }
  lines.push("```");
  lines.push("");
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Entry — só executa se chamado direto (não em import)
// ---------------------------------------------------------------------------

const isDirect =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith("backtest-ai-reco.ts");

if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
