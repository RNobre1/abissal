/**
 * Tests para o script de backtest IA-2 (`scripts/backtest-ai-reco.ts`).
 *
 * O script propriamente dito é I/O contra Supabase — não testamos a I/O
 * aqui. Testamos as funções PURAS exportadas:
 *
 *   - evaluateBet({ market, side, homeScore, awayScore, units, odd })
 *       → { bet_won, pl_units }
 *
 *   - chooseBetForScenario(candidates, opts)
 *       → { candidate, units } | null
 *
 * São essas as funções que decidem se uma aposta venceu / qual cenário
 * substituto da IA aposta em qual candidato. Bugs aqui = backtest
 * inteiro inválido. TDD obrigatório (CLAUDE.md global).
 */
import { describe, it, expect } from "vitest";

import {
  evaluateBet,
  chooseBetForScenario,
  type ScenarioOpts,
} from "@/scripts/backtest-ai-reco";

import type { EdgeCandidate } from "@/lib/ai-reco/edge-calculator";

// ---------------------------------------------------------------------------
// evaluateBet — 7 mercados + edge cases
// ---------------------------------------------------------------------------

describe("evaluateBet", () => {
  describe("1x2/home", () => {
    it("ganha quando home_score > away_score", () => {
      const r = evaluateBet({
        market: "1x2",
        side: "home",
        homeScore: 2,
        awayScore: 1,
        units: 1.0,
        odd: 2.5,
      });
      expect(r.bet_won).toBe(true);
      // pl = units * (odd - 1) = 1 * 1.5 = 1.5
      expect(r.pl_units).toBeCloseTo(1.5, 5);
    });

    it("perde no empate", () => {
      const r = evaluateBet({
        market: "1x2",
        side: "home",
        homeScore: 1,
        awayScore: 1,
        units: 1.0,
        odd: 2.5,
      });
      expect(r.bet_won).toBe(false);
      expect(r.pl_units).toBeCloseTo(-1.0, 5);
    });

    it("perde quando home_score < away_score", () => {
      const r = evaluateBet({
        market: "1x2",
        side: "home",
        homeScore: 0,
        awayScore: 1,
        units: 0.5,
        odd: 3.0,
      });
      expect(r.bet_won).toBe(false);
      expect(r.pl_units).toBeCloseTo(-0.5, 5);
    });
  });

  describe("1x2/draw", () => {
    it("ganha em 1-1", () => {
      const r = evaluateBet({
        market: "1x2",
        side: "draw",
        homeScore: 1,
        awayScore: 1,
        units: 1.0,
        odd: 3.4,
      });
      expect(r.bet_won).toBe(true);
      expect(r.pl_units).toBeCloseTo(2.4, 5);
    });

    it("ganha em 0-0", () => {
      const r = evaluateBet({
        market: "1x2",
        side: "draw",
        homeScore: 0,
        awayScore: 0,
        units: 2.0,
        odd: 3.0,
      });
      expect(r.bet_won).toBe(true);
      expect(r.pl_units).toBeCloseTo(4.0, 5);
    });

    it("perde quando há vencedor", () => {
      const r = evaluateBet({
        market: "1x2",
        side: "draw",
        homeScore: 2,
        awayScore: 0,
        units: 1.0,
        odd: 3.0,
      });
      expect(r.bet_won).toBe(false);
      expect(r.pl_units).toBeCloseTo(-1.0, 5);
    });
  });

  describe("1x2/away", () => {
    it("ganha quando away > home", () => {
      const r = evaluateBet({
        market: "1x2",
        side: "away",
        homeScore: 0,
        awayScore: 1,
        units: 1.0,
        odd: 4.0,
      });
      expect(r.bet_won).toBe(true);
      expect(r.pl_units).toBeCloseTo(3.0, 5);
    });

    it("perde no empate e na vitória do mandante", () => {
      const r1 = evaluateBet({
        market: "1x2",
        side: "away",
        homeScore: 1,
        awayScore: 1,
        units: 1.0,
        odd: 4.0,
      });
      expect(r1.bet_won).toBe(false);
      expect(r1.pl_units).toBeCloseTo(-1.0, 5);

      const r2 = evaluateBet({
        market: "1x2",
        side: "away",
        homeScore: 3,
        awayScore: 1,
        units: 1.0,
        odd: 4.0,
      });
      expect(r2.bet_won).toBe(false);
    });
  });

  describe("over25/over", () => {
    it("ganha em 3 gols (over 2.5)", () => {
      const r = evaluateBet({
        market: "over25",
        side: "over",
        homeScore: 2,
        awayScore: 1,
        units: 1.0,
        odd: 1.85,
      });
      expect(r.bet_won).toBe(true);
      expect(r.pl_units).toBeCloseTo(0.85, 5);
    });

    it("perde em 2 gols (sob a linha)", () => {
      const r = evaluateBet({
        market: "over25",
        side: "over",
        homeScore: 1,
        awayScore: 1,
        units: 1.0,
        odd: 1.85,
      });
      expect(r.bet_won).toBe(false);
      expect(r.pl_units).toBeCloseTo(-1.0, 5);
    });

    it("perde em 0-0", () => {
      const r = evaluateBet({
        market: "over25",
        side: "over",
        homeScore: 0,
        awayScore: 0,
        units: 1.0,
        odd: 1.85,
      });
      expect(r.bet_won).toBe(false);
    });
  });

  describe("over25/under", () => {
    it("ganha em 1-1 (2 gols, sob a linha)", () => {
      const r = evaluateBet({
        market: "over25",
        side: "under",
        homeScore: 1,
        awayScore: 1,
        units: 1.0,
        odd: 2.0,
      });
      expect(r.bet_won).toBe(true);
      expect(r.pl_units).toBeCloseTo(1.0, 5);
    });

    it("perde em 2-1 (3 gols, sobre a linha)", () => {
      const r = evaluateBet({
        market: "over25",
        side: "under",
        homeScore: 2,
        awayScore: 1,
        units: 1.0,
        odd: 2.0,
      });
      expect(r.bet_won).toBe(false);
    });

    it("ganha em 0-0", () => {
      const r = evaluateBet({
        market: "over25",
        side: "under",
        homeScore: 0,
        awayScore: 0,
        units: 0.5,
        odd: 2.0,
      });
      expect(r.bet_won).toBe(true);
      expect(r.pl_units).toBeCloseTo(0.5, 5);
    });
  });

  describe("btts/sim", () => {
    it("ganha quando ambos marcam", () => {
      const r = evaluateBet({
        market: "btts",
        side: "sim",
        homeScore: 1,
        awayScore: 1,
        units: 1.0,
        odd: 1.9,
      });
      expect(r.bet_won).toBe(true);
      expect(r.pl_units).toBeCloseTo(0.9, 5);
    });

    it("perde em 2-0", () => {
      const r = evaluateBet({
        market: "btts",
        side: "sim",
        homeScore: 2,
        awayScore: 0,
        units: 1.0,
        odd: 1.9,
      });
      expect(r.bet_won).toBe(false);
    });

    it("perde em 0-0", () => {
      const r = evaluateBet({
        market: "btts",
        side: "sim",
        homeScore: 0,
        awayScore: 0,
        units: 1.0,
        odd: 1.9,
      });
      expect(r.bet_won).toBe(false);
    });
  });

  describe("btts/nao", () => {
    it("ganha em 0-0", () => {
      const r = evaluateBet({
        market: "btts",
        side: "nao",
        homeScore: 0,
        awayScore: 0,
        units: 1.0,
        odd: 2.0,
      });
      expect(r.bet_won).toBe(true);
      expect(r.pl_units).toBeCloseTo(1.0, 5);
    });

    it("ganha em 2-0", () => {
      const r = evaluateBet({
        market: "btts",
        side: "nao",
        homeScore: 2,
        awayScore: 0,
        units: 1.0,
        odd: 2.0,
      });
      expect(r.bet_won).toBe(true);
    });

    it("perde quando ambos marcam", () => {
      const r = evaluateBet({
        market: "btts",
        side: "nao",
        homeScore: 1,
        awayScore: 1,
        units: 1.0,
        odd: 2.0,
      });
      expect(r.bet_won).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("retorna nulls quando homeScore é null", () => {
      const r = evaluateBet({
        market: "1x2",
        side: "home",
        homeScore: null,
        awayScore: 1,
        units: 1.0,
        odd: 2.0,
      });
      expect(r.bet_won).toBeNull();
      expect(r.pl_units).toBeNull();
    });

    it("retorna nulls quando awayScore é null", () => {
      const r = evaluateBet({
        market: "1x2",
        side: "home",
        homeScore: 1,
        awayScore: null,
        units: 1.0,
        odd: 2.0,
      });
      expect(r.bet_won).toBeNull();
      expect(r.pl_units).toBeNull();
    });

    it("retorna nulls em market/side desconhecido", () => {
      const r = evaluateBet({
        market: "asian" as never,
        side: "+0.5" as never,
        homeScore: 1,
        awayScore: 1,
        units: 1.0,
        odd: 2.0,
      });
      expect(r.bet_won).toBeNull();
      expect(r.pl_units).toBeNull();
    });

    it("p&l usa units = 0 sem crash", () => {
      const r = evaluateBet({
        market: "1x2",
        side: "home",
        homeScore: 1,
        awayScore: 0,
        units: 0,
        odd: 3.0,
      });
      expect(r.bet_won).toBe(true);
      expect(r.pl_units).toBeCloseTo(0, 5);
    });
  });
});

// ---------------------------------------------------------------------------
// chooseBetForScenario — regra determinística substituta da IA
// ---------------------------------------------------------------------------

const baseCandidate = (over: Partial<EdgeCandidate>): EdgeCandidate => ({
  market: "1x2",
  side: "home",
  prob_estimated: 0.5,
  prob_calibrated: 0.5,
  odd: 2.0,
  edge_pct: 0,
  kelly_units: 0,
  ...over,
});

describe("chooseBetForScenario", () => {
  const cands: EdgeCandidate[] = [
    baseCandidate({ market: "1x2", side: "home", edge_pct: 8.0, odd: 2.0, prob_calibrated: 0.54 }),
    baseCandidate({ market: "btts", side: "sim", edge_pct: 18.0, odd: 1.9, prob_calibrated: 0.62 }),
    baseCandidate({ market: "over25", side: "over", edge_pct: 35.0, odd: 1.85, prob_calibrated: 0.73 }),
    baseCandidate({ market: "1x2", side: "draw", edge_pct: 3.0, odd: 3.5, prob_calibrated: 0.30 }),
  ];

  it("Cenário A — best edge ≥ 5%, liga NÃO calibrada → 0.5u", () => {
    const opts: ScenarioOpts = {
      name: "A",
      edgeMinPct: 5,
      requireCalibrated: false,
      sanityGuard: false,
    };
    const pick = chooseBetForScenario(cands, opts, { leagueCalibrated: false });
    expect(pick).not.toBeNull();
    expect(pick!.candidate.market).toBe("over25");
    expect(pick!.candidate.edge_pct).toBe(35.0);
    expect(pick!.units).toBe(0.5);
  });

  it("Cenário A — best edge ≥ 5%, liga calibrada → 2.0u", () => {
    const opts: ScenarioOpts = {
      name: "A",
      edgeMinPct: 5,
      requireCalibrated: false,
      sanityGuard: false,
    };
    const pick = chooseBetForScenario(cands, opts, { leagueCalibrated: true });
    expect(pick).not.toBeNull();
    expect(pick!.units).toBe(2.0);
  });

  it("Cenário B — sanity guard pula apostas com edge > 50 em liga não calibrada", () => {
    // Threshold v2 (2026-05-25): subido de 30 → 50 após backtest provar que
    // o range 30-50% contém winners. Edge 35% (over25) agora PASSA pelo guard.
    const candsHighEdge: EdgeCandidate[] = [
      baseCandidate({ market: "1x2", side: "home", edge_pct: 8.0, odd: 2.0, prob_calibrated: 0.54 }),
      baseCandidate({ market: "btts", side: "sim", edge_pct: 18.0, odd: 1.9, prob_calibrated: 0.62 }),
      baseCandidate({ market: "over25", side: "over", edge_pct: 35.0, odd: 1.85, prob_calibrated: 0.73 }),
      baseCandidate({ market: "1x2", side: "away", edge_pct: 60.0, odd: 3.5, prob_calibrated: 0.30 }),
    ];
    const opts: ScenarioOpts = {
      name: "B",
      edgeMinPct: 5,
      requireCalibrated: false,
      sanityGuard: true,
    };
    const pick = chooseBetForScenario(candsHighEdge, opts, {
      leagueCalibrated: false,
    });
    // 1x2/away tem 60% edge → bloqueado pelo sanity guard (> 50)
    // próximo melhor é over25/over (35%) — agora passa (era bloqueado em v1)
    expect(pick).not.toBeNull();
    expect(pick!.candidate.market).toBe("over25");
    expect(pick!.candidate.edge_pct).toBe(35.0);
  });

  it("Cenário B — sanity guard NÃO bloqueia se liga calibrada", () => {
    const candsHighEdge: EdgeCandidate[] = [
      baseCandidate({ market: "1x2", side: "home", edge_pct: 8.0, odd: 2.0, prob_calibrated: 0.54 }),
      baseCandidate({ market: "btts", side: "sim", edge_pct: 18.0, odd: 1.9, prob_calibrated: 0.62 }),
      baseCandidate({ market: "over25", side: "over", edge_pct: 35.0, odd: 1.85, prob_calibrated: 0.73 }),
      baseCandidate({ market: "1x2", side: "away", edge_pct: 60.0, odd: 3.5, prob_calibrated: 0.30 }),
    ];
    const opts: ScenarioOpts = {
      name: "B",
      edgeMinPct: 5,
      requireCalibrated: false,
      sanityGuard: true,
    };
    const pick = chooseBetForScenario(candsHighEdge, opts, {
      leagueCalibrated: true,
    });
    // sanity bypass: 1x2/away com 60% passa
    expect(pick!.candidate.market).toBe("1x2");
    expect(pick!.candidate.edge_pct).toBe(60.0);
  });

  it("Cenário C — requireCalibrated, liga NÃO calibrada → null (skip)", () => {
    const opts: ScenarioOpts = {
      name: "C",
      edgeMinPct: 5,
      requireCalibrated: true,
      sanityGuard: false,
    };
    const pick = chooseBetForScenario(cands, opts, { leagueCalibrated: false });
    expect(pick).toBeNull();
  });

  it("Cenário C — requireCalibrated, liga calibrada → escolhe best edge", () => {
    const opts: ScenarioOpts = {
      name: "C",
      edgeMinPct: 5,
      requireCalibrated: true,
      sanityGuard: false,
    };
    const pick = chooseBetForScenario(cands, opts, { leagueCalibrated: true });
    expect(pick!.candidate.market).toBe("over25");
    expect(pick!.units).toBe(2.0);
  });

  it("Cenário D — edge ≥ 20% filtra over25 (35%) apenas", () => {
    const opts: ScenarioOpts = {
      name: "D20",
      edgeMinPct: 20,
      requireCalibrated: false,
      sanityGuard: false,
    };
    const pick = chooseBetForScenario(cands, opts, { leagueCalibrated: true });
    expect(pick!.candidate.market).toBe("over25");
  });

  it("Cenário D — edge ≥ 50% → nenhum candidato passa → null", () => {
    const opts: ScenarioOpts = {
      name: "D50",
      edgeMinPct: 50,
      requireCalibrated: false,
      sanityGuard: false,
    };
    const pick = chooseBetForScenario(cands, opts, { leagueCalibrated: true });
    expect(pick).toBeNull();
  });

  it("retorna null em lista vazia", () => {
    const opts: ScenarioOpts = {
      name: "A",
      edgeMinPct: 5,
      requireCalibrated: false,
      sanityGuard: false,
    };
    const pick = chooseBetForScenario([], opts, { leagueCalibrated: true });
    expect(pick).toBeNull();
  });
});
