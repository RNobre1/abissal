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
  /**
   * Refita o parâmetro a cada N jogos em vez de a cada jogo. Default 1
   * (comportamento original).
   *
   * Motivação (28/07): fitar por jogo é O(n² · grade-de-busca) — o seed do
   * challenger consumia 18 dos 20 minutos do cron semanal e morria no
   * timeout, então `Seed challenger` era cancelado e `Compare` nunca rodava
   * desde 05/07.
   *
   * Não introduz leakage: o parâmetro do jogo `i` continua fitado apenas em
   * jogos ANTERIORES — no limite usa MENOS histórico (o do início do bloco),
   * nunca mais. Estatisticamente é uma escolha conservadora, e o parâmetro
   * praticamente não muda entre jogos consecutivos.
   */
  refitEvery?: number;
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
  const step = Math.max(1, Math.floor(opts.refitEvery ?? 1));
  const out = new Array<number>(games.length);

  let cached: number | null = null;
  let cachedAt = -1; // índice em que o cache foi fitado

  for (let i = 0; i < games.length; i++) {
    if (i < opts.warmup) {
      out[i] = opts.defaultParam;
      continue;
    }
    // Refita ao entrar num novo bloco (ou na primeira vez após o warmup).
    if (cached === null || i - cachedAt >= step) {
      cached = fit(games.slice(0, i));
      cachedAt = i;
    }
    out[i] = cached;
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
