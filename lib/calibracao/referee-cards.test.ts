import { describe, it, expect } from "vitest";
import { blendCardMean, nuForDispersion, REFEREE_WEIGHT } from "./referee-cards";
import { cmpVariance } from "./cmp";

describe("blendCardMean", () => {
  it("sem dado de árbitro devolve a média da sim intacta", () => {
    expect(blendCardMean(4.5, null)).toBeCloseTo(4.5, 9);
    expect(blendCardMean(4.5, undefined)).toBeCloseTo(4.5, 9);
    expect(blendCardMean(4.5, Number.NaN)).toBeCloseTo(4.5, 9);
  });

  it("mistura sim e árbitro no peso do F6 (40% árbitro)", () => {
    // 0.6 * 4.0 + 0.4 * 6.0 = 2.4 + 2.4 = 4.8
    expect(blendCardMean(4.0, 6.0)).toBeCloseTo(4.8, 6);
    expect(REFEREE_WEIGHT).toBeCloseTo(0.4, 9);
  });

  it("árbitro igual à sim não muda nada", () => {
    expect(blendCardMean(5.0, 5.0)).toBeCloseTo(5.0, 6);
  });

  it("nunca devolve média não-positiva", () => {
    expect(blendCardMean(0, 0)).toBeGreaterThan(0);
    expect(blendCardMean(-1, -1)).toBeGreaterThan(0);
  });
});

describe("nuForDispersion", () => {
  // O achado que motiva o challenger: a dispersão dos cartões NÃO é global —
  // varia por árbitro (medido em 118 fixtures: 45 over-dispersos, 42
  // sub-dispersos, 31 ~Poisson, mediana 1.02). Fitar um ν global é fitar a
  // média de duas populações opostas, que dá ≈ Poisson — exatamente o que
  // deixou o CMP global inconclusivo (B35-B37).
  it("dispersão ≈ 1 devolve ν ≈ 1 (Poisson)", () => {
    expect(nuForDispersion(4.5, 1.0)).toBeCloseTo(1.0, 1);
  });

  it("dispersão > 1 (over-disperso) devolve ν < 1", () => {
    expect(nuForDispersion(4.5, 1.8)).toBeLessThan(1);
  });

  it("dispersão < 1 (sub-disperso) devolve ν > 1", () => {
    expect(nuForDispersion(4.5, 0.5)).toBeGreaterThan(1);
  });

  it("o ν encontrado reproduz a dispersão alvo", () => {
    for (const target of [0.6, 0.8, 1.0, 1.4, 1.9]) {
      const mu = 4.5;
      const nu = nuForDispersion(mu, target);
      const got = cmpVariance(mu, nu) / mu;
      expect(Math.abs(got - target)).toBeLessThan(0.25);
    }
  });

  it("é monotônica: mais dispersão ⇒ menor ν", () => {
    const a = nuForDispersion(4.5, 0.7);
    const b = nuForDispersion(4.5, 1.0);
    const c = nuForDispersion(4.5, 1.6);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it("degrada pra ν=1 sem dispersão utilizável", () => {
    expect(nuForDispersion(4.5, null)).toBe(1);
    expect(nuForDispersion(4.5, undefined)).toBe(1);
    expect(nuForDispersion(4.5, Number.NaN)).toBe(1);
    expect(nuForDispersion(4.5, 0)).toBe(1);
    expect(nuForDispersion(4.5, -1)).toBe(1);
  });

  it("clampa em faixa segura (não explode com dispersão absurda)", () => {
    const alto = nuForDispersion(4.5, 50);
    const baixo = nuForDispersion(4.5, 0.01);
    expect(alto).toBeGreaterThan(0);
    expect(Number.isFinite(alto)).toBe(true);
    expect(Number.isFinite(baixo)).toBe(true);
    expect(baixo).toBeLessThanOrEqual(4);
  });

  it("média inválida devolve ν=1 em vez de propagar NaN", () => {
    expect(nuForDispersion(0, 1.5)).toBe(1);
    expect(nuForDispersion(Number.NaN, 1.5)).toBe(1);
  });
});
