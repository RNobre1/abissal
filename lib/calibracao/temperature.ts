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

/**
 * Cortes temporais do gate. Maioria decide.
 *
 * Um split único inverte o veredito conforme a fatia — as diferenças de
 * log-loss aqui são da mesma ordem do ruído amostral, então "um corte 70/30"
 * é coin flip com aparência de rigor. Mesma constante do gate da isotônica,
 * pelo mesmo motivo.
 */
const GATE_CUTS: readonly number[] = [0.5, 0.6, 0.7, 0.8, 0.85];
const MIN_GATE_SIDE = 50;

function logLossCom(pts: ReadonlyArray<[number, number]>, T: number): number {
  const clamp = (p: number) => Math.min(Math.max(p, 0.01), 0.99);
  let s = 0;
  for (const [p, o] of pts) {
    const q = clamp(applyTemperature(p, T));
    s -= o === 1 ? Math.log(q) : Math.log(1 - q);
  }
  return s / pts.length;
}

function corteUnico(
  pts: ReadonlyArray<[number, number]>,
  frac: number,
): { keep: boolean; raw: number; tempered: number; nTest: number } | null {
  const cut = Math.floor(pts.length * frac);
  const train = pts.slice(0, cut);
  const test = pts.slice(cut);
  if (test.length < MIN_GATE_SIDE || train.length < MIN_GATE_SIDE) return null;

  const T = fitTemperature(train);
  const raw = logLossCom(test, 1);
  const tempered = logLossCom(test, T);
  return { keep: tempered < raw, raw, tempered, nTest: test.length };
}

/**
 * O T só deve ir para produção se BATER o dado cru em amostra que não viu.
 *
 * POR QUE EXISTE: `fit-temperature.ts` fitava o T e media o ganho na MESMA
 * amostra do fit, persistindo com base nisso. Um parâmetro livre ajustado e
 * avaliado no mesmo conjunto sempre melhora o log-loss — não é evidência de
 * generalização, é aritmética. Foi essa a armadilha que produziu a regra B24
 * (in-sample dizia +14% de ROI; walk-forward disse −14%).
 *
 * O gate da isotônica (`fit-isotonic.ts`, 29/07) nasceu depois de flagrar
 * curvas ativas piores que o raw. Este é o mesmo remédio para o irmão que roda
 * no mesmo cron semanal.
 *
 * Sem amostra suficiente para dividir, reprova: ausência de evidência não é
 * evidência de ganho.
 */
export function temperatureHeldOutGate(pts: ReadonlyArray<[number, number]>): {
  keep: boolean;
  raw: number;
  tempered: number;
  nTest: number;
} {
  const votos = GATE_CUTS.map((f) => corteUnico(pts, f)).filter(
    (v): v is { keep: boolean; raw: number; tempered: number; nTest: number } => v !== null,
  );
  if (votos.length === 0) return { keep: false, raw: NaN, tempered: NaN, nTest: 0 };

  const aprovados = votos.filter((v) => v.keep).length;
  const media = (get: (v: (typeof votos)[number]) => number) =>
    votos.reduce((a, v) => a + get(v), 0) / votos.length;
  return {
    keep: aprovados > votos.length / 2,
    raw: media((v) => v.raw),
    tempered: media((v) => v.tempered),
    nTest: Math.round(media((v) => v.nTest)),
  };
}
