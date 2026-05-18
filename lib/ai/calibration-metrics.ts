/**
 * Funções puras de calibração — calculam acerto e curva de calibração a partir
 * de predições resolvidas. Sem side-effects, sem I/O.
 */

// ── tipos ─────────────────────────────────────────────────────────────────────

/** Linha mínima de ai_predictions com status='resolved'. */
export interface ResolvedPrediction {
  correct_winner: boolean;
  correct_over_under: boolean;
  pred_confidence?: number; // necessário para calibrationBuckets
}

export interface HitRateResult {
  winner: number; // [0, 1]
  overUnder: number; // [0, 1]
}

export interface CalibrationBucket {
  range: [number, number]; // [min, max] inclusive / exclusive
  predictedAvg: number; // média de pred_confidence no bucket
  realizedAccuracy: number; // fracção de correct_winner no bucket
  n: number; // total de linhas no bucket
}

// ── scoreWinner ───────────────────────────────────────────────────────────────

/**
 * Retorna true se a predição de vencedor acertou dado o placar final.
 */
export function scoreWinner(
  predWinner: "home" | "draw" | "away",
  homeGoals: number,
  awayGoals: number,
): boolean {
  const actual =
    homeGoals > awayGoals ? "home" : homeGoals < awayGoals ? "away" : "draw";
  return predWinner === actual;
}

// ── scoreOverUnder ────────────────────────────────────────────────────────────

/**
 * Retorna true se a predição de over/under acertou.
 * Over = total de gols > 2.5 (i.e., >= 3).
 */
export function scoreOverUnder(
  predOu: "over" | "under",
  homeGoals: number,
  awayGoals: number,
): boolean {
  const total = homeGoals + awayGoals;
  const actual = total > 2.5 ? "over" : "under";
  return predOu === actual;
}

// ── hitRate ───────────────────────────────────────────────────────────────────

/**
 * Calcula a taxa de acerto global de winner e over/under.
 * Retorna null se não houver linhas.
 */
export function hitRate(rows: ResolvedPrediction[]): HitRateResult | null {
  if (rows.length === 0) return null;
  let correctWinner = 0;
  let correctOu = 0;
  for (const r of rows) {
    if (r.correct_winner) correctWinner += 1;
    if (r.correct_over_under) correctOu += 1;
  }
  return {
    winner: correctWinner / rows.length,
    overUnder: correctOu / rows.length,
  };
}

// ── calibrationBuckets ────────────────────────────────────────────────────────

/**
 * Bucketiza predições por faixa de confiança e computa previsto vs. realizado.
 * Cada bucket cobre [i/nBuckets, (i+1)/nBuckets) exceto o último que inclui 1.
 *
 * Rows sem pred_confidence são ignoradas (apenas afetam linhas sem o campo).
 */
export function calibrationBuckets(
  rows: Array<ResolvedPrediction & { pred_confidence?: number }>,
  nBuckets = 5,
): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = Array.from({ length: nBuckets }, (_, i) => ({
    range: [i / nBuckets, (i + 1) / nBuckets] as [number, number],
    predictedAvg: 0,
    realizedAccuracy: 0,
    n: 0,
  }));
  // Ajusta o último bucket para incluir 1.0
  buckets[nBuckets - 1].range[1] = 1;

  const sums = Array.from({ length: nBuckets }, () => ({
    confidenceSum: 0,
    correctSum: 0,
    n: 0,
  }));

  for (const r of rows) {
    const conf = r.pred_confidence;
    if (typeof conf !== "number" || !Number.isFinite(conf)) continue;

    // Determina o índice do bucket
    let idx = Math.floor(conf * nBuckets);
    if (idx >= nBuckets) idx = nBuckets - 1; // conf === 1.0

    sums[idx].confidenceSum += conf;
    sums[idx].correctSum += r.correct_winner ? 1 : 0;
    sums[idx].n += 1;
  }

  for (let i = 0; i < nBuckets; i++) {
    const s = sums[i];
    buckets[i].n = s.n;
    buckets[i].predictedAvg = s.n > 0 ? s.confidenceSum / s.n : 0;
    buckets[i].realizedAccuracy = s.n > 0 ? s.correctSum / s.n : 0;
  }

  return buckets;
}

// ── brierScore ────────────────────────────────────────────────────────────────

/**
 * Brier score binário: penalidade quadrática `(p − y)²` de uma probabilidade
 * prevista `p ∈ [0,1]` contra o desfecho real `y ∈ {0,1}`.
 *
 * Menor é melhor. Predição perfeita = 0; pior caso = 1.
 * Puro, sem I/O.
 */
export function brierScore(p: number, y: 0 | 1): number {
  const d = p - y;
  return d * d;
}

// ── brierScoreMulticlass ──────────────────────────────────────────────────────

/** Distribuição de probabilidade 1X2 (home/draw/away). */
export interface Outcome1x2Probs {
  home: number;
  draw: number;
  away: number;
}

/**
 * Brier score multiclasse para o mercado 1X2: `Σ_i (p_i − y_i)²` onde `y` é o
 * one-hot do desfecho real (1 na classe ocorrida, 0 nas demais).
 *
 * Menor é melhor. Predição perfeita = 0; pior caso (toda massa na classe
 * errada) = 2 para a forma one-hot de 3 classes.
 * Puro, sem I/O.
 */
export function brierScoreMulticlass(
  probs: Outcome1x2Probs,
  outcome: "home" | "draw" | "away",
): number {
  const dh = probs.home - (outcome === "home" ? 1 : 0);
  const dd = probs.draw - (outcome === "draw" ? 1 : 0);
  const da = probs.away - (outcome === "away" ? 1 : 0);
  return dh * dh + dd * dd + da * da;
}
