/**
 * Gate out-of-sample compartilhado por `fit-isotonic.ts` e `fit-dist.ts`: uma
 * curva só entra em produção se BATER o raw em dado que ela não viu.
 *
 * A amostra `pares` PRECISA vir ordenada do mais ANTIGO para o mais RECENTE —
 * o treino é `pares.slice(0, cut)` e o teste é o restante. Ordem invertida
 * treina no futuro e testa no passado, que é o oposto de held-out temporal
 * (bug medido em 07/08: veredito divergia em 7 de 21 combinações versão ×
 * métrica). Como a ordem vem da query, este módulo não pode inferi-la —
 * `assertCronologico` existe para que uma ordem errada FALHE ALTO em vez de
 * produzir um veredito plausível.
 */
import { fitIsotonic } from "./isotonic";

/** Cortes do held-out. Cinco porque um só invertia o veredito (medido 29/07). */
export const GATE_CUTS: readonly number[] = [0.5, 0.6, 0.7, 0.8, 0.85];

const MIN_TEST = 50;

export interface GateResult {
  keep: boolean;
  raw: number;
  curved: number;
  nTest: number;
  votosKeep: number;
  votosTotal: number;
}

/**
 * Verifica que `linhas` está em ordem cronológica ASCENDENTE por `timestamp`
 * (mais antigo primeiro). Empates são tolerados; timestamps ausentes (null/
 * undefined) são ignorados — não contam a favor nem contra a ordem.
 *
 * Lança se encontrar uma linha mais antiga depois de uma mais recente. Isso
 * pega em runtime a classe de bug que motivou este módulo: uma query com
 * `order(..., { ascending: false })` esquecida vira "held-out" que treina no
 * futuro.
 */
export function assertCronologico<T>(
  linhas: readonly T[],
  timestamp: (linha: T) => string | null | undefined,
): void {
  let anterior: string | null = null;
  for (const linha of linhas) {
    const t = timestamp(linha);
    if (t == null) continue;
    if (anterior !== null && t < anterior) {
      throw new Error(
        `assertCronologico: amostra fora de ordem cronológica (esperado ascendente, mais antigo primeiro) — "${t}" veio depois de "${anterior}". A query provavelmente está ordenando DESC.`,
      );
    }
    anterior = t;
  }
}

interface SingleCutResult {
  keep: boolean;
  raw: number;
  curved: number;
  nTest: number;
}

function singleCutGate(
  pares: ReadonlyArray<[number, number]>,
  frac: number,
): SingleCutResult | null {
  const cut = Math.floor(pares.length * frac);
  const train = pares.slice(0, cut);
  const test = pares.slice(cut);
  if (test.length < MIN_TEST || train.length < MIN_TEST) return null;

  const curve = fitIsotonic(train as Array<[number, number]>);
  const clamp = (p: number) => Math.min(Math.max(p, 0.01), 0.99);
  const ll = (get: (p: number) => number) =>
    -test.reduce((acc, [p, o]) => {
      const q = clamp(get(p));
      return acc + (o * Math.log(q) + (1 - o) * Math.log(1 - q));
    }, 0) / test.length;

  const lookup = (p: number): number => {
    if (p <= curve[0][0]) return curve[0][1];
    if (p >= curve[curve.length - 1][0]) return curve[curve.length - 1][1];
    let lo = 0;
    let hi = curve.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (curve[mid][0] <= p) lo = mid;
      else hi = mid - 1;
    }
    return curve[lo][1];
  };

  const raw = ll((p) => p);
  const curved = ll(lookup);
  return { keep: curved < raw, raw, curved, nTest: test.length };
}

/**
 * Decide por MAIORIA sobre `GATE_CUTS`: a curva só é mantida se bater o raw
 * (menor log-loss) na maioria dos cortes testados.
 *
 * `pares` deve estar em ordem cronológica ascendente — valide com
 * `assertCronologico` antes de chamar esta função.
 */
export function heldOutGate(pares: ReadonlyArray<[number, number]>): GateResult {
  const votos = GATE_CUTS.map((frac) => singleCutGate(pares, frac)).filter(
    (v): v is SingleCutResult => v !== null,
  );

  const votosKeep = votos.filter((v) => v.keep).length;
  const votosTotal = GATE_CUTS.length;

  if (votos.length === 0) {
    // Sem amostra pra dividir: conservador — sem evidência, não calibra.
    return { keep: false, raw: NaN, curved: NaN, nTest: 0, votosKeep, votosTotal };
  }

  return {
    keep: votosKeep > votosTotal / 2,
    raw: votos.reduce((a, v) => a + v.raw, 0) / votos.length,
    curved: votos.reduce((a, v) => a + v.curved, 0) / votos.length,
    nTest: Math.round(votos.reduce((a, v) => a + v.nTest, 0) / votos.length),
    votosKeep,
    votosTotal,
  };
}
