/**
 * wilson-ic.ts — Intervalos de confiança 95% para proporções (Wilson score)
 * e Brier score (bootstrap paramétrico).
 *
 * Usado em /calibracao para mostrar incerteza real em TODA métrica.
 * Convergência de 8 personas no brainstorm: sem IC visível, "Brier 0.22" com
 * n=12 vira anchor de decisão falso (BE + DA + SystemsThinker + ML).
 */

/**
 * Wilson score interval (95% padrão) para proporção binomial.
 *
 * Refs: Wilson 1927; Newcombe 1998.
 *
 * @param successes número de sucessos (inteiro ou aproximação)
 * @param n total de observações
 * @param z quantil z (1.96 para 95%, 1.645 para 90%)
 * @returns { lo, hi, center } todos em proporção [0, 1]
 */
export function wilsonInterval(
  successes: number,
  n: number,
  z = 1.96,
): { lo: number; hi: number; center: number } {
  if (n === 0) return { lo: 0, hi: 1, center: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin =
    (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    lo: Math.max(0, center - margin),
    hi: Math.min(1, center + margin),
    center,
  };
}

/**
 * Bootstrap paramétrico para intervalo de confiança do Brier score.
 *
 * Reamostras com reposição `reps` vezes e calcula percentis alpha/2 e
 * 1-alpha/2. Mais correto que Wilson (que assume binomial) pois o Brier é
 * contínuo em [0, 1].
 *
 * @param samples array de Brier scores individuais (um por observação)
 * @param reps número de replicações (default 1000)
 * @param alpha nível (0.05 → IC 95%)
 * @returns { lo, hi, mean } em [0, 1]
 */
export function brierBootstrapCI(
  samples: number[],
  reps = 1000,
  alpha = 0.05,
): { lo: number; hi: number; mean: number } {
  if (samples.length === 0) return { lo: 0, hi: 0, mean: 0 };
  const n = samples.length;
  const mean = samples.reduce((a, b) => a + b, 0) / n;

  if (n === 1) return { lo: mean, hi: mean, mean };

  // Reamostras bootstrap
  const bootMeans: number[] = [];
  for (let r = 0; r < reps; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += samples[Math.floor(Math.random() * n)]!;
    }
    bootMeans.push(sum / n);
  }
  bootMeans.sort((a, b) => a - b);

  const loIdx = Math.floor((alpha / 2) * reps);
  const hiIdx = Math.min(Math.ceil((1 - alpha / 2) * reps), reps - 1);

  return {
    lo: Math.max(0, bootMeans[loIdx] ?? 0),
    hi: Math.min(1, bootMeans[hiIdx] ?? 1),
    mean,
  };
}

/**
 * Formata IC para display: "[lo%, hi%]" com precisão variável.
 */
export function fmtIC(lo: number, hi: number, digits = 0): string {
  const fmt = (v: number) => `${(v * 100).toFixed(digits)}%`;
  return `[${fmt(lo)}, ${fmt(hi)}]`;
}

/**
 * Sample-size guard: determina o nível de "confiança na cor" do card.
 *
 * - n < 30 → "pequena" (cor neutra, badge ⚠)
 * - n 30-99 → "media" (cor ativa, discretamente)
 * - n ≥ 100 → "grande" (cor plena)
 */
export type SampleSizeLevel = "pequena" | "media" | "grande";

export function sampleSizeLevel(n: number): SampleSizeLevel {
  if (n < 30) return "pequena";
  if (n < 100) return "media";
  return "grande";
}
