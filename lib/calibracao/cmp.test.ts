import { describe, it, expect } from "vitest";
import { cmpPmf, cmpProb, cmpLogLoss, cmpVariance } from "./cmp";

// Poisson pmf de referência (log-space) pra ancorar ν=1.
function poissonPmf(mu: number, k: number): number {
  let logp = -mu;
  for (let i = 1; i <= k; i++) logp += Math.log(mu) - Math.log(i);
  return Math.exp(logp);
}

describe("cmp", () => {
  it("ν=1 reduz a Poisson (âncora de correção)", () => {
    const mu = 4.3;
    const pmf = cmpPmf(mu, 1);
    for (let k = 0; k <= 12; k++) {
      expect(pmf[k]).toBeCloseTo(poissonPmf(mu, k), 6);
    }
  });

  it("pmf soma ~1 (normalização)", () => {
    for (const [mu, nu] of [[4.3, 1.3], [9.5, 1.2], [2.0, 1.5], [7.0, 0.8]]) {
      const sum = cmpPmf(mu, nu).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it("a média da distribuição bate o μ alvo (parametrização por média)", () => {
    for (const [mu, nu] of [[4.3, 1.3], [9.5, 1.2], [3.0, 1.45]]) {
      const pmf = cmpPmf(mu, nu);
      let mean = 0;
      for (let k = 0; k < pmf.length; k++) mean += k * pmf[k];
      expect(mean).toBeCloseTo(mu, 2);
    }
  });

  it("ν>1 → UNDER-dispersão (variância < média) — o caso dos cartões", () => {
    const mu = 4.3;
    expect(cmpVariance(mu, 1)).toBeCloseTo(mu, 1); // Poisson: var = mean
    expect(cmpVariance(mu, 1.3)).toBeLessThan(mu); // underdisperso
    expect(cmpVariance(mu, 1.5)).toBeLessThan(cmpVariance(mu, 1.3));
  });

  it("ν<1 → OVER-dispersão (variância > média)", () => {
    const mu = 4.3;
    expect(cmpVariance(mu, 0.7)).toBeGreaterThan(mu);
  });

  it("cmpProb floora e rejeita k inválido", () => {
    expect(cmpProb(4.3, 1.3, -1)).toBe(1e-12);
    expect(cmpProb(4.3, 1.3, 999)).toBe(1e-12);
    expect(cmpProb(4.3, 1.3, 4)).toBeGreaterThan(0.01);
  });

  it("cmpLogLoss: menor quando o actual está perto do μ", () => {
    const perto = cmpLogLoss(4.3, 1.3, 4);
    const longe = cmpLogLoss(4.3, 1.3, 12);
    expect(perto).toBeLessThan(longe);
    expect(perto).toBeGreaterThan(0);
  });
});
