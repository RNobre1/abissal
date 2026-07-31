/**
 * resolveParsedSlip — múltipla MISTA (pernas-grupo "Criar Aposta" de jogos
 * diferentes junto com pernas simples) e a guarda defensiva do redirect.
 *
 * Caso real (print Superbet 31/07): 3 pernas — grupo CSKA Sofia @4.00
 * (3 seleções), simples Valerenga @1.56, grupo Bodo/Glimt @1.95 — combinada
 * 12.16. is_bet_builder=true continua sendo SÓ cupom inteiro de um jogo;
 * múltipla mista segue o fluxo normal de revisão com builder_selections
 * preservadas por leg.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedSlip } from "@/lib/bet-slip-ocr/schema";

const matchFixtureMock = vi.fn<(args: unknown) => Promise<{ best: null; candidates: [] }>>(
  async () => ({ best: null, candidates: [] }),
);
vi.mock("@/lib/bet-slip-ocr/match-fixture", () => ({
  matchFixture: (args: unknown) => matchFixtureMock(args),
  CONFIDENCE_AUTO_LINK: 0.85,
  CONFIDENCE_MIN: 0.4,
}));

import { resolveParsedSlip } from "@/lib/bet-slip-ocr/parse-result";

function mixedSlip(): ParsedSlip {
  return {
    legs: [
      {
        home: "CSKA 1948 Sofia",
        away: "Arda Kardzhali",
        market: "Criar Aposta",
        side: "Menos 2.5 Gols + Menos 9.5 Escanteios + Menos 4.5 Cartões",
        odd_taken: 4.0,
        league: null,
        kickoff_iso: null,
        builder_selections: [
          "Menos de 2.5 - Total de Gols",
          "Menos de 9.5 - Total de Escanteios",
          "Menos de 4.5 - Total de Cartões",
        ],
      },
      {
        home: "Valerenga",
        away: "HamKam",
        market: "1X2",
        side: "Casa",
        odd_taken: 1.56,
        league: null,
        kickoff_iso: null,
        builder_selections: null,
      },
      {
        home: "Bodo/Glimt",
        away: "Lillestrom",
        market: "Criar Aposta",
        side: "Casa + Mais 6.5 Escanteios Bodo/Glimt",
        odd_taken: 1.95,
        league: null,
        kickoff_iso: null,
        builder_selections: ["1 - Resultado Final", "Mais de 6.5 - Escanteios Bodo/Glimt"],
      },
    ],
    stake_total: 10,
    odd_combined: 12.16,
    house_detected: "superbet",
    is_bet_builder: false,
  };
}

beforeEach(() => {
  matchFixtureMock.mockClear();
});

describe("resolveParsedSlip — múltipla mista", () => {
  it("NÃO redireciona: segue o fluxo de revisão com as 3 legs e builder_selections preservadas", async () => {
    const result = await resolveParsedSlip(mixedSlip());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redirect_to).toBeUndefined();
    expect(result.slip!.legs).toHaveLength(3);
    expect(result.slip!.legs[0].parsed.builder_selections).toHaveLength(3);
    expect(result.slip!.legs[1].parsed.builder_selections).toBeNull();
    expect(result.slip!.legs[2].parsed.odd_taken).toBe(1.95);
    expect(result.slip!.odd_combined).toBe(12.16);
  });

  it("guarda defensiva: is_bet_builder=true com MAIS de um jogo distinto NÃO redireciona (trata como múltipla)", async () => {
    const slip = { ...mixedSlip(), is_bet_builder: true };
    const result = await resolveParsedSlip(slip);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redirect_to).toBeUndefined();
    expect(result.slip!.legs).toHaveLength(3);
  });

  it("is_bet_builder=true com UM jogo só continua redirecionando pro builder", async () => {
    const slip: ParsedSlip = {
      legs: [
        {
          home: "CSKA 1948 Sofia",
          away: "Arda Kardzhali",
          market: "Total de Gols",
          side: "Menos de 2.5",
          odd_taken: null,
          league: null,
          kickoff_iso: null,
          builder_selections: null,
        },
        {
          home: "CSKA 1948 Sofia",
          away: "Arda Kardzhali",
          market: "Total de Escanteios",
          side: "Menos de 9.5",
          odd_taken: null,
          league: null,
          kickoff_iso: null,
          builder_selections: null,
        },
      ],
      stake_total: 10,
      odd_combined: 4.0,
      house_detected: "superbet",
      is_bet_builder: true,
    };
    const result = await resolveParsedSlip(slip);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redirect_to).toContain("/bilhete/builder?");
  });
});
