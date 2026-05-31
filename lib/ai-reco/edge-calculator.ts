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

import { poissonProbOver, poissonProbUnder } from "./dist-helpers";

export interface SimInput {
  p_home?: number | null;
  p_draw?: number | null;
  p_away?: number | null;
  p_over_25?: number | null;
  p_btts?: number | null;
  // Wave O+E — secondary markets (Poisson-approximated from sim_stats p50).
  // Unit: expected total match count (home + away combined).
  sim_corners_total_mean?: number | null;
  sim_cards_total_mean?: number | null;
  sim_sot_total_mean?: number | null;
}

export interface OddsInput {
  home?: number | null;
  draw?: number | null;
  away?: number | null;
  over25?: number | null;
  under25?: number | null;
  btts_sim?: number | null;
  btts_nao?: number | null;
  // Wave O+E — secondary market odds (over/under lines).
  // "95" = line 9.5, "105" = line 10.5, "115" = 11.5, etc.
  corners_over_95?: number | null;
  corners_under_95?: number | null;
  corners_over_105?: number | null;
  corners_under_105?: number | null;
  corners_over_85?: number | null;
  corners_under_85?: number | null;
  cards_over_35?: number | null;
  cards_under_35?: number | null;
  cards_over_45?: number | null;
  cards_under_45?: number | null;
  cards_over_55?: number | null;
  cards_under_55?: number | null;
  sot_over_75?: number | null;
  sot_under_75?: number | null;
  sot_over_95?: number | null;
  sot_under_95?: number | null;
  sot_over_105?: number | null;
  sot_under_105?: number | null;
}

/**
 * Market union — Wave O+E extends 1x2/over25/btts with:
 *   corners-over / corners-under  (line encoded in side: "85", "95", "105")
 *   cards-over   / cards-under    (line: "35", "45", "55")
 *   sot-over     / sot-under      (line: "75", "95", "105")
 *
 * V1 approximation: prob estimated via Poisson(mean=sim_*_total_mean).
 * V2 TODO: use actual sample distribution from Monte Carlo runs for better
 * CDF accuracy (p50 ≠ mean for non-symmetric distributions).
 */
export type Market =
  | "1x2"
  | "over25"
  | "btts"
  | "corners-over"
  | "corners-under"
  | "cards-over"
  | "cards-under"
  | "sot-over"
  | "sot-under";

export type Side =
  | "home"
  | "draw"
  | "away"
  | "over"
  | "under"
  | "sim"
  | "nao"
  // Secondary market line identifiers (numeric string):
  | "85"
  | "95"
  | "105"
  | "115"
  | "35"
  | "45"
  | "55"
  | "75";

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
  /** Default ⅛ Kelly = 0.125. Pode customizar pra ¼ Kelly etc. */
  kellyFraction?: number;
  /** Blending sim × mercado. 0..1. Default 1.0 (sem blending — status quo).
   *  prob_final = blendAlpha · prob_calibrado + (1 − blendAlpha) · prob_market_devigged. */
  blendAlpha?: number;
}

// R2 walk-forward (2026-05-25 noite): ¼ Kelly → ⅛ Kelly
const DEFAULT_KELLY_FRACTION = 0.125;
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

/** True quando existe curva própria pra metricKey (curva independente do lado). */
function hasCurve(
  lookup: BuildOptions["isotonicLookup"],
  metricKey: string,
): boolean {
  return typeof lookup?.[metricKey] === "function";
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
      // Fix 2/3: o under tem curva PRÓPRIA ('over25-under') — calibração
      // assimétrica vs over. Sem a curva, fallback pra 1 − cal(over25).
      const underSim = 1 - sim.p_over_25;
      const calOver = calibrate("over25", sim.p_over_25, lookup);
      const calUnder = hasCurve(lookup, "over25-under")
        ? calibrate("over25-under", underSim, lookup)
        : 1 - calOver;
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

  // ---- BTTS — Fix 2/3: calibrado ('btts' sim / 'btts-nao'). Sem curva, cai no
  // raw (sim) e em 1 − cal_sim (nao) — preserva o comportamento anterior. ----
  const bttsDevig =
    alpha < 1.0 ? devigProportional([odds.btts_sim, odds.btts_nao]) : null;
  if (isFiniteNum(sim.p_btts)) {
    const sim_p = sim.p_btts;
    const nao_p = 1 - sim_p;
    const calSim = calibrate("btts", sim_p, lookup);
    const calNao = hasCurve(lookup, "btts-nao")
      ? calibrate("btts-nao", nao_p, lookup)
      : 1 - calSim;
    if (isFiniteNum(odds.btts_sim)) {
      const marketSim = bttsDevig?.[0];
      const blended =
        alpha < 1.0 && marketSim !== undefined && Number.isFinite(marketSim)
          ? alpha * calSim + (1 - alpha) * marketSim
          : calSim;
      out.push({
        market: "btts",
        side: "sim",
        prob_estimated: sim_p,
        prob_calibrated: calSim,
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
          ? alpha * calNao + (1 - alpha) * marketNao
          : calNao;
      out.push({
        market: "btts",
        side: "nao",
        prob_estimated: nao_p,
        prob_calibrated: calNao,
        prob_market: alpha < 1.0 ? marketNao : undefined,
        prob_blended: alpha < 1.0 ? blended : undefined,
        odd: odds.btts_nao,
        edge_pct: pct(blended, odds.btts_nao),
        kelly_units: kellyUnits(blended, odds.btts_nao, bankroll, kFrac),
      });
    }
  }

  // ── Wave O+E: CORNERS (Poisson approx from sim_corners_total_mean) ─────────
  // V1: p50 used as Poisson mean. V2 TODO: proper CDF from MC samples.
  if (isFiniteNum(sim.sim_corners_total_mean)) {
    const mean = sim.sim_corners_total_mean!;
    const cornerLines: Array<[number, keyof OddsInput, keyof OddsInput, Side]> = [
      [8.5, "corners_over_85", "corners_under_85", "85"],
      [9.5, "corners_over_95", "corners_under_95", "95"],
      [10.5, "corners_over_105", "corners_under_105", "105"],
    ];
    for (const [line, overKey, underKey, sideLbl] of cornerLines) {
      if (isFiniteNum(odds[overKey])) {
        const p = poissonProbOver(mean, line);
        const cornersDevig = isFiniteNum(odds[underKey])
          ? devigProportional([odds[overKey], odds[underKey]])
          : null;
        const { prob_calibrated, prob_market, prob_blended } = computeBlend(
          p, `corners-over-${sideLbl}`, cornersDevig?.[0], alpha, lookup,
        );
        out.push({
          market: "corners-over", side: sideLbl,
          prob_estimated: p, prob_calibrated, prob_market,
          prob_blended: alpha < 1.0 ? prob_blended : undefined,
          odd: odds[overKey] as number,
          edge_pct: pct(prob_blended, odds[overKey] as number),
          kelly_units: kellyUnits(prob_blended, odds[overKey] as number, bankroll, kFrac),
        });
      }
      if (isFiniteNum(odds[underKey])) {
        const p = poissonProbUnder(mean, line);
        const cornersDevig = isFiniteNum(odds[overKey])
          ? devigProportional([odds[overKey], odds[underKey]])
          : null;
        const { prob_calibrated, prob_market, prob_blended } = computeBlend(
          p, `corners-under-${sideLbl}`, cornersDevig?.[1], alpha, lookup,
        );
        out.push({
          market: "corners-under", side: sideLbl,
          prob_estimated: p, prob_calibrated, prob_market,
          prob_blended: alpha < 1.0 ? prob_blended : undefined,
          odd: odds[underKey] as number,
          edge_pct: pct(prob_blended, odds[underKey] as number),
          kelly_units: kellyUnits(prob_blended, odds[underKey] as number, bankroll, kFrac),
        });
      }
    }
  }

  // ── Wave O+E: CARDS (Poisson approx from sim_cards_total_mean) ─────────────
  if (isFiniteNum(sim.sim_cards_total_mean)) {
    const mean = sim.sim_cards_total_mean!;
    const cardLines: Array<[number, keyof OddsInput, keyof OddsInput, Side]> = [
      [3.5, "cards_over_35", "cards_under_35", "35"],
      [4.5, "cards_over_45", "cards_under_45", "45"],
      [5.5, "cards_over_55", "cards_under_55", "55"],
    ];
    for (const [line, overKey, underKey, sideLbl] of cardLines) {
      if (isFiniteNum(odds[overKey])) {
        const p = poissonProbOver(mean, line);
        const cardsDevig = isFiniteNum(odds[underKey])
          ? devigProportional([odds[overKey], odds[underKey]])
          : null;
        const { prob_calibrated, prob_market, prob_blended } = computeBlend(
          p, `cards-over-${sideLbl}`, cardsDevig?.[0], alpha, lookup,
        );
        out.push({
          market: "cards-over", side: sideLbl,
          prob_estimated: p, prob_calibrated, prob_market,
          prob_blended: alpha < 1.0 ? prob_blended : undefined,
          odd: odds[overKey] as number,
          edge_pct: pct(prob_blended, odds[overKey] as number),
          kelly_units: kellyUnits(prob_blended, odds[overKey] as number, bankroll, kFrac),
        });
      }
      if (isFiniteNum(odds[underKey])) {
        const p = poissonProbUnder(mean, line);
        const cardsDevig = isFiniteNum(odds[overKey])
          ? devigProportional([odds[overKey], odds[underKey]])
          : null;
        const { prob_calibrated, prob_market, prob_blended } = computeBlend(
          p, `cards-under-${sideLbl}`, cardsDevig?.[1], alpha, lookup,
        );
        out.push({
          market: "cards-under", side: sideLbl,
          prob_estimated: p, prob_calibrated, prob_market,
          prob_blended: alpha < 1.0 ? prob_blended : undefined,
          odd: odds[underKey] as number,
          edge_pct: pct(prob_blended, odds[underKey] as number),
          kelly_units: kellyUnits(prob_blended, odds[underKey] as number, bankroll, kFrac),
        });
      }
    }
  }

  // ── Wave O+E: SHOTS ON TARGET (Poisson approx from sim_sot_total_mean) ─────
  if (isFiniteNum(sim.sim_sot_total_mean)) {
    const mean = sim.sim_sot_total_mean!;
    const sotLines: Array<[number, keyof OddsInput, keyof OddsInput, Side]> = [
      [7.5, "sot_over_75", "sot_under_75", "75"],
      [9.5, "sot_over_95", "sot_under_95", "95"],
      [10.5, "sot_over_105", "sot_under_105", "105"],
    ];
    for (const [line, overKey, underKey, sideLbl] of sotLines) {
      if (isFiniteNum(odds[overKey])) {
        const p = poissonProbOver(mean, line);
        const sotDevig = isFiniteNum(odds[underKey])
          ? devigProportional([odds[overKey], odds[underKey]])
          : null;
        const { prob_calibrated, prob_market, prob_blended } = computeBlend(
          p, `sot-over-${sideLbl}`, sotDevig?.[0], alpha, lookup,
        );
        out.push({
          market: "sot-over", side: sideLbl,
          prob_estimated: p, prob_calibrated, prob_market,
          prob_blended: alpha < 1.0 ? prob_blended : undefined,
          odd: odds[overKey] as number,
          edge_pct: pct(prob_blended, odds[overKey] as number),
          kelly_units: kellyUnits(prob_blended, odds[overKey] as number, bankroll, kFrac),
        });
      }
      if (isFiniteNum(odds[underKey])) {
        const p = poissonProbUnder(mean, line);
        const sotDevig = isFiniteNum(odds[overKey])
          ? devigProportional([odds[overKey], odds[underKey]])
          : null;
        const { prob_calibrated, prob_market, prob_blended } = computeBlend(
          p, `sot-under-${sideLbl}`, sotDevig?.[1], alpha, lookup,
        );
        out.push({
          market: "sot-under", side: sideLbl,
          prob_estimated: p, prob_calibrated, prob_market,
          prob_blended: alpha < 1.0 ? prob_blended : undefined,
          odd: odds[underKey] as number,
          edge_pct: pct(prob_blended, odds[underKey] as number),
          kelly_units: kellyUnits(prob_blended, odds[underKey] as number, bankroll, kFrac),
        });
      }
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
