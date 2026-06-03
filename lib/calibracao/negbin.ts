/**
 * Negative Binomial (NB) parametrizada pela MÉDIA — a distribuição de contagem
 * que o motor de produção (sim) usa pros mercados secundários (escanteios/
 * cartões/SOT), porque modela OVER-dispersão (var > média). Serve de baseline
 * JUSTO pra arena: o "champion-cards" via Poisson(mean) era pessimista; o real
 * é NB. Compará-lo com o challenger CMP é apples-to-apples (ADR-011/B35 caveat).
 *
 * Param: média μ, tamanho r (var = μ + μ²/r). r→∞ ⇒ Poisson (equi-dispersão).
 *   P(X=k) = Γ(k+r)/(Γ(r)·k!) · (r/(r+μ))^r · (μ/(r+μ))^k
 *
 * Puro, sem I/O.
 */

/** ln Γ(x) — aproximação de Lanczos (precisão ~1e-10 pra x>0). */
export function lgamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // reflexão
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** log P(X=k | NB(μ, r)). k inteiro ≥0. */
export function nbLogProb(mu: number, r: number, k: number): number {
  const m = Math.max(mu, 1e-9);
  const rr = Math.max(r, 1e-6);
  const lnpFail = Math.log(rr / (rr + m));
  const lnpSucc = Math.log(m / (rr + m));
  return (
    lgamma(k + rr) - lgamma(rr) - lgamma(k + 1) + rr * lnpFail + k * lnpSucc
  );
}

/** P(X=k | NB(μ, r)), floor 1e-12. */
export function nbProb(mu: number, r: number, k: number): number {
  if (!Number.isInteger(k) || k < 0) return 1e-12;
  return Math.max(Math.exp(nbLogProb(mu, r, k)), 1e-12);
}

/** Log-loss de um resultado de contagem sob NB(μ, r): −ln P(X=actual). */
export function nbLogLoss(mu: number, r: number, actual: number): number {
  return -Math.log(nbProb(mu, r, actual));
}

/** Variância de NB(μ, r) = μ + μ²/r. */
export function nbVariance(mu: number, r: number): number {
  return mu + (mu * mu) / Math.max(r, 1e-6);
}
