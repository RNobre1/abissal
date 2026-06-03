/**
 * Funções puras de scoring probabilístico por mercado — usadas pela arena
 * champion-challenger (ADR-011) para avaliar predições em `model_predictions`.
 *
 * Sem I/O, sem DB. Puramente matemático e testável em Vitest.
 *
 * Mercados suportados:
 *   '1x2'       — 3 categorias (home/draw/away)
 *   'over25'    — binário (over/under)
 *   'btts'      — binário (sim/nao)
 *   'scoreline' — categórico top-N (array de {score, prob})
 *   'corners'   — Poisson sobre total contado
 *   'cards'     — Poisson sobre total contado
 *   'sot'       — Poisson sobre total contado
 */

const P_FLOOR = 1e-9;

// ── Tipos de probs e outcomes por mercado ─────────────────────────────────────

export interface Probs1x2 {
  home: number;
  draw: number;
  away: number;
}

export interface Outcome1x2 {
  result: "home" | "draw" | "away";
}

export interface ProbsOver {
  over: number;
  under: number;
}

export interface OutcomeOver {
  over: boolean;
}

export interface ProbsBtts {
  sim: number;
  nao: number;
}

export interface OutcomeBtts {
  btts: boolean;
}

export interface ScorelineEntry {
  score: string;
  prob: number;
}

export interface OutcomeScoreline {
  score: string; // formato "h-a", ex.: "2-1"
}

export interface ProbsCount {
  mean: number;
}

export interface OutcomeCount {
  total: number;
}

// ── poissonPmf ────────────────────────────────────────────────────────────────

/**
 * P(X = k | Poisson(mean)) em log-space para evitar overflow.
 * k deve ser inteiro não-negativo; mean é clampado para ≥1e-9.
 * Retorna 0 para k negativo.
 */
export function poissonPmf(mean: number, k: number): number {
  if (k < 0 || !Number.isInteger(k)) return 0;
  const lambda = Math.max(mean, P_FLOOR);
  // log P(X=k) = -lambda + k*ln(lambda) - ln(k!)
  let logP = -lambda;
  for (let i = 1; i <= k; i++) {
    logP += Math.log(lambda) - Math.log(i);
  }
  const p = Math.exp(logP);
  return Math.max(P_FLOOR, p); // floor pra evitar ln(0) downstream
}

// ── logLoss ────────────────────────────────────────────────────────────────────

/**
 * Log-loss = −ln(p atribuída ao resultado real).
 * Floor interno de p em P_FLOOR (1e-9) para evitar −Infinity.
 */
export function logLoss(
  market: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  probs: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outcome: any,
): number {
  switch (market) {
    case "1x2": {
      const p = Math.max(P_FLOOR, (probs as Probs1x2)[(outcome as Outcome1x2).result] ?? 0);
      return -Math.log(p);
    }

    case "over25": {
      const o = outcome as OutcomeOver;
      const pr = probs as ProbsOver;
      const p = Math.max(P_FLOOR, o.over ? pr.over : pr.under);
      return -Math.log(p);
    }

    case "btts": {
      const o = outcome as OutcomeBtts;
      const pr = probs as ProbsBtts;
      const p = Math.max(P_FLOOR, o.btts ? pr.sim : pr.nao);
      return -Math.log(p);
    }

    case "scoreline": {
      const lista = probs as ScorelineEntry[];
      const targetScore = (outcome as OutcomeScoreline).score;
      const entry = lista.find((e) => e.score === targetScore);
      let p: number;
      if (entry) {
        p = Math.max(P_FLOOR, entry.prob);
      } else {
        // massa-restante = 1 − Σprob; floor em P_FLOOR
        const sumProb = lista.reduce((acc, e) => acc + e.prob, 0);
        const restante = 1 - sumProb;
        p = Math.max(P_FLOOR, restante);
      }
      return -Math.log(p);
    }

    case "corners":
    case "cards":
    case "sot": {
      const mean = (probs as ProbsCount).mean;
      const k = Math.round((outcome as OutcomeCount).total); // garante inteiro
      const pmf = poissonPmf(mean, k);
      return -Math.log(pmf);
    }

    default:
      return NaN;
  }
}

// ── brier ──────────────────────────────────────────────────────────────────────

/**
 * Brier score por mercado:
 *   - 1x2: Σ(p_i − o_i)² sobre as 3 categorias (multiclasse)
 *   - over25 / btts: (p − o)² binário
 *   - scoreline / corners / cards / sot: NaN (não aplicável)
 */
export function brier(
  market: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  probs: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outcome: any,
): number {
  switch (market) {
    case "1x2": {
      const pr = probs as Probs1x2;
      const result = (outcome as Outcome1x2).result;
      const oH = result === "home" ? 1 : 0;
      const oD = result === "draw" ? 1 : 0;
      const oA = result === "away" ? 1 : 0;
      return (pr.home - oH) ** 2 + (pr.draw - oD) ** 2 + (pr.away - oA) ** 2;
    }

    case "over25": {
      const pr = probs as ProbsOver;
      const obs = (outcome as OutcomeOver).over ? 1 : 0;
      return (pr.over - obs) ** 2;
    }

    case "btts": {
      const pr = probs as ProbsBtts;
      const obs = (outcome as OutcomeBtts).btts ? 1 : 0;
      return (pr.sim - obs) ** 2;
    }

    // Contagem e scoreline: Brier não é interpretável nessa dimensão
    case "scoreline":
    case "corners":
    case "cards":
    case "sot":
      return NaN;

    default:
      return NaN;
  }
}

// ── rps1x2Score ────────────────────────────────────────────────────────────────

/**
 * Ranked Probability Score para o mercado 1x2 (3 categorias ordinais:
 * home / draw / away).
 *
 * RPS = 0.5 × [(pH − oH)² + (pH + pD − oH − oD)²]
 *
 * Fórmula alinhada com rps1x2 em scoreline-accuracy.ts (re-exporta a lógica
 * sob o nome canônico da arena).
 */
export function rps1x2Score(probs: Probs1x2, outcome: Outcome1x2): number {
  const { home: pH, draw: pD } = probs;
  const oH = outcome.result === "home" ? 1 : 0;
  const oD = outcome.result === "draw" ? 1 : 0;
  const c1 = pH - oH;
  const c2 = pH + pD - (oH + oD);
  return 0.5 * (c1 * c1 + c2 * c2);
}
