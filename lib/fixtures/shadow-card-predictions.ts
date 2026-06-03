/**
 * Predições SHADOW de cartões por modelo, pro toggle experimental no detalhe do
 * jogo (ADR-011). Dado a média de cartões da sim (home p50 + away p50) e os
 * params ativos da arena (ν do CMP challenger, r do NB champion), deriva
 * P(over) por linha pra cada modelo — pra o Pilot VER, lado a lado, o que cada
 * modelo da arena preveria pra ESTE jogo.
 *
 * NÃO são as probs calibradas de aposta (essas têm isotônica/k) — é a
 * representação INTERNA da arena (comparação de modelos). Puro, sem I/O.
 */

import { cmpPmf } from "@/lib/calibracao/cmp";
import { nbProb } from "@/lib/calibracao/negbin";

export interface ShadowCardParams {
  /** ν do CMP challenger (over-disp <1 / under-disp >1). */
  nu: number;
  /** r (size) do NB champion. */
  r: number;
}

export interface CardsShadowRow {
  line: number;
  /** P(total cartões > line) sob cada distribuição (mesma média). */
  poissonOver: number;
  nbOver: number;
  cmpOver: number;
}

const LINES = [3.5, 4.5, 5.5];

/** P(X > line) a partir de um array pmf (k = índice). */
function overFromPmf(pmf: number[], line: number): number {
  const f = Math.floor(line);
  let s = 0;
  for (let k = f + 1; k < pmf.length; k++) s += pmf[k];
  return Math.max(0, Math.min(1, s));
}

/**
 * Linhas de comparação shadow de cartões (3.5/4.5/5.5): P(over) sob Poisson
 * (champion ingênuo), NB (champion de produção) e CMP (challenger) — todos com
 * a MESMA média, isolando o efeito da FORMA da distribuição.
 */
export function cardsShadowRows(
  mean: number | null | undefined,
  params: ShadowCardParams | null | undefined,
): CardsShadowRow[] {
  if (typeof mean !== "number" || !Number.isFinite(mean) || mean <= 0 || !params) return [];

  const poissonPmf = cmpPmf(mean, 1); // ν=1 → Poisson
  const cmpArr = cmpPmf(mean, params.nu);

  const nbOver = (line: number): number => {
    const f = Math.floor(line);
    let cdf = 0;
    for (let k = 0; k <= f; k++) cdf += nbProb(mean, params.r, k);
    return Math.max(0, Math.min(1, 1 - cdf));
  };

  return LINES.map((line) => ({
    line,
    poissonOver: overFromPmf(poissonPmf, line),
    nbOver: nbOver(line),
    cmpOver: overFromPmf(cmpArr, line),
  }));
}
