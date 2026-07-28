import { describe, it, expect } from "vitest";
import {
  applyTemperature,
  applyTemperatureVector,
  fitTemperature,
  TEMPERATURE_GRID,
} from "./temperature";

describe("applyTemperature", () => {
  it("T = 1 é identidade (âncora)", () => {
    for (const p of [0.05, 0.3, 0.5, 0.72, 0.95]) {
      expect(applyTemperature(p, 1)).toBeCloseTo(p, 9);
    }
  });

  it("T > 1 ACHATA em direção a 0.5 (corrige superconfiança)", () => {
    expect(applyTemperature(0.9, 2)).toBeLessThan(0.9);
    expect(applyTemperature(0.9, 2)).toBeGreaterThan(0.5);
    expect(applyTemperature(0.1, 2)).toBeGreaterThan(0.1);
    expect(applyTemperature(0.1, 2)).toBeLessThan(0.5);
  });

  it("T < 1 ESTICA para longe de 0.5", () => {
    expect(applyTemperature(0.9, 0.5)).toBeGreaterThan(0.9);
    expect(applyTemperature(0.1, 0.5)).toBeLessThan(0.1);
  });

  it("preserva 0.5 para qualquer T (ponto fixo)", () => {
    for (const T of [0.5, 1, 1.7, 2.5]) {
      expect(applyTemperature(0.5, T)).toBeCloseTo(0.5, 9);
    }
  });

  it("preserva a ordenação (transformação monotônica)", () => {
    const ps = [0.1, 0.25, 0.4, 0.55, 0.8, 0.95];
    const out = ps.map((p) => applyTemperature(p, 2.2));
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).toBeGreaterThan(out[i - 1]);
    }
  });

  it("nunca devolve 0 nem 1, mesmo com entrada degenerada", () => {
    // p=1.0 vinha do Monte Carlo quando nenhuma rodada cruzava a linha (B43).
    for (const T of [0.5, 1, 2.5]) {
      expect(applyTemperature(1, T)).toBeLessThan(1);
      expect(applyTemperature(0, T)).toBeGreaterThan(0);
    }
  });

  it("é robusto a entrada inválida (NaN → 0.5, sem propagar NaN)", () => {
    expect(applyTemperature(Number.NaN, 2)).toBe(0.5);
    expect(applyTemperature(0.7, Number.NaN)).toBeCloseTo(0.7, 9);
    expect(applyTemperature(0.7, 0)).toBeCloseTo(0.7, 9);
  });
});

describe("fitTemperature", () => {
  it("acha T ≈ 1 quando as probabilidades já são calibradas", () => {
    // Amostra sintética bem calibrada: p=0.7 acerta 70% das vezes.
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 100; i++) pts.push([0.7, i < 70 ? 1 : 0]);
    for (let i = 0; i < 100; i++) pts.push([0.3, i < 30 ? 1 : 0]);
    const T = fitTemperature(pts);
    expect(T).toBeGreaterThan(0.85);
    expect(T).toBeLessThan(1.25);
  });

  it("acha T > 1 quando o modelo é SUPERconfiante", () => {
    // Modelo diz 90%, acerta só 60% — precisa achatar.
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 100; i++) pts.push([0.9, i < 60 ? 1 : 0]);
    for (let i = 0; i < 100; i++) pts.push([0.1, i < 40 ? 1 : 0]);
    expect(fitTemperature(pts)).toBeGreaterThan(1.2);
  });

  it("acha T < 1 quando o modelo é SUBconfiante", () => {
    // Modelo diz 60%, acerta 90% — precisa esticar.
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 100; i++) pts.push([0.6, i < 90 ? 1 : 0]);
    for (let i = 0; i < 100; i++) pts.push([0.4, i < 10 ? 1 : 0]);
    expect(fitTemperature(pts)).toBeLessThan(0.9);
  });

  it("o T escolhido minimiza log-loss na própria amostra", () => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 100; i++) pts.push([0.85, i < 65 ? 1 : 0]);
    for (let i = 0; i < 100; i++) pts.push([0.2, i < 25 ? 1 : 0]);
    const T = fitTemperature(pts);

    const ll = (t: number) =>
      -pts.reduce((acc, [p, o]) => {
        const q = applyTemperature(p, t);
        return acc + (o * Math.log(q) + (1 - o) * Math.log(1 - q));
      }, 0) / pts.length;

    for (const other of TEMPERATURE_GRID) {
      expect(ll(T)).toBeLessThanOrEqual(ll(other) + 1e-9);
    }
  });

  it("devolve 1 (identidade) para amostra vazia ou minúscula", () => {
    expect(fitTemperature([])).toBe(1);
    expect(fitTemperature([[0.7, 1]])).toBe(1);
  });

  it("ignora pontos inválidos em vez de propagar NaN", () => {
    const pts: Array<[number, number]> = [
      [Number.NaN, 1],
      [0.9, 0],
      [0.9, 0],
      [0.9, 1],
      [0.1, 0],
      [0.1, 1],
      [0.1, 0],
    ];
    const T = fitTemperature(pts);
    expect(Number.isFinite(T)).toBe(true);
    expect(T).toBeGreaterThan(0);
  });
});

describe("applyTemperatureVector — mercados multi-classe (1x2)", () => {
  it("T = 1 é identidade", () => {
    const p = [0.5, 0.25, 0.25];
    const out = applyTemperatureVector(p, 1);
    out.forEach((v, i) => expect(v).toBeCloseTo(p[i], 9));
  });

  it("sempre soma 1", () => {
    for (const T of [0.5, 1, 1.7, 2.5]) {
      const out = applyTemperatureVector([0.6, 0.25, 0.15], T);
      expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
  });

  it("T > 1 aproxima da uniforme (achata)", () => {
    const out = applyTemperatureVector([0.8, 0.15, 0.05], 3);
    expect(out[0]).toBeLessThan(0.8);
    expect(out[2]).toBeGreaterThan(0.05);
  });

  it("T < 1 concentra na classe dominante", () => {
    const out = applyTemperatureVector([0.6, 0.25, 0.15], 0.5);
    expect(out[0]).toBeGreaterThan(0.6);
  });

  it("preserva a ordenação das classes", () => {
    const out = applyTemperatureVector([0.6, 0.25, 0.15], 2.2);
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[1]).toBeGreaterThan(out[2]);
  });

  it("com 2 classes coincide com a versão binária", () => {
    const T = 1.8;
    const bin = applyTemperature(0.7, T);
    const vec = applyTemperatureVector([0.7, 0.3], T);
    expect(vec[0]).toBeCloseTo(bin, 6);
  });

  it("é robusto a vetor degenerado (uma classe em 1.0)", () => {
    const out = applyTemperatureVector([1, 0, 0], 2);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(out[0]).toBeLessThan(1);
    expect(out[1]).toBeGreaterThan(0);
  });

  it("normaliza vetor que não soma 1 na entrada", () => {
    const out = applyTemperatureVector([0.6, 0.6, 0.6], 1);
    out.forEach((v) => expect(v).toBeCloseTo(1 / 3, 9));
  });
});
