/**
 * Edge calculator — determinístico, pure function.
 *
 * Pra cada mercado relevante (1x2/over25/btts), calcula:
 *   prob_blended = α · prob_calibrated + (1 − α) · prob_market_devigged
 *   edge_pct     = (prob_blended · odd - 1) · 100
 *   kelly fracionado (¼ Kelly) = ((prob*odd - 1) / (odd - 1)) / 4
 *   kelly_units = kelly_fracionado * (bankroll / 100)   [1 unit = 1% bankroll]
 *
 * Bankroll convention: 1 unit = bankroll/100. Sem casa decimal "raw money".
 *
 * Isotonic lookup é opcional — se fornecido, prob_calibrated vem dele,
 * senão prob_calibrado = prob_estimated (sem mudança).
 *
 * Blending sim × mercado (v1 universal, default α=1.0 retrocompat):
 *   - α=1.0 → sim puro (status quo histórico).
 *   - α=0.5 → mistura 50/50 com mercado devigado (atenua edges absurdos
 *     em ligas sem league_parameters calibrados, ex: Kolding IF 114%).
 *   - α=0.0 → 100% mercado → edge ≈ 0 sempre.
 *
 * TODO v2 (Wave 3+): α aprendido por liga via fit em fixture_simulations
 *   resolvidas (regressão ROI vs α). Atualmente usamos universal pelo
 *   simulador (sem dataset histórico por liga calibrado pra aprender α).
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
  /** Prob implícita do mercado, devigada. Undefined quando blendAlpha === 1.0. */
  prob_market?: number;
  /** prob_blended = α · prob_calibrated + (1 − α) · prob_market.
   *  Quando blendAlpha === 1.0, prob_blended === prob_calibrated. */
  prob_blended?: number;
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
  /** Blending sim × mercado. 0..1. Default 1.0 (sem blending — status quo).
   *  prob_final = blendAlpha · prob_calibrado + (1 − blendAlpha) · prob_market_devigged. */
  blendAlpha?: number;
}

const DEFAULT_KELLY_FRACTION = 0.25;
const DEFAULT_BLEND_ALPHA = 1.0;

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

/**
 * Devig proporcional: probs_i = (1/odd_i) / sum(1/odd_j).
 * Inputs inválidos (null/undefined/NaN/odd<=1) viram NaN no output, mas a
 * normalização ignora esses inversos no denominador (output dos válidos
 * continua somando 1.0).
 *
 * Shin's method (mais teórico p/ favorito-longshot bias) é v2; proporcional
 * é fine pra v1 — Kolding IF (sim 57% vs market 27%) bate igual sob ambos.
 */
export function devigProportional(odds: Array<number | null | undefined>): number[] {
  const invs = odds.map((o) => (isFiniteNum(o) && o > 1 ? 1 / o : NaN));
  let sum = 0;
  for (const v of invs) {
    if (Number.isFinite(v)) sum += v;
  }
  if (sum <= 0) return invs.map(() => NaN);
  return invs.map((v) => (Number.isFinite(v) ? v / sum : NaN));
}

interface BlendedComputation {
  prob_calibrated: number;
  prob_market: number | undefined;
  prob_blended: number;
}

function computeBlend(
  prob_estimated: number,
  metricKey: string,
  prob_market: number | undefined,
  alpha: number,
  lookup: BuildOptions["isotonicLookup"],
): BlendedComputation {
  const prob_calibrated = calibrate(metricKey, prob_estimated, lookup);
  if (alpha >= 1.0 || prob_market === undefined || !Number.isFinite(prob_market)) {
    return {
      prob_calibrated,
      prob_market: alpha < 1.0 ? prob_market : undefined,
      prob_blended: prob_calibrated,
    };
  }
  const prob_blended = alpha * prob_calibrated + (1 - alpha) * prob_market;
  return { prob_calibrated, prob_market, prob_blended };
}

export function buildEdgeTable(
  sim: SimInput,
  odds: OddsInput,
  bankroll: number,
  options: BuildOptions = {},
): EdgeCandidate[] {
  const kFrac = options.kellyFraction ?? DEFAULT_KELLY_FRACTION;
  const alpha = clampAlpha(options.blendAlpha ?? DEFAULT_BLEND_ALPHA);
  const lookup = options.isotonicLookup;
  const out: EdgeCandidate[] = [];

  // ---- 1X2 — devig conjunto dos 3 inversos (home, draw, away) ----
  const oneX2Devig =
    alpha < 1.0 ? devigProportional([odds.home, odds.draw, odds.away]) : null;

  type Triple = {
    side: Side;
    prob?: number | null;
    odd?: number | null;
    metricKey: string;
    marketProb: number | undefined;
  };
  const oneX2: Triple[] = [
    {
      side: "home",
      prob: sim.p_home,
      odd: odds.home,
      metricKey: "1x2-home",
      marketProb: oneX2Devig?.[0],
    },
    {
      side: "draw",
      prob: sim.p_draw,
      odd: odds.draw,
      metricKey: "1x2-draw",
      marketProb: oneX2Devig?.[1],
    },
    {
      side: "away",
      prob: sim.p_away,
      odd: odds.away,
      metricKey: "1x2-away",
      marketProb: oneX2Devig?.[2],
    },
  ];
  for (const t of oneX2) {
    if (!isFiniteNum(t.prob) || !isFiniteNum(t.odd)) continue;
    const { prob_calibrated, prob_market, prob_blended } = computeBlend(
      t.prob,
      t.metricKey,
      t.marketProb,
      alpha,
      lookup,
    );
    out.push({
      market: "1x2",
      side: t.side,
      prob_estimated: t.prob,
      prob_calibrated,
      prob_market,
      prob_blended: alpha < 1.0 ? prob_blended : undefined,
      odd: t.odd,
      edge_pct: pct(prob_blended, t.odd),
      kelly_units: kellyUnits(prob_blended, t.odd, bankroll, kFrac),
    });
  }

  // ---- OVER/UNDER 2.5 — devig do par (over, under) ----
  const ouDevig =
    alpha < 1.0 ? devigProportional([odds.over25, odds.under25]) : null;
  if (isFiniteNum(sim.p_over_25)) {
    if (isFiniteNum(odds.over25)) {
      const { prob_calibrated, prob_market, prob_blended } = computeBlend(
        sim.p_over_25,
        "over25",
        ouDevig?.[0],
        alpha,
        lookup,
      );
      out.push({
        market: "over25",
        side: "over",
        prob_estimated: sim.p_over_25,
        prob_calibrated,
        prob_market,
        prob_blended: alpha < 1.0 ? prob_blended : undefined,
        odd: odds.over25,
        edge_pct: pct(prob_blended, odds.over25),
        kelly_units: kellyUnits(prob_blended, odds.over25, bankroll, kFrac),
      });
    }
    if (isFiniteNum(odds.under25)) {
      // Under é simétrico: prob_calibrated_under = 1 − cal(over25) (não há
      // curva "over25-under" registrada, então usamos a complementar).
      const underSim = 1 - sim.p_over_25;
      const calOver = calibrate("over25", sim.p_over_25, lookup);
      const calUnder = 1 - calOver;
      const marketUnder = ouDevig?.[1];
      const blendedUnder =
        alpha < 1.0 && marketUnder !== undefined && Number.isFinite(marketUnder)
          ? alpha * calUnder + (1 - alpha) * marketUnder
          : calUnder;
      out.push({
        market: "over25",
        side: "under",
        prob_estimated: underSim,
        prob_calibrated: calUnder,
        prob_market: alpha < 1.0 ? marketUnder : undefined,
        prob_blended: alpha < 1.0 ? blendedUnder : undefined,
        odd: odds.under25,
        edge_pct: pct(blendedUnder, odds.under25),
        kelly_units: kellyUnits(blendedUnder, odds.under25, bankroll, kFrac),
      });
    }
  }

  // ---- BTTS (sem isotônica por enquanto — não há curva treinada pra btts) ----
  const bttsDevig =
    alpha < 1.0 ? devigProportional([odds.btts_sim, odds.btts_nao]) : null;
  if (isFiniteNum(sim.p_btts)) {
    const sim_p = sim.p_btts;
    const nao_p = 1 - sim_p;
    if (isFiniteNum(odds.btts_sim)) {
      const marketSim = bttsDevig?.[0];
      const blended =
        alpha < 1.0 && marketSim !== undefined && Number.isFinite(marketSim)
          ? alpha * sim_p + (1 - alpha) * marketSim
          : sim_p;
      out.push({
        market: "btts",
        side: "sim",
        prob_estimated: sim_p,
        prob_calibrated: sim_p,
        prob_market: alpha < 1.0 ? marketSim : undefined,
        prob_blended: alpha < 1.0 ? blended : undefined,
        odd: odds.btts_sim,
        edge_pct: pct(blended, odds.btts_sim),
        kelly_units: kellyUnits(blended, odds.btts_sim, bankroll, kFrac),
      });
    }
    if (isFiniteNum(odds.btts_nao)) {
      const marketNao = bttsDevig?.[1];
      const blended =
        alpha < 1.0 && marketNao !== undefined && Number.isFinite(marketNao)
          ? alpha * nao_p + (1 - alpha) * marketNao
          : nao_p;
      out.push({
        market: "btts",
        side: "nao",
        prob_estimated: nao_p,
        prob_calibrated: nao_p,
        prob_market: alpha < 1.0 ? marketNao : undefined,
        prob_blended: alpha < 1.0 ? blended : undefined,
        odd: odds.btts_nao,
        edge_pct: pct(blended, odds.btts_nao),
        kelly_units: kellyUnits(blended, odds.btts_nao, bankroll, kFrac),
      });
    }
  }

  return out.sort((a, b) => b.edge_pct - a.edge_pct);
}

function clampAlpha(a: number): number {
  if (!Number.isFinite(a)) return DEFAULT_BLEND_ALPHA;
  if (a < 0) return 0;
  if (a > 1) return 1;
  return a;
}
