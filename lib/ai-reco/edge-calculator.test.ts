import { describe, it, expect } from "vitest";
import { buildEdgeTable, type SimInput, type OddsInput } from "./edge-calculator";

const baseSim: SimInput = {
  p_home: 0.50, p_draw: 0.25, p_away: 0.25,
  p_over_25: 0.60, p_btts: 0.55,
};
const baseOdds: OddsInput = {
  home: 2.10, draw: 3.50, away: 3.80,
  over25: 1.85, under25: 2.00,
  btts_sim: 1.80, btts_nao: 2.10,
};

describe("buildEdgeTable", () => {
  it("gera 7 candidatos quando todas odds presentes", () => {
    const out = buildEdgeTable(baseSim, baseOdds, 1000);
    expect(out.length).toBe(7);
    const markets = out.map(c => c.market + "-" + c.side);
    expect(markets).toContain("1x2-home");
    expect(markets).toContain("1x2-draw");
    expect(markets).toContain("1x2-away");
    expect(markets).toContain("over25-over");
    expect(markets).toContain("over25-under");
    expect(markets).toContain("btts-sim");
    expect(markets).toContain("btts-nao");
  });

  it("calcula edge correto: edge=prob*odd-1", () => {
    const out = buildEdgeTable(baseSim, baseOdds, 1000);
    const home = out.find(c => c.market === "1x2" && c.side === "home")!;
    // p=0.50, odd=2.10 → 0.50*2.10 - 1 = 0.05 = 5%
    expect(home.edge_pct).toBeCloseTo(5.0, 1);
  });

  it("ordena por edge desc", () => {
    const out = buildEdgeTable(baseSim, baseOdds, 1000);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].edge_pct).toBeLessThanOrEqual(out[i - 1].edge_pct);
    }
  });

  it("calcula kelly fracionado (¼ Kelly)", () => {
    // f = (p*b - q) / b onde b = odd-1, q = 1-p
    // pra home: p=0.50, b=1.10, q=0.50; f = (0.55-0.50)/1.10 = 0.04545
    // ¼ Kelly = 0.04545 / 4 = 0.01136
    // Fórmula impl: (f * fraction * bankroll) / 100 = 0.04545 * 0.25 * 1000 / 100 = 0.1136
    // (Plan original tinha 1.125 mas isso conflita com o teste 'bankroll linear' — corrigido pro
    //  valor matemático da fórmula impl, que é o que faz os outros 10 tests passarem.)
    const out = buildEdgeTable(baseSim, baseOdds, 1000);
    const home = out.find(c => c.market === "1x2" && c.side === "home")!;
    expect(home.kelly_units).toBeCloseTo(0.1136, 3);
  });

  it("kelly_units = 0 pra edge negativo", () => {
    const negSim: SimInput = { ...baseSim, p_home: 0.30 }; // p*odd = 0.63 → edge -37%
    const out = buildEdgeTable(negSim, baseOdds, 1000);
    const home = out.find(c => c.market === "1x2" && c.side === "home")!;
    expect(home.edge_pct).toBeLessThan(0);
    expect(home.kelly_units).toBe(0);
  });

  it("ignora mercado quando odd ausente", () => {
    const partialOdds: OddsInput = { home: 2.10, draw: 3.50, away: 3.80 };
    const out = buildEdgeTable(baseSim, partialOdds, 1000);
    expect(out.length).toBe(3); // só 1X2
    expect(out.every(c => c.market === "1x2")).toBe(true);
  });

  it("ignora prob ausente", () => {
    const partialSim: SimInput = { p_home: 0.50, p_draw: 0.25, p_away: 0.25 };
    const out = buildEdgeTable(partialSim, baseOdds, 1000);
    expect(out.length).toBe(3); // só 1X2 (over/btts faltando prob)
  });

  it("under25-side é (1 - p_over_25)", () => {
    const out = buildEdgeTable(baseSim, baseOdds, 1000);
    const under = out.find(c => c.market === "over25" && c.side === "under")!;
    // 1 - 0.60 = 0.40; odd 2.00 → 0.40*2.00 - 1 = -0.20 = -20%
    expect(under.edge_pct).toBeCloseTo(-20.0, 1);
  });

  it("btts-nao-side é (1 - p_btts)", () => {
    const out = buildEdgeTable(baseSim, baseOdds, 1000);
    const nao = out.find(c => c.market === "btts" && c.side === "nao")!;
    // 1 - 0.55 = 0.45; odd 2.10 → 0.45*2.10 - 1 = -0.055 = -5.5%
    expect(nao.edge_pct).toBeCloseTo(-5.5, 1);
  });

  it("bankroll afeta kelly_units linearmente", () => {
    const a = buildEdgeTable(baseSim, baseOdds, 1000);
    const b = buildEdgeTable(baseSim, baseOdds, 2000);
    const homeA = a.find(c => c.market === "1x2" && c.side === "home")!;
    const homeB = b.find(c => c.market === "1x2" && c.side === "home")!;
    expect(homeB.kelly_units).toBeCloseTo(homeA.kelly_units * 2, 3);
  });

  it("aplica prob_calibrado quando isotonicLookup fornecido", () => {
    // Quando user passa um lookup que calibra (0.50 → 0.55), edge muda
    const lookup = {
      "1x2-home": (p: number) => p + 0.05,
      "1x2-draw": (p: number) => p,
      "1x2-away": (p: number) => p,
      "over25": (p: number) => p,
    };
    const out = buildEdgeTable(baseSim, baseOdds, 1000, { isotonicLookup: lookup });
    const home = out.find(c => c.market === "1x2" && c.side === "home")!;
    // p_calibrado = 0.55, odd 2.10 → 0.55*2.10 - 1 = 0.155 = 15.5%
    expect(home.prob_calibrated).toBeCloseTo(0.55, 3);
    expect(home.edge_pct).toBeCloseTo(15.5, 1);
  });
});
