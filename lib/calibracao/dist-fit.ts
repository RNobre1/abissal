/**
 * Distribution-level calibration ("calibrar a distribuição, não a linha").
 *
 * PROBLEMA (B31): calibrar cada linha de aposta (corners 1.5…15.5) por isotônica
 * exige pares (prob-prevista, resultado) DAQUELA linha — e os actuals de
 * corners/cards/sot só cobrem ~13-53% dos jogos. Fatiar esse pouco por dezenas
 * de linhas ⇒ n≪30 por linha ⇒ overfit ([[walk-forward-bomb]]).
 *
 * SOLUÇÃO (Opção A do docs/tasks/calibracao-distribuicao/00-plan.md): calibrar
 * UMA vez o que o simulador erra — a MÉDIA do total por métrica — contra os
 * actuals. Um único fator `k = média(actual) / média(previsto)` corrige a média
 * do Poisson, e TODA linha herda a correção (sample-efficient: usa todos os
 * jogos resolvidos do metric, não fatiado).
 *
 * Aplicação: `mean_calibrado = mean_previsto × k`, depois Poisson(mean_calibrado).
 * Substitui a isotônica por-linha nos secundários (corners/cards/sot). 1x2/over25/
 * btts seguem na isotônica (eventos binários, bem amostrados — PAV é a ferramenta
 * certa lá).
 *
 * Sem I/O, sem DB — funções puras, testáveis.
 */

import { poissonProbOver } from "@/lib/ai-reco/dist-helpers";

export interface DistKFit {
  /** Fator de escala da média: mean_calibrado = mean_previsto × k. */
  k: number;
  /** Nº de pares válidos usados no fit. */
  n: number;
  /** Média do total previsto (Poisson mean = home p50 + away p50). */
  meanPred: number;
  /** Média do total real observado. */
  meanActual: number;
}

/**
 * Ajusta o fator de distribuição `k` sobre pares (total_previsto, total_real).
 *
 * `k = Σ actual / Σ pred` (razão das médias — o estimador de momento mais
 * robusto a small-sample; um único parâmetro, sem fatiar por linha).
 *
 * PREVISÃO ZERO NÃO É PREVISÃO — é ausência de previsão, e fica de fora do fit.
 * Times sem jogos na temporada nova vêm do choistats com `avgs` inteiro zerado
 * (`num_matches: 0` ⇒ 100% deles com `cornersFor: 0`), e a sim propagava isso
 * como projeção 0. Em julho/2026 isso chegou a 38% dos jogos com a virada da
 * temporada europeia, e o fit — que contava esses pares — fez o k perseguir o
 * lixo: 1.05 em junho → 1.5672 em 26/07, inflando em ~57% justamente os jogos
 * que TINHAM dados bons.
 *
 * O `actual` zero continua valendo: 0 a 0 é resultado legítimo.
 *
 * Ver docs/pesquisas/auditoria-shape-produtor-consumidor.md.
 *
 * @param pairs  pares [predTotal, actualTotal] dos jogos resolvidos.
 * @param minN   mínimo de pares válidos (default 30, gate B24). Abaixo disso → null.
 * @returns DistKFit ou null (poucos dados / média prevista não-positiva).
 */
export function fitDistK(pairs: Array<[number, number]>, minN = 30): DistKFit | null {
  let sumPred = 0;
  let sumActual = 0;
  let n = 0;
  for (const [pred, actual] of pairs) {
    if (!Number.isFinite(pred) || !Number.isFinite(actual)) continue;
    if (pred <= 0) continue;
    sumPred += pred;
    sumActual += actual;
    n += 1;
  }
  if (n < minN || sumPred <= 0) return null;
  return {
    k: sumActual / sumPred,
    n,
    meanPred: sumPred / n,
    meanActual: sumActual / n,
  };
}

/**
 * Brier score de P(total > line) sob Poisson(meanTransform(predMean)) contra o
 * resultado real, agregado sobre `rows`. Usado pra AVALIAR a calibração (gate
 * B24 — comparar transform identidade vs k vs isotônica em held-out).
 *
 * @param rows           pares [predMean, actualTotal].
 * @param line           linha (ex.: 9.5).
 * @param meanTransform  transformação aplicada à média antes do Poisson
 *                       (identidade `(m)=>m` = raw; `(m)=>m*k` = calibrado).
 * @returns Brier médio (0 = perfeito); 0 se `rows` vazio.
 */
export function brierForLine(
  rows: Array<[number, number]>,
  line: number,
  meanTransform: (mean: number) => number,
): number {
  if (rows.length === 0) return 0;
  let sse = 0;
  let n = 0;
  for (const [predMean, actualTotal] of rows) {
    if (!Number.isFinite(predMean) || !Number.isFinite(actualTotal)) continue;
    const p = poissonProbOver(meanTransform(predMean), line);
    const obs = actualTotal > line ? 1 : 0;
    sse += (p - obs) ** 2;
    n += 1;
  }
  return n === 0 ? 0 : sse / n;
}

/**
 * Split determinístico train/test por ÍNDICE (sem shuffle) — preserva a ordem
 * cronológica do caller pra avaliação honesta out-of-sample ([[walk-forward-bomb]]).
 * As últimas `testFrac` linhas (as mais recentes, se ordenado por data) viram teste.
 *
 * @param rows      coleção já ordenada (cronologicamente) pelo caller.
 * @param testFrac  fração reservada pro teste (0..1).
 */
export function splitTrainTest<T>(
  rows: T[],
  testFrac: number,
): { train: T[]; test: T[] } {
  const frac = Math.max(0, Math.min(1, testFrac));
  const cut = Math.floor(rows.length * (1 - frac));
  return { train: rows.slice(0, cut), test: rows.slice(cut) };
}
