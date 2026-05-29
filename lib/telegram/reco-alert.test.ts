import { describe, it, expect } from "vitest";
import { formatRecoAlert, formatPick, type RecoBet } from "./reco-alert";

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

describe("formatPick — humaniza market/side", () => {
  it("1x2 → Resultado: Casa/Empate/Fora", () => {
    expect(formatPick("1x2", "home")).toBe("Resultado: Casa");
    expect(formatPick("1x2", "draw")).toBe("Resultado: Empate");
    expect(formatPick("1x2", "away")).toBe("Resultado: Fora");
  });

  it("over25 → Gols: Over/Under 2.5", () => {
    expect(formatPick("over25", "over")).toBe("Gols: Over 2.5");
    expect(formatPick("over25", "under")).toBe("Gols: Under 2.5");
  });

  it("btts → Ambas marcam: Sim/Não", () => {
    expect(formatPick("btts", "sim")).toBe("Ambas marcam: Sim");
    expect(formatPick("btts", "nao")).toBe("Ambas marcam: Não");
  });

  it("secundários: side é a linha ×10 (85 → 8.5)", () => {
    expect(formatPick("corners-under", "85")).toBe("Escanteios: Under 8.5");
    expect(formatPick("corners-over", "105")).toBe("Escanteios: Over 10.5");
    expect(formatPick("corners-over", "95")).toBe("Escanteios: Over 9.5");
    expect(formatPick("cards-over", "45")).toBe("Cartões: Over 4.5");
    expect(formatPick("sot-under", "75")).toBe("Finalizações no gol: Under 7.5");
    expect(formatPick("sot-over", "105")).toBe("Finalizações no gol: Over 10.5");
  });

  it("fallback pra market/side desconhecido (não quebra)", () => {
    expect(formatPick("foo", "bar")).toBe("FOO/BAR");
  });
});

describe("formatRecoAlert", () => {
  it("retorna null quando não há nenhuma aposta", () => {
    expect(formatRecoAlert({ date: "29/05", bets: [], skipCount: 5 })).toBeNull();
  });

  it("usa o pick humanizado (não o slug cru)", () => {
    const msg = formatRecoAlert({
      date: "29/05",
      bets: [bet({ market: "corners-under", side: "85" })],
      skipCount: 0,
    })!;
    expect(msg).toContain("Escanteios: Under 8.5");
    expect(msg).not.toContain("CORNERS-UNDER/85");
  });

  it("usa HTML: negrito no confronto", () => {
    const msg = formatRecoAlert({ date: "29/05", bets: [bet()], skipCount: 0 })!;
    expect(msg).toContain("<b>Flamengo × Palmeiras</b>");
  });

  it("escapa caracteres HTML em nomes de time/liga", () => {
    const msg = formatRecoAlert({
      date: "1/1",
      bets: [bet({ homeTeam: "A & B", awayTeam: "C", league: "<liga>" })],
      skipCount: 0,
    })!;
    expect(msg).toContain("A &amp; B");
    expect(msg).toContain("&lt;liga&gt;");
  });

  it("DEDUPLICA recos do mesmo confronto+mercado+lado", () => {
    const dup = bet({ market: "corners-under", side: "85" });
    const msg = formatRecoAlert({ date: "1/1", bets: [dup, { ...dup }, { ...dup }], skipCount: 0 })!;
    // só 1 bloco (1 ⚽), e header conta 1
    expect((msg.match(/⚽|<b>Flamengo/g) || []).length).toBe(1);
  });

  it("mostra edge (pt-BR, sinal), units e odd", () => {
    const msg = formatRecoAlert({ date: "29/05", bets: [bet({ units: 0.1, oddCaptured: 2.62 })], skipCount: 0 })!;
    expect(msg).toContain("+12,3%");
    expect(msg).toContain("0,1u");
    expect(msg).toContain("2.62");
  });

  it("lista TODAS as confianças (não filtra) e mapeia alto/medio/baixo", () => {
    const msg = formatRecoAlert({
      date: "1/1",
      bets: [bet({ confidence: "alto", market: "1x2", side: "home" }), bet({ homeTeam: "X", awayTeam: "Y", confidence: "baixo", market: "1x2", side: "away" })],
      skipCount: 0,
    })!;
    expect(msg.toLowerCase()).toContain("alta");
    expect(msg.toLowerCase()).toContain("baixa");
  });

  it("footer mostra skips (>0) e some quando 0", () => {
    const com = formatRecoAlert({ date: "1/1", bets: [bet()], skipCount: 7 })!;
    expect(com).toContain("7");
    const sem = formatRecoAlert({ date: "1/1", bets: [bet()], skipCount: 0 })!;
    expect(sem).not.toMatch(/0 .*sem valor/i);
  });

  it("trunca em maxBets e sinaliza o resto (header conta o total)", () => {
    const many = Array.from({ length: 30 }, (_, i) => bet({ homeTeam: `H${i}`, awayTeam: `A${i}` }));
    const msg = formatRecoAlert({ date: "1/1", bets: many, skipCount: 0, maxBets: 10 })!;
    expect((msg.match(/<b>H\d+ ×/g) || []).length).toBe(10);
    expect(msg).toContain("30");
    expect(msg).toMatch(/20.*(mais|app)/i);
  });

  it("tolera campos nulos sem quebrar", () => {
    const msg = formatRecoAlert({
      date: "1/1",
      bets: [bet({ edgePct: null, confidence: null, units: null, oddCaptured: null })],
      skipCount: 0,
    })!;
    expect(msg).toContain("Flamengo");
    expect(msg).toContain("—");
  });
});
