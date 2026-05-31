import { describe, it, expect } from "vitest";
import {
  summarizeAiRecoRoi,
  brierAiReco,
  groupAiRecoByLeague,
  groupAiRecoByConfidence,
  summarizeRealizedRoi,
  groupRealizedRoiByLeague,
  groupRealizedRoiByConfidence,
  groupAiRecoByMarket,
  groupAiRecoByMarketLine,
  type AiRecoRow,
  type RealizedBetRow,
} from "./ai-reco-metrics";

function row(over: Partial<AiRecoRow> = {}): AiRecoRow {
  return {
    id: 1,
    league: "Premier League",
    status: "resolved",
    verdict: "bet",
    confidence: "alto",
    prob_estimated: 0.5,
    units_final: 1.0,
    bet_won: true,
    pl_units: 1.0,
    ...over,
  };
}

describe("summarizeAiRecoRoi", () => {
  it("retorna zeros sem rows", () => {
    const s = summarizeAiRecoRoi([]);
    expect(s).toEqual({
      betCount: 0,
      resolvedCount: 0,
      won: 0,
      lost: 0,
      totalPl: 0,
      totalUnitsRisked: 0,
      winRate: null,
      roiPerUnit: null,
    });
  });

  it("ignora status=pending/unresolvable", () => {
    const s = summarizeAiRecoRoi([
      row({ status: "pending" }),
      row({ status: "unresolvable" }),
      row({ status: "resolved", bet_won: true, pl_units: 1.5 }),
    ]);
    expect(s.resolvedCount).toBe(1);
    expect(s.betCount).toBe(1);
    expect(s.totalPl).toBe(1.5);
  });

  it("ignora skips no count de bets mas conta como resolved", () => {
    const s = summarizeAiRecoRoi([
      row({ verdict: "skip", bet_won: null, pl_units: null }),
      row({ verdict: "bet", bet_won: true, pl_units: 1.5 }),
    ]);
    expect(s.resolvedCount).toBe(2);
    expect(s.betCount).toBe(1);
  });

  it("calcula winRate corretamente", () => {
    const s = summarizeAiRecoRoi([
      row({ bet_won: true, pl_units: 1.5 }),
      row({ bet_won: true, pl_units: 0.95 }),
      row({ bet_won: false, pl_units: -1.0 }),
    ]);
    expect(s.won).toBe(2);
    expect(s.lost).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 3, 5);
    expect(s.totalPl).toBeCloseTo(1.45, 5);
  });

  it("calcula roiPerUnit (P/L / units arriscadas)", () => {
    const s = summarizeAiRecoRoi([
      row({ units_final: 2.0, pl_units: 1.0 }),
      row({ units_final: 1.0, pl_units: -1.0 }),
    ]);
    // totalPl=0, totalUnitsRisked=3 → 0
    expect(s.roiPerUnit).toBe(0);
  });

  it("coerce numeric vindo como string (PostgREST)", () => {
    // A interface AiRecoRow já aceita string em pl_units/units_final por
    // design (PostgREST devolve numeric como string). Esse teste valida a
    // coerção pra Number na agregação.
    const s = summarizeAiRecoRoi([
      row({ pl_units: "1.50", units_final: "1.00" }),
    ]);
    expect(s.totalPl).toBe(1.5);
    expect(s.totalUnitsRisked).toBe(1.0);
  });
});

describe("brierAiReco", () => {
  it("retorna n=0/brier=null sem dados utilizáveis", () => {
    expect(brierAiReco([])).toEqual({ n: 0, brier: null });
    expect(brierAiReco([row({ status: "pending" })])).toEqual({
      n: 0,
      brier: null,
    });
  });

  it("ignora skips (sem prob a calibrar)", () => {
    const r = brierAiReco([row({ verdict: "skip", bet_won: null })]);
    expect(r.n).toBe(0);
  });

  it("computa Brier corretamente em casos simples", () => {
    // prob=0.6, won → (0.6-1)^2 = 0.16
    // prob=0.6, lost → (0.6-0)^2 = 0.36
    // média = 0.26
    const r = brierAiReco([
      row({ prob_estimated: 0.6, bet_won: true }),
      row({ prob_estimated: 0.6, bet_won: false }),
    ]);
    expect(r.n).toBe(2);
    expect(r.brier).toBeCloseTo(0.26, 5);
  });

  it("ignora rows sem prob_estimated ou sem bet_won", () => {
    const r = brierAiReco([
      row({ prob_estimated: null, bet_won: true }),
      row({ prob_estimated: 0.5, bet_won: null }),
      row({ prob_estimated: 0.7, bet_won: true }),
    ]);
    expect(r.n).toBe(1);
    expect(r.brier).toBeCloseTo(Math.pow(0.7 - 1, 2), 5);
  });
});

describe("groupAiRecoByLeague", () => {
  it("agrupa por liga e ordena por volume", () => {
    const out = groupAiRecoByLeague([
      row({ league: "PL", bet_won: true, pl_units: 1.0 }),
      row({ league: "PL", bet_won: false, pl_units: -1.0 }),
      row({ league: "LaLiga", bet_won: true, pl_units: 2.0 }),
    ]);
    expect(out[0].league).toBe("PL");
    expect(out[0].total).toBe(2);
    expect(out[0].bets).toBe(2);
    expect(out[0].won).toBe(1);
    expect(out[0].totalPl).toBe(0); // 1 - 1
    expect(out[0].winRate).toBe(0.5);
    expect(out[1].league).toBe("LaLiga");
    expect(out[1].totalPl).toBe(2);
  });

  it("conta skips em total mas não em bets", () => {
    const out = groupAiRecoByLeague([
      row({ league: "PL", verdict: "skip", bet_won: null, pl_units: null }),
      row({ league: "PL", verdict: "bet", bet_won: true, pl_units: 1.5 }),
    ]);
    expect(out[0].total).toBe(2);
    expect(out[0].bets).toBe(1);
    expect(out[0].totalPl).toBe(1.5);
  });

  it("usa fallback '(sem liga)' quando null", () => {
    const out = groupAiRecoByLeague([row({ league: null })]);
    expect(out[0].league).toBe("(sem liga)");
  });
});

describe("groupAiRecoByConfidence", () => {
  it("retorna apenas níveis com pelo menos 1 row", () => {
    const out = groupAiRecoByConfidence([
      row({ confidence: "alto" }),
      row({ confidence: "baixo" }),
    ]);
    expect(out.length).toBe(2);
    expect(out.map((r) => r.confidence)).toEqual(["alto", "baixo"]);
  });

  it("ordem fixa alto → medio → baixo", () => {
    const out = groupAiRecoByConfidence([
      row({ confidence: "baixo" }),
      row({ confidence: "alto" }),
      row({ confidence: "medio" }),
    ]);
    expect(out.map((r) => r.confidence)).toEqual(["alto", "medio", "baixo"]);
  });

  it("ignora confidence null ou desconhecida", () => {
    const out = groupAiRecoByConfidence([
      // @ts-expect-error testa que confidence fora do enum é ignorada
      row({ confidence: "foo" }),
      row({ confidence: null }),
    ]);
    expect(out).toEqual([]);
  });

  it("conta WR/P/L por nível", () => {
    const out = groupAiRecoByConfidence([
      row({ confidence: "alto", bet_won: true, pl_units: 1.5 }),
      row({ confidence: "alto", bet_won: true, pl_units: 1.0 }),
      row({ confidence: "medio", bet_won: false, pl_units: -1.0 }),
    ]);
    const alto = out.find((r) => r.confidence === "alto")!;
    expect(alto.winRate).toBe(1);
    expect(alto.totalPl).toBe(2.5);
    const medio = out.find((r) => r.confidence === "medio")!;
    expect(medio.winRate).toBe(0);
    expect(medio.totalPl).toBe(-1);
  });
});

// ── ROI realizado (bets reais vinculadas a recos via 0025) ────────────────────

function betRow(over: Partial<RealizedBetRow> = {}): RealizedBetRow {
  return {
    id: "bet-1",
    ai_recommendation_id: 1,
    house_id: "house-1",
    total_stake: 21,
    total_odds: 2.0,
    status: "won",
    actual_return: 42,
    league: "Premier League",
    confidence: "alto",
    ...over,
  };
}

describe("summarizeRealizedRoi", () => {
  it("retorna zeros sem bets", () => {
    const s = summarizeRealizedRoi([]);
    expect(s).toEqual({
      betCount: 0,
      resolvedCount: 0,
      won: 0,
      lost: 0,
      void: 0,
      totalStake: 0,
      totalPl: 0,
      winRate: null,
      roi: null,
    });
  });

  it("ignora bets sem ai_recommendation_id", () => {
    const s = summarizeRealizedRoi([
      betRow({ id: "a", ai_recommendation_id: null, status: "won" }),
      betRow({ id: "b", ai_recommendation_id: 7, status: "won" }),
    ]);
    expect(s.betCount).toBe(1);
  });

  it("ignora bets ainda pending no resolvedCount mas conta no betCount", () => {
    const s = summarizeRealizedRoi([
      betRow({ id: "a", status: "pending", actual_return: null }),
      betRow({ id: "b", status: "won", actual_return: 42 }),
    ]);
    expect(s.betCount).toBe(2);
    expect(s.resolvedCount).toBe(1);
    expect(s.won).toBe(1);
  });

  it("calcula PL corretamente: won = stake * (odd - 1)", () => {
    const s = summarizeRealizedRoi([
      betRow({ status: "won", total_stake: 21, total_odds: 2.0 }),
    ]);
    expect(s.totalPl).toBe(21);
  });

  it("calcula PL corretamente: lost = -stake", () => {
    const s = summarizeRealizedRoi([
      betRow({ status: "lost", total_stake: 21, total_odds: 2.0 }),
    ]);
    expect(s.totalPl).toBe(-21);
  });

  it("calcula PL corretamente: void = 0", () => {
    const s = summarizeRealizedRoi([
      betRow({ status: "void", total_stake: 21, total_odds: 2.0 }),
    ]);
    expect(s.totalPl).toBe(0);
    expect(s.void).toBe(1);
  });

  it("calcula winRate sobre bets resolvidas (sem void no denominador)", () => {
    const s = summarizeRealizedRoi([
      betRow({ id: "a", status: "won", total_stake: 21, total_odds: 2.0 }),
      betRow({ id: "b", status: "lost", total_stake: 21, total_odds: 2.0 }),
      betRow({ id: "c", status: "void", total_stake: 21, total_odds: 2.0 }),
    ]);
    expect(s.won).toBe(1);
    expect(s.lost).toBe(1);
    expect(s.void).toBe(1);
    expect(s.winRate).toBe(0.5);
  });

  it("calcula ROI = totalPl / totalStake", () => {
    const s = summarizeRealizedRoi([
      betRow({ id: "a", status: "won", total_stake: 21, total_odds: 2.0 }),
      betRow({ id: "b", status: "lost", total_stake: 21, total_odds: 2.0 }),
    ]);
    expect(s.totalStake).toBe(42);
    expect(s.roi).toBe(0);
  });

  it("coerce numeric vindo como string (PostgREST)", () => {
    const s = summarizeRealizedRoi([
      betRow({ status: "won", total_stake: "21.00", total_odds: "2.10" }),
    ]);
    expect(s.totalPl).toBeCloseTo(23.1, 5);
  });
});

describe("groupRealizedRoiByLeague", () => {
  it("agrupa bets por liga (da reco) e ordena por volume", () => {
    const out = groupRealizedRoiByLeague([
      betRow({ id: "a", league: "Premier League", status: "won", total_stake: 21, total_odds: 2.0 }),
      betRow({ id: "b", league: "Premier League", status: "lost", total_stake: 21, total_odds: 2.0 }),
      betRow({ id: "c", league: "La Liga", status: "won", total_stake: 21, total_odds: 1.8 }),
    ]);
    expect(out[0].league).toBe("Premier League");
    expect(out[0].bets).toBe(2);
    expect(out[0].won).toBe(1);
    expect(out[0].totalPl).toBe(0);
    expect(out[1].league).toBe("La Liga");
  });

  it("fallback '(sem liga)' quando league é null", () => {
    const out = groupRealizedRoiByLeague([
      betRow({ league: null, status: "won" }),
    ]);
    expect(out[0].league).toBe("(sem liga)");
  });
});

describe("groupRealizedRoiByConfidence", () => {
  it("agrupa bets por confidence (alto/medio/baixo) preservando ordem", () => {
    const out = groupRealizedRoiByConfidence([
      betRow({ id: "a", confidence: "alto", status: "won", total_stake: 21, total_odds: 2.0 }),
      betRow({ id: "b", confidence: "baixo", status: "lost", total_stake: 21, total_odds: 2.0 }),
    ]);
    expect(out.map((r) => r.confidence)).toEqual(["alto", "baixo"]);
  });

  it("ignora bets com confidence desconhecido / null", () => {
    const out = groupRealizedRoiByConfidence([
      betRow({ confidence: null }),
    ]);
    expect(out).toEqual([]);
  });
});

describe("groupAiRecoByMarket", () => {
  it("retorna [] sem rows", () => {
    expect(groupAiRecoByMarket([])).toEqual([]);
  });

  it("normaliza over/under para a categoria base (corners-over + corners-under → corners)", () => {
    const out = groupAiRecoByMarket([
      row({ market: "corners-over", bet_won: true, pl_units: 0.9, units_final: 1 }),
      row({ market: "corners-under", bet_won: false, pl_units: -1, units_final: 1 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].market).toBe("corners");
    expect(out[0].label).toBe("escanteios");
    expect(out[0].bets).toBe(2);
    expect(out[0].won).toBe(1);
    expect(out[0].totalPl).toBeCloseTo(-0.1, 6);
    expect(out[0].totalUnitsRisked).toBe(2);
  });

  it("calcula ROI por unidade e win rate por mercado", () => {
    const out = groupAiRecoByMarket([
      row({ market: "1x2", bet_won: true, pl_units: 1.5, units_final: 1 }),
      row({ market: "1x2", bet_won: false, pl_units: -1, units_final: 1 }),
    ]);
    const m = out.find((r) => r.market === "1x2")!;
    expect(m.bets).toBe(2);
    expect(m.winRate).toBeCloseTo(0.5, 6);
    expect(m.totalPl).toBeCloseTo(0.5, 6);
    expect(m.roiPerUnit).toBeCloseTo(0.25, 6); // 0.5 / 2
  });

  it("ignora pending/unresolvable; skips contam em total mas não em bets", () => {
    const out = groupAiRecoByMarket([
      row({ market: "btts", status: "pending" }),
      row({ market: "btts", status: "unresolvable" }),
      row({ market: "btts", status: "resolved", verdict: "skip" }),
      row({ market: "btts", status: "resolved", verdict: "bet", bet_won: true, pl_units: 1, units_final: 1 }),
    ]);
    const m = out.find((r) => r.market === "btts")!;
    expect(m.total).toBe(2); // 1 skip + 1 bet resolvidos
    expect(m.bets).toBe(1);
    expect(m.won).toBe(1);
  });

  it("usa rótulo legível para cada categoria conhecida", () => {
    const out = groupAiRecoByMarket([
      row({ market: "over25" }),
      row({ market: "cards-over" }),
      row({ market: "sot-under" }),
    ]);
    const labels = Object.fromEntries(out.map((r) => [r.market, r.label]));
    expect(labels["over25"]).toBe("over 2.5 gols");
    expect(labels["cards"]).toBe("cartões");
    expect(labels["sot"]).toBe("chutes no gol");
  });

  it("agrupa mercado nulo/desconhecido em '(outros)'", () => {
    const out = groupAiRecoByMarket([
      row({ market: null }),
      row({ market: "" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].market).toBe("(outros)");
  });

  it("mantém 1x2 como UMA linha na tabela base, mesmo com sides diferentes", () => {
    // A tabela "por mercado" (base) não divide por side — o split é só na
    // tabela "por linha" (groupAiRecoByMarketLine).
    const out = groupAiRecoByMarket([
      row({ market: "1x2", side: "home" }),
      row({ market: "1x2", side: "draw" }),
      row({ market: "1x2", side: "away" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].market).toBe("1x2");
    expect(out[0].bets).toBe(3);
  });
});

describe("groupAiRecoByMarketLine", () => {
  it("separa over/under como linhas distintas (escanteios over vs under)", () => {
    const out = groupAiRecoByMarketLine([
      row({ market: "corners-over", bet_won: true, pl_units: 0.8, units_final: 1 }),
      row({ market: "corners-under", bet_won: false, pl_units: -1, units_final: 1 }),
    ]);
    const lines = out.map((r) => r.market);
    expect(lines).toContain("corners-over");
    expect(lines).toContain("corners-under");
    const over = out.find((r) => r.market === "corners-over")!;
    expect(over.label).toBe("escanteios over");
    expect(over.winRate).toBe(1);
    const under = out.find((r) => r.market === "corners-under")!;
    expect(under.label).toBe("escanteios under");
    expect(under.winRate).toBe(0);
  });

  it("mantém 1x2/over25/btts como linhas únicas com rótulo legível", () => {
    const out = groupAiRecoByMarketLine([
      row({ market: "1x2" }),
      row({ market: "over25" }),
      row({ market: "btts" }),
    ]);
    const labels = Object.fromEntries(out.map((r) => [r.market, r.label]));
    expect(labels["1x2"]).toBe("1x2");
    expect(labels["over25"]).toBe("over 2.5 gols");
    expect(labels["btts"]).toBe("btts");
  });

  it("calcula ROI por unidade por linha", () => {
    const out = groupAiRecoByMarketLine([
      row({ market: "sot-over", bet_won: true, pl_units: 1.2, units_final: 1 }),
      row({ market: "sot-over", bet_won: true, pl_units: 0.8, units_final: 1 }),
    ]);
    const m = out.find((r) => r.market === "sot-over")!;
    expect(m.label).toBe("chutes no gol over");
    expect(m.bets).toBe(2);
    expect(m.roiPerUnit).toBeCloseTo(1.0, 6);
  });

  it("ordena over antes de under dentro da mesma categoria", () => {
    const out = groupAiRecoByMarketLine([
      row({ market: "cards-under" }),
      row({ market: "cards-over" }),
    ]);
    expect(out.map((r) => r.market)).toEqual(["cards-over", "cards-under"]);
  });

  it("divide 1x2 por side em linhas distintas (casa/empate/fora)", () => {
    const out = groupAiRecoByMarketLine([
      row({ market: "1x2", side: "home", bet_won: true, pl_units: 1.4, units_final: 1 }),
      row({ market: "1x2", side: "draw", bet_won: false, pl_units: -1, units_final: 1 }),
      row({ market: "1x2", side: "away", bet_won: true, pl_units: 2.0, units_final: 1 }),
    ]);
    const keys = out.map((r) => r.market);
    expect(keys).toContain("1x2-home");
    expect(keys).toContain("1x2-draw");
    expect(keys).toContain("1x2-away");

    const home = out.find((r) => r.market === "1x2-home")!;
    expect(home.label).toBe("1x2 casa");
    expect(home.bets).toBe(1);
    expect(home.won).toBe(1);
    expect(home.roiPerUnit).toBeCloseTo(1.4, 6);

    const draw = out.find((r) => r.market === "1x2-draw")!;
    expect(draw.label).toBe("1x2 empate");
    expect(draw.won).toBe(0);
    expect(draw.roiPerUnit).toBeCloseTo(-1.0, 6);

    const away = out.find((r) => r.market === "1x2-away")!;
    expect(away.label).toBe("1x2 fora");
    expect(away.won).toBe(1);
  });

  it("ordena 1x2 na sequência casa → empate → fora", () => {
    const out = groupAiRecoByMarketLine([
      row({ id: 3, market: "1x2", side: "away" }),
      row({ id: 1, market: "1x2", side: "home" }),
      row({ id: 2, market: "1x2", side: "draw" }),
    ]);
    expect(out.map((r) => r.market)).toEqual(["1x2-home", "1x2-draw", "1x2-away"]);
  });

  it("cai pra linha única '1x2' quando side ausente/desconhecido", () => {
    const out = groupAiRecoByMarketLine([
      row({ market: "1x2", side: null }),
      row({ market: "1x2", side: "" }),
      row({ market: "1x2", side: "lixo" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].market).toBe("1x2");
    expect(out[0].label).toBe("1x2");
    expect(out[0].bets).toBe(3);
  });
});
