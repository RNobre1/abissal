import { describe, it, expect } from "vitest";
import { pairedBootstrap, deflatePValue, modelVerdict } from "./model-comparison";

describe("pairedBootstrap", () => {
  it("vazio → neutro", () => {
    const r = pairedBootstrap([]);
    expect(r.n).toBe(0);
    expect(r.pChallengerBetter).toBe(1);
  });

  it("challenger consistentemente melhor → meanDelta>0, CI>0, p baixo", () => {
    // delta = champion − challenger; todos positivos (challenger sempre melhor)
    const deltas = Array.from({ length: 100 }, () => 0.05);
    const r = pairedBootstrap(deltas, { seed: 1 });
    expect(r.meanDelta).toBeCloseTo(0.05, 6);
    expect(r.ciLo).toBeGreaterThan(0);
    expect(r.pChallengerBetter).toBeLessThan(0.05);
  });

  it("sem diferença real (deltas ~0 simétricos) → p alto, CI cruza 0", () => {
    const deltas: number[] = [];
    for (let i = 0; i < 100; i++) deltas.push(i % 2 === 0 ? 0.02 : -0.02);
    const r = pairedBootstrap(deltas, { seed: 7 });
    expect(Math.abs(r.meanDelta)).toBeLessThan(0.005);
    expect(r.ciLo).toBeLessThan(0);
    expect(r.ciHi).toBeGreaterThan(0);
    expect(r.pChallengerBetter).toBeGreaterThan(0.05);
  });

  it("é determinístico com a mesma seed", () => {
    const d = Array.from({ length: 50 }, (_, i) => Math.sin(i) * 0.03);
    const a = pairedBootstrap(d, { seed: 42 });
    const b = pairedBootstrap(d, { seed: 42 });
    expect(a.pChallengerBetter).toBe(b.pChallengerBetter);
    expect(a.ciLo).toBe(b.ciLo);
  });

  it("ignora deltas não-finitos", () => {
    const r = pairedBootstrap([0.05, NaN, 0.05, Infinity], { seed: 1 });
    expect(r.n).toBe(2);
  });
});

describe("deflatePValue", () => {
  it("k=1 → inalterado", () => {
    expect(deflatePValue(0.04, 1)).toBeCloseTo(0.04, 6);
  });
  it("k>1 → infla o p (mais difícil ganhar)", () => {
    expect(deflatePValue(0.04, 5)).toBeGreaterThan(0.04);
    // Šidák: 1-(1-0.04)^5 ≈ 0.1846
    expect(deflatePValue(0.04, 5)).toBeCloseTo(1 - Math.pow(0.96, 5), 6);
  });
  it("clampa em [0,1]", () => {
    expect(deflatePValue(2, 3)).toBeLessThanOrEqual(1);
    expect(deflatePValue(-1, 3)).toBeGreaterThanOrEqual(0);
  });
});

describe("modelVerdict", () => {
  it("challenger_better quando delta>0 e p deflacionado < alpha", () => {
    const boot = { n: 100, meanDelta: 0.05, ciLo: 0.03, ciHi: 0.07, pChallengerBetter: 0.001 };
    const { verdict } = modelVerdict(boot, 1);
    expect(verdict).toBe("challenger_better");
  });

  it("deflação pelo nº de challengers pode virar challenger_better → inconclusive", () => {
    // p=0.02 sozinho passa; com 5 challengers (Šidák ~0.096) não passa.
    const boot = { n: 100, meanDelta: 0.03, ciLo: 0.005, ciHi: 0.06, pChallengerBetter: 0.02 };
    expect(modelVerdict(boot, 1).verdict).toBe("challenger_better");
    expect(modelVerdict(boot, 5).verdict).toBe("inconclusive");
  });

  it("champion_better quando delta<0 e CI95 todo abaixo de 0", () => {
    const boot = { n: 100, meanDelta: -0.05, ciLo: -0.08, ciHi: -0.02, pChallengerBetter: 0.99 };
    expect(modelVerdict(boot, 1).verdict).toBe("champion_better");
  });

  it("n<30 → sempre inconclusive (small-sample)", () => {
    const boot = { n: 20, meanDelta: 0.1, ciLo: 0.05, ciHi: 0.15, pChallengerBetter: 0.0001 };
    expect(modelVerdict(boot, 1).verdict).toBe("inconclusive");
  });
});
