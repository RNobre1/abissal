/**
 * Helper de exibição dos placares mais simulados (top-N) no painel de simulação.
 *
 * O Monte Carlo persiste o top-6 (`top_scorelines`). O front mostrava só o [0];
 * mostrar os demais comunica a INCERTEZA real (o placar exato mais provável tem
 * só ~10%) em vez de uma falsa precisão. Puro, sem I/O.
 */

export interface Scoreline {
  score: string;
  prob: number;
}

export interface ScorelineBar extends Scoreline {
  /** Largura da barra em %, normalizada pelo placar de maior prob (0..100). */
  barPct: number;
  /** True quando é um empate (h == a) — útil pra realce/leitura do viés. */
  isDraw: boolean;
}

export interface ScorelineDisplay {
  top: ScorelineBar | null;
  /** Demais placares (2º em diante), até `max` no total (top incluído). */
  rest: ScorelineBar[];
  /** Soma das probs exibidas — pra rótulo honesto "cobre ~X%". */
  coverage: number;
}

function isDrawScore(score: string): boolean {
  const m = score.match(/^(\d+)\s*-\s*(\d+)$/);
  return m ? m[1] === m[2] : false;
}

/**
 * Monta as linhas de exibição a partir dos placares simulados.
 *
 * @param scorelines  top_scorelines do repo ([{score, prob}], já ordenado desc).
 * @param max         nº máximo de placares a exibir (default 6).
 */
export function scorelineDisplay(
  scorelines: Scoreline[] | null | undefined,
  max = 6,
): ScorelineDisplay {
  const valid = (scorelines ?? []).filter(
    (s) => s && typeof s.score === "string" && typeof s.prob === "number" && Number.isFinite(s.prob),
  );
  if (valid.length === 0) return { top: null, rest: [], coverage: 0 };

  const shown = valid.slice(0, max);
  const maxProb = Math.max(...shown.map((s) => s.prob), 1e-9);
  const bars: ScorelineBar[] = shown.map((s) => ({
    score: s.score,
    prob: s.prob,
    barPct: Math.max(0, Math.min(100, (s.prob / maxProb) * 100)),
    isDraw: isDrawScore(s.score),
  }));

  return {
    top: bars[0] ?? null,
    rest: bars.slice(1),
    coverage: shown.reduce((acc, s) => acc + s.prob, 0),
  };
}
