import { describe, it, expect } from "vitest";
import {
  rankDuploGreen,
  rankCornersBothHalves,
  scanKey,
  type ScanFixture,
} from "./pre-match-scan";

function f(over: Partial<ScanFixture>): ScanFixture {
  return {
    fixtureId: null,
    homeTeam: "A",
    awayTeam: "B",
    league: "L",
    kickoffUtc: "2026-05-31T18:00:00Z",
    perHalfAvailable: true,
    pDuploGreen: null,
    pDuploGreenHome: null,
    pDuploGreenAway: null,
    pBoth2CornersBothHalves: null,
    ...over,
  };
}

describe("rankDuploGreen", () => {
  it("ordena desc por p_duplo_green e exclui NULL", () => {
    const out = rankDuploGreen([
      f({ homeTeam: "X", pDuploGreen: 0.05 }),
      f({ homeTeam: "Y", pDuploGreen: 0.12 }),
      f({ homeTeam: "Z", pDuploGreen: null }), // excluído
      f({ homeTeam: "W", pDuploGreen: 0.08 }),
    ]);
    expect(out.map((r) => r.fixture.homeTeam)).toEqual(["Y", "W", "X"]);
    expect(out[0].prob).toBeCloseTo(0.12, 6);
  });

  it("respeita o limite (top-N)", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      f({ homeTeam: `T${i}`, pDuploGreen: i / 100 }),
    );
    expect(rankDuploGreen(many, new Map(), 10)).toHaveLength(10);
  });

  it("desempate determinístico por nome quando prob igual", () => {
    const out = rankDuploGreen([
      f({ homeTeam: "Beta", pDuploGreen: 0.1 }),
      f({ homeTeam: "Alpha", pDuploGreen: 0.1 }),
    ]);
    expect(out.map((r) => r.fixture.homeTeam)).toEqual(["Alpha", "Beta"]);
  });

  it("anexa sidecar pela chave", () => {
    const fix = f({ homeTeam: "X", pDuploGreen: 0.1 });
    const side = {
      home: { made: 1, eligible: 5, rate: 0.2 },
      away: { made: 0, eligible: 5, rate: 0 },
    };
    const out = rankDuploGreen([fix], new Map([[scanKey(fix), side]]));
    expect(out[0].sidecar).toEqual(side);
  });
});

describe("rankCornersBothHalves", () => {
  it("ordena desc e exclui NULL (inclui per_half_available=false ⇒ NULL)", () => {
    const out = rankCornersBothHalves([
      f({ homeTeam: "X", pBoth2CornersBothHalves: 0.3 }),
      f({ homeTeam: "Y", perHalfAvailable: false, pBoth2CornersBothHalves: null }), // excluído
      f({ homeTeam: "Z", pBoth2CornersBothHalves: 0.5 }),
    ]);
    expect(out.map((r) => r.fixture.homeTeam)).toEqual(["Z", "X"]);
  });
});

describe("scanKey", () => {
  it("usa home|away|dia-UTC", () => {
    expect(
      scanKey({ homeTeam: "A", awayTeam: "B", kickoffUtc: "2026-05-31T18:00:00Z" }),
    ).toBe("A|B|2026-05-31");
  });
  it("tolera kickoff null", () => {
    expect(scanKey({ homeTeam: "A", awayTeam: "B", kickoffUtc: null })).toBe("A|B|");
  });
});
