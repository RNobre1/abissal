import { describe, it, expect } from "vitest";
import { scorelineDisplay } from "./scoreline-display";

describe("scorelineDisplay", () => {
  const six = [
    { score: "1-1", prob: 0.11 },
    { score: "2-1", prob: 0.09 },
    { score: "1-0", prob: 0.08 },
    { score: "0-0", prob: 0.07 },
    { score: "2-0", prob: 0.06 },
    { score: "0-1", prob: 0.05 },
  ];

  it("separa top do resto e marca empates", () => {
    const d = scorelineDisplay(six);
    expect(d.top?.score).toBe("1-1");
    expect(d.top?.isDraw).toBe(true);
    expect(d.rest.map((r) => r.score)).toEqual(["2-1", "1-0", "0-0", "2-0", "0-1"]);
    expect(d.rest.find((r) => r.score === "0-0")?.isDraw).toBe(true);
    expect(d.rest.find((r) => r.score === "2-1")?.isDraw).toBe(false);
  });

  it("normaliza barPct pelo maior prob (top = 100%)", () => {
    const d = scorelineDisplay(six);
    expect(d.top?.barPct).toBeCloseTo(100, 6);
    // 2-1 @0.09 vs top 0.11 → 81.8%
    expect(d.rest[0].barPct).toBeCloseTo((0.09 / 0.11) * 100, 6);
  });

  it("coverage = soma das probs exibidas", () => {
    const d = scorelineDisplay(six);
    expect(d.coverage).toBeCloseTo(0.46, 6);
  });

  it("respeita o limite max", () => {
    const d = scorelineDisplay(six, 3);
    expect(d.rest.length).toBe(2); // top + 2 = 3
    expect(d.coverage).toBeCloseTo(0.11 + 0.09 + 0.08, 6);
  });

  it("vazio/inválido → top null", () => {
    expect(scorelineDisplay([]).top).toBeNull();
    expect(scorelineDisplay(null).top).toBeNull();
    expect(scorelineDisplay([{ score: "x", prob: NaN }]).top).toBeNull();
  });
});
