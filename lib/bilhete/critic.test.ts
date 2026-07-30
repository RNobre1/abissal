/**
 * TDD — F2 "Advogado do diabo do bilhete": lib pura.
 *
 * Cobre: normalização de mercado/lado das pernas → vocabulário do
 * edge-calculator; construção do OddsInput de UMA perna; parse robusto da
 * resposta JSON do LLM; linha de histórico por mercado; e o prompt (system
 * com os fatos MEDIDOS do modelo + user com os blocos por perna).
 */
import { describe, expect, it } from "vitest";
import {
  accuracyLineFor,
  buildCriticPrompt,
  buildLegOdds,
  normalizeLegMarket,
  parseCriticResponse,
  type CriticLegContext,
} from "./critic";
import type { MarketAccuracy } from "@/lib/calibracao/market-accuracy";

// ── normalizeLegMarket ──────────────────────────────────────────────────────

describe("normalizeLegMarket", () => {
  it("mapeia 1x2 com os três lados", () => {
    expect(normalizeLegMarket("1x2", "home")).toEqual({ market: "1x2", side: "home" });
    expect(normalizeLegMarket("1X2", "draw")).toEqual({ market: "1x2", side: "draw" });
    expect(normalizeLegMarket("1x2", "away")).toEqual({ market: "1x2", side: "away" });
  });

  it("aceita aliases pt-br (casa/empate/fora, x)", () => {
    expect(normalizeLegMarket("1x2", "casa")).toEqual({ market: "1x2", side: "home" });
    expect(normalizeLegMarket("1x2", "empate")).toEqual({ market: "1x2", side: "draw" });
    expect(normalizeLegMarket("1x2", "x")).toEqual({ market: "1x2", side: "draw" });
    expect(normalizeLegMarket("1x2", "fora")).toEqual({ market: "1x2", side: "away" });
  });

  it("mapeia over25 e btts (yes/no → sim/nao)", () => {
    expect(normalizeLegMarket("over25", "over")).toEqual({ market: "over25", side: "over" });
    expect(normalizeLegMarket("over25", "under")).toEqual({ market: "over25", side: "under" });
    expect(normalizeLegMarket("btts", "yes")).toEqual({ market: "btts", side: "sim" });
    expect(normalizeLegMarket("btts", "sim")).toEqual({ market: "btts", side: "sim" });
    expect(normalizeLegMarket("btts", "no")).toEqual({ market: "btts", side: "nao" });
    expect(normalizeLegMarket("btts", "não")).toEqual({ market: "btts", side: "nao" });
  });

  it("mapeia mercados secundários com linha ('9.5' → '95')", () => {
    expect(normalizeLegMarket("corners-over", "9.5")).toEqual({
      market: "corners-over",
      side: "95",
    });
    expect(normalizeLegMarket("corners-under", "105")).toEqual({
      market: "corners-under",
      side: "105",
    });
    expect(normalizeLegMarket("cards-over", "3.5")).toEqual({
      market: "cards-over",
      side: "35",
    });
    expect(normalizeLegMarket("sot-under", "7.5")).toEqual({
      market: "sot-under",
      side: "75",
    });
  });

  it("devolve null pra mercado/lado desconhecido", () => {
    expect(normalizeLegMarket("handicap", "-1")).toBeNull();
    expect(normalizeLegMarket("1x2", "banana")).toBeNull();
    expect(normalizeLegMarket("corners-over", "12.5")).toBeNull();
  });
});

// ── buildLegOdds ────────────────────────────────────────────────────────────

describe("buildLegOdds", () => {
  it("seta SOMENTE a chave da perna no OddsInput", () => {
    expect(buildLegOdds({ market: "1x2", side: "home" }, 2.1)).toEqual({ home: 2.1 });
    expect(buildLegOdds({ market: "1x2", side: "draw" }, 3.4)).toEqual({ draw: 3.4 });
    expect(buildLegOdds({ market: "over25", side: "under" }, 2.0)).toEqual({
      under25: 2.0,
    });
    expect(buildLegOdds({ market: "btts", side: "nao" }, 1.9)).toEqual({
      btts_nao: 1.9,
    });
    expect(buildLegOdds({ market: "corners-over", side: "95" }, 1.8)).toEqual({
      corners_over_95: 1.8,
    });
    expect(buildLegOdds({ market: "sot-under", side: "75" }, 2.2)).toEqual({
      sot_under_75: 2.2,
    });
  });
});

// ── parseCriticResponse ─────────────────────────────────────────────────────

const VALID_RESPONSE = {
  legs: [
    { verdict: "ok", why: "Edge positivo com liga calibrada." },
    { verdict: "fuga", why: "Empate mora nesse jogo." },
  ],
  overall: {
    summary: "Bilhete arriscado.",
    correlation_flags: ["duas pernas 1x2"],
    ev_comment: "EV combinado negativo.",
  },
};

describe("parseCriticResponse", () => {
  it("parseia JSON cru válido", () => {
    const out = parseCriticResponse(JSON.stringify(VALID_RESPONSE), 2);
    expect(out).not.toBeNull();
    expect(out!.legs).toHaveLength(2);
    expect(out!.legs[1].verdict).toBe("fuga");
    expect(out!.overall.summary).toBe("Bilhete arriscado.");
  });

  it("parseia JSON dentro de fence ```json", () => {
    const content = "```json\n" + JSON.stringify(VALID_RESPONSE) + "\n```";
    expect(parseCriticResponse(content, 2)).not.toBeNull();
  });

  it("normaliza 'atenção' (com acento) pra 'atencao'", () => {
    const resp = {
      ...VALID_RESPONSE,
      legs: [
        { verdict: "atenção", why: "x" },
        { verdict: "ok", why: "y" },
      ],
    };
    const out = parseCriticResponse(JSON.stringify(resp), 2);
    expect(out!.legs[0].verdict).toBe("atencao");
  });

  it("devolve null quando faltam pernas em relação ao bilhete", () => {
    const resp = { ...VALID_RESPONSE, legs: [VALID_RESPONSE.legs[0]] };
    expect(parseCriticResponse(JSON.stringify(resp), 2)).toBeNull();
  });

  it("corta pernas excedentes", () => {
    const resp = {
      ...VALID_RESPONSE,
      legs: [...VALID_RESPONSE.legs, { verdict: "ok", why: "extra" }],
    };
    const out = parseCriticResponse(JSON.stringify(resp), 2);
    expect(out!.legs).toHaveLength(2);
  });

  it("devolve null pra verdict fora do enum", () => {
    const resp = {
      ...VALID_RESPONSE,
      legs: [
        { verdict: "maybe", why: "x" },
        { verdict: "ok", why: "y" },
      ],
    };
    expect(parseCriticResponse(JSON.stringify(resp), 2)).toBeNull();
  });

  it("devolve null pra prosa sem JSON", () => {
    expect(parseCriticResponse("não sei responder isso", 2)).toBeNull();
  });

  it("defaulta correlation_flags e ev_comment ausentes", () => {
    const resp = {
      legs: VALID_RESPONSE.legs,
      overall: { summary: "ok" },
    };
    const out = parseCriticResponse(JSON.stringify(resp), 2);
    expect(out!.overall.correlation_flags).toEqual([]);
    expect(out!.overall.ev_comment).toBe("");
  });

  it("devolve null quando overall.summary falta", () => {
    const resp = { legs: VALID_RESPONSE.legs, overall: {} };
    expect(parseCriticResponse(JSON.stringify(resp), 2)).toBeNull();
  });
});

// ── accuracyLineFor ─────────────────────────────────────────────────────────

function makeAccuracy(over: Partial<MarketAccuracy>): MarketAccuracy {
  return {
    market: "corners",
    label: "escanteios · menos de 9.5",
    shortLabel: "escanteios",
    line: 9.5,
    dominantSide: "under",
    calls: 40,
    hits: 26,
    rate: 0.65,
    baseRate: 0.55,
    lift: 0.1,
    ci95: { lo: 0.5, hi: 0.78 },
    sampleTier: "liga",
    ...over,
  };
}

describe("accuracyLineFor", () => {
  it("acha o histórico do mercado da perna (corners-under → corners)", () => {
    const line = accuracyLineFor([makeAccuracy({})], "corners-under");
    expect(line).toContain("escanteios");
    expect(line).toContain("65%");
    expect(line).toContain("n=40");
  });

  it("mapeia over25 → goals e 1x2 → 1x2", () => {
    const markets = [
      makeAccuracy({ market: "goals", label: "gols · mais de 2.5", shortLabel: "gols" }),
      makeAccuracy({ market: "1x2", label: "resultado (1x2)", shortLabel: "resultado (1x2)", line: null }),
    ];
    expect(accuracyLineFor(markets, "over25")).toContain("gols");
    expect(accuracyLineFor(markets, "1x2")).toContain("resultado");
  });

  it("devolve null quando não há histórico do mercado", () => {
    expect(accuracyLineFor([], "btts")).toBeNull();
  });
});

// ── buildCriticPrompt ───────────────────────────────────────────────────────

const LEG_WITH_MODEL: CriticLegContext = {
  home: "Liverpool",
  away: "Tottenham",
  market: "1x2",
  side: "home",
  odd: 2.1,
  model: {
    probCalibrated: 0.6,
    edgePct: 26.0,
    leagueCalibrated: true,
    league: "Premier League",
    accuracyLine: "resultado (1x2): acerto 52% (n=300)",
  },
};

const LEG_WITHOUT_MODEL: CriticLegContext = {
  home: "Foo FC",
  away: "Bar FC",
  market: "over25",
  side: "over",
  odd: 1.9,
  model: null,
};

describe("buildCriticPrompt", () => {
  const prompt = buildCriticPrompt({
    legs: [LEG_WITH_MODEL, LEG_WITHOUT_MODEL],
    stakeTotal: 50,
    oddCombined: 3.99,
  });

  it("system carrega os fatos MEDIDOS do modelo", () => {
    expect(prompt.system).toContain("3,1");
    expect(prompt.system).toContain("corners-under");
    expect(prompt.system).toMatch(/não[- ]calibrada/i);
    expect(prompt.system).toContain('"ok"');
    expect(prompt.system).toContain('"atencao"');
    expect(prompt.system).toContain('"fuga"');
  });

  it("user tem um bloco por perna, na ordem", () => {
    expect(prompt.user).toContain("PERNA 1");
    expect(prompt.user).toContain("PERNA 2");
    expect(prompt.user.indexOf("Liverpool")).toBeLessThan(prompt.user.indexOf("Foo FC"));
  });

  it("perna com modelo mostra prob calibrada e edge", () => {
    expect(prompt.user).toContain("60.0%");
    expect(prompt.user).toContain("+26.0%");
    expect(prompt.user).toContain("Premier League");
    expect(prompt.user).toContain("resultado (1x2): acerto 52%");
  });

  it("perna sem modelo é marcada 'sem dados do modelo'", () => {
    expect(prompt.user.toLowerCase()).toContain("sem dados do modelo");
  });

  it("inclui stake e odd combinada quando informados", () => {
    expect(prompt.user).toContain("50");
    expect(prompt.user).toContain("3.99");
  });

  it("omite stake quando ausente", () => {
    const p2 = buildCriticPrompt({ legs: [LEG_WITH_MODEL], stakeTotal: null, oddCombined: null });
    expect(p2.user).not.toContain("stake");
  });
});
