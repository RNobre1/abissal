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
  computeGroupEdge,
  isBuilderMarket,
  normalizeBuilderSelection,
  normalizeLegMarket,
  parseCriticResponse,
  splitBuilderSide,
  type CriticGroupSelection,
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

// ── Pernas-grupo "Criar Aposta" (bet builder em múltipla mista) ─────────────

describe("isBuilderMarket / splitBuilderSide", () => {
  it("detecta 'Criar Aposta' e 'Bet Builder' (case-insensitive)", () => {
    expect(isBuilderMarket("Criar Aposta")).toBe(true);
    expect(isBuilderMarket("criar aposta")).toBe(true);
    expect(isBuilderMarket("Bet Builder")).toBe(true);
    expect(isBuilderMarket("1x2")).toBe(false);
    expect(isBuilderMarket("over25")).toBe(false);
  });

  it("splitBuilderSide separa por ' + ' preservando hífens internos", () => {
    expect(
      splitBuilderSide(
        "1 - Resultado Final + Mais de 6.5 - Bodo/Glimt - Total de Escanteios",
      ),
    ).toEqual([
      "1 - Resultado Final",
      "Mais de 6.5 - Bodo/Glimt - Total de Escanteios",
    ]);
    expect(splitBuilderSide("Menos de 2.5 - Total de Gols")).toEqual([
      "Menos de 2.5 - Total de Gols",
    ]);
  });
});

describe("normalizeBuilderSelection — SEM hífen (formato real do OCR varia)", () => {
  // Caso real 31/07 18:44: o OCR emitiu as seleções sem o separador " - "
  // ("Menos de 2.5 Total de Gols") e TODAS caíram em sem-mapeamento — a
  // crítica rodou cega com a sim disponível.
  it("'Menos de 2.5 Total de Gols' mapeia over25/under", () => {
    const r = normalizeBuilderSelection("Menos de 2.5 Total de Gols");
    expect(r.status).toBe("mapped");
    expect(r.market).toBe("over25");
    expect(r.side).toBe("under");
  });

  it("'Menos de 9.5 Total de Escanteios' mapeia corners-under/95", () => {
    const r = normalizeBuilderSelection("Menos de 9.5 Total de Escanteios");
    expect(r.status).toBe("mapped");
    expect(r.market).toBe("corners-under");
    expect(r.side).toBe("95");
  });

  it("'Menos de 4.5 Total de Cartões' mapeia cards-under/45", () => {
    const r = normalizeBuilderSelection("Menos de 4.5 Total de Cartões");
    expect(r.status).toBe("mapped");
    expect(r.market).toBe("cards-under");
    expect(r.side).toBe("45");
  });

  it("'1 Resultado Final' mapeia 1x2/home", () => {
    const r = normalizeBuilderSelection("1 Resultado Final");
    expect(r.status).toBe("mapped");
    expect(r.market).toBe("1x2");
    expect(r.side).toBe("home");
  });

  it("per-team SEM hífen ('Mais de 6.5 Bodo/Glimt Total de Escanteios') segue sem-mapeamento", () => {
    const r = normalizeBuilderSelection("Mais de 6.5 Bodo/Glimt Total de Escanteios");
    expect(r.status).toBe("sem-mapeamento");
  });

  it("per-team COM hífen continua sem-mapeamento (não regride)", () => {
    const r = normalizeBuilderSelection("Mais de 6.5 - Bodo/Glimt - Total de Escanteios");
    expect(r.status).toBe("sem-mapeamento");
  });
});

describe("normalizeBuilderSelection", () => {
  it("mapeia gols: 'Menos de 2.5 - Total de Gols' → over25/under, 'Mais de 2.5' → over", () => {
    expect(normalizeBuilderSelection("Menos de 2.5 - Total de Gols")).toEqual({
      label: "Menos de 2.5 - Total de Gols",
      status: "mapped",
      market: "over25",
      side: "under",
    });
    expect(normalizeBuilderSelection("Mais de 2.5 - Total de Gols")).toEqual({
      label: "Mais de 2.5 - Total de Gols",
      status: "mapped",
      market: "over25",
      side: "over",
    });
  });

  it("gols em linha ≠ 2.5 → 'linha-nao-coberta' (o modelo só tem p_over_25)", () => {
    expect(normalizeBuilderSelection("Mais de 1.5 - Total de Gols")).toEqual({
      label: "Mais de 1.5 - Total de Gols",
      status: "linha-nao-coberta",
      market: null,
      side: null,
    });
  });

  it("mapeia escanteios nas linhas canônicas 8.5/9.5/10.5", () => {
    expect(
      normalizeBuilderSelection("Menos de 9.5 - Total de Escanteios"),
    ).toEqual({
      label: "Menos de 9.5 - Total de Escanteios",
      status: "mapped",
      market: "corners-under",
      side: "95",
    });
    expect(
      normalizeBuilderSelection("Mais de 8.5 - Total de Escanteios"),
    ).toEqual({
      label: "Mais de 8.5 - Total de Escanteios",
      status: "mapped",
      market: "corners-over",
      side: "85",
    });
    expect(
      normalizeBuilderSelection("Mais de 10.5 - Escanteios"),
    ).toEqual({
      label: "Mais de 10.5 - Escanteios",
      status: "mapped",
      market: "corners-over",
      side: "105",
    });
  });

  it("escanteios fora das linhas canônicas → 'linha-nao-coberta'", () => {
    expect(
      normalizeBuilderSelection("Menos de 12.5 - Total de Escanteios"),
    ).toEqual({
      label: "Menos de 12.5 - Total de Escanteios",
      status: "linha-nao-coberta",
      market: null,
      side: null,
    });
  });

  it("mapeia cartões (3.5/4.5/5.5) e vírgula decimal", () => {
    expect(
      normalizeBuilderSelection("Menos de 4.5 - Total de Cartões"),
    ).toEqual({
      label: "Menos de 4.5 - Total de Cartões",
      status: "mapped",
      market: "cards-under",
      side: "45",
    });
    expect(normalizeBuilderSelection("Mais de 3,5 - Total de Cartões")).toEqual({
      label: "Mais de 3,5 - Total de Cartões",
      status: "mapped",
      market: "cards-over",
      side: "35",
    });
  });

  it("mapeia SOT: 'Chutes no gol' e 'Total de Finalizações no Gol' (7.5/9.5/10.5)", () => {
    expect(normalizeBuilderSelection("Mais de 7.5 - Chutes no gol")).toEqual({
      label: "Mais de 7.5 - Chutes no gol",
      status: "mapped",
      market: "sot-over",
      side: "75",
    });
    expect(
      normalizeBuilderSelection("Menos de 9.5 - Total de Finalizações no Gol"),
    ).toEqual({
      label: "Menos de 9.5 - Total de Finalizações no Gol",
      status: "mapped",
      market: "sot-under",
      side: "95",
    });
  });

  it("mapeia 1x2: '1/X/2 - Resultado Final'", () => {
    expect(normalizeBuilderSelection("1 - Resultado Final")).toEqual({
      label: "1 - Resultado Final",
      status: "mapped",
      market: "1x2",
      side: "home",
    });
    expect(normalizeBuilderSelection("X - Resultado Final")).toEqual({
      label: "X - Resultado Final",
      status: "mapped",
      market: "1x2",
      side: "draw",
    });
    expect(normalizeBuilderSelection("2 - Resultado")).toEqual({
      label: "2 - Resultado",
      status: "mapped",
      market: "1x2",
      side: "away",
    });
  });

  it("mapeia BTTS: 'Sim/Não - Ambas as Equipes Marcam' (e ordem invertida)", () => {
    expect(
      normalizeBuilderSelection("Sim - Ambas as Equipes Marcam"),
    ).toEqual({
      label: "Sim - Ambas as Equipes Marcam",
      status: "mapped",
      market: "btts",
      side: "sim",
    });
    expect(normalizeBuilderSelection("Não - Ambos Marcam")).toEqual({
      label: "Não - Ambos Marcam",
      status: "mapped",
      market: "btts",
      side: "nao",
    });
    expect(
      normalizeBuilderSelection("Ambas as Equipes Marcam - Sim"),
    ).toEqual({
      label: "Ambas as Equipes Marcam - Sim",
      status: "mapped",
      market: "btts",
      side: "sim",
    });
  });

  it("seleção por TIME (ex. escanteios do Bodo/Glimt) → 'sem-mapeamento'", () => {
    expect(
      normalizeBuilderSelection(
        "Mais de 6.5 - Bodo/Glimt - Total de Escanteios",
      ),
    ).toEqual({
      label: "Mais de 6.5 - Bodo/Glimt - Total de Escanteios",
      status: "sem-mapeamento",
      market: null,
      side: null,
    });
  });

  it("seleção desconhecida → 'sem-mapeamento'", () => {
    expect(normalizeBuilderSelection("Empate Anula - Handicap")).toEqual({
      label: "Empate Anula - Handicap",
      status: "sem-mapeamento",
      market: null,
      side: null,
    });
  });

  it("caso real CSKA Sofia: as 3 seleções do grupo mapeiam", () => {
    const sels = [
      "Menos de 2.5 - Total de Gols",
      "Menos de 9.5 - Total de Escanteios",
      "Menos de 4.5 - Total de Cartões",
    ].map(normalizeBuilderSelection);
    expect(sels.map((s) => s.status)).toEqual(["mapped", "mapped", "mapped"]);
    expect(sels.map((s) => s.market)).toEqual([
      "over25",
      "corners-under",
      "cards-under",
    ]);
    expect(sels.map((s) => s.side)).toEqual(["under", "95", "45"]);
  });
});

// ── computeGroupEdge ────────────────────────────────────────────────────────

function groupSel(over: Partial<CriticGroupSelection>): CriticGroupSelection {
  return {
    label: "x",
    status: "mapped",
    market: "over25",
    side: "under",
    probCalibrated: null,
    ...over,
  };
}

describe("computeGroupEdge", () => {
  it("prob conjunta = PRODUTO das probs mapeadas; edge = produto × odd − 1", () => {
    const out = computeGroupEdge(
      [
        groupSel({ probCalibrated: 0.5 }),
        groupSel({ probCalibrated: 0.4, market: "corners-under", side: "95" }),
      ],
      4.0,
    );
    expect(out.jointProb).toBeCloseTo(0.2, 6);
    expect(out.edgePct).toBeCloseTo(-20.0, 3);
  });

  it("ignora seleções sem prob (unmapped/linha não coberta) sem derrubar o grupo", () => {
    const out = computeGroupEdge(
      [
        groupSel({ probCalibrated: 0.5 }),
        groupSel({ status: "sem-mapeamento", market: null, side: null }),
        groupSel({ status: "linha-nao-coberta", market: null, side: null }),
      ],
      2.5,
    );
    expect(out.jointProb).toBeCloseTo(0.5, 6);
    expect(out.edgePct).toBeCloseTo(25.0, 3);
  });

  it("nenhuma prob disponível → jointProb e edge null", () => {
    const out = computeGroupEdge(
      [groupSel({ status: "sem-mapeamento", market: null, side: null })],
      3.0,
    );
    expect(out.jointProb).toBeNull();
    expect(out.edgePct).toBeNull();
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

  it("perna sem modelo com gameFinished mostra 'JOGO JÁ ENCERRADO' (não 'sem simulação')", () => {
    // Caso real: criticar bilhete de jogo que já rolou — a sim existe mas é
    // pré-jogo; dizer "sem simulação" é mentira, dizer "encerrado" é honesto.
    const p3 = buildCriticPrompt({
      legs: [{ ...LEG_WITHOUT_MODEL, gameFinished: true }],
      stakeTotal: null,
      oddCombined: null,
    });
    expect(p3.user).toContain("JOGO JÁ ENCERRADO");
    expect(p3.user.toLowerCase()).not.toContain("sem simulação pra este jogo");
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

  it("system instrui como criticar pernas-grupo (seleção mais fraca, correlação, linha não coberta)", () => {
    expect(prompt.system.toLowerCase()).toContain("criar aposta");
    expect(prompt.system.toLowerCase()).toContain("mais fraca");
    expect(prompt.system.toLowerCase()).toContain("correlacionad");
    expect(prompt.system.toLowerCase()).toContain("linha não coberta");
  });
});

// ── buildCriticPrompt — perna-grupo "Criar Aposta" ──────────────────────────

const GROUP_LEG: CriticLegContext = {
  home: "CSKA Sofia",
  away: "Ludogorets",
  market: "Criar Aposta",
  side: "Menos de 2.5 - Total de Gols + Menos de 9.5 - Total de Escanteios + Menos de 4.5 - Total de Cartões",
  odd: 4.0,
  model: {
    probCalibrated: 0.149,
    edgePct: -40.4,
    leagueCalibrated: false,
    league: "Bulgaria First League",
    accuracyLine: null,
  },
  group: {
    selections: [
      {
        label: "Menos de 2.5 - Total de Gols",
        status: "mapped",
        market: "over25",
        side: "under",
        probCalibrated: 0.4,
      },
      {
        label: "Menos de 9.5 - Total de Escanteios",
        status: "mapped",
        market: "corners-under",
        side: "95",
        probCalibrated: 0.458,
      },
      {
        label: "Mais de 6.5 - Bodo/Glimt - Total de Escanteios",
        status: "sem-mapeamento",
        market: null,
        side: null,
        probCalibrated: null,
      },
      {
        label: "Menos de 12.5 - Total de Escanteios",
        status: "linha-nao-coberta",
        market: null,
        side: null,
        probCalibrated: null,
      },
    ],
    jointProb: 0.1832,
    edgePct: -26.7,
  },
};

describe("buildCriticPrompt — perna-grupo", () => {
  const prompt = buildCriticPrompt({
    legs: [GROUP_LEG],
    stakeTotal: null,
    oddCombined: null,
  });

  it("lista cada seleção com sua prob calibrada ou o motivo da ausência", () => {
    expect(prompt.user).toContain("Menos de 2.5 - Total de Gols");
    expect(prompt.user).toContain("40.0%");
    expect(prompt.user).toContain("Menos de 9.5 - Total de Escanteios");
    expect(prompt.user).toContain("45.8%");
    expect(prompt.user).toContain("Mais de 6.5 - Bodo/Glimt - Total de Escanteios");
    expect(prompt.user.toLowerCase()).toContain("sem dados do modelo");
    expect(prompt.user.toLowerCase()).toContain("linha não coberta");
  });

  it("mostra o produto (prob conjunta), o edge do grupo e a cobertura parcial", () => {
    expect(prompt.user.toLowerCase()).toContain("produto");
    expect(prompt.user).toContain("18.3%");
    expect(prompt.user).toContain("-26.7%");
    // 2 de 4 seleções entraram no produto — o número cobre só parte do grupo.
    expect(prompt.user).toContain("2 de 4");
  });

  it("carrega o caveat de correlação (produto SUBestima prob de seleções do mesmo jogo)", () => {
    expect(prompt.user.toLowerCase()).toContain("correlacionad");
    expect(prompt.user.toLowerCase()).toContain("subestima");
  });

  it("grupo SEM modelo lista as seleções e marca 'sem dados do modelo'", () => {
    const p2 = buildCriticPrompt({
      legs: [
        {
          ...GROUP_LEG,
          model: null,
          group: {
            selections: GROUP_LEG.group!.selections.map((s) => ({
              ...s,
              probCalibrated: null,
            })),
            jointProb: null,
            edgePct: null,
          },
        },
      ],
      stakeTotal: null,
      oddCombined: null,
    });
    expect(p2.user).toContain("Menos de 2.5 - Total de Gols");
    expect(p2.user.toLowerCase()).toContain("sem dados do modelo");
    expect(p2.user.toLowerCase()).not.toContain("produto");
  });
});
