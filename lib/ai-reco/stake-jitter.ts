/**
 * applyStakeJitter — aplica variação aleatória ±10% na stake sugerida.
 *
 * Motivação (Sharp persona, Wave B fix #3):
 *   Stakes redondas (R$ 50,00) marcam a conta como bot nos sistemas de
 *   detecção das casas. Humanizar: R$ 47,30 ou R$ 51,80 em vez de R$ 50,00.
 *
 * Algoritmo:
 *   - Jitter uniforme em [-0.1, +0.1] × stake.
 *   - Com `seed` (inteiro ≥ 0): determinístico via LCG simples.
 *   - Sem `seed` (undefined): Math.random() — non-determinístico.
 *   - Resultado arredondado a 2 casas decimais.
 *
 * O jitter NÃO é aplicado no servidor (sem acesso a Math.random
 * no SSR); é chamado no client (AposteiModal) após o Pilot abrir o modal.
 * O valor pre-jitter deve ser salvo em telemetria pelo caller pra análise.
 *
 * Sem I/O, puro, sem side-effects além do Math.random (quando sem seed).
 */

const JITTER_RANGE = 0.1; // ±10%

/**
 * Gerador LCG (Linear Congruential Generator) simples para seed determinístico.
 * Parâmetros de Numerical Recipes (m=2^32, a=1664525, c=1013904223).
 * Retorna float em [0, 1).
 */
function seededRandom(seed: number): number {
  // Um passo de LCG produz distribuição razoável para jitter visual
  // (não criptográfico, apenas anti-fingerprint)
  const s = Math.abs(Math.trunc(seed));
  const next = (1664525 * s + 1013904223) & 0xffffffff;
  // normalizar para [0, 1)
  return (next >>> 0) / 0x100000000;
}

/**
 * Aplica jitter ±10% na `stake`.
 *
 * @param stake — stake original em BRL (> 0).
 * @param seed  — semente inteira para resultado determinístico. undefined = aleatório.
 * @returns stake com jitter, arredondada a 2 casas decimais.
 */
export function applyStakeJitter(stake: number, seed?: number): number {
  const rand = seed !== undefined ? seededRandom(seed) : Math.random();
  // rand ∈ [0, 1) → mapear para [-JITTER_RANGE, +JITTER_RANGE]
  const factor = 1 + (rand * 2 - 1) * JITTER_RANGE;
  const jittered = stake * factor;
  return Math.round(jittered * 100) / 100;
}
