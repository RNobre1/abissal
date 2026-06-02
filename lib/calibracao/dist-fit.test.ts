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
    expect(fitDistK([[0, 5], [0, 4]], 1)).toBeNull();
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
