/**
 * Comparação champion-challenger (ADR-011) — declara um vencedor com HONESTIDADE.
 *
 * Núcleo estatístico: **bootstrap pareado** dos deltas de log-loss por jogo
 * (champion − challenger), com p-valor **deflacionado pelo nº de challengers**
 * testados (controle de multiple testing — anti walk-forward-bomb). Regra de
 * score própria (log-loss) por construção; o teste é robusto a small-sample e
 * a caudas (não assume normalidade, ao contrário do Diebold-Mariano puro).
 *
 * Convenção de sinal: `delta_i = score_champion(i) − score_challenger(i)`.
 * delta > 0 ⇒ challenger tem MENOR perda ⇒ challenger melhor.
 *
 * Puro, sem I/O. RNG semeado (determinístico) pra testes reproduzíveis.
 */

/** PRNG determinístico (mulberry32). */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BootstrapResult {
  n: number;
  /** Média de (score_champion − score_challenger). >0 ⇒ challenger melhor. */
  meanDelta: number;
  /** IC95% (percentil) da média do delta. */
  ciLo: number;
  ciHi: number;
  /** p-valor unilateral de "challenger NÃO é melhor" (fração de reamostras com média ≤ 0). */
  pChallengerBetter: number;
}

/**
 * Bootstrap pareado dos deltas por jogo. `iterations` reamostragens com
 * reposição; IC95% por percentil; p unilateral = fração de reamostras ≤ 0.
 */
export function pairedBootstrap(
  deltas: number[],
  opts: { iterations?: number; seed?: number } = {},
): BootstrapResult {
  const clean = deltas.filter((d) => Number.isFinite(d));
  const n = clean.length;
  if (n === 0) return { n: 0, meanDelta: 0, ciLo: 0, ciHi: 0, pChallengerBetter: 1 };

  const iterations = opts.iterations ?? 2000;
  const rng = mulberry32(opts.seed ?? 12345);
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const meanDelta = mean(clean);

  const means = new Array<number>(iterations);
  for (let b = 0; b < iterations; b++) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc += clean[(rng() * n) | 0];
    means[b] = acc / n;
  }
  means.sort((a, b) => a - b);
  const ciLo = means[Math.floor(0.025 * iterations)];
  const ciHi = means[Math.min(iterations - 1, Math.floor(0.975 * iterations))];

  let le0 = 0;
  for (const m of means) if (m <= 0) le0++;
  // p unilateral de "challenger é melhor" = massa de reamostras que NÃO mostram melhora.
  const pChallengerBetter = meanDelta > 0 ? le0 / iterations : 1 - le0 / iterations;

  return { n, meanDelta, ciLo, ciHi, pChallengerBetter };
}

/**
 * Deflaciona o p-valor pelo nº de challengers testados (Šidák — menos
 * conservador que Bonferroni, exato sob independência). Controla o multiple
 * testing que produziu a walk-forward-bomb.
 */
export function deflatePValue(p: number, numChallengers: number): number {
  const k = Math.max(1, Math.floor(numChallengers));
  const pc = Math.max(0, Math.min(1, p));
  return 1 - Math.pow(1 - pc, k);
}

export type Verdict = "challenger_better" | "champion_better" | "inconclusive";

/**
 * Veredito honesto: challenger só "ganha" se a média do delta é positiva E o
 * p deflacionado < alpha. Champion "ganha" se delta claramente negativo. Caso
 * contrário, inconclusivo (a maioria dos casos em small-sample — é o esperado).
 */
export function modelVerdict(
  boot: BootstrapResult,
  numChallengers: number,
  alpha = 0.05,
): { verdict: Verdict; pDeflated: number } {
  const pDeflated = deflatePValue(boot.pChallengerBetter, numChallengers);
  if (boot.n < 30) return { verdict: "inconclusive", pDeflated };
  if (boot.meanDelta > 0 && pDeflated < alpha) return { verdict: "challenger_better", pDeflated };
  if (boot.meanDelta < 0 && boot.ciHi < 0) return { verdict: "champion_better", pDeflated };
  return { verdict: "inconclusive", pDeflated };
}
