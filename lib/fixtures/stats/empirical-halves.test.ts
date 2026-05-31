import { describe, it, expect } from "vitest";
import {
  corners2PlusBothHalvesRate,
  goals2PlusInHalfRate,
  corners2PlusInHalfRate,
  blewHalftime2LeadRate,
} from "./empirical-halves";
import type { NormalizedRecentMatch } from "./detail-json-types";

/** Constrói um match normalizado só com os campos relevantes (resto null). */
function m(over: Partial<NormalizedRecentMatch>): NormalizedRecentMatch {
  return {
    id: 0,
    date_iso: "2026-05-01",
    opponent: "X",
    is_home: true,
    result: null,
    goals_1h_for: null,
    goals_2h_for: null,
    goals_1h_against: null,
    goals_2h_against: null,
    goals_ft_for: null,
    goals_ft_against: null,
    corners_1h_for: null,
    corners_2h_for: null,
    corners_1h_against: null,
    corners_2h_against: null,
    corners_for: null,
    corners_against: null,
    cards_1h_for: null,
    cards_2h_for: null,
    cards_1h_against: null,
    cards_2h_against: null,
    cards_for: null,
    cards_against: null,
    sot_for: null,
    sot_against: null,
    shots_for: null,
    shots_against: null,
    booking_points_for: null,
    booking_points_against: null,
    fouls_for: null,
    fouls_against: null,
    offsides_for: null,
    offsides_against: null,
    ...over,
  };
}

describe("corners2PlusBothHalvesRate", () => {
  it("conta só jogos com AMBOS os tempos preenchidos (subset ~53%)", () => {
    const matches = [
      m({ corners_1h_for: 3, corners_2h_for: 4 }), // ✓ 2+/2+
      m({ corners_1h_for: 1, corners_2h_for: 5 }), // ✗ (1h<2)
      m({ corners_1h_for: 2, corners_2h_for: 2 }), // ✓ (exatamente 2)
      m({ corners_1h_for: null, corners_2h_for: 4 }), // não elegível (1h null)
      m({ corners_1h_for: 5, corners_2h_for: null }), // não elegível (2h null)
    ];
    const r = corners2PlusBothHalvesRate(matches);
    expect(r.eligible).toBe(3);
    expect(r.made).toBe(2);
    expect(r.rate).toBeCloseTo(2 / 3, 6);
  });

  it("sem elegíveis → rate null (honesto, não zero)", () => {
    const r = corners2PlusBothHalvesRate([m({}), m({ corners_1h_for: 3 })]);
    expect(r.eligible).toBe(0);
    expect(r.rate).toBeNull();
  });

  it("threshold customizável", () => {
    const matches = [m({ corners_1h_for: 3, corners_2h_for: 3 })];
    expect(corners2PlusBothHalvesRate(matches, 4).made).toBe(0);
    expect(corners2PlusBothHalvesRate(matches, 3).made).toBe(1);
  });
});

describe("goals2PlusInHalfRate", () => {
  it("1º tempo: usa goals_1h_for", () => {
    const matches = [
      m({ goals_1h_for: 2 }), // ✓
      m({ goals_1h_for: 1 }), // ✗
      m({ goals_1h_for: 3 }), // ✓
      m({ goals_1h_for: null }), // não elegível
    ];
    const r = goals2PlusInHalfRate(matches, "1h");
    expect(r.eligible).toBe(3);
    expect(r.made).toBe(2);
  });

  it("2º tempo: usa goals_2h_for", () => {
    const matches = [m({ goals_2h_for: 2 }), m({ goals_2h_for: 0 })];
    const r = goals2PlusInHalfRate(matches, "2h");
    expect(r.eligible).toBe(2);
    expect(r.made).toBe(1);
  });
});

describe("corners2PlusInHalfRate", () => {
  it("conta por tempo, elegível só com o tempo preenchido", () => {
    const matches = [
      m({ corners_1h_for: 2 }),
      m({ corners_1h_for: 1 }),
      m({ corners_1h_for: null }),
    ];
    const r = corners2PlusInHalfRate(matches, "1h");
    expect(r.eligible).toBe(2);
    expect(r.made).toBe(1);
  });
});

describe("blewHalftime2LeadRate (duplo-green empírico, parcial via HT)", () => {
  it("conta quando abriu 2+ no HT E não venceu (L ou D)", () => {
    const matches = [
      m({ goals_1h_for: 2, goals_1h_against: 0, result: "D" }), // ✓ abriu 2, empatou
      m({ goals_1h_for: 3, goals_1h_against: 1, result: "L" }), // ✓ abriu 2, perdeu
      m({ goals_1h_for: 2, goals_1h_against: 0, result: "W" }), // ✗ abriu 2 mas venceu
      m({ goals_1h_for: 1, goals_1h_against: 0, result: "D" }), // ✗ não abriu 2
      m({ goals_1h_for: null, goals_1h_against: 0, result: "D" }), // não elegível
    ];
    const r = blewHalftime2LeadRate(matches);
    expect(r.eligible).toBe(4); // 4 com HT+result; o de HT null fora
    expect(r.made).toBe(2);
    expect(r.rate).toBeCloseTo(2 / 4, 6);
  });

  it("sem dados de HT/resultado → rate null", () => {
    const r = blewHalftime2LeadRate([m({ result: "W" })]); // HT null
    expect(r.eligible).toBe(0);
    expect(r.rate).toBeNull();
  });
});
