import { describe, it, expect } from "vitest";
import { lgamma, nbProb, nbLogLoss, nbVariance } from "./negbin";

function poissonProb(mu: number, k: number): number {
  let logp = -mu;
  for (let i = 1; i <= k; i++) logp += Math.log(mu) - Math.log(i);
  return Math.exp(logp);
}

describe("lgamma", () => {
  it("Γ(n) = (n-1)! → lgamma bate ln((n-1)!)", () => {
    expect(lgamma(1)).toBeCloseTo(0, 8); // 0! = 1
    expect(lgamma(5)).toBeCloseTo(Math.log(24), 8); // 4! = 24
    expect(lgamma(6)).toBeCloseTo(Math.log(120), 8); // 5! = 120
  });
});

describe("negbin", () => {
  it("r grande → ≈ Poisson (âncora; over-disp some)", () => {
    const mu = 4.3;
    for (let k = 0; k <= 12; k++) {
      expect(nbProb(mu, 1e7, k)).toBeCloseTo(poissonProb(mu, k), 4);
    }
  });

  it("pmf soma ~1", () => {
    for (const [mu, r] of [[4.3, 8], [9.5, 20], [3.0, 4]]) {
      let s = 0;
      for (let k = 0; k <= 80; k++) s += nbProb(mu, r, k);
      expect(s).toBeCloseTo(1, 4);
    }
  });

  it("var = μ + μ²/r > μ (OVER-dispersão)", () => {
    expect(nbVariance(4.3, 8)).toBeGreaterThan(4.3);
    expect(nbVariance(4.3, 4)).toBeGreaterThan(nbVariance(4.3, 8)); // r menor = mais disperso
  });

  it("logLoss menor perto da média", () => {
    expect(nbLogLoss(4.3, 6, 4)).toBeLessThan(nbLogLoss(4.3, 6, 13));
    expect(nbLogLoss(4.3, 6, 4)).toBeGreaterThan(0);
  });

  it("k inválido → floor", () => {
    expect(nbProb(4.3, 6, -1)).toBe(1e-12);
    expect(nbProb(4.3, 6, 2.5)).toBe(1e-12);
  });
});
