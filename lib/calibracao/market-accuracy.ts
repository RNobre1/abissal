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

function sideMean(
  simStats: unknown,
  side: "home" | "away",
  metric: CountMarket,
): number | null {
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
 * chave `sot` (NÃO `shots_on_target`, que o produtor jamais grava em sim_stats;
 * ver docs/pesquisas/auditoria-shape-produtor-consumidor.md).
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

// Reexportado para o consumidor que precisa do complemento explícito sem
// recalcular 1 − p (evita erro de arredondamento acumulado).
export { poissonProbUnder };

// ── Agregação ─────────────────────────────────────────────────────────────
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

const emptyTally = (): Tally => ({
  calls: 0,
  hits: 0,
  overs: 0,
  universe: 0,
  side: { over: 0, under: 0 },
});

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

/** Chamada binária a partir de uma probabilidade direta (gols/btts). */
function probSide(p: number | null): "over" | "under" | null {
  if (p === null) return null;
  if (p >= CALL_THRESHOLD) return "over";
  if (p <= 1 - CALL_THRESHOLD) return "under";
  return null;
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
        record(
          t,
          marketCall(r.sim_stats, metric, line, opts?.distK).side,
          countOutcome(r, metric, line),
        );
      }
      if (best === null || t.calls > best.t.calls) best = { line, t };
    }
    const acc = best && finish(metric, best.line, best.t, tier);
    if (acc) out.push(acc);
  }

  // gols — p_over_25 já É a probabilidade da linha 2.5, sem Poisson no meio
  const gols = emptyTally();
  for (const r of rows) {
    const h = num(r.actual_home_goals);
    const a = num(r.actual_away_goals);
    record(
      gols,
      probSide(num(r.p_over_25)),
      h === null || a === null ? null : h + a > 2.5,
    );
  }
  const golsAcc = finish("goals", 2.5, gols, tier);
  if (golsAcc) out.push(golsAcc);

  // btts — "over" = ambos marcam
  const btts = emptyTally();
  for (const r of rows) {
    record(
      btts,
      probSide(num(r.p_btts)),
      typeof r.actual_btts === "boolean" ? r.actual_btts : null,
    );
  }
  const bttsAcc = finish("btts", null, btts, tier);
  if (bttsAcc) out.push(bttsAcc);

  // 1x2 — a chamada é sempre o lado de maior probabilidade; o reconciler já
  // gravou o veredito em correct_winner, então não recomputamos o resultado.
  // Taxa-base: usar "acertar sempre o favorito" seria circular (é exatamente o
  // que o modelo faz). A régua honesta pra um mercado ternário é o chute
  // uniforme de 1/3.
  let calls1x2 = 0;
  let hits1x2 = 0;
  for (const r of rows) {
    if (typeof r.correct_winner !== "boolean") continue;
    if ([r.p_home, r.p_draw, r.p_away].some((p) => num(p) === null)) continue;
    calls1x2++;
    if (r.correct_winner) hits1x2++;
  }
  if (calls1x2 > 0) {
    const rate = hits1x2 / calls1x2;
    const ci = wilsonInterval(hits1x2, calls1x2);
    out.push({
      market: "1x2",
      label: MARKET_LABEL["1x2"],
      line: null,
      dominantSide: null,
      calls: calls1x2,
      hits: hits1x2,
      rate,
      baseRate: 1 / 3,
      lift: rate - 1 / 3,
      ci95: { lo: ci.lo, hi: ci.hi },
      sampleTier: tier,
    });
  }

  return out;
}
