/**
 * Tests para refit in-memory + bootstrap IC do backtest walk-forward
 * (`scripts/backtest-walk-forward.ts`).
 *
 * Por que in-memory e não usar `lib/calibracao/*`?
 * O fit batch em prod usa o estado ATUAL do banco (`getActiveCurves` +
 * `league_parameters` ativos). O walk-forward precisa de calibração com
 * histórico-só-até-t — recriamos as funções aqui aceitando samples
 * arbitrários, sem tocar Supabase.
 *
 * TDD obrigatório (CLAUDE.md global): bugs nessas funções = backtest
 * inteiro inválido (de novo).
 */
import { describe, it, expect } from "vitest";

import {
  refitIsotonicFromSamples,
  refitLeagueParamsFromSamples,
  bootstrapCi95,
  brierDecompose,
  type WfSample,
} from "@/scripts/backtest-walk-forward";

import { applyIsotonic } from "@/lib/calibracao/isotonic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSample(over: Partial<WfSample>): WfSample {
  return {
    league: "League A",
    p_home: 0.5,
    p_draw: 0.25,
    p_away: 0.25,
    p_over_25: 0.5,
    p_btts: 0.5,
    home_goals: 1,
    away_goals: 1,
    resolved_at: new Date("2026-01-01").toISOString(),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// refitIsotonicFromSamples
// ---------------------------------------------------------------------------

describe("refitIsotonicFromSamples", () => {
  it("retorna 4 curvas (1x2-home, draw, away, over25) com pares ordenados", () => {
    // 200 samples sintéticas: 100 com p_home alto + win home, 100 com p_home
    // baixo + win away — isotonic deve ser monotônico não-decrescente.
    const samples: WfSample[] = [];
    for (let i = 0; i < 100; i++) {
      samples.push(
        makeSample({
          p_home: 0.7,
          p_draw: 0.2,
          p_away: 0.1,
          p_over_25: 0.55,
          home_goals: 2,
          away_goals: 1,
        }),
      );
    }
    for (let i = 0; i < 100; i++) {
      samples.push(
        makeSample({
          p_home: 0.2,
          p_draw: 0.3,
          p_away: 0.5,
          p_over_25: 0.4,
          home_goals: 0,
          away_goals: 1,
        }),
      );
    }
    const out = refitIsotonicFromSamples(samples);
    expect(out.pairs1x2Home).toBeDefined();
    expect(out.pairsDraw).toBeDefined();
    expect(out.pairsAway).toBeDefined();
    expect(out.pairsOver25).toBeDefined();

    // Monotonicidade: y_i <= y_{i+1} pra cada curva
    for (const curve of [
      out.pairs1x2Home!,
      out.pairsDraw!,
      out.pairsAway!,
      out.pairsOver25!,
    ]) {
      for (let i = 1; i < curve.length; i++) {
        expect(curve[i][1]).toBeGreaterThanOrEqual(curve[i - 1][1]);
      }
    }
  });

  it("PAV bate frequência empírica em datasets simples (n=2 grupos)", () => {
    // Grupo 1: p=0.3, 50% wins. Grupo 2: p=0.7, 80% wins.
    // PAV deve achar exatamente 0.5 e 0.8 nesses dois pontos.
    const samples: WfSample[] = [];
    // grupo 1: 100 amostras, p_home=0.3, win_home_rate=0.5
    for (let i = 0; i < 100; i++) {
      samples.push(
        makeSample({
          p_home: 0.3,
          p_draw: 0.4,
          p_away: 0.3,
          home_goals: i < 50 ? 2 : 0,
          away_goals: 1,
        }),
      );
    }
    // grupo 2: 100 amostras, p_home=0.7, win_home_rate=0.8
    for (let i = 0; i < 100; i++) {
      samples.push(
        makeSample({
          p_home: 0.7,
          p_draw: 0.2,
          p_away: 0.1,
          home_goals: i < 80 ? 2 : 0,
          away_goals: 1,
        }),
      );
    }
    const out = refitIsotonicFromSamples(samples);
    // applyIsotonic em p=0.3 deve devolver ~0.5; em p=0.7 deve devolver ~0.8
    const cal3 = applyIsotonic(out.pairs1x2Home!, 0.3);
    const cal7 = applyIsotonic(out.pairs1x2Home!, 0.7);
    expect(cal3).toBeCloseTo(0.5, 5);
    expect(cal7).toBeCloseTo(0.8, 5);
  });

  it("retorna undefined pra curvas com n<30 (mínimo do fit em prod)", () => {
    const tiny: WfSample[] = [];
    for (let i = 0; i < 10; i++) {
      tiny.push(makeSample({}));
    }
    const out = refitIsotonicFromSamples(tiny);
    expect(out.pairs1x2Home).toBeUndefined();
    expect(out.pairsDraw).toBeUndefined();
    expect(out.pairsAway).toBeUndefined();
    expect(out.pairsOver25).toBeUndefined();
  });

  it("ignora samples sem prob (p_home null) sem crash", () => {
    const samples: WfSample[] = [];
    for (let i = 0; i < 50; i++) {
      samples.push(
        makeSample({
          p_home: i < 25 ? null : 0.5,
          p_draw: 0.25,
          p_away: 0.25,
          home_goals: 1,
          away_goals: 0,
        }),
      );
    }
    const out = refitIsotonicFromSamples(samples);
    // só 25 samples válidas (>= 30 falha pra home), deve ser undefined
    expect(out.pairs1x2Home).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// refitLeagueParamsFromSamples
// ---------------------------------------------------------------------------

describe("refitLeagueParamsFromSamples", () => {
  it("retorna params só pra ligas com n>=20", () => {
    const samples: WfSample[] = [];
    // Liga A: 25 samples (>= 20, qualifica)
    for (let i = 0; i < 25; i++) {
      samples.push(makeSample({ league: "League A", home_goals: 1, away_goals: 1 }));
    }
    // Liga B: 10 samples (< 20, pula)
    for (let i = 0; i < 10; i++) {
      samples.push(makeSample({ league: "League B", home_goals: 2, away_goals: 0 }));
    }
    const out = refitLeagueParamsFromSamples(samples);
    expect(out.has("League A")).toBe(true);
    expect(out.has("League B")).toBe(false);
  });

  it("avg_goals_home/away = média dos golos reais", () => {
    const samples: WfSample[] = [];
    for (let i = 0; i < 20; i++) {
      // home: avg 1.5, away: avg 1.0 (sums: 30, 20)
      samples.push(
        makeSample({
          league: "L",
          home_goals: i < 10 ? 2 : 1,
          away_goals: i < 10 ? 1 : 1,
        }),
      );
    }
    const out = refitLeagueParamsFromSamples(samples);
    const p = out.get("L")!;
    expect(p.avg_goals_home).toBeCloseTo(1.5, 5);
    expect(p.avg_goals_away).toBeCloseTo(1.0, 5);
  });

  it("ignora liga vazia/null", () => {
    const samples: WfSample[] = [];
    for (let i = 0; i < 25; i++) {
      samples.push(makeSample({ league: "", home_goals: 1, away_goals: 1 }));
    }
    const out = refitLeagueParamsFromSamples(samples);
    expect(out.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// bootstrapCi95
// ---------------------------------------------------------------------------

describe("bootstrapCi95", () => {
  it("IC95% de média ~ µ ± 1.96·σ/√n em distribuição normal", () => {
    // 1000 samples ~ N(0, 1). IC95% da média deve estar bem perto de
    // ±1.96/√1000 ≈ ±0.062 da média amostral.
    const rng = mulberry32(42);
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      // Box-Muller
      const u1 = Math.max(rng(), 1e-9);
      const u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      samples.push(z);
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const ci = bootstrapCi95(
      samples,
      (xs) => xs.reduce((a, b) => a + b, 0) / xs.length,
      500,
      // seed
      123,
    );
    // O CI deve abraçar a média amostral
    expect(ci.low).toBeLessThanOrEqual(mean);
    expect(ci.high).toBeGreaterThanOrEqual(mean);
    // Largura aproximada: 2 * 1.96 * (1 / √1000) ≈ 0.124
    const width = ci.high - ci.low;
    expect(width).toBeGreaterThan(0.05);
    expect(width).toBeLessThan(0.25);
  });

  it("CI vazio em array vazio", () => {
    const ci = bootstrapCi95([], (xs) => (xs.length > 0 ? xs[0] : 0), 100, 1);
    expect(ci.low).toBeNaN();
    expect(ci.high).toBeNaN();
  });

  it("CI degenerado em array unitário", () => {
    const ci = bootstrapCi95([5], (xs) => xs[0], 100, 1);
    expect(ci.low).toBe(5);
    expect(ci.high).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// brierDecompose (Murphy 1973)
// ---------------------------------------------------------------------------

describe("brierDecompose", () => {
  it("calibração perfeita → reliability ~0", () => {
    // 10 bins: p=0.0, 0.1, ..., 0.9; cada bin tem 100 obs; freq observada = p
    const probs: number[] = [];
    const outcomes: number[] = [];
    for (let k = 0; k < 10; k++) {
      const p = k / 10;
      for (let i = 0; i < 100; i++) {
        probs.push(p);
        outcomes.push(i < k * 10 ? 1 : 0); // freq = k/10 = p
      }
    }
    const d = brierDecompose(probs, outcomes, 10);
    expect(d.reliability).toBeLessThan(0.001);
  });

  it("uncertainty = base_rate * (1 - base_rate)", () => {
    // 50% base rate
    const probs: number[] = [];
    const outcomes: number[] = [];
    for (let i = 0; i < 1000; i++) {
      probs.push(0.5);
      outcomes.push(i % 2);
    }
    const d = brierDecompose(probs, outcomes, 10);
    expect(d.uncertainty).toBeCloseTo(0.25, 3);
  });

  it("brier = reliability - resolution + uncertainty", () => {
    const probs = [0.1, 0.3, 0.5, 0.7, 0.9, 0.2, 0.4, 0.6, 0.8, 0.95];
    const outcomes = [0, 0, 1, 1, 1, 0, 1, 0, 1, 1];
    const brierManual =
      probs.reduce((acc, p, i) => acc + (p - outcomes[i]) ** 2, 0) /
      probs.length;
    const d = brierDecompose(probs, outcomes, 10);
    const reconstructed = d.reliability - d.resolution + d.uncertainty;
    expect(reconstructed).toBeCloseTo(brierManual, 2);
  });
});

// ---------------------------------------------------------------------------
// Mulberry32 PRNG (determinístico para os testes)
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
