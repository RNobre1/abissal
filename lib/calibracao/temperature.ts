/**
 * Temperature scaling para probabilidades BINÁRIAS.
 *
 * Motivação (medido em 28/07 sobre 3.508 jogos resolvidos): a simulação
 * **estica** as probabilidades — subconfiante nas caudas baixas, superconfiante
 * nas altas, com a mesma assinatura em todos os mercados. Ex. 1x2-home:
 * previsto ~25% → real 30%; previsto ~85% → real 72%.
 *
 * Esse viés é sistemático e monotônico, que é exatamente o que UM parâmetro
 * corrige. Fitado por log-loss e testado out-of-sample (60/40 temporal, só v7,
 * n=2858), o ganho foi positivo em todos os mercados:
 *
 *   1x2 away  T=1.45  +2.47% log-loss
 *   BTTS      T=2.55  +1.47%
 *   over 2.5  T=2.15  +1.35%
 *   1x2 home  T=1.70  +1.07%
 *   1x2 draw  T=0.95  +0.09%   (já calibrado — T≈1)
 *
 * Por que não isotônica: ela precisa de amostra grande POR LIGA (só 14
 * calibradas) e overfita abaixo de ~500 pontos (B34). Um T global fitado em
 * milhares de jogos é muito mais robusto. As duas coexistem — a isotônica
 * conserta forma local onde há dado; o T conserta o esticamento global.
 *
 * Nota histórica: o `T` da `scoreline-cal` (B33) já era temperature scaling,
 * aplicado só à FORMA do placar (display-only). Aqui a mesma ideia vai para as
 * probabilidades de MERCADO, que são as que viram aposta.
 *
 * Puro, sem I/O.
 */

/** Fora desse intervalo a probabilidade deixa de ser informativa (ver B43). */
const EPS = 1e-6;

/**
 * Grade de busca do T. Cobre de "esticar bastante" (0.5) a "achatar muito"
 * (3.0) com passo fino o suficiente pra não perder o ótimo interior.
 */
export const TEMPERATURE_GRID: readonly number[] = Array.from(
  { length: 51 },
  (_, i) => Number((0.5 + i * 0.05).toFixed(2)),
);

/**
 * Aplica temperatura a uma probabilidade binária.
 *
 *   p' = p^(1/T) / ( p^(1/T) + (1-p)^(1/T) )
 *
 * T = 1 → identidade. T > 1 → achata em direção a 0.5. T < 1 → estica.
 * Monotônica (preserva ordenação) e com ponto fixo em 0.5.
 */
export function applyTemperature(p: number, T: number): number {
  if (!Number.isFinite(p)) return 0.5;
  if (!Number.isFinite(T) || T <= 0) return p;

  const clamped = Math.min(Math.max(p, EPS), 1 - EPS);
  const inv = 1 / T;
  const a = Math.pow(clamped, inv);
  const b = Math.pow(1 - clamped, inv);
  const denom = a + b;
  if (!Number.isFinite(denom) || denom <= 0) return clamped;

  return Math.min(Math.max(a / denom, EPS), 1 - EPS);
}

/**
 * Versão multi-classe (1x2: home/draw/away).
 *
 *   p'_i = p_i^(1/T) / Σ_j p_j^(1/T)
 *
 * Generaliza a binária: com 2 classes as duas coincidem. Sempre devolve um
 * vetor que soma 1 — inclusive quando a entrada não soma (renormaliza) ou é
 * degenerada (uma classe em 1.0). T > 1 aproxima da uniforme, T < 1 concentra
 * na classe dominante, e a ordenação das classes é preservada em ambos.
 */
export function applyTemperatureVector(
  probs: readonly number[],
  T: number,
): number[] {
  const n = probs.length;
  if (n === 0) return [];

  const safe = probs.map((p) =>
    Number.isFinite(p) && p > 0 ? Math.max(p, EPS) : EPS,
  );
  const inv = Number.isFinite(T) && T > 0 ? 1 / T : 1;

  const powered = safe.map((p) => Math.pow(p, inv));
  const total = powered.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return new Array<number>(n).fill(1 / n);
  }
  return powered.map((v) => v / total);
}

/**
 * Fita o T que minimiza log-loss numa amostra `[probabilidade, resultado]`.
 *
 * Log-loss (e não Brier) porque é a regra própria que a arena usa como árbitro
 * de modelo (B34) e porque pune com força a superconfiança — que é justamente
 * o viés a corrigir.
 *
 * ATENÇÃO: fite no PASSADO e aplique no futuro. Fitar e avaliar na mesma
 * amostra é a receita da walk-forward-bomb (B24) — o ganho in-sample de um
 * parâmetro livre é sempre positivo e não significa nada.
 *
 * Devolve 1 (identidade) quando não há amostra suficiente.
 */
export function fitTemperature(points: ReadonlyArray<[number, number]>): number {
  const valid = points.filter(
    ([p, o]) => Number.isFinite(p) && (o === 0 || o === 1),
  );
  if (valid.length < 2) return 1;

  let bestT = 1;
  let bestLoss = Number.POSITIVE_INFINITY;

  for (const T of TEMPERATURE_GRID) {
    let sum = 0;
    for (const [p, o] of valid) {
      const q = applyTemperature(p, T);
      sum -= o === 1 ? Math.log(q) : Math.log(1 - q);
    }
    const loss = sum / valid.length;
    if (loss < bestLoss) {
      bestLoss = loss;
      bestT = T;
    }
  }
  return bestT;
}
