import { describe, it, expect } from "vitest";
import { cardsShadowRows } from "./shadow-card-predictions";

describe("cardsShadowRows", () => {
  it("retorna [] sem média ou params", () => {
    expect(cardsShadowRows(null, { nu: 0.7, r: 8 })).toEqual([]);
    expect(cardsShadowRows(4.3, null)).toEqual([]);
    expect(cardsShadowRows(0, { nu: 0.7, r: 8 })).toEqual([]);
  });

  it("3 linhas (3.5/4.5/5.5), P(over) decrescente com a linha", () => {
    const rows = cardsShadowRows(4.3, { nu: 0.7, r: 8 });
    expect(rows.map((r) => r.line)).toEqual([3.5, 4.5, 5.5]);
    for (const r of rows) {
      expect(r.poissonOver).toBeGreaterThanOrEqual(0);
      expect(r.cmpOver).toBeLessThanOrEqual(1);
    }
    expect(rows[0].cmpOver).toBeGreaterThan(rows[2].cmpOver); // over 3.5 > over 5.5
  });

  it("ν=1 e r grande ≈ Poisson (as 3 colunas batem)", () => {
    const rows = cardsShadowRows(4.3, { nu: 1, r: 1e7 });
    for (const r of rows) {
      expect(r.cmpOver).toBeCloseTo(r.poissonOver, 4);
      expect(r.nbOver).toBeCloseTo(r.poissonOver, 3);
    }
  });

  it("over-dispersão (ν<1, r pequeno) afasta as caudas vs Poisson", () => {
    // over-disp põe mais massa nas caudas → P(over linha alta) maior que Poisson
    const rows = cardsShadowRows(4.3, { nu: 0.6, r: 4 });
    const high = rows.find((r) => r.line === 5.5)!;
    expect(high.cmpOver).toBeGreaterThan(high.poissonOver);
    expect(high.nbOver).toBeGreaterThan(high.poissonOver);
  });
});
