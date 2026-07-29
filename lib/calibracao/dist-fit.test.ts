import { describe, it, expect } from "vitest";
import { fitDistK, brierForLine, splitTrainTest } from "./dist-fit";

describe("fitDistK", () => {
  it("returns null for empty input", () => {
    expect(fitDistK([], 1)).toBeNull();
  });

  it("returns null when fewer than minN valid pairs", () => {
    expect(fitDistK([[10, 11]], 30)).toBeNull();
  });

  it("returns null when total predicted mean is non-positive", () => {
    expect(
      fitDistK(
        [
          [0, 5],
          [0, 4],
        ],
        1,
      ),
    ).toBeNull();
  });

  it("computes k as ratio of means (sum actual / sum pred)", () => {
    const fit = fitDistK(
      [
        [10, 11],
        [10, 11],
      ],
      2,
    );
    expect(fit).not.toBeNull();
    expect(fit!.k).toBeCloseTo(1.1, 10);
    expect(fit!.meanPred).toBeCloseTo(10, 10);
    expect(fit!.meanActual).toBeCloseTo(11, 10);
    expect(fit!.n).toBe(2);
  });

  it("detects systematic under-prediction (k > 1)", () => {
    // sim predicts ~9.5 corners, reality averages ~10.5 → k ≈ 1.105
    const rows: Array<[number, number]> = Array.from({ length: 100 }, (_, i) => [
      9.5,
      i % 2 === 0 ? 10 : 11,
    ]);
    const fit = fitDistK(rows, 30)!;
    expect(fit.k).toBeGreaterThan(1.0);
    expect(fit.k).toBeCloseTo(10.5 / 9.5, 6);
    expect(fit.n).toBe(100);
  });

  it("ignores non-finite pairs", () => {
    const rows: Array<[number, number]> = [
      [10, 11],
      [NaN, 5],
      [10, Infinity],
      [10, 11],
    ];
    const fit = fitDistK(rows, 2)!;
    expect(fit.n).toBe(2);
    expect(fit.k).toBeCloseTo(1.1, 10);
  });
});

describe("brierForLine", () => {
  // Construct a population where the sim systematically under-predicts the mean:
  // predicted Poisson mean = 9.0, but actual totals cluster around 11.
  const rows: Array<[number, number]> = Array.from({ length: 200 }, (_, i) => [
    9.0,
    9 + (i % 5), // actuals in {9,10,11,12,13}, mean 11
  ]);

  it("scores a perfect-ish forecast lower than a biased one", () => {
    const raw = brierForLine(rows, 9.5, (m) => m); // under-predicts over
    const corrected = brierForLine(rows, 9.5, (m) => m * (11 / 9)); // k-corrected
    expect(corrected).toBeLessThan(raw);
  });

  it("returns 0 for empty rows", () => {
    expect(brierForLine([], 9.5, (m) => m)).toBe(0);
  });
});

describe("splitTrainTest", () => {
  it("splits deterministically by index without shuffling", () => {
    const rows = Array.from({ length: 10 }, (_, i) => i);
    const { train, test } = splitTrainTest(rows, 0.3);
    expect(train).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(test).toEqual([7, 8, 9]);
  });

  it("keeps everything in train when testFrac is 0", () => {
    const rows = [1, 2, 3];
    const { train, test } = splitTrainTest(rows, 0);
    expect(train).toEqual([1, 2, 3]);
    expect(test).toEqual([]);
  });
});

// ── Regressão: projeção degenerada não entra no fit (auditoria 2026-07-29) ──
describe("fitDistK — projeções degeneradas", () => {
  /**
   * Times sem histórico na temporada nova vêm com `avgs` zerado do choistats, e
   * a sim (pré-conserto) projetava 0. Esses pares [0, real] NÃO são previsões —
   * são ausência de previsão. Incluí-los no fit fazia o k perseguir o lixo:
   * subiu de 1.05 (junho) para 1.5672 (26/07), inflando em ~57% os jogos que
   * TINHAM dados bons.
   */
  it("ignora pares com previsão zero", () => {
    const bons: Array<[number, number]> = Array.from({ length: 40 }, () => [9.5, 9.6]);
    const semFix = fitDistK(bons)!;
    const comZeros: Array<[number, number]> = [
      ...bons,
      ...Array.from({ length: 20 }, () => [0, 9.6] as [number, number]),
    ];
    const comFix = fitDistK(comZeros)!;
    expect(comFix.k).toBeCloseTo(semFix.k, 6);
    expect(comFix.n).toBe(40);
  });

  it("ignora previsão negativa", () => {
    const pairs: Array<[number, number]> = [
      ...Array.from({ length: 35 }, () => [8, 8] as [number, number]),
      ...Array.from({ length: 5 }, () => [-3, 9] as [number, number]),
    ];
    const fit = fitDistK(pairs)!;
    expect(fit.n).toBe(35);
    expect(fit.k).toBeCloseTo(1, 6);
  });

  it("devolve null quando sobra menos que o mínimo depois do filtro", () => {
    const pairs: Array<[number, number]> = [
      ...Array.from({ length: 10 }, () => [9, 9] as [number, number]),
      ...Array.from({ length: 50 }, () => [0, 9] as [number, number]),
    ];
    expect(fitDistK(pairs)).toBeNull();
  });

  it("o actual continua podendo ser zero (0 a 0 é resultado legítimo)", () => {
    const pairs: Array<[number, number]> = Array.from(
      { length: 40 },
      (_, i) => [8, i < 20 ? 0 : 8] as [number, number],
    );
    const fit = fitDistK(pairs)!;
    expect(fit.n).toBe(40);
    expect(fit.k).toBeCloseTo(0.5, 6);
  });
});
