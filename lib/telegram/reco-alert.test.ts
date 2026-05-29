import { describe, it, expect } from "vitest";
import { formatRecoAlert, type RecoBet } from "./reco-alert";

function bet(overrides: Partial<RecoBet> = {}): RecoBet {
  return {
    homeTeam: "Flamengo",
    awayTeam: "Palmeiras",
    league: "Brasileirão",
    market: "btts",
    side: "sim",
    edgePct: 12.3,
    confidence: "medio",
    units: 1.0,
    oddCaptured: 1.9,
    ...overrides,
  };
}

describe("formatRecoAlert", () => {
  it("retorna null quando não há nenhuma aposta (nada pra alertar)", () => {
    expect(formatRecoAlert({ date: "29/05", bets: [], skipCount: 5 })).toBeNull();
  });

  it("lista TODAS as apostas — independente da confiança", () => {
    const msg = formatRecoAlert({
      date: "29/05",
      bets: [
        bet({ confidence: "alto" }),
        bet({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "Premier League", market: "over25", side: "over", edgePct: 8.1, confidence: "baixo", units: 0.5, oddCaptured: 2.0 }),
      ],
      skipCount: 5,
    })!;
    // header com a contagem
    expect(msg).toContain("2");
    expect(msg).toContain("29/05");
    // ambos os jogos
    expect(msg).toContain("Flamengo");
    expect(msg).toContain("Palmeiras");
    expect(msg).toContain("Arsenal");
    expect(msg).toContain("Chelsea");
    // confiança alta E baixa aparecem (não filtra)
    expect(msg.toLowerCase()).toContain("alta");
    expect(msg.toLowerCase()).toContain("baixa");
  });

  it("mostra edge (pt-BR, sinal), units e odd por aposta", () => {
    const msg = formatRecoAlert({ date: "29/05", bets: [bet()], skipCount: 0 })!;
    expect(msg).toContain("+12,3%"); // edge pt-BR com sinal
    expect(msg).toContain("1,0u"); // units pt-BR
    expect(msg).toContain("1.90"); // odd
    expect(msg.toLowerCase()).toContain("btts");
  });

  it("mapeia confiança alto/medio/baixo → alta/média/baixa", () => {
    const alto = formatRecoAlert({ date: "1/1", bets: [bet({ confidence: "alto" })], skipCount: 0 })!;
    const medio = formatRecoAlert({ date: "1/1", bets: [bet({ confidence: "medio" })], skipCount: 0 })!;
    const baixo = formatRecoAlert({ date: "1/1", bets: [bet({ confidence: "baixo" })], skipCount: 0 })!;
    expect(alto.toLowerCase()).toContain("alta");
    expect(medio.toLowerCase()).toContain("média");
    expect(baixo.toLowerCase()).toContain("baixa");
  });

  it("footer mostra a contagem de skips (contexto), e some quando 0", () => {
    const comSkip = formatRecoAlert({ date: "1/1", bets: [bet()], skipCount: 7 })!;
    expect(comSkip).toContain("7");
    const semSkip = formatRecoAlert({ date: "1/1", bets: [bet()], skipCount: 0 })!;
    // sem skips: não inventa linha de "0 sem valor"
    expect(semSkip).not.toMatch(/0 .*sem valor/i);
  });

  it("trunca quando há muitas apostas (cap) e sinaliza o resto", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      bet({ homeTeam: `H${i}`, awayTeam: `A${i}` }),
    );
    const msg = formatRecoAlert({ date: "1/1", bets: many, skipCount: 0, maxBets: 10 })!;
    // só 10 blocos de jogo renderizados
    expect((msg.match(/⚽/g) || []).length).toBe(10);
    // header reflete o TOTAL (30), não o cap
    expect(msg).toContain("30");
    // sinaliza as 20 restantes
    expect(msg).toMatch(/20.*(mais|app)/i);
  });

  it("tolera campos nulos (edge/confiança/units/odd ausentes) sem quebrar", () => {
    const msg = formatRecoAlert({
      date: "1/1",
      bets: [bet({ edgePct: null, confidence: null, units: null, oddCaptured: null })],
      skipCount: 0,
    })!;
    expect(msg).toContain("Flamengo");
    expect(msg).toContain("—"); // placeholder pra valor ausente
  });
});
