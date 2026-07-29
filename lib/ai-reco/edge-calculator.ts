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
import {
  applyTemperature,
  applyTemperatureVector,
} from "@/lib/calibracao/temperature";

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

/** Fator de calibração de DISTRIBUIÇÃO por stat (mean_calibrado = mean × k). */
export type DistKMap = Partial<Record<"corners" | "cards" | "sot" | "goals", number>>;

export interface BuildOptions {
  /** Map "metric-side" → fn(p) → p_calibrado. Métricas: '1x2-home', '1x2-draw',
   *  '1x2-away', 'over25' (cobre tb 'under25' via 1-p). */
  isotonicLookup?: Partial<Record<string, (p: number) => number>>;
  /** Default ⅛ Kelly = 0.125. Pode customizar pra ¼ Kelly etc. */
  kellyFraction?: number;
  /** Blending sim × mercado. 0..1. Default 1.0 (sem blending — status quo).
   *  prob_final = blendAlpha · prob_calibrado + (1 − blendAlpha) · prob_market_devigged. */
  blendAlpha?: number;
  /** Calibração de DISTRIBUIÇÃO dos mercados de contagem (corners/cards/sot).
   *  Prioridade por linha: curva isotônica → k → raw. O k corrige a MÉDIA do
   *  Poisson (a sim subestima ~6–13%) nas linhas SEM curva. Ver
   *  docs/tasks/calibracao-distribuicao + lição B31. */
  distK?: DistKMap;
  /** Temperature scaling por mercado PRINCIPAL ('1x2' | 'over25' | 'btts').
   *
   *  A sim ESTICA as probabilidades — subconfiante nas caudas baixas,
   *  superconfiante nas altas — com a mesma assinatura em todo mercado. Um T
   *  por mercado corrige esse viés monotônico. Promovido em 28/07 após vencer
   *  a arena (n=7290, meanDelta +0.0121, IC95 sem cruzar zero, p<.001); ver
   *  lição B45.
   *
   *  COMPÕE com a curva isotônica: curva primeiro, T depois (29/07). A ordem
   *  anterior era "curva OU T", mas held-out temporal 70/30 (n_test=865)
   *  mostrou que compor bate escolher, e que as curvas de over25/btts estavam
   *  OVERFITANDO (piores que raw out-of-sample) — dar prioridade a elas
   *  mantinha o prejuízo. NÃO se aplica a corners/cards/sot — lá é o k. */
  temperature?: TemperatureMap;
}

/** T por mercado principal. Ausente ou não-finito ⇒ sem correção. */
export type TemperatureMap = Partial<Record<"1x2" | "over25" | "btts", number>>;

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
  /** T do mercado. Só é usado quando NÃO existe curva pra `metricKey`. */
  temperature?: number,
): number {
  const T = usableTemp(temperature);
  const fn = lookup?.[metricKey];

  // Sem curva: o T age sozinho sobre a prob crua.
  if (!fn) return T === null ? prob : applyTemperature(prob, T);

  const out = fn(prob);
  const curved = Number.isFinite(out) ? Math.max(0, Math.min(1, out)) : prob;

  // COM curva: compõe — a curva primeiro, o T depois. Medido em held-out
  // temporal 70/30 (n_test=865): compor bate escolher em 1x2-home
  // (raw .6935 | iso .6826 | T .6844 | iso+T .6805). E as curvas de
  // over25/btts estavam OVERFITANDO — piores que não calibrar nada
  // out-of-sample — então dar prioridade à curva mantinha o prejuízo.
  return T === null ? curved : applyTemperature(curved, T);
}

/** T utilizável: número finito e positivo, e diferente de 1 (identidade). */
function usableTemp(T: number | undefined): number | null {
  if (typeof T !== "number" || !Number.isFinite(T) || T <= 0) return null;
  return T === 1 ? null : T;
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

/** k positivo finito do distK pra um stat; null quando ausente/inválido/<=0. */
function positiveK(distK: DistKMap | undefined, stat: keyof DistKMap): number | null {
  const v = distK?.[stat];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Calibração de um mercado SECUNDÁRIO (corners/cards/sot), ordem de prioridade:
 * curva isotônica → k de distribuição → raw. Espelha
 * `EdgeCalculator#secondary_calibrate` (Ruby).
 */
function secondaryCalibrate(
  metricKey: string,
  rawProb: number,
  stat: keyof DistKMap,
  side: "over" | "under",
  line: number,
  baseMean: number,
  lookup: BuildOptions["isotonicLookup"],
  distK: DistKMap | undefined,
): number {
  if (hasCurve(lookup, metricKey)) return calibrate(metricKey, rawProb, lookup);
  const k = positiveK(distK, stat);
  if (k === null) return rawProb;
  const m = baseMean * k;
  return side === "over" ? poissonProbOver(m, line) : poissonProbUnder(m, line);
}

/**
 * Probabilidade nunca é 0 nem 1.
 *
 * O Monte Carlo de 10k rodadas devolve 1.0 quando nenhuma simulação cruzou a
 * linha, e o modelo passa a tratar isso como certeza — mas a incerteza de
 * MODELO (forma da distribuição, escalação, arbitragem) é ordens de grandeza
 * maior que a de amostragem do MC. Um p=1.0 num mercado de contagem é sempre
 * artefato, nunca conhecimento.
 *
 * Dois danos concretos: infla edge/Kelly na direção errada, e quebra métricas
 * logarítmicas — se o jogo sai do outro lado, log-loss = ∞ e contamina a
 * calibração (a arena usa log-loss como árbitro, B34).
 *
 * NÃO substitui calibração: mercado de contagem em liga sem curva segue
 * overconfiante (B31). É guarda-corpo, não conserto.
 *
 * Espelha `PROB_CEILING`/`PROB_FLOOR` do edge_calculator.rb — os dois lados
 * precisam da mesma guarda.
 */
export const PROB_CEILING = 0.99;
export const PROB_FLOOR = 0.01;

export function clampProb<T extends number | null | undefined>(p: T): T {
  // Preserva null/undefined: "não temos essa probabilidade" é diferente de
  // "a probabilidade é o piso". Só clampa número finito.
  if (typeof p !== "number" || !Number.isFinite(p)) return p;
  return Math.max(PROB_FLOOR, Math.min(PROB_CEILING, p)) as T;
}

/**
 * Normaliza um candidato pronto: probabilidades dentro de [FLOOR, CEILING] e
 * edge/kelly recalculados a partir da probabilidade que de fato decide a
 * aposta (`prob_blended`, ou `prob_calibrated` quando não há blending).
 */
function finalizeCandidate(
  c: EdgeCandidate,
  bankroll: number,
  fraction: number,
): EdgeCandidate {
  const prob_calibrated = clampProb(c.prob_calibrated);
  const prob_blended =
    c.prob_blended === undefined ? undefined : clampProb(c.prob_blended);
  // A prob que decide a aposta: o blend quando há blending, senão a calibrada.
  const effective = prob_blended ?? prob_calibrated;

  return {
    ...c,
    prob_estimated: clampProb(c.prob_estimated),
    prob_calibrated,
    prob_blended,
    edge_pct: pct(effective, c.odd),
    kelly_units: kellyUnits(effective, c.odd, bankroll, fraction),
  };
}

function computeBlend(
  prob_estimated: number,
  metricKey: string,
  prob_market: number | undefined,
  alpha: number,
  lookup: BuildOptions["isotonicLookup"],
  calibratedOverride?: number,
  temperature?: number,
): BlendedComputation {
  const prob_calibrated = clampProb(
    calibratedOverride !== undefined
      ? calibratedOverride
      : calibrate(metricKey, prob_estimated, lookup, temperature),
  );
  if (alpha >= 1.0 || prob_market === undefined || !Number.isFinite(prob_market)) {
    return {
      prob_calibrated,
      prob_market: alpha < 1.0 ? prob_market : undefined,
      prob_blended: prob_calibrated,
    };
  }
  const prob_blended = clampProb(
    alpha * prob_calibrated + (1 - alpha) * prob_market,
  );
  return { prob_calibrated, prob_market, prob_blended };
}

export function buildEdgeTable(
  sim: SimInput,
  odds: OddsInput,
  bankroll: number,
  options: BuildOptions = {},
): EdgeCandidate[] {
  // Clampa as probabilidades da simulação na ENTRADA: assim `prob_estimated`
  // (que vai pro banco e pra UI) e tudo que é derivado dele já nascem sãos.
  // A saída da isotônica é clampada de novo em computeBlend — a curva pode
  // ter platô em 1.0 mesmo com entrada válida.
  sim = {
    ...sim,
    p_home: clampProb(sim.p_home),
    p_draw: clampProb(sim.p_draw),
    p_away: clampProb(sim.p_away),
    p_over_25: clampProb(sim.p_over_25),
    p_btts: clampProb(sim.p_btts),
  };
  const kFrac = options.kellyFraction ?? DEFAULT_KELLY_FRACTION;
  const alpha = clampAlpha(options.blendAlpha ?? DEFAULT_BLEND_ALPHA);
  const lookup = options.isotonicLookup;
  const distK = options.distK;
  const temp = options.temperature;
  const out: EdgeCandidate[] = [];

  // Temperature scaling do 1x2: aplicado no VETOR (não por classe), senão as
  // três probabilidades deixariam de somar 1. Só entra quando nenhum dos três
  // lados tem curva isotônica — curva ganha do T (ver nota em BuildOptions).
  const t1x2 = usableTemp(temp?.["1x2"]);
  let temp1x2: { home: number; draw: number; away: number } | null = null;
  if (
    t1x2 !== null &&
    isFiniteNum(sim.p_home) &&
    isFiniteNum(sim.p_draw) &&
    isFiniteNum(sim.p_away)
  ) {
    // Compõe: cada lado passa pela sua curva (quando existe) e o vetor
    // resultante é reescalado pelo T de uma vez — aplicar o T por classe
    // separadamente quebraria a soma 1.
    const [home, draw, away] = applyTemperatureVector(
      [
        calibrate("1x2-home", sim.p_home, lookup),
        calibrate("1x2-draw", sim.p_draw, lookup),
        calibrate("1x2-away", sim.p_away, lookup),
      ],
      t1x2,
    );
    temp1x2 = { home, draw, away };
  }

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
      temp1x2 ? temp1x2[t.side as "home" | "draw" | "away"] : undefined,
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
        undefined,
        temp?.over25,
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
      const calOver = calibrate("over25", sim.p_over_25, lookup, temp?.over25);
      const calUnder = hasCurve(lookup, "over25-under")
        ? calibrate("over25-under", underSim, lookup, temp?.over25)
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
    const calSim = calibrate("btts", sim_p, lookup, temp?.btts);
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
        const p = clampProb(poissonProbOver(mean, line));
        const cornersDevig = isFiniteNum(odds[underKey])
          ? devigProportional([odds[overKey], odds[underKey]])
          : null;
        const cal = secondaryCalibrate(`corners-over-${sideLbl}`, p, "corners", "over", line, mean, lookup, distK);
        const { prob_calibrated, prob_market, prob_blended } = computeBlend(
          p, `corners-over-${sideLbl}`, cornersDevig?.[0], alpha, lookup, cal,
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
        const p = clampProb(poissonProbUnder(mean, line));
        const cornersDevig = isFiniteNum(odds[overKey])
          ? devigProportional([odds[overKey], odds[underKey]])
          : null;
        const cal = secondaryCalibrate(`corners-under-${sideLbl}`, p, "corners", "under", line, mean, lookup, distK);
        const { prob_calibrated, prob_market, prob_blended } = computeBlend(
          p, `corners-under-${sideLbl}`, cornersDevig?.[1], alpha, lookup, cal,
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
        const p = clampProb(poissonProbOver(mean, line));
        const cardsDevig = isFiniteNum(odds[underKey])
          ? devigProportional([odds[overKey], odds[underKey]])
          : null;
        const cal = secondaryCalibrate(`cards-over-${sideLbl}`, p, "cards", "over", line, mean, lookup, distK);
        const { prob_calibrated, prob_market, prob_blended } = computeBlend(
          p, `cards-over-${sideLbl}`, cardsDevig?.[0], alpha, lookup, cal,
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
        const p = clampProb(poissonProbUnder(mean, line));
        const cardsDevig = isFiniteNum(odds[overKey])
          ? devigProportional([odds[overKey], odds[underKey]])
          : null;
        const cal = secondaryCalibrate(`cards-under-${sideLbl}`, p, "cards", "under", line, mean, lookup, distK);
        const { prob_calibrated, prob_market, prob_blended } = computeBlend(
          p, `cards-under-${sideLbl}`, cardsDevig?.[1], alpha, lookup, cal,
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
        const p = clampProb(poissonProbOver(mean, line));
        const sotDevig = isFiniteNum(odds[underKey])
          ? devigProportional([odds[overKey], odds[underKey]])
          : null;
        const cal = secondaryCalibrate(`sot-over-${sideLbl}`, p, "sot", "over", line, mean, lookup, distK);
        const { prob_calibrated, prob_market, prob_blended } = computeBlend(
          p, `sot-over-${sideLbl}`, sotDevig?.[0], alpha, lookup, cal,
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
        const p = clampProb(poissonProbUnder(mean, line));
        const sotDevig = isFiniteNum(odds[overKey])
          ? devigProportional([odds[overKey], odds[underKey]])
          : null;
        const cal = secondaryCalibrate(`sot-under-${sideLbl}`, p, "sot", "under", line, mean, lookup, distK);
        const { prob_calibrated, prob_market, prob_blended } = computeBlend(
          p, `sot-under-${sideLbl}`, sotDevig?.[1], alpha, lookup, cal,
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

  // Guarda-corpo ÚNICO de saída: clampa as três probabilidades e recalcula
  // edge/kelly a partir da prob efetivamente usada. Fica aqui, e não em cada
  // `out.push`, porque três mercados (over25-under, btts-sim, btts-nao)
  // calculam calibração e blend inline sem passar por `computeBlend` — e um
  // mercado novo escaparia de novo. Um ponto de saída cobre todos, hoje e
  // depois (mesma classe de bug das lições B16/B25: fiar só um caminho).
  return out
    .map((c) => finalizeCandidate(c, bankroll, kFrac))
    .sort((a, b) => b.edge_pct - a.edge_pct);
}

function clampAlpha(a: number): number {
  if (!Number.isFinite(a)) return DEFAULT_BLEND_ALPHA;
  if (a < 0) return 0;
  if (a > 1) return 1;
  return a;
}
