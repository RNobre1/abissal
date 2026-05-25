import { describe, it, expect } from "vitest";
import {
  summarizeAiRecoRoi,
  brierAiReco,
  groupAiRecoByLeague,
  groupAiRecoByConfidence,
  type AiRecoRow,
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
