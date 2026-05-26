import { brierScore, brierScoreMulticlass } from "@/lib/ai/calibration-metrics";
import { crpsFromPercentiles, type PercentileSummary } from "@/lib/calibracao/crps";

export interface ResolvedSimRow {
  league: string | null;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  p_over_25: number | null;
  market_anchor: unknown;
  actual_home_goals: number | null;
  actual_away_goals: number | null;
  actual_resolved_at: string | null;
}

// ── Wave G: Secondary actuals extension ──────────────────────────────────────
// sim_stats JSON shape: { home: { corners: {p10,p50,p90}, cards: {...}, shots_on_target: {...} },
//                         away: { ... } }
// Secondary actuals: actual_btts, actual_corners_{home,away}, actual_cards_{home,away},
//                    actual_sot_{home,away} — populated by the reconciler when available.
// NOTE: choistats API only returns homeGoalsFt/awayGoalsFt/homeReds/awayReds for the
// reconciled fixture. Corners/SOT/cards are NOT available for the current fixture
// in the recent-results widget (only in historical recent results for past games).
// These columns will be NULL until an alternate data source is available.
// BTTS is fully derivable from goals.

interface SimStatsMetric {
  p10: number | null;
  p50: number | null;
  p90: number | null;
  p10_1h?: number | null;
  p50_1h?: number | null;
  p90_1h?: number | null;
  p10_2h?: number | null;
  p50_2h?: number | null;
  p90_2h?: number | null;
}

interface SimStatsSide {
  corners?: SimStatsMetric | null;
  cards?: SimStatsMetric | null;
  shots_on_target?: SimStatsMetric | null;
  goals?: SimStatsMetric | null;
}

interface SimStats {
  home?: SimStatsSide | null;
  away?: SimStatsSide | null;
}

export interface ResolvedSimRowSecondary extends ResolvedSimRow {
  p_btts: number | null;
  actual_btts: boolean | null;
  actual_corners_home: number | null;
  actual_corners_away: number | null;
  actual_cards_home: number | null;
  actual_cards_away: number | null;
  actual_sot_home: number | null;
  actual_sot_away: number | null;
  sim_stats: SimStats | null | unknown;
}

export interface ReliabilityBin {
  range: [number, number];
  n: number;
  predictedAvg: number | null;
  observedFreq: number | null;
}

export type ReliabilityMetric = "1x2-home" | "over25";

export function reliabilityBins(
  rows: ResolvedSimRow[],
  metric: ReliabilityMetric,
): ReliabilityBin[] {
  const bins: ReliabilityBin[] = [];
  for (let i = 0; i < 10; i++) {
    bins.push({
      range: [i / 10, (i + 1) / 10],
      n: 0,
      predictedAvg: null,
      observedFreq: null,
    });
  }
  const acc: Array<{ sumP: number; sumObs: number; n: number }> = bins.map(() => ({
    sumP: 0,
    sumObs: 0,
    n: 0,
  }));

  for (const r of rows) {
    const p = metric === "1x2-home" ? r.p_home : r.p_over_25;
    if (p == null || !Number.isFinite(p)) continue;
    const hg = r.actual_home_goals;
    const ag = r.actual_away_goals;
    if (hg == null || ag == null) continue;

    const observed = metric === "1x2-home"
      ? (hg > ag ? 1 : 0)
      : (hg + ag > 2.5 ? 1 : 0);

    const idx = Math.min(9, Math.max(0, Math.floor(p * 10)));
    acc[idx].sumP += p;
    acc[idx].sumObs += observed;
    acc[idx].n += 1;
  }

  for (let i = 0; i < 10; i++) {
    if (acc[i].n > 0) {
      bins[i].n = acc[i].n;
      bins[i].predictedAvg = acc[i].sumP / acc[i].n;
      bins[i].observedFreq = acc[i].sumObs / acc[i].n;
    }
  }
  return bins;
}

export interface BrierBucket {
  bucket: string;
  n: number;
  brier1x2: number | null;
  brierOver: number | null;
}

export function brierOverTime(
  rows: ResolvedSimRow[],
  granularity: "week" | "month",
): BrierBucket[] {
  const groups = new Map<string, { sum1: number; n1: number; sumO: number; nO: number }>();
  for (const r of rows) {
    if (!r.actual_resolved_at) continue;
    const date = new Date(r.actual_resolved_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = granularity === "week" ? isoWeekLabel(date) : isoMonthLabel(date);
    const g = groups.get(key) ?? { sum1: 0, n1: 0, sumO: 0, nO: 0 };

    const ph = Number(r.p_home);
    const pd = Number(r.p_draw);
    const pa = Number(r.p_away);
    const hg = r.actual_home_goals;
    const ag = r.actual_away_goals;
    if (
      hg != null && ag != null &&
      Number.isFinite(ph) && Number.isFinite(pd) && Number.isFinite(pa)
    ) {
      const outcome: "home" | "draw" | "away" = hg > ag ? "home" : hg < ag ? "away" : "draw";
      g.sum1 += brierScoreMulticlass({ home: ph, draw: pd, away: pa }, outcome);
      g.n1 += 1;
    }
    const pOver = Number(r.p_over_25);
    if (hg != null && ag != null && Number.isFinite(pOver)) {
      g.sumO += brierScore(pOver, hg + ag > 2.5 ? 1 : 0);
      g.nO += 1;
    }
    groups.set(key, g);
  }

  return Array.from(groups.entries())
    .map(([bucket, g]) => ({
      bucket,
      n: Math.max(g.n1, g.nO),
      brier1x2: g.n1 > 0 ? g.sum1 / g.n1 : null,
      brierOver: g.nO > 0 ? g.sumO / g.nO : null,
    }))
    .sort((a, b) => (a.bucket < b.bucket ? 1 : a.bucket > b.bucket ? -1 : 0));
}

function isoWeekLabel(d: Date): string {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function isoMonthLabel(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface MarketDeviation {
  league: string;
  n: number;
  mad: number;
  modelMean: number;
  marketMean: number;
}

/**
 * Desvio entre p_home modelo e probabilidade implícita do mercado por liga.
 * `market_anchor.Result` é keyed por nome de time longo OU por "Draw"; quando
 * não conseguimos identificar qual outcome é "home" pelo nome (que não vem
 * neste payload por design), usamos o MAIOR p NÃO-Draw como proxy do
 * favorito. NÃO é perfeito — é heurística honesta pra sinal de viés
 * sistemático ("modelo sempre acima do mercado em PL?"). Casos exatos vão
 * precisar de coluna home_team aqui (out of scope na F2).
 */
export function marketDeviation(rows: ResolvedSimRow[]): MarketDeviation[] {
  const byLeague = new Map<string, { sumAbs: number; sumP: number; sumM: number; n: number }>();
  for (const r of rows) {
    if (!r.league) continue;
    const p = Number(r.p_home);
    if (!Number.isFinite(p)) continue;
    const m = extractMarketHome(r.market_anchor);
    if (m == null) continue;

    const g = byLeague.get(r.league) ?? { sumAbs: 0, sumP: 0, sumM: 0, n: 0 };
    g.sumAbs += Math.abs(p - m);
    g.sumP += p;
    g.sumM += m;
    g.n += 1;
    byLeague.set(r.league, g);
  }
  return Array.from(byLeague.entries())
    .map(([league, g]) => ({
      league,
      n: g.n,
      mad: g.sumAbs / g.n,
      modelMean: g.sumP / g.n,
      marketMean: g.sumM / g.n,
    }))
    .sort((a, b) => b.n - a.n);
}

function extractMarketHome(anchor: unknown): number | null {
  if (!anchor || typeof anchor !== "object") return null;
  const result = (anchor as Record<string, unknown>).Result;
  if (!result || typeof result !== "object") return null;
  const entries = Object.entries(result as Record<string, unknown>).filter(
    ([k]) => k.toLowerCase() !== "draw",
  );
  if (entries.length === 0) return null;
  const probs = entries
    .map(([, v]) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (probs.length === 0) return null;
  return Math.max(...probs);
}

// ── Wave G: Secondary calibration metrics ────────────────────────────────────

/**
 * Brier score for BTTS (both-teams-to-score) forecasts.
 *
 * Uses actual_btts if available. Falls back to deriving BTTS from
 * actual_home_goals / actual_away_goals when actual_btts is null.
 * Skips rows where p_btts is null.
 *
 * Returns null if no valid rows exist.
 */
export function bttsBrier(rows: ResolvedSimRowSecondary[]): number | null {
  let sumBrier = 0;
  let n = 0;

  for (const r of rows) {
    const p = r.p_btts;
    if (p == null || !Number.isFinite(p)) continue;

    // Resolve actual BTTS: prefer the explicit column, fall back to goals.
    let actualBtts: boolean | null = r.actual_btts;
    if (actualBtts == null) {
      const hg = r.actual_home_goals;
      const ag = r.actual_away_goals;
      if (hg == null || ag == null) continue;
      actualBtts = hg > 0 && ag > 0;
    }

    const y: 0 | 1 = actualBtts ? 1 : 0;
    sumBrier += brierScore(p, y);
    n += 1;
  }

  return n > 0 ? sumBrier / n : null;
}

/**
 * Extract a sim_stats percentile summary for a given side+metric.
 * Returns null if missing.
 */
function extractPctSummary(
  simStats: unknown,
  side: "home" | "away",
  metric: string,
): PercentileSummary | null {
  if (!simStats || typeof simStats !== "object") return null;
  const stats = simStats as Record<string, unknown>;
  const sideData = stats[side];
  if (!sideData || typeof sideData !== "object") return null;
  const metricData = (sideData as Record<string, unknown>)[metric];
  if (!metricData || typeof metricData !== "object") return null;
  const m = metricData as Record<string, unknown>;
  const p10 = m.p10 == null ? null : Number(m.p10);
  const p50 = m.p50 == null ? null : Number(m.p50);
  const p90 = m.p90 == null ? null : Number(m.p90);
  if (
    p10 == null || !Number.isFinite(p10) ||
    p50 == null || !Number.isFinite(p50) ||
    p90 == null || !Number.isFinite(p90)
  ) {
    return null;
  }
  return { p10, p50, p90 };
}

/**
 * Generic helper: compute mean CRPS for a count metric across rows.
 * Returns null if no rows have both sim_stats distribution and actual value.
 *
 * @param rows - resolved sim rows with secondary fields
 * @param simMetric - key in sim_stats (e.g. "corners", "cards", "shots_on_target")
 * @param getActual - function to extract total actual count from a row (e.g. corners_home + corners_away)
 */
function countCrpsMean(
  rows: ResolvedSimRowSecondary[],
  simMetric: string,
  getActual: (r: ResolvedSimRowSecondary) => number | null,
): number | null {
  let sumCrps = 0;
  let n = 0;

  for (const r of rows) {
    const actual = getActual(r);
    if (actual == null) continue;

    // We sum CRPS for home and away sides separately, then average.
    // This gives a per-team-perspective CRPS that aligns with what sim produces.
    const homePerc = extractPctSummary(r.sim_stats, "home", simMetric);
    const awayPerc = extractPctSummary(r.sim_stats, "away", simMetric);

    // At least one side must be available to contribute.
    if (homePerc == null && awayPerc == null) continue;

    // For total metric: use combined home+away.
    // Build a synthetic "total" percentile by summing the two side distributions.
    // Simple approximation: p10_total ≈ p10_home + p10_away (convolution lower bound).
    // This is an approximation; for precise CRPS we'd need the joint distribution.
    // Since we only have marginals, this is the standard practice for separable stats.
    const totalPerc = combineSidePercentiles(homePerc, awayPerc);
    if (totalPerc == null) continue;

    const c = crpsFromPercentiles(totalPerc, actual);
    if (c == null) continue;

    sumCrps += c;
    n += 1;
  }

  return n > 0 ? sumCrps / n : null;
}

/**
 * Combine two side percentile summaries into a total by summing percentiles.
 * If one side is null, uses only the available side.
 * Returns null if both are null.
 *
 * Note: sum of percentiles is an approximation (exact only for independent
 * distributions with symmetric shapes). For overdispersed count distributions
 * (NB), this underestimates the variance at extreme percentiles. Acceptable
 * for calibration monitoring purposes.
 */
function combineSidePercentiles(
  home: PercentileSummary | null,
  away: PercentileSummary | null,
): PercentileSummary | null {
  if (home == null && away == null) return null;
  if (home == null) return away;
  if (away == null) return home;
  return {
    p10: (home.p10 ?? 0) + (away.p10 ?? 0),
    p50: (home.p50 ?? 0) + (away.p50 ?? 0),
    p90: (home.p90 ?? 0) + (away.p90 ?? 0),
  };
}

/**
 * Mean CRPS for corners (home + away total) vs sim_stats.home.corners + sim_stats.away.corners.
 * Returns null if no rows have both actual corners and sim_stats corners distribution.
 *
 * KNOWN LIMITATION (Wave G investigation, 2026-05-25):
 * The choistats recent-results widget does NOT return corners/SOT/cards for the
 * reconciled fixture directly (only homeGoalsFt/awayGoalsFt/homeReds/awayReds).
 * actual_corners_home/away will be NULL until an alternate data source is wired.
 */
export function cornersCrps(rows: ResolvedSimRowSecondary[]): number | null {
  return countCrpsMean(
    rows,
    "corners",
    (r) => {
      const h = r.actual_corners_home;
      const a = r.actual_corners_away;
      if (h == null || a == null) return null;
      return h + a;
    },
  );
}

/**
 * Mean CRPS for cards (home + away total) vs sim_stats.*.cards distribution.
 * See cornersCrps for the known data availability limitation.
 */
export function cardsCrps(rows: ResolvedSimRowSecondary[]): number | null {
  return countCrpsMean(
    rows,
    "cards",
    (r) => {
      const h = r.actual_cards_home;
      const a = r.actual_cards_away;
      if (h == null || a == null) return null;
      return h + a;
    },
  );
}

/**
 * Mean CRPS for shots-on-target (home + away total) vs sim_stats.*.shots_on_target.
 * See cornersCrps for the known data availability limitation.
 */
export function sotCrps(rows: ResolvedSimRowSecondary[]): number | null {
  return countCrpsMean(
    rows,
    "shots_on_target",
    (r) => {
      const h = r.actual_sot_home;
      const a = r.actual_sot_away;
      if (h == null || a == null) return null;
      return h + a;
    },
  );
}
