import { describe, it, expect } from "vitest";
import { distCalibrationRows } from "./dist-calibration";

describe("distCalibrationRows", () => {
  it("extrai {stat,k,n,meanPred,meanActual} das linhas *-dist", () => {
    const rows = [
      { metric: "corners-dist", n: 325, pairs: [[8.9, 9.46]] },
      { metric: "cards-dist", n: 325, pairs: [[3.68, 4.19]] },
      { metric: "sot-dist", n: 300, pairs: [[7.78, 8.38]] },
      { metric: "1x2-home", n: 500, pairs: [[0.5, 0.45]] }, // isotônica → ignorada
    ];
    const out = distCalibrationRows(rows);
    expect(out.map((r) => r.stat)).toEqual(["corners", "sot", "cards"]);
    const corners = out.find((r) => r.stat === "corners")!;
    expect(corners.k).toBeCloseTo(9.46 / 8.9, 6);
    expect(corners.n).toBe(325);
    expect(corners.meanPred).toBeCloseTo(8.9, 6);
    expect(corners.meanActual).toBeCloseTo(9.46, 6);
  });

  it("aceita pairs como string JSON", () => {
    const out = distCalibrationRows([{ metric: "corners-dist", n: 50, pairs: "[[10,11]]" }]);
    expect(out[0].k).toBeCloseTo(1.1, 6);
  });

  it("descarta meanPred não-positivo e pairs malformado", () => {
    const out = distCalibrationRows([
      { metric: "corners-dist", n: 10, pairs: [[0, 9]] },
      { metric: "cards-dist", n: 10, pairs: "lixo" },
      { metric: "sot-dist", n: 10, pairs: [[7, 7.5]] },
    ]);
    expect(out.map((r) => r.stat)).toEqual(["sot"]);
  });

  it("vazio quando não há linhas *-dist", () => {
    expect(distCalibrationRows([{ metric: "over25", n: 100, pairs: [[0.5, 0.5]] }])).toEqual([]);
  });
});
