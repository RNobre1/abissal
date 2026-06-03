/**
 * Conway-Maxwell-Poisson (CMP) — distribuição de contagem que cobre
 * over-, equi- E UNDER-dispersão (Poisson só faz equi; Negative Binomial só
 * over). A pesquisa L3 (ADR-011/B34) achou que **cartões são SUB-dispersos**
 * (ν 1.11–1.46) → o NB/Poisson do champion erra a FORMA. CMP é o challenger.
 *
 * Parametrização por MÉDIA: dado μ (média desejada) e ν (dispersão; ν=1 →
 * Poisson, ν>1 → underdisperso, ν<1 → overdisperso), achamos a taxa λ tal que
 * a média da distribuição = μ (busca binária — a média cresce monotônica em λ).
 *
 * Puro, sem I/O. Truncado em kmax (cartões/escanteios/sot ≤ ~40).
 */

const DEFAULT_KMAX = 40;

/** ln(k!) acumulado pra k = 0..kmax. */
function lnFactorials(kmax: number): number[] {
  const a = new Array<number>(kmax + 1);
  a[0] = 0;
  for (let k = 1; k <= kmax; k++) a[k] = a[k - 1] + Math.log(k);
  return a;
}

/** pmf + média de uma CMP(λ, ν) truncada, em log-space (estável). */
function cmpStats(lambda: number, nu: number, lnf: number[], kmax: number): { pmf: number[]; mean: number } {
  const lnl = Math.log(Math.max(lambda, 1e-300));
  const logw = new Array<number>(kmax + 1);
  let maxLog = -Infinity;
  for (let k = 0; k <= kmax; k++) {
    const lw = k * lnl - nu * lnf[k];
    logw[k] = lw;
    if (lw > maxLog) maxLog = lw;
  }
  let z = 0;
  const w = new Array<number>(kmax + 1);
  for (let k = 0; k <= kmax; k++) {
    w[k] = Math.exp(logw[k] - maxLog);
    z += w[k];
  }
  const pmf = new Array<number>(kmax + 1);
  let mean = 0;
  for (let k = 0; k <= kmax; k++) {
    pmf[k] = w[k] / z;
    mean += k * pmf[k];
  }
  return { pmf, mean };
}

/** Acha λ tal que E[CMP(λ,ν)] ≈ μ (bisseção; média monotônica crescente em λ). */
function findLambda(mu: number, nu: number, lnf: number[], kmax: number): number {
  if (mu <= 0) return 1e-12;
  let hi = Math.max(mu + 5, 2 * mu);
  // garante que hi cobre a média alvo
  let guard = 0;
  while (cmpStats(hi, nu, lnf, kmax).mean < mu && guard < 60) {
    hi *= 2;
    guard++;
  }
  let lo = 0;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const m = cmpStats(mid, nu, lnf, kmax).mean;
    if (m < mu) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * pmf da CMP parametrizada pela média. ν=1 → Poisson exata (λ=μ).
 * @returns array pmf[0..kmax].
 */
export function cmpPmf(mu: number, nu: number, kmax: number = DEFAULT_KMAX): number[] {
  const lnf = lnFactorials(kmax);
  const m = Math.max(mu, 1e-9);
  const lambda = nu === 1 ? m : findLambda(m, nu, lnf, kmax);
  return cmpStats(lambda, nu, lnf, kmax).pmf;
}

/** P(X = k | μ, ν). Floor em 1e-12 (evita −ln(0)). */
export function cmpProb(mu: number, nu: number, k: number, kmax: number = DEFAULT_KMAX): number {
  if (!Number.isInteger(k) || k < 0 || k > kmax) return 1e-12;
  return Math.max(cmpPmf(mu, nu, kmax)[k], 1e-12);
}

/** Log-loss de um resultado de contagem sob CMP(μ, ν): −ln P(X = actual). */
export function cmpLogLoss(mu: number, nu: number, actual: number, kmax: number = DEFAULT_KMAX): number {
  return -Math.log(cmpProb(mu, nu, actual, kmax));
}

/** Variância de CMP(μ, ν) — útil pra checar dispersão (var<μ ⇔ ν>1). */
export function cmpVariance(mu: number, nu: number, kmax: number = DEFAULT_KMAX): number {
  const pmf = cmpPmf(mu, nu, kmax);
  let m = 0;
  for (let k = 0; k <= kmax; k++) m += k * pmf[k];
  let v = 0;
  for (let k = 0; k <= kmax; k++) v += (k - m) * (k - m) * pmf[k];
  return v;
}
