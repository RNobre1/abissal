/**
 * wilson-ic.ts unit tests (TDD)
 *
 * Casos canônicos:
 *   n=12 p=0.5 → IC [0.25, 0.75] (spec do brainstorm)
 *   n=100 p=0.5 → IC estreito ~[0.40, 0.60]
 *   n=0 → [0, 1] (degenerate)
 *   successes=n → hi≈1
 *   successes=0 → lo≈0
 */

import { describe, it, expect } from "vitest";
import { wilsonInterval, brierBootstrapCI } from "@/lib/calibracao/wilson-ic";

describe("wilsonInterval", () => {
  it("n=0 devolve degenerate [0, 1]", () => {
    const r = wilsonInterval(0, 0);
    expect(r.lo).toBe(0);
    expect(r.hi).toBe(1);
    expect(r.center).toBe(0);
  });

  it("n=12 p=0.5 → IC contém [0.25, 0.75] (spec brainstorm)", () => {
    const r = wilsonInterval(6, 12);
    expect(r.lo).toBeLessThanOrEqual(0.26);
    expect(r.hi).toBeGreaterThanOrEqual(0.74);
    // centro ≈ 0.5
    expect(r.center).toBeCloseTo(0.5, 1);
  });

  it("n=100 p=0.5 → IC mais estreito que n=12 p=0.5", () => {
    const r12 = wilsonInterval(6, 12);
    const r100 = wilsonInterval(50, 100);
    // IC de n=100 deve ser significativamente mais estreito que n=12
    expect(r100.hi - r100.lo).toBeLessThan(r12.hi - r12.lo);
    // e deve ser menor que 0.25 (razoável para n=100)
    expect(r100.hi - r100.lo).toBeLessThan(0.25);
  });

  it("successes=n → hi próximo de 1", () => {
    const r = wilsonInterval(20, 20);
    expect(r.hi).toBeCloseTo(1, 1);
  });

  it("successes=0 → lo próximo de 0", () => {
    const r = wilsonInterval(0, 20);
    expect(r.lo).toBeCloseTo(0, 1);
  });

  it("lo e hi ficam no intervalo [0, 1]", () => {
    for (const [k, n] of [[0, 1], [1, 1], [3, 10], [99, 100]]) {
      const r = wilsonInterval(k, n);
      expect(r.lo).toBeGreaterThanOrEqual(0);
      expect(r.hi).toBeLessThanOrEqual(1);
    }
  });

  it("z customizado (z=1.645 → IC mais estreito)", () => {
    const r95 = wilsonInterval(50, 100, 1.96);
    const r90 = wilsonInterval(50, 100, 1.645);
    expect(r90.hi - r90.lo).toBeLessThan(r95.hi - r95.lo);
  });
});

describe("brierBootstrapCI", () => {
  it("array vazio → lo=0, hi=0, mean=0", () => {
    const r = brierBootstrapCI([]);
    expect(r.lo).toBe(0);
    expect(r.hi).toBe(0);
    expect(r.mean).toBe(0);
  });

  it("array uniforme [0.25] x 100 → IC estreito em torno de 0.25", () => {
    const samples = Array(100).fill(0.25) as number[];
    const r = brierBootstrapCI(samples, 500);
    expect(r.mean).toBeCloseTo(0.25, 2);
    // IC quase zero width quando valores idênticos
    expect(r.hi - r.lo).toBeLessThan(0.05);
  });

  it("lo ≤ mean ≤ hi sempre", () => {
    const samples = [0.1, 0.2, 0.15, 0.3, 0.25, 0.18, 0.22];
    const r = brierBootstrapCI(samples, 200);
    expect(r.lo).toBeLessThanOrEqual(r.mean + 1e-9);
    expect(r.mean).toBeLessThanOrEqual(r.hi + 1e-9);
  });
});
