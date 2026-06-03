/**
 * Walk-forward (janela expansiva) — predição JUSTA e SEM leakage pra a arena.
 *
 * Pra cada jogo (em ordem CRONOLÓGICA), o parâmetro do modelo é fitado APENAS
 * nos jogos ANTERIORES e usado pra prever aquele jogo → toda predição é
 * out-of-sample. Cobre TODOS os jogos (igual ao champion), ao contrário de um
 * split train/test fixo que só cobre 30%. Jogos antes do `warmup` (sem
 * histórico suficiente) caem no `defaultParam` (forma degenerada sem fit, ex.:
 * Poisson) — sem leakage. É a metodologia que a pesquisa L3 recomenda
 * (anti walk-forward-bomb): nada é avaliado nos dados em que foi fitado.
 *
 * Puro, sem I/O.
 */

export interface WalkForwardOpts {
  /** Mín. de jogos anteriores pra fitar; abaixo disso usa defaultParam. */
  warmup: number;
  /** Parâmetro degenerado (sem fit) usado no warmup (ex.: Poisson). */
  defaultParam: number;
}

/**
 * Retorna, pra cada jogo i (na ordem dada — DEVE ser cronológica), o parâmetro
 * fitado em games[0..i-1] (ou defaultParam se i < warmup).
 *
 * @param games  jogos em ordem cronológica.
 * @param fit    fita o parâmetro num conjunto de treino (jogos anteriores).
 */
export function walkForwardParams<T>(
  games: T[],
  fit: (train: T[]) => number,
  opts: WalkForwardOpts,
): number[] {
  const out = new Array<number>(games.length);
  for (let i = 0; i < games.length; i++) {
    out[i] = i >= opts.warmup ? fit(games.slice(0, i)) : opts.defaultParam;
  }
  return out;
}

/**
 * Parâmetro "ao vivo" pra jogos FUTUROS (sem resultado): fita em TODOS os jogos
 * resolvidos disponíveis. defaultParam se < warmup.
 */
export function liveParam<T>(
  resolved: T[],
  fit: (train: T[]) => number,
  opts: WalkForwardOpts,
): number {
  return resolved.length >= opts.warmup ? fit(resolved) : opts.defaultParam;
}
