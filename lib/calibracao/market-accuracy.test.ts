import { describe, it, expect } from "vitest";
import {
  countTotalMean,
  marketCall,
  countOutcome,
  MARKET_LINES,
  CALL_THRESHOLD,
  type AccuracyRow,
} from "./market-accuracy";

const simStats = {
  home: {
    corners: { p10: 3, p50: 6, p90: 10 },
    cards: { p10: 0, p50: 1, p90: 4 },
    sot: { p10: 2, p50: 5, p90: 8 },
  },
  away: {
    corners: { p10: 2, p50: 4, p90: 8 },
    cards: { p10: 0, p50: 2, p90: 4 },
    sot: { p10: 0, p50: 2, p90: 4 },
  },
};

function row(over: Partial<AccuracyRow> = {}): AccuracyRow {
  return {
    league: "Serie B",
    sim_stats: simStats,
    p_home: 0.45,
    p_draw: 0.28,
    p_away: 0.27,
    p_over_25: 0.52,
    p_btts: 0.48,
    actual_home_goals: 1,
    actual_away_goals: 1,
    actual_corners_home: 6,
    actual_corners_away: 5,
    actual_cards_home: 2,
    actual_cards_away: 1,
    actual_sot_home: 4,
    actual_sot_away: 3,
    actual_btts: true,
    correct_winner: false,
    ...over,
  };
}

describe("countTotalMean", () => {
  it("soma o p50 dos dois lados", () => {
    expect(countTotalMean(simStats, "corners")).toBe(10);
    expect(countTotalMean(simStats, "cards")).toBe(3);
    expect(countTotalMean(simStats, "sot")).toBe(7);
  });

  it("usa a chave `sot`, nunca `shots_on_target`", () => {
    const alien = {
      home: { shots_on_target: { p50: 5 } },
      away: { shots_on_target: { p50: 3 } },
    };
    expect(countTotalMean(alien, "sot")).toBeNull();
  });

  it("cai pra `mean` quando não há p50", () => {
    const m = { home: { corners: { mean: 5 } }, away: { corners: { mean: 4 } } };
    expect(countTotalMean(m, "corners")).toBe(9);
  });

  it("devolve null com um dos lados ausente, malformado ou não-numérico", () => {
    expect(countTotalMean({ home: { corners: { p50: 5 } } }, "corners")).toBeNull();
    expect(
      countTotalMean(
        { home: { corners: { p50: "x" } }, away: { corners: { p50: 4 } } },
        "corners",
      ),
    ).toBeNull();
    expect(countTotalMean(null, "corners")).toBeNull();
    expect(countTotalMean("lixo", "corners")).toBeNull();
    expect(countTotalMean({}, "corners")).toBeNull();
  });
});

describe("marketCall", () => {
  it("chama over quando P >= 0.55", () => {
    const c = marketCall(simStats, "corners", 8.5);
    expect(c.side).toBe("over");
    expect(c.prob).toBeGreaterThanOrEqual(CALL_THRESHOLD);
  });

  it("chama under quando P <= 0.45", () => {
    const c = marketCall(simStats, "cards", 5.5);
    expect(c.side).toBe("under");
  });

  it("não chama quando a probabilidade fica na zona morta", () => {
    // média 10 contra linha 9.5 ⇒ Poisson(10) P(>9.5) fica dentro de [0.45, 0.55)
    const c = marketCall(simStats, "corners", 9.5);
    expect(c.side).toBeNull();
    expect(c.prob).toBeGreaterThan(1 - CALL_THRESHOLD);
    expect(c.prob).toBeLessThan(CALL_THRESHOLD);
  });

  it("aplica o k de distribuição quando fornecido", () => {
    const semK = marketCall(simStats, "corners", 10.5);
    const comK = marketCall(simStats, "corners", 10.5, { corners: 1.2 });
    expect(comK.prob!).toBeGreaterThan(semK.prob!);
  });

  it("ignora k inválido (zero, negativo, NaN)", () => {
    const base = marketCall(simStats, "corners", 10.5).prob;
    for (const k of [0, -1, NaN]) {
      expect(marketCall(simStats, "corners", 10.5, { corners: k }).prob).toBe(base);
    }
  });

  it("devolve side e prob nulos quando a média não é derivável", () => {
    expect(marketCall(null, "corners", 9.5)).toEqual({ side: null, prob: null });
  });
});

describe("countOutcome", () => {
  it("true quando o total supera a linha", () => {
    expect(countOutcome(row(), "corners", 9.5)).toBe(true); // 6+5 = 11
  });

  it("false quando o total fica abaixo", () => {
    expect(
      countOutcome(
        row({ actual_corners_home: 4, actual_corners_away: 4 }),
        "corners",
        9.5,
      ),
    ).toBe(false);
  });

  it("resolve os adjacentes da linha sem ambiguidade", () => {
    const r = (t: number) => row({ actual_corners_home: t, actual_corners_away: 0 });
    expect(countOutcome(r(9), "corners", 9.5)).toBe(false);
    expect(countOutcome(r(10), "corners", 9.5)).toBe(true);
  });

  it("devolve null quando qualquer lado do actual falta", () => {
    expect(countOutcome(row({ actual_corners_home: null }), "corners", 9.5)).toBeNull();
    expect(countOutcome(row({ actual_corners_away: null }), "corners", 9.5)).toBeNull();
  });
});

describe("MARKET_LINES", () => {
  it("espelha as linhas canônicas do edge-calculator", () => {
    expect(MARKET_LINES.corners).toEqual([8.5, 9.5, 10.5]);
    expect(MARKET_LINES.cards).toEqual([3.5, 4.5, 5.5]);
    expect(MARKET_LINES.sot).toEqual([7.5, 9.5, 10.5]);
  });
});

// ── Task 2: agregação ────────────────────────────────────────────────────
import { marketAccuracies, MIN_LEAGUE_CALLS } from "./market-accuracy";

/** Linha com escanteios controlados: sim projeta homeP50+awayP50, real dá `total`. */
function cornersRow(homeP50: number, awayP50: number, total: number): AccuracyRow {
  return row({
    sim_stats: {
      home: { corners: { p50: homeP50 }, cards: { p50: 1 }, sot: { p50: 4 } },
      away: { corners: { p50: awayP50 }, cards: { p50: 1 }, sot: { p50: 3 } },
    },
    actual_corners_home: total,
    actual_corners_away: 0,
  });
}

describe("marketAccuracies", () => {
  it("conta acerto só sobre as chamadas, mas o universo inclui os sem chamada", () => {
    const semProjecao = row({
      // sim_stats sem `corners` ⇒ nenhuma chamada possível, mas o jogo
      // aconteceu e o resultado real entra na taxa-base.
      sim_stats: { home: { cards: { p50: 1 } }, away: { cards: { p50: 1 } } },
      actual_corners_home: 20,
      actual_corners_away: 0,
    });
    const rows = [
      cornersRow(7, 7, 20), // média 14 vs 8.5 ⇒ over; real 20 ⇒ acerto
      cornersRow(7, 7, 2), //  over; real 2 ⇒ erro
      semProjecao,
    ];
    const out = marketAccuracies(rows).find((m) => m.market === "corners")!;
    expect(out.calls).toBe(2);
    expect(out.hits).toBe(1);
    expect(out.rate).toBeCloseTo(0.5, 6);
  });

  it("escolhe a linha canônica com mais chamadas", () => {
    // média 14: chama over em 8.5/9.5/10.5. média 10: chama em 8.5 e 10.5,
    // zona morta em 9.5. Logo 8.5 e 10.5 empatam em 3 chamadas e 9.5 tem 2 —
    // a escolhida nunca é a 9.5.
    const rows = [cornersRow(7, 7, 20), cornersRow(7, 7, 2), cornersRow(5, 5, 20)];
    const out = marketAccuracies(rows).find((m) => m.market === "corners")!;
    expect(out.calls).toBe(3);
    expect(out.line).not.toBe(9.5);
  });

  it("calcula a taxa-base sobre o universo, não sobre as chamadas", () => {
    const rows = [
      cornersRow(7, 7, 2),
      cornersRow(7, 7, 2),
      cornersRow(7, 7, 2),
      cornersRow(7, 7, 20),
    ];
    const out = marketAccuracies(rows).find((m) => m.market === "corners")!;
    expect(out.baseRate).toBeCloseTo(0.75, 6);
    expect(out.lift).toBeCloseTo(out.rate - out.baseRate, 6);
  });

  it("escolhe a linha com mais chamadas quando várias qualificam", () => {
    const rows = Array.from({ length: 10 }, () => cornersRow(2, 2, 3));
    const out = marketAccuracies(rows).find((m) => m.market === "corners")!;
    expect(MARKET_LINES.corners).toContain(out.line!);
    expect(out.calls).toBe(10);
    expect(out.dominantSide).toBe("under");
  });

  it("devolve IC95 de Wilson coerente com o acerto", () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      cornersRow(7, 7, i < 30 ? 20 : 2),
    );
    const out = marketAccuracies(rows).find((m) => m.market === "corners")!;
    expect(out.rate).toBeCloseTo(0.75, 2);
    expect(out.ci95.lo).toBeLessThan(out.rate);
    expect(out.ci95.hi).toBeGreaterThan(out.rate);
    expect(out.ci95.lo).toBeGreaterThanOrEqual(0);
    expect(out.ci95.hi).toBeLessThanOrEqual(1);
  });

  it("marca o tier recebido e não inventa dado", () => {
    const out = marketAccuracies([cornersRow(7, 7, 20)], { tier: "global" });
    expect(out.every((m) => m.sampleTier === "global")).toBe(true);
  });

  it("omite mercado sem nenhuma chamada", () => {
    const semCards = [
      row({
        sim_stats: { home: { corners: { p50: 7 } }, away: { corners: { p50: 7 } } },
      }),
    ];
    const out = marketAccuracies(semCards);
    expect(out.find((m) => m.market === "cards")).toBeUndefined();
  });

  it("cobre 1x2, gols e btts sem depender de linha de contagem", () => {
    const rows = [
      row({
        correct_winner: true,
        p_over_25: 0.8,
        actual_home_goals: 2,
        actual_away_goals: 2,
        p_btts: 0.9,
        actual_btts: true,
      }),
      row({
        correct_winner: false,
        p_over_25: 0.8,
        actual_home_goals: 0,
        actual_away_goals: 0,
        p_btts: 0.9,
        actual_btts: false,
      }),
    ];
    const out = marketAccuracies(rows);
    const m1x2 = out.find((m) => m.market === "1x2")!;
    expect(m1x2.calls).toBe(2);
    expect(m1x2.hits).toBe(1);
    const gols = out.find((m) => m.market === "goals")!;
    expect(gols.line).toBe(2.5);
    expect(gols.calls).toBe(2);
    expect(gols.hits).toBe(1);
    const btts = out.find((m) => m.market === "btts")!;
    expect(btts.calls).toBe(2);
    expect(btts.hits).toBe(1);
  });

  it("não conta linha sem actual", () => {
    const out = marketAccuracies([
      row({ actual_corners_home: null, actual_corners_away: null }),
    ]);
    expect(out.find((m) => m.market === "corners")).toBeUndefined();
  });

  it("MIN_LEAGUE_CALLS é 30", () => {
    expect(MIN_LEAGUE_CALLS).toBe(30);
  });

  it("aguenta lista vazia", () => {
    expect(marketAccuracies([])).toEqual([]);
  });
});
