import { describe, it, expect } from "vitest";
import {
  buildEdgeTable,
  devigProportional,
  type SimInput,
  type OddsInput,
} from "./edge-calculator";
import { poissonProbOver, poissonProbUnder } from "./dist-helpers";

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

  it("calcula kelly fracionado (⅛ Kelly)", () => {
    // f = (p*b - q) / b onde b = odd-1, q = 1-p
    // pra home: p=0.50, b=1.10, q=0.50; f = (0.55-0.50)/1.10 = 0.04545
    // ⅛ Kelly = 0.04545 * 0.125 = 0.005682
    // Fórmula impl: (f * fraction * bankroll) / 100 = 0.04545 * 0.125 * 1000 / 100 = 0.05682
    // R2 walk-forward: Kelly fraction ¼→⅛ (2026-05-25)
    const out = buildEdgeTable(baseSim, baseOdds, 1000);
    const home = out.find(c => c.market === "1x2" && c.side === "home")!;
    expect(home.kelly_units).toBeCloseTo(0.05682, 3);
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

  // ---------------------------------------------------------------------------
  // Blending sim × mercado (v1 universal, α=0.5 default in plumbing)
  // ---------------------------------------------------------------------------

  describe("blending sim × mercado (blendAlpha < 1.0)", () => {
    it("α=1.0 (default) — comportamento idêntico ao status quo (regressão)", () => {
      const a = buildEdgeTable(baseSim, baseOdds, 1000);
      const b = buildEdgeTable(baseSim, baseOdds, 1000, { blendAlpha: 1.0 });
      expect(b.length).toBe(a.length);
      for (let i = 0; i < a.length; i++) {
        expect(b[i].market).toBe(a[i].market);
        expect(b[i].side).toBe(a[i].side);
        expect(b[i].edge_pct).toBeCloseTo(a[i].edge_pct, 6);
        expect(b[i].kelly_units).toBeCloseTo(a[i].kelly_units, 6);
        expect(b[i].prob_calibrated).toBeCloseTo(a[i].prob_calibrated, 6);
      }
    });

    it("α=0.0 — edge_pct = (1/sum_inv − 1) · 100 (vig do bookmaker, igual em todos os lados do mesmo mercado)", () => {
      // Com α=0, prob_blended = prob_market_devig = (1/odd_i)/sum_inv.
      // edge = prob_market * odd - 1 = (1/sum_inv) - 1 (constante por mercado, == -vig).
      const out = buildEdgeTable(baseSim, baseOdds, 1000, { blendAlpha: 0.0 });
      const oneX2 = out.filter((c) => c.market === "1x2");
      expect(oneX2.length).toBe(3);
      const edges1x2 = oneX2.map((c) => c.edge_pct);
      // Todos os 3 lados devem ter o MESMO edge_pct (== -vig do mercado).
      for (let i = 1; i < edges1x2.length; i++) {
        expect(edges1x2[i]).toBeCloseTo(edges1x2[0], 4);
      }
      // baseOdds: home 2.10, draw 3.50, away 3.80. sum_inv = 0.4762+0.2857+0.2632 = 1.0251
      // edge = (1/1.0251 - 1) * 100 = -2.45
      expect(edges1x2[0]).toBeCloseTo(-2.45, 1);

      const overUnder = out.filter((c) => c.market === "over25");
      const edgesOU = overUnder.map((c) => c.edge_pct);
      for (let i = 1; i < edgesOU.length; i++) {
        expect(edgesOU[i]).toBeCloseTo(edgesOU[0], 4);
      }
      const btts = out.filter((c) => c.market === "btts");
      const edgesB = btts.map((c) => c.edge_pct);
      for (let i = 1; i < edgesB.length; i++) {
        expect(edgesB[i]).toBeCloseTo(edgesB[0], 4);
      }
    });

    it("α=0.0 com odds sem vig — edge_pct = 0 em todos lados", () => {
      // Odds (10/3, 4, 4): invs 0.3+0.25+0.25 = 0.8 (sub-vig, normaliza)
      // edge = (1/0.8 - 1) * 100 = +25%. Use odds com sum_inv = 1 exato:
      // (2.0, 4.0, 4.0) → invs 0.5+0.25+0.25 = 1.0 → edge=0 em todos.
      const sim: SimInput = { p_home: 0.5, p_draw: 0.25, p_away: 0.25 };
      const odds: OddsInput = { home: 2.0, draw: 4.0, away: 4.0 };
      const out = buildEdgeTable(sim, odds, 1000, { blendAlpha: 0.0 });
      for (const c of out.filter((c) => c.market === "1x2")) {
        expect(Math.abs(c.edge_pct)).toBeLessThan(0.001);
      }
    });

    it("α=0.5 caso explícito — sim=0.6, market_devig=0.3, odd=3.0 → blended=0.45, edge=35%", () => {
      // Construir caso fechado: 3-way com odds (3.0, 4.0, 4.0)
      // Devig proporcional: 1/3 + 1/4 + 1/4 = 0.5833; p1 = (1/3)/0.5833 = 0.5714, ...
      // Ajustar: use odds que devigam pra (0.3, 0.35, 0.35).
      // 1/0.3 = 3.333, 1/0.35 = 2.857, 1/0.35 = 2.857 → sum = 9.047 → odds = (9.047, 9.047, 9.047)???
      // Mais limpo: odds (3.0, ?, ?) com home=0.3 devigado.
      // Caso pedagógico simples: odd_home=3.0 sozinho → market devigging pega vig se outros existirem.
      // Para isolar: usar odd_home=3.0 e fazer outros 2 saídas devigarem pra 0.7 total.
      // 1/odd_draw + 1/odd_away = 0.7 * (sum 1/odd_total) - 1/3
      // Mas o devigging proporcional precisa do total. Use: odds (10/3, 4, 4) → invs (0.3, 0.25, 0.25) sum=0.8
      // Devigado: 0.3/0.8 = 0.375, 0.3125, 0.3125. Não bate 0.3.
      // Simplificar: caso onde NÃO importa devig pra outros — usar odd_home=3.0 com sim=0.6:
      //   prob_market (devig) será calculada com os 3 inversos.
      //   Pra forçar prob_market_home = 0.3 com odd_home=3.33333 (1/0.3):
      //   precisa que (1/3.33333) / total_inv = 0.3 → total_inv = 1/0.3 / 0.3 = 11.111? não, basta total_inv=1.
      //   Total_inv = 1.0 significa odds sem vig. Então use odds (10/3, 4, 4):
      //   inversos = 0.3, 0.25, 0.25. sum=0.8. devigado = 0.375, 0.3125, 0.3125.
      // Pra ter prob_market exata=0.3, preciso de odd_home tal que (1/odd_home)/sum_inv = 0.3.
      // Fix: usar odds onde sum_inv = 1.0 e (1/odd_home) = 0.3 → odd_home = 10/3.
      // Outros 2: 1/draw + 1/away = 0.7. Use draw=2.857, away=2.857 → 0.35 cada.
      const sim: SimInput = { p_home: 0.6, p_draw: 0.2, p_away: 0.2 };
      const odds: OddsInput = { home: 10 / 3, draw: 2.857142857, away: 2.857142857 };
      const out = buildEdgeTable(sim, odds, 1000, { blendAlpha: 0.5 });
      const home = out.find((c) => c.market === "1x2" && c.side === "home")!;
      expect(home.prob_market).toBeCloseTo(0.3, 3);
      // blended = 0.5 * 0.6 + 0.5 * 0.3 = 0.45
      expect(home.prob_blended).toBeCloseTo(0.45, 3);
      // edge = 0.45 * 3.3333 - 1 = 0.5 → 50%
      expect(home.edge_pct).toBeCloseTo(50.0, 1);
    });

    it("EdgeCandidate inclui prob_market e prob_blended quando blendAlpha < 1.0", () => {
      const out = buildEdgeTable(baseSim, baseOdds, 1000, { blendAlpha: 0.5 });
      for (const c of out) {
        expect(c.prob_market).toBeDefined();
        expect(c.prob_blended).toBeDefined();
        expect(typeof c.prob_market).toBe("number");
        expect(typeof c.prob_blended).toBe("number");
      }
    });

    it("blending opera apenas em mercados disponíveis (1x2 sem over25/btts)", () => {
      const partialOdds: OddsInput = { home: 2.10, draw: 3.50, away: 3.80 };
      const out = buildEdgeTable(baseSim, partialOdds, 1000, { blendAlpha: 0.5 });
      expect(out.length).toBe(3);
      for (const c of out) {
        expect(c.market).toBe("1x2");
        expect(c.prob_market).toBeDefined();
      }
    });

    it("Kolding-like: sim=0.575, market_devig~0.27, odd=3.7 → α=0.5 reduz edge de 113% pra ~57%", () => {
      // Caso documentado em prod (Kolding IF, 2026-05-25).
      // Pra ter prob_market_devig=0.27 com odd_home=3.7:
      //   sum_inv = 1/3.7/0.27 = 1.0009 (vig quase zero, exato seria 1.0)
      // Construir caso clean: odd_home=3.7, com odds_draw e odds_away tais que sum_inv=1.
      // 1/3.7 = 0.270270. Resto 0.729729 dividido entre draw e away.
      // Usar draw=3.4 → inv=0.2941, away=2.30 → inv=0.4348. Sum = 0.999 ≈ 1.
      // (1/3.7) / 1.0 = 0.2703 ≈ prob_market_home.
      const sim: SimInput = { p_home: 0.575, p_draw: 0.20, p_away: 0.225 };
      const odds: OddsInput = { home: 3.7, draw: 3.4, away: 2.30 };
      const noBlend = buildEdgeTable(sim, odds, 1000);
      const blend = buildEdgeTable(sim, odds, 1000, { blendAlpha: 0.5 });
      const homeNo = noBlend.find((c) => c.market === "1x2" && c.side === "home")!;
      const homeBl = blend.find((c) => c.market === "1x2" && c.side === "home")!;
      // No blend: 0.575 * 3.7 - 1 = 1.1275 → 112.75%
      expect(homeNo.edge_pct).toBeCloseTo(112.75, 0);
      // Blend α=0.5: prob_market ≈ 0.2703; blended = 0.5*0.575 + 0.5*0.2703 = 0.4226
      //   edge = 0.4226 * 3.7 - 1 = 0.5638 → ~56%
      expect(homeBl.edge_pct).toBeLessThan(60);
      expect(homeBl.edge_pct).toBeGreaterThan(50);
      // E o edge ficou menor (atenuação)
      expect(homeBl.edge_pct).toBeLessThan(homeNo.edge_pct);
    });

    it("isotonic + blending combinam: cal aplicada ao sim antes do blend", () => {
      const lookup = {
        "1x2-home": (p: number) => p + 0.05, // sim 0.50 → cal 0.55
        "1x2-draw": (p: number) => p,
        "1x2-away": (p: number) => p,
      };
      const out = buildEdgeTable(baseSim, baseOdds, 1000, {
        blendAlpha: 0.5,
        isotonicLookup: lookup,
      });
      const home = out.find((c) => c.market === "1x2" && c.side === "home")!;
      expect(home.prob_calibrated).toBeCloseTo(0.55, 3);
      // prob_blended = 0.5 * cal + 0.5 * market
      // odds = home 2.10, draw 3.50, away 3.80 → invs 0.4762, 0.2857, 0.2632 → sum 1.0251
      //   prob_market_home = 0.4762 / 1.0251 = 0.4645
      // blended = 0.5*0.55 + 0.5*0.4645 = 0.5072
      expect(home.prob_market!).toBeCloseTo(0.4645, 2);
      expect(home.prob_blended!).toBeCloseTo(0.5072, 2);
    });
  });

  describe("devigProportional", () => {
    it("3 odds (2.0, 4.0, 4.0) sem vig → (0.5, 0.25, 0.25) soma 1.0", () => {
      // invs: 0.5, 0.25, 0.25 → sum 1.0 (zero vig).
      const probs = devigProportional([2.0, 4.0, 4.0]);
      expect(probs.length).toBe(3);
      expect(probs[0]).toBeCloseTo(0.5, 6);
      expect(probs[1]).toBeCloseTo(0.25, 6);
      expect(probs[2]).toBeCloseTo(0.25, 6);
      const sum = probs.reduce((s, p) => s + p, 0);
      expect(sum).toBeCloseTo(1.0, 6);
    });

    it("3 odds com vig (2.0, 3.0, 3.0) → (3/7, 2/7, 2/7) soma 1.0", () => {
      // invs: 0.5, 0.333, 0.333 → sum 1.166 (16.6% vig).
      // devigado: 0.5/1.166=3/7, 0.333/1.166=2/7, 2/7.
      const probs = devigProportional([2.0, 3.0, 3.0]);
      expect(probs.length).toBe(3);
      expect(probs[0]).toBeCloseTo(3 / 7, 4);
      expect(probs[1]).toBeCloseTo(2 / 7, 4);
      expect(probs[2]).toBeCloseTo(2 / 7, 4);
      const sum = probs.reduce((s, p) => s + p, 0);
      expect(sum).toBeCloseTo(1.0, 6);
    });

    it("2 odds (2.0, 2.0) → (0.5, 0.5)", () => {
      const probs = devigProportional([2.0, 2.0]);
      expect(probs[0]).toBeCloseTo(0.5, 6);
      expect(probs[1]).toBeCloseTo(0.5, 6);
    });

    it("aceita odds com vig (1.91, 1.91) → (0.5, 0.5) após normalize", () => {
      const probs = devigProportional([1.91, 1.91]);
      expect(probs[0]).toBeCloseTo(0.5, 6);
      expect(probs[1]).toBeCloseTo(0.5, 6);
    });

    it("ignora odds inválidas (null, NaN, ≤1)", () => {
      // null/undefined espalhamos como inversos zero (e re-normalizamos)
      const probs = devigProportional([2.0, null as unknown as number, 3.0]);
      expect(probs.length).toBe(3);
      expect(probs[1]).toBeNaN();
      // Os outros 2 devem somar 1.0
      expect(probs[0] + probs[2]).toBeCloseTo(1.0, 6);
    });
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

  // Fix 2/3 — curvas INDEPENDENTES por lado (paridade com o Ruby edge_calculator)
  describe("calibração independente por lado (Fix 2/3)", () => {
    it("over25-under usa curva própria quando fornecida (≠ 1 − cal_over)", () => {
      const lookup = {
        over25: (p: number) => p + 0.10,
        "over25-under": (p: number) => p + 0.07,
      };
      const out = buildEdgeTable(baseSim, baseOdds, 1000, { isotonicLookup: lookup });
      const under = out.find(c => c.market === "over25" && c.side === "under")!;
      // raw under = 1 - 0.60 = 0.40 → curva própria 0.40 + 0.07 = 0.47
      // (1 − cal_over daria 1 - 0.70 = 0.30 — diverge, confirma curva própria)
      expect(under.prob_calibrated).toBeCloseTo(0.47, 3);
    });

    it("over25-under SEM curva cai em 1 − cal_over (fallback, não quebra)", () => {
      const lookup = { over25: (p: number) => p + 0.10 };
      const out = buildEdgeTable(baseSim, baseOdds, 1000, { isotonicLookup: lookup });
      const under = out.find(c => c.market === "over25" && c.side === "under")!;
      expect(under.prob_calibrated).toBeCloseTo(0.30, 3); // 1 - 0.70
    });

    it("btts sim e nao usam curvas próprias quando fornecidas", () => {
      const lookup = {
        btts: (p: number) => p + 0.05,
        "btts-nao": (p: number) => p - 0.05,
      };
      const out = buildEdgeTable(baseSim, baseOdds, 1000, { isotonicLookup: lookup });
      const sim = out.find(c => c.market === "btts" && c.side === "sim")!;
      const nao = out.find(c => c.market === "btts" && c.side === "nao")!;
      expect(sim.prob_calibrated).toBeCloseTo(0.60, 3); // 0.55 + 0.05
      expect(nao.prob_calibrated).toBeCloseTo(0.40, 3); // 0.45 - 0.05
    });

    it("btts SEM curva mantém prob crua (fallback, não quebra)", () => {
      const out = buildEdgeTable(baseSim, baseOdds, 1000);
      const sim = out.find(c => c.market === "btts" && c.side === "sim")!;
      const nao = out.find(c => c.market === "btts" && c.side === "nao")!;
      expect(sim.prob_calibrated).toBeCloseTo(0.55, 3);
      expect(nao.prob_calibrated).toBeCloseTo(0.45, 3);
    });
  });

  // ── Wave O+E: mercados secundários (corners, cards, SOT) ───────────────────

  describe("mercados secundários — corners/cards/SOT", () => {
    const simWithSecondary: SimInput = {
      ...baseSim,
      // Sim Monte Carlo projeta: home avg 5.8 corners + away avg 4.7 = 10.5 total (p50)
      sim_corners_total_mean: 10.5,
      // Sim: home avg 2.1 cards + away avg 2.2 = 4.3 total (p50)
      sim_cards_total_mean: 4.3,
      // Sim: home avg 3.8 SOT + away avg 2.9 = 6.7 total (p50)
      sim_sot_total_mean: 6.7,
    };

    const oddsWithSecondary: OddsInput = {
      ...baseOdds,
      corners_over_95: 1.90,
      corners_under_95: 1.90,
      corners_over_105: 2.20,
      corners_under_105: 1.65,
      cards_over_45: 1.85,
      cards_under_45: 1.95,
      sot_over_75: 1.95,
      sot_under_75: 1.85,
    };

    it("gera candidatos de corners quando sim_corners_total_mean e odds presentes", () => {
      const out = buildEdgeTable(simWithSecondary, oddsWithSecondary, 1000);
      const cornersCandidates = out.filter(c => c.market.startsWith("corners-"));
      expect(cornersCandidates.length).toBeGreaterThanOrEqual(2); // over+under para pelo menos 1 linha
    });

    it("gera candidatos de cards quando sim_cards_total_mean e odds presentes", () => {
      const out = buildEdgeTable(simWithSecondary, oddsWithSecondary, 1000);
      const cardsCandidates = out.filter(c => c.market.startsWith("cards-"));
      expect(cardsCandidates.length).toBeGreaterThanOrEqual(1);
    });

    it("gera candidatos de SOT quando sim_sot_total_mean e odds presentes", () => {
      const out = buildEdgeTable(simWithSecondary, oddsWithSecondary, 1000);
      const sotCandidates = out.filter(c => c.market.startsWith("sot-"));
      expect(sotCandidates.length).toBeGreaterThanOrEqual(1);
    });

    it("corners over 9.5 com mean=10.5: P(X>9.5|10.5) ≈ 0.603 → edge calculado via Poisson", () => {
      const out = buildEdgeTable(simWithSecondary, oddsWithSecondary, 1000);
      const over95 = out.find(c => c.market === "corners-over" && c.side === "95");
      expect(over95).toBeDefined();
      // P(X > 9.5 | lambda=10.5) ≈ 0.6029 (scipy reference)
      expect(over95!.prob_estimated).toBeCloseTo(0.6029, 2);
    });

    it("cards under 4.5 com mean=4.3: P(X<=4|4.3) ≈ 0.557 → under side", () => {
      const out = buildEdgeTable(simWithSecondary, oddsWithSecondary, 1000);
      const under45 = out.find(c => c.market === "cards-under" && c.side === "45");
      expect(under45).toBeDefined();
      // P(X < 4.5 | lambda=4.3) = P(X <= 4) = poissonCDF(4.3, 4) ≈ 0.557
      expect(under45!.prob_estimated).toBeGreaterThan(0.4);
      expect(under45!.prob_estimated).toBeLessThan(0.7);
    });

    it("corners sem mean → nenhum candidato corners", () => {
      const out = buildEdgeTable(baseSim, oddsWithSecondary, 1000);
      const corners = out.filter(c => c.market.startsWith("corners-"));
      expect(corners.length).toBe(0);
    });

    it("odds corners ausentes → nenhum candidato corners mesmo com mean", () => {
      const out = buildEdgeTable(simWithSecondary, baseOdds, 1000);
      const corners = out.filter(c => c.market.startsWith("corners-"));
      expect(corners.length).toBe(0);
    });

    it("gera candidatos apenas onde as odds estão presentes (corners_over_95 apenas)", () => {
      const partialOdds: OddsInput = {
        ...baseOdds,
        corners_over_95: 2.00,
        // sem corners_under_95, sem corners_over_105, etc.
      };
      const out = buildEdgeTable(simWithSecondary, partialOdds, 1000);
      const corners = out.filter(c => c.market.startsWith("corners-"));
      expect(corners.length).toBe(1);
      expect(corners[0].market).toBe("corners-over");
      expect(corners[0].side).toBe("95");
    });

    it("edge calculado corretamente para corners-over 9.5 com odd 1.90", () => {
      const out = buildEdgeTable(simWithSecondary, oddsWithSecondary, 1000);
      const over95 = out.find(c => c.market === "corners-over" && c.side === "95");
      expect(over95).toBeDefined();
      // prob ≈ 0.6029, odd 1.90 → edge = (0.6029 * 1.90 - 1) * 100 ≈ +14.5%
      expect(over95!.edge_pct).toBeCloseTo((0.6029 * 1.90 - 1) * 100, 0);
    });
  });

  // ── Calibração de DISTRIBUIÇÃO (distK) — prioridade curva → k → raw ─────────
  describe("calibração de distribuição (distK)", () => {
    const simSec: SimInput = { ...baseSim, sim_corners_total_mean: 10.5 };
    const oddsSec: OddsInput = { ...baseOdds, corners_over_95: 1.9, corners_under_95: 1.9 };

    it("aplica k na média quando NÃO há curva (prob_calibrated = Poisson(mean·k))", () => {
      const out = buildEdgeTable(simSec, oddsSec, 1000, { distK: { corners: 1.1 } });
      const over95 = out.find(c => c.market === "corners-over" && c.side === "95")!;
      expect(over95.prob_estimated).toBeCloseTo(poissonProbOver(10.5, 9.5), 9);
      expect(over95.prob_calibrated).toBeCloseTo(poissonProbOver(10.5 * 1.1, 9.5), 9);
      expect(over95.prob_calibrated).toBeGreaterThan(over95.prob_estimated);
    });

    it("aplica k no under simetricamente", () => {
      const out = buildEdgeTable(simSec, oddsSec, 1000, { distK: { corners: 1.1 } });
      const under95 = out.find(c => c.market === "corners-under" && c.side === "95")!;
      expect(under95.prob_calibrated).toBeCloseTo(poissonProbUnder(10.5 * 1.1, 9.5), 9);
    });

    it("curva isotônica tem prioridade sobre o k", () => {
      const lookup = { "corners-over-95": () => 0.42 };
      const out = buildEdgeTable(simSec, oddsSec, 1000, {
        isotonicLookup: lookup, distK: { corners: 1.1 },
      });
      const over95 = out.find(c => c.market === "corners-over" && c.side === "95")!;
      expect(over95.prob_calibrated).toBeCloseTo(0.42, 9);
    });

    it("sem distK e sem curva → raw (comportamento atual)", () => {
      const out = buildEdgeTable(simSec, oddsSec, 1000);
      const over95 = out.find(c => c.market === "corners-over" && c.side === "95")!;
      expect(over95.prob_calibrated).toBeCloseTo(over95.prob_estimated, 9);
    });

    it("k inválido/zero → ignorado (raw)", () => {
      const out = buildEdgeTable(simSec, oddsSec, 1000, { distK: { corners: 0 } });
      const over95 = out.find(c => c.market === "corners-over" && c.side === "95")!;
      expect(over95.prob_calibrated).toBeCloseTo(over95.prob_estimated, 9);
    });
  });
});

// ── clamp de probabilidade degenerada (28/07) ──────────────────────────────
// Espelha o spec Ruby (edge_calculator_spec.rb). Os dois caminhos precisam da
// MESMA guarda: o Ruby serve o batch noturno, este TS serve o botão
// on-demand de /fixtures/[id] e o value-bets. Fiar só um lado é a classe de
// bug das lições B16/B25.
describe("buildEdgeTable — clamp de probabilidade degenerada", () => {
  const CEILING = 0.99;
  const FLOOR = 0.01;

  it("nunca devolve prob_estimated igual a 1.0", () => {
    const out = buildEdgeTable({ ...baseSim, p_over_25: 1.0 }, baseOdds, 1000);
    const over = out.find(c => c.market === "over25" && c.side === "over")!;
    expect(over.prob_estimated).toBeLessThan(1.0);
    expect(over.prob_estimated).toBeCloseTo(CEILING, 9);
  });

  it("nunca devolve prob_estimated igual a 0.0", () => {
    const out = buildEdgeTable({ ...baseSim, p_over_25: 0.0 }, baseOdds, 1000);
    const over = out.find(c => c.market === "over25" && c.side === "over")!;
    expect(over.prob_estimated).toBeGreaterThan(0);
    expect(over.prob_estimated).toBeCloseTo(FLOOR, 9);
  });

  it("clampa a prob CALIBRADA mesmo quando a curva isotônica satura em 1", () => {
    // curva isotônica com platô no topo — satura em 1.0 para toda entrada
    const saturated: Partial<Record<string, (p: number) => number>> = {
      "1x2-home": () => 1.0,
      "1x2-draw": () => 1.0,
      "1x2-away": () => 1.0,
      over25: () => 1.0,
      btts: () => 1.0,
    };
    const out = buildEdgeTable({ ...baseSim, p_over_25: 0.9 }, baseOdds, 1000, {
      isotonicLookup: saturated,
    });
    for (const c of out) {
      expect(c.prob_calibrated).toBeLessThanOrEqual(CEILING);
    }
  });

  it("o edge reflete a prob clampada, não a degenerada", () => {
    const out = buildEdgeTable({ ...baseSim, p_over_25: 1.0 }, baseOdds, 1000);
    const over = out.find(c => c.market === "over25" && c.side === "over")!;
    // sem clamp seria (1.0 * 1.85 - 1) * 100 = 85.0
    expect(over.edge_pct).toBeLessThan(85.0);
    expect(over.edge_pct).toBeCloseTo((CEILING * 1.85 - 1) * 100, 6);
  });

  it("nenhum candidato sai com prob fora de [0.01, 0.99]", () => {
    const out = buildEdgeTable(
      { p_home: 1.0, p_draw: 0.0, p_away: 0.0, p_over_25: 1.0, p_btts: 0.0 },
      baseOdds,
      1000,
    );
    for (const c of out) {
      expect(c.prob_estimated).toBeGreaterThanOrEqual(FLOOR);
      expect(c.prob_estimated).toBeLessThanOrEqual(CEILING);
      expect(c.prob_calibrated).toBeGreaterThanOrEqual(FLOOR);
      expect(c.prob_calibrated).toBeLessThanOrEqual(CEILING);
    }
  });

  it("não mexe em probabilidades normais", () => {
    const out = buildEdgeTable(baseSim, baseOdds, 1000);
    const home = out.find(c => c.market === "1x2" && c.side === "home")!;
    expect(home.prob_estimated).toBeCloseTo(0.5, 9);
    expect(home.edge_pct).toBeCloseTo(5.0, 1);
  });
});

// Reprodução do caso real: CSKA Sofia x Qarabağ, corners-over 10.5, o
// primeiro batch pós-religamento gravou prob_estimated = prob_calibrated = 1.0.
// Média de corners altíssima faz poissonProbOver saturar em 1.
describe("clamp — mercados secundários (o caso que originou o bug)", () => {
  it("corners-over com média altíssima não sai com prob 1.0", () => {
    const out = buildEdgeTable(
      { ...baseSim, sim_corners_total_mean: 40 },
      { ...baseOdds, corners_over_105: 2.48, corners_under_105: 1.5 },
      1000,
    );
    const corners = out.filter(c => c.market.startsWith("corners"));
    expect(corners.length).toBeGreaterThan(0);
    for (const c of corners) {
      expect(c.prob_estimated).toBeLessThanOrEqual(0.99);
      expect(c.prob_estimated).toBeGreaterThanOrEqual(0.01);
      expect(c.prob_calibrated).toBeLessThanOrEqual(0.99);
      expect(c.prob_calibrated).toBeGreaterThanOrEqual(0.01);
    }
  });

  it("cards e sot com média extrema também ficam dentro do range", () => {
    const out = buildEdgeTable(
      { ...baseSim, sim_cards_total_mean: 30, sim_sot_total_mean: 40 },
      { ...baseOdds, cards_over_45: 2.0, cards_under_45: 1.8, sot_over_75: 2.0, sot_under_75: 1.8 },
      1000,
    );
    const sec = out.filter(c => c.market.startsWith("cards") || c.market.startsWith("sot"));
    expect(sec.length).toBeGreaterThan(0);
    for (const c of sec) {
      expect(c.prob_estimated).toBeLessThanOrEqual(0.99);
      expect(c.prob_calibrated).toBeLessThanOrEqual(0.99);
    }
  });
});

// ── temperature scaling (28/07) ────────────────────────────────────────────
// Challenger promovido: venceu a arena em 1x2/over25/btts (n=7290, p<.001).
// A sim ESTICA as probabilidades e um T por mercado corrige.
//
// Prioridade: curva isotônica → temperatura → raw. A isotônica foi fitada
// SOBRE probs raw, então aplicar T antes dela mudaria a entrada que ela
// aprendeu. Onde há curva ela ganha (corrige forma local, com dado da liga);
// onde não há — a maioria dos jogos — o T corrige o esticamento global.
// Mesmo padrão do `k` de distribuição (B32).
describe("buildEdgeTable — temperature scaling", () => {
  it("aplica T quando NÃO há curva isotônica pro mercado", () => {
    const semT = buildEdgeTable(baseSim, baseOdds, 1000);
    const comT = buildEdgeTable(baseSim, baseOdds, 1000, {
      temperature: { over25: 2.15 },
    });
    const a = semT.find(c => c.market === "over25" && c.side === "over")!;
    const b = comT.find(c => c.market === "over25" && c.side === "over")!;

    // p=0.60 com T=2.15 achata em direção a 0.5
    expect(b.prob_calibrated).toBeLessThan(a.prob_calibrated);
    expect(b.prob_calibrated).toBeGreaterThan(0.5);
  });

  it("a curva isotônica tem prioridade sobre o T", () => {
    const out = buildEdgeTable(baseSim, baseOdds, 1000, {
      isotonicLookup: { over25: () => 0.42 },
      temperature: { over25: 2.5 },
    });
    const over = out.find(c => c.market === "over25" && c.side === "over")!;
    // valor da curva, intocado pelo T
    expect(over.prob_calibrated).toBeCloseTo(0.42, 6);
  });

  it("T aplicado ao 1x2 preserva a soma das três probabilidades", () => {
    const out = buildEdgeTable(baseSim, baseOdds, 1000, {
      temperature: { "1x2": 1.7 },
    });
    const soma = ["home", "draw", "away"]
      .map(s => out.find(c => c.market === "1x2" && c.side === s)!.prob_calibrated)
      .reduce((a, b) => a + b, 0);
    expect(soma).toBeCloseTo(1, 6);
  });

  it("T no 1x2 achata o favorito e levanta o azarão", () => {
    const sem = buildEdgeTable(baseSim, baseOdds, 1000);
    const com = buildEdgeTable(baseSim, baseOdds, 1000, { temperature: { "1x2": 2.0 } });
    const pick = (o: typeof sem, side: string) =>
      o.find(c => c.market === "1x2" && c.side === side)!.prob_calibrated;

    expect(pick(com, "home")).toBeLessThan(pick(sem, "home")); // 0.50 → menor
    expect(pick(com, "draw")).toBeGreaterThan(pick(sem, "draw")); // 0.25 → maior
  });

  it("btts também aceita T", () => {
    const sem = buildEdgeTable(baseSim, baseOdds, 1000);
    const com = buildEdgeTable(baseSim, baseOdds, 1000, { temperature: { btts: 2.6 } });
    const a = sem.find(c => c.market === "btts" && c.side === "sim")!;
    const b = com.find(c => c.market === "btts" && c.side === "sim")!;
    expect(b.prob_calibrated).toBeLessThan(a.prob_calibrated);
    // e o lado oposto continua complementar
    const nao = com.find(c => c.market === "btts" && c.side === "nao")!;
    expect(b.prob_calibrated + nao.prob_calibrated).toBeCloseTo(1, 6);
  });

  it("T = 1 é indistinguível de não passar temperatura", () => {
    const sem = buildEdgeTable(baseSim, baseOdds, 1000);
    const com = buildEdgeTable(baseSim, baseOdds, 1000, {
      temperature: { "1x2": 1, over25: 1, btts: 1 },
    });
    for (let i = 0; i < sem.length; i++) {
      expect(com[i].prob_calibrated).toBeCloseTo(sem[i].prob_calibrated, 9);
    }
  });

  it("T ausente/inválido não altera nada (degrada gracioso)", () => {
    const sem = buildEdgeTable(baseSim, baseOdds, 1000);
    const com = buildEdgeTable(baseSim, baseOdds, 1000, {
      temperature: { over25: Number.NaN },
    });
    const a = sem.find(c => c.market === "over25" && c.side === "over")!;
    const b = com.find(c => c.market === "over25" && c.side === "over")!;
    expect(b.prob_calibrated).toBeCloseTo(a.prob_calibrated, 9);
  });

  it("NÃO toca mercados secundários (corners/cards/sot usam o k)", () => {
    const sim = { ...baseSim, sim_corners_total_mean: 10 };
    const odds = { ...baseOdds, corners_over_95: 2.0, corners_under_95: 1.8 };
    const sem = buildEdgeTable(sim, odds, 1000);
    const com = buildEdgeTable(sim, odds, 1000, { temperature: { "1x2": 2.5 } });
    const a = sem.find(c => c.market === "corners-over")!;
    const b = com.find(c => c.market === "corners-over")!;
    expect(b.prob_calibrated).toBeCloseTo(a.prob_calibrated, 9);
  });
});
