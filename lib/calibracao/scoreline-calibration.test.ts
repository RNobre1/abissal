import { describe, it, expect } from "vitest";
import {
  calibrateScorelines,
  fitScorelineCalibration,
  IDENTITY_CAL,
  type Scoreline,
} from "./scoreline-calibration";

const grid: Scoreline[] = [
  { score: "1-1", prob: 0.15 },
  { score: "1-0", prob: 0.1 },
  { score: "2-1", prob: 0.09 },
  { score: "0-0", prob: 0.08 },
  { score: "2-0", prob: 0.07 },
  { score: "0-1", prob: 0.06 },
];

describe("calibrateScorelines", () => {
  it("identidade quando T=1 e δ=1", () => {
    const out = calibrateScorelines(grid, IDENTITY_CAL);
    for (let i = 0; i < grid.length; i++) {
      expect(out[i].prob).toBeCloseTo(grid[i].prob, 9);
    }
  });

  it("temperatura T>1 achata o pico (top-1 cai)", () => {
    const out = calibrateScorelines(grid, { temperature: 1.8, drawFactor: 1 });
    const top = out.find((s) => s.score === "1-1")!;
    expect(top.prob).toBeLessThan(0.15);
  });

  it("drawFactor<1 reduz a massa de empate", () => {
    const rawDraw = 0.15 + 0.08; // 1-1 + 0-0
    const out = calibrateScorelines(grid, { temperature: 1, drawFactor: 0.6 });
    const calDraw = out.filter((s) => ["1-1", "0-0"].includes(s.score)).reduce((a, s) => a + s.prob, 0);
    expect(calDraw).toBeLessThan(rawDraw);
  });

  it("vazio → []", () => {
    expect(calibrateScorelines([], { temperature: 1.5, drawFactor: 0.8 })).toEqual([]);
    expect(calibrateScorelines(null)).toEqual([]);
  });

  it("params inválidos caem na identidade (T<=0/δ<=0)", () => {
    const out = calibrateScorelines(grid, { temperature: 0, drawFactor: -1 });
    for (let i = 0; i < grid.length; i++) expect(out[i].prob).toBeCloseTo(grid[i].prob, 9);
  });
});

describe("fitScorelineCalibration", () => {
  it("retorna null com <30 amostras", () => {
    expect(fitScorelineCalibration([{ scorelines: grid, actualHome: 1, actualAway: 0 }])).toBeNull();
  });

  it("minimiza log-loss: calibração escolhida não é pior que a crua", () => {
    // Mistura de resultados (modal nem sempre acerta) → o fit deve achatar o
    // pico e melhorar (ou empatar) a log-loss vs T=1,δ=1.
    const outcomes: Array<[number, number]> = [
      [1, 1], [2, 1], [1, 0], [0, 0], [2, 0], [0, 1], [2, 1], [1, 0], [3, 1], [0, 2],
    ];
    const samples = Array.from({ length: 80 }, (_, i) => ({
      scorelines: grid,
      actualHome: outcomes[i % outcomes.length][0],
      actualAway: outcomes[i % outcomes.length][1],
    }));
    const fit = fitScorelineCalibration(samples)!;
    expect(fit).not.toBeNull();
    expect(fit.logLoss).toBeLessThanOrEqual(fit.logLossRaw + 1e-9);
    expect(fit.temperature).toBeGreaterThanOrEqual(1);
    expect(fit.drawFactor).toBeGreaterThan(0);
    expect(fit.drawFactor).toBeLessThanOrEqual(1);
  });
});
