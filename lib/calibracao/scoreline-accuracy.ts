/**
 * Acurácia de PLACAR da simulação — a métrica que nunca tivemos (item 1 / B28).
 *
 * Avalia, sobre os jogos resolvidos, quão bem a sim acerta o placar e — o ponto
 * de B28 — quão enviesada pra EMPATE a distribuição está (predita vs real).
 *
 * Puro, sem I/O. As probs `pHome/pDraw/pAway` são as CRUAS do Monte Carlo
 * (a isotônica é aplicada na leitura, não no que é persistido) — então
 * `predDrawRate = média(pDraw)` é exatamente o viés de empate do GERADOR.
 */

export interface ScorelineSample {
  /** Placar mais simulado (top_scorelines[0].score), ex "1-1". */
  topScore: string | null;
  /** Prob do placar mais simulado (top_scorelines[0].prob). */
  pTop: number | null;
  /** Lista ordenada de placares simulados (top-N). */
  scorelines: Array<{ score: string; prob: number }>;
  pHome: number | null;
  pDraw: number | null;
  pAway: number | null;
  actualHome: number;
  actualAway: number;
}

export interface ScorelineAccuracy {
  n: number;
  /** Fração em que o placar real == top_scorelines[0]. */
  top1HitRate: number;
  /** Média de pTop — o que a sim ACHA que é a taxa de acerto do top-1. */
  top1PredictedMean: number;
  /** Fração em que o real está entre os 3 / 6 mais simulados. */
  top3HitRate: number;
  top6HitRate: number;
  /** Taxa de empate PREVISTA (média de pDraw cru). */
  predDrawRate: number;
  /** Taxa de empate REAL observada. */
  actualDrawRate: number;
  /** Viés de empate = previsto − real (positivo = sim infla empate, B28). */
  drawBias: number;
  /** Ranked Probability Score médio (1X2 ordenado); menor = melhor. */
  rps: number;
}

function isNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** RPS de um jogo 1X2 (3 categorias ordenadas home/draw/away). */
export function rps1x2(
  pHome: number,
  pDraw: number,
  pAway: number,
  outcome: "home" | "draw" | "away",
): number {
  const oH = outcome === "home" ? 1 : 0;
  const oD = outcome === "draw" ? 1 : 0;
  // RPS = (1/(r-1)) Σ_{i=1}^{r-1} (CDF_pred_i − CDF_obs_i)^2, r=3
  const c1 = pHome - oH;
  const c2 = pHome + pDraw - (oH + oD);
  return 0.5 * (c1 * c1 + c2 * c2);
}

export function scorelineAccuracy(samples: ScorelineSample[]): ScorelineAccuracy {
  let n = 0;
  let top1 = 0;
  let top3 = 0;
  let top6 = 0;
  let pTopSum = 0;
  let pTopN = 0;
  let pDrawSum = 0;
  let pDrawN = 0;
  let actualDraws = 0;
  let rpsSum = 0;
  let rpsN = 0;

  for (const s of samples) {
    if (!Number.isInteger(s.actualHome) || !Number.isInteger(s.actualAway)) continue;
    n += 1;
    const actual = `${s.actualHome}-${s.actualAway}`;

    if (s.topScore != null && s.topScore === actual) top1 += 1;

    const idx = s.scorelines.findIndex((sc) => sc.score === actual);
    if (idx >= 0 && idx < 3) top3 += 1;
    if (idx >= 0 && idx < 6) top6 += 1;

    if (isNum(s.pTop)) {
      pTopSum += s.pTop;
      pTopN += 1;
    }
    if (isNum(s.pDraw)) {
      pDrawSum += s.pDraw;
      pDrawN += 1;
    }
    if (s.actualHome === s.actualAway) actualDraws += 1;

    if (isNum(s.pHome) && isNum(s.pDraw) && isNum(s.pAway)) {
      const outcome =
        s.actualHome > s.actualAway ? "home" : s.actualHome < s.actualAway ? "away" : "draw";
      rpsSum += rps1x2(s.pHome, s.pDraw, s.pAway, outcome);
      rpsN += 1;
    }
  }

  const predDrawRate = pDrawN > 0 ? pDrawSum / pDrawN : 0;
  const actualDrawRate = n > 0 ? actualDraws / n : 0;

  return {
    n,
    top1HitRate: n > 0 ? top1 / n : 0,
    top1PredictedMean: pTopN > 0 ? pTopSum / pTopN : 0,
    top3HitRate: n > 0 ? top3 / n : 0,
    top6HitRate: n > 0 ? top6 / n : 0,
    predDrawRate,
    actualDrawRate,
    drawBias: predDrawRate - actualDrawRate,
    rps: rpsN > 0 ? rpsSum / rpsN : 0,
  };
}
