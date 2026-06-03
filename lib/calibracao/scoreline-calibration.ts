/**
 * Calibração de PLACAR (item 1 / B28) — corrige, DISPLAY-ONLY, os dois vieses
 * medidos da distribuição de placar da sim, SEM mexer no gerador (sem bump de
 * model_version, sem resetar isotônica/league/dist-k):
 *
 *   1. Superconfiança no modal (a sim diz ~15% pro top-1, crava ~10%) →
 *      **temperatura** T>1 achata a distribuição.
 *   2. Inflação de empate (+~4pp) → **drawFactor** δ<1 deflaciona as células
 *      de empate (h==a).
 *
 * Filosofia idêntica à do `k` de distribuição: não muda o gerador, calibra a
 * SAÍDA contra os actuals. As probs de aposta (p_home/draw/away) NÃO passam por
 * aqui — a isotônica já as trata (evita dupla-calibração).
 *
 * Puro, sem I/O. Espelhável em qualquer consumidor.
 */

export interface Scoreline {
  score: string;
  prob: number;
}

export interface ScorelineCalParams {
  /** Temperatura T≥1: achata o pico (T=1 → sem mudança). */
  temperature: number;
  /** Fator de empate δ (0..1]: deflaciona placares h==a (δ=1 → sem mudança). */
  drawFactor: number;
}

export const IDENTITY_CAL: ScorelineCalParams = { temperature: 1, drawFactor: 1 };

function isDraw(score: string): boolean {
  const m = score.match(/^(\d+)\s*-\s*(\d+)$/);
  return m ? m[1] === m[2] : false;
}

/**
 * Aplica a calibração à lista de placares (top-N), PRESERVANDO a cobertura
 * (Σ prob dos exibidos). Por quê: a medição mostrou que a COBERTURA do top-6 já
 * é calibrada (previsto ~55% vs real 55.9%) — o que está enviesado é a FORMA
 * dentro do top-6 (top-1 peaked demais + empate inflado). Então recalibramos só
 * a forma interna e mantemos a massa total exibida.
 *
 * T=1, δ=1 → identidade exata.
 */
export function calibrateScorelines(
  scorelines: Scoreline[] | null | undefined,
  params: ScorelineCalParams = IDENTITY_CAL,
): Scoreline[] {
  const list = (scorelines ?? []).filter(
    (s) => s && typeof s.prob === "number" && Number.isFinite(s.prob) && s.prob >= 0,
  );
  if (list.length === 0) return [];

  const T = Number.isFinite(params.temperature) && params.temperature > 0 ? params.temperature : 1;
  const d = Number.isFinite(params.drawFactor) && params.drawFactor > 0 ? params.drawFactor : 1;

  const coverage = list.reduce((a, s) => a + s.prob, 0);
  const weights = list.map(
    (s) => Math.pow(s.prob, 1 / T) * (isDraw(s.score) ? d : 1),
  );
  const Zw = weights.reduce((a, b) => a + b, 0);
  if (Zw <= 0) return list;

  // Renormaliza a forma interna, reescalando pra preservar a cobertura.
  return list.map((s, i) => ({ score: s.score, prob: (weights[i] / Zw) * coverage }));
}

export interface ScorelineFitSample {
  scorelines: Scoreline[];
  actualHome: number;
  actualAway: number;
}

export interface ScorelineFitResult extends ScorelineCalParams {
  n: number;
  /** Log-loss média da distribuição calibrada (regra de score própria; menor = melhor). */
  logLoss: number;
  /** Log-loss SEM calibração (T=1,δ=1) — baseline pra mostrar o ganho. */
  logLossRaw: number;
  /** Alvos empíricos (pra exibição). */
  actualDrawRate: number;
  actualTop1Hit: number;
  /** Após calibração, o que o modelo passa a "dizer" (médias). */
  calDrawRate: number;
  calTop1Mean: number;
}

// T até 6.0 + δ 0.5..1.0. O objetivo é LOG-LOSS (regra própria) → tem ótimo
// INTERIOR data-driven (pico demais E achatamento demais pioram), então a grade
// larga não vira "sempre o teto".
const T_GRID = Array.from({ length: 26 }, (_, i) => 1 + i * 0.2); // 1.0 … 6.0
const D_GRID = Array.from({ length: 11 }, (_, i) => 0.5 + i * 0.05); // 0.50 … 1.00

/** Massa de empate da lista calibrada (soma das probs de placares h==a). */
function drawMass(cal: Scoreline[]): number {
  return cal.reduce((a, s) => a + (isDraw(s.score) ? s.prob : 0), 0);
}
/** Maior prob calibrada (o modal pós-calibração). */
function top1Prob(cal: Scoreline[]): number {
  return cal.reduce((m, s) => Math.max(m, s.prob), 0);
}

/**
 * Log-loss média de uma calibração sobre as samples. Pro placar real de cada
 * jogo, usa a prob calibrada daquele placar; se o real está FORA do top-N,
 * usa a massa "outros" = 1 − cobertura (preservada pela calibração). Regra de
 * score PRÓPRIA: penaliza tanto o excesso de pico quanto o de achatamento.
 */
export function meanLogLoss(samples: ScorelineFitSample[], T: number, d: number): number {
  let ll = 0;
  let m = 0;
  for (const s of samples) {
    const cal = calibrateScorelines(s.scorelines, { temperature: T, drawFactor: d });
    const coverage = cal.reduce((a, c) => a + c.prob, 0);
    const other = Math.max(1e-9, 1 - coverage);
    const actual = `${s.actualHome}-${s.actualAway}`;
    const hit = cal.find((c) => c.score === actual);
    const p = hit ? hit.prob : other;
    ll += -Math.log(Math.max(p, 1e-9));
    m += 1;
  }
  return m > 0 ? ll / m : Infinity;
}

/**
 * Ajusta (T, δ) por busca em grade MINIMIZANDO a log-loss da distribuição
 * calibrada contra os placares reais — regra de score própria, ótimo interior.
 * Robusto a small-sample (2 parâmetros). Retorna null com <30 amostras.
 */
export function fitScorelineCalibration(samples: ScorelineFitSample[]): ScorelineFitResult | null {
  const valid = samples.filter(
    (s) => Number.isInteger(s.actualHome) && Number.isInteger(s.actualAway) && (s.scorelines?.length ?? 0) > 0,
  );
  if (valid.length < 30) return null;

  const n = valid.length;
  const logLossRaw = meanLogLoss(valid, 1, 1);

  let bestT = 1;
  let bestD = 1;
  let bestLL = Infinity;
  for (const T of T_GRID) {
    for (const d of D_GRID) {
      const ll = meanLogLoss(valid, T, d);
      if (ll < bestLL) {
        bestLL = ll;
        bestT = T;
        bestD = d;
      }
    }
  }

  // Estatísticas de exibição com os params escolhidos.
  let drawSum = 0;
  let top1Sum = 0;
  for (const s of valid) {
    const cal = calibrateScorelines(s.scorelines, { temperature: bestT, drawFactor: bestD });
    drawSum += drawMass(cal);
    top1Sum += top1Prob(cal);
  }
  const actualDrawRate = valid.filter((s) => s.actualHome === s.actualAway).length / n;
  const actualTop1Hit =
    valid.filter((s) => s.scorelines[0]?.score === `${s.actualHome}-${s.actualAway}`).length / n;

  return {
    temperature: bestT,
    drawFactor: bestD,
    n,
    logLoss: bestLL,
    logLossRaw,
    actualDrawRate,
    actualTop1Hit,
    calDrawRate: drawSum / n,
    calTop1Mean: top1Sum / n,
  };
}
