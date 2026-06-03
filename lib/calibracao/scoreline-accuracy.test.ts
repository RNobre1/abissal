import { describe, it, expect } from "vitest";
import { scorelineAccuracy, rps1x2, type ScorelineSample } from "./scoreline-accuracy";

function sample(over: Partial<ScorelineSample>): ScorelineSample {
  return {
    topScore: "1-1",
    pTop: 0.11,
    scorelines: [
      { score: "1-1", prob: 0.11 },
      { score: "1-0", prob: 0.09 },
      { score: "2-1", prob: 0.08 },
      { score: "0-0", prob: 0.07 },
      { score: "2-0", prob: 0.06 },
      { score: "0-1", prob: 0.05 },
    ],
    pHome: 0.45,
    pDraw: 0.28,
    pAway: 0.27,
    actualHome: 1,
    actualAway: 1,
    ...over,
  };
}

describe("rps1x2", () => {
  it("é 0 para previsão perfeita", () => {
    expect(rps1x2(1, 0, 0, "home")).toBeCloseTo(0, 9);
    expect(rps1x2(0, 1, 0, "draw")).toBeCloseTo(0, 9);
  });

  it("penaliza mais o erro distante (prever home, sai away)", () => {
    const near = rps1x2(0.4, 0.4, 0.2, "draw"); // errou por 1 categoria
    const far = rps1x2(0.7, 0.2, 0.1, "away"); // errou por 2 categorias
    expect(far).toBeGreaterThan(near);
  });
});

describe("scorelineAccuracy", () => {
  it("conta top1/top3/top6 hit corretamente", () => {
    const rows = [
      sample({ actualHome: 1, actualAway: 1 }), // == top1 (1-1)
      sample({ actualHome: 2, actualAway: 1 }), // idx 2 → top3
      sample({ actualHome: 0, actualAway: 1 }), // idx 5 → top6 (não top3)
      sample({ actualHome: 4, actualAway: 4 }), // fora do top6
    ];
    const acc = scorelineAccuracy(rows);
    expect(acc.n).toBe(4);
    expect(acc.top1HitRate).toBeCloseTo(1 / 4, 9);
    expect(acc.top3HitRate).toBeCloseTo(2 / 4, 9);
    expect(acc.top6HitRate).toBeCloseTo(3 / 4, 9);
  });

  it("detecta viés de empate (predito > real)", () => {
    // pDraw médio 0.30; mas só 1 de 4 jogos foi empate (25%) → viés +0.05
    const rows = [
      sample({ pDraw: 0.3, actualHome: 1, actualAway: 1 }), // empate
      sample({ pDraw: 0.3, actualHome: 2, actualAway: 1 }),
      sample({ pDraw: 0.3, actualHome: 0, actualAway: 1 }),
      sample({ pDraw: 0.3, actualHome: 3, actualAway: 0 }),
    ];
    const acc = scorelineAccuracy(rows);
    expect(acc.predDrawRate).toBeCloseTo(0.3, 9);
    expect(acc.actualDrawRate).toBeCloseTo(0.25, 9);
    expect(acc.drawBias).toBeCloseTo(0.05, 9);
  });

  it("compara top1 hit rate com a prob que a sim previu (calibração)", () => {
    // sim prevê pTop=0.11 mas só acerta 1/4 = 0.25 → bem-calibrado seria ~igual
    const rows = [
      sample({ actualHome: 1, actualAway: 1 }),
      sample({ actualHome: 3, actualAway: 0 }),
      sample({ actualHome: 2, actualAway: 2 }),
      sample({ actualHome: 0, actualAway: 2 }),
    ];
    const acc = scorelineAccuracy(rows);
    expect(acc.top1PredictedMean).toBeCloseTo(0.11, 9);
    expect(acc.top1HitRate).toBeCloseTo(0.25, 9);
  });

  it("ignora linhas com placar real não-inteiro", () => {
    const rows = [
      sample({ actualHome: 1, actualAway: 1 }),
      sample({ actualHome: NaN as unknown as number, actualAway: 0 }),
    ];
    expect(scorelineAccuracy(rows).n).toBe(1);
  });
});
