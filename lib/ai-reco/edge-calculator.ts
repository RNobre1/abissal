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
