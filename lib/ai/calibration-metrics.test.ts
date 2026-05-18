import { describe, it, expect } from "vitest";
import {
  scoreWinner,
  scoreOverUnder,
  hitRate,
  calibrationBuckets,
  brierScore,
  brierScoreMulticlass,
  type ResolvedPrediction,
} from "./calibration-metrics";

// ── scoreWinner ───────────────────────────────────────────────────────────────

describe("scoreWinner", () => {
  it("home vence (2-1) → pred home = true", () => {
    expect(scoreWinner("home", 2, 1)).toBe(true);
  });
  it("empate (1-1) → pred draw = true", () => {
    expect(scoreWinner("draw", 1, 1)).toBe(true);
  });
  it("away vence (0-3) → pred away = true", () => {
    expect(scoreWinner("away", 0, 3)).toBe(true);
  });
  it("home vence mas pred é draw → false", () => {
    expect(scoreWinner("draw", 2, 1)).toBe(false);
  });
  it("empate mas pred é home → false", () => {
    expect(scoreWinner("home", 1, 1)).toBe(false);
  });
});

// ── scoreOverUnder ────────────────────────────────────────────────────────────

describe("scoreOverUnder", () => {
  it("placar 2-1 = 3 gols → over", () => {
    expect(scoreOverUnder("over", 2, 1)).toBe(true);
  });
  it("placar 1-1 = 2 gols → under (≤2.5)", () => {
    expect(scoreOverUnder("under", 1, 1)).toBe(true);
  });
  it("placar 2-1 = 3 gols, pred under → false", () => {
    expect(scoreOverUnder("under", 2, 1)).toBe(false);
  });
  it("placar 1-1 = 2 gols, pred over → false", () => {
    expect(scoreOverUnder("over", 1, 1)).toBe(false);
  });
  it("placar 3-0 = 3 gols (over), pred over → true", () => {
    expect(scoreOverUnder("over", 3, 0)).toBe(true);
  });
  it("placar 1-0 = 1 gol, pred under → true", () => {
    expect(scoreOverUnder("under", 1, 0)).toBe(true);
  });
  it("placar exato 2-0 = 2 gols → under (limite: 2.5)", () => {
    expect(scoreOverUnder("under", 2, 0)).toBe(true);
  });
  it("placar 2-1 = 3 gols (exatamente >2.5) → over", () => {
    expect(scoreOverUnder("over", 2, 1)).toBe(true);
  });
});

// ── hitRate ───────────────────────────────────────────────────────────────────

describe("hitRate", () => {
  it("sem linhas resolvidas → null", () => {
    expect(hitRate([])).toBeNull();
  });

  it("1 acerto winner, 0 over_under → {winner:1, overUnder:0}", () => {
    const rows: ResolvedPrediction[] = [
      { correct_winner: true, correct_over_under: false },
    ];
    expect(hitRate(rows)).toEqual({ winner: 1, overUnder: 0 });
  });

  it("2 rows: 1 winner certo + 1 errado → 50%", () => {
    const rows: ResolvedPrediction[] = [
      { correct_winner: true, correct_over_under: true },
      { correct_winner: false, correct_over_under: true },
    ];
    const result = hitRate(rows)!;
    expect(result.winner).toBeCloseTo(0.5);
    expect(result.overUnder).toBeCloseTo(1.0);
  });

  it("todas certas → 100%", () => {
    const rows: ResolvedPrediction[] = [
      { correct_winner: true, correct_over_under: true },
      { correct_winner: true, correct_over_under: true },
    ];
    expect(hitRate(rows)).toEqual({ winner: 1, overUnder: 1 });
  });
});

// ── calibrationBuckets ────────────────────────────────────────────────────────

describe("calibrationBuckets", () => {
  it("sem rows → retorna array vazio (nBuckets buckets todos com n=0)", () => {
    const result = calibrationBuckets([], 5);
    expect(result).toHaveLength(5);
    expect(result.every((b) => b.n === 0)).toBe(true);
  });

  it("rows concentradas em alta confiança → bucket correto tem predictedAvg alto", () => {
    // confidence=0.9 → deve cair no bucket [0.8, 1.0] (4º de 5)
    const rows: Array<ResolvedPrediction & { pred_confidence: number }> = [
      { pred_confidence: 0.9, correct_winner: true, correct_over_under: true },
      { pred_confidence: 0.85, correct_winner: false, correct_over_under: true },
    ];
    const buckets = calibrationBuckets(rows, 5);
    const highBucket = buckets[4]; // último bucket [0.8, 1.0]
    expect(highBucket.n).toBe(2);
    expect(highBucket.predictedAvg).toBeCloseTo(0.875); // média de 0.9 e 0.85
    expect(highBucket.realizedAccuracy).toBeCloseTo(0.5); // 1 de 2 acertou winner
  });

  it("default nBuckets=5 produz 5 buckets cobrindo [0,1]", () => {
    const result = calibrationBuckets([]);
    expect(result).toHaveLength(5);
    expect(result[0].range[0]).toBe(0);
    expect(result[4].range[1]).toBe(1);
  });

  it("cada bucket tem range correto para 4 buckets", () => {
    const result = calibrationBuckets([], 4);
    expect(result[0].range).toEqual([0, 0.25]);
    expect(result[1].range).toEqual([0.25, 0.5]);
    expect(result[2].range).toEqual([0.5, 0.75]);
    expect(result[3].range).toEqual([0.75, 1]);
  });

  // PostgREST pode devolver numeric(4,3) como string em vez de number.
  // Documenta o comportamento sem coerção (todos n=0) e com coerção (Number()).
  it("pred_confidence como string é ignorado (sem coerção) — n permanece 0", () => {
    // Simula PostgREST retornando "0.72" como string.
    const rows = [
      { pred_confidence: "0.72" as unknown as number, correct_winner: true, correct_over_under: true },
    ];
    const result = calibrationBuckets(rows, 5);
    // Sem coerção, typeof "0.72" !== "number" → a row é ignorada.
    expect(result.every((b) => b.n === 0)).toBe(true);
  });

  it("pred_confidence coagida via Number() é corretamente bucketizada", () => {
    // Simula o mapeamento de page.tsx: Number("0.72") antes de passar pra calibrationBuckets.
    const rows = [
      { pred_confidence: Number("0.72"), correct_winner: true, correct_over_under: true },
    ];
    const result = calibrationBuckets(rows, 5);
    // 0.72 cai no bucket 3 (index=3: [0.6, 0.8)).
    const activeBucket = result.find((b) => b.n > 0);
    expect(activeBucket).toBeDefined();
    expect(activeBucket!.n).toBe(1);
    expect(activeBucket!.realizedAccuracy).toBe(1);
  });
});

// ── brierScore (binário) ──────────────────────────────────────────────────────

describe("brierScore", () => {
  it("p=0.7, y=1 → (0.7−1)² = 0.09", () => {
    expect(brierScore(0.7, 1)).toBeCloseTo(0.09, 10);
  });
  it("p=0.7, y=0 → (0.7−0)² = 0.49", () => {
    expect(brierScore(0.7, 0)).toBeCloseTo(0.49, 10);
  });
  it("predição perfeita p=1, y=1 → 0", () => {
    expect(brierScore(1, 1)).toBe(0);
  });
  it("predição perfeita p=0, y=0 → 0", () => {
    expect(brierScore(0, 0)).toBe(0);
  });
  it("pior caso p=1, y=0 → 1", () => {
    expect(brierScore(1, 0)).toBe(1);
  });
  it("pior caso p=0, y=1 → 1", () => {
    expect(brierScore(0, 1)).toBe(1);
  });
  it("p=0.5 → 0.25 independente de y", () => {
    expect(brierScore(0.5, 0)).toBeCloseTo(0.25, 10);
    expect(brierScore(0.5, 1)).toBeCloseTo(0.25, 10);
  });
});

// ── brierScoreMulticlass (1X2) ────────────────────────────────────────────────

describe("brierScoreMulticlass", () => {
  it("{0.5,0.3,0.2}, outcome home → 0.25+0.09+0.04 = 0.38", () => {
    expect(
      brierScoreMulticlass({ home: 0.5, draw: 0.3, away: 0.2 }, "home"),
    ).toBeCloseTo(0.38, 10);
  });
  it("{0.5,0.3,0.2}, outcome draw → 0.25+0.49+0.04 = 0.78", () => {
    expect(
      brierScoreMulticlass({ home: 0.5, draw: 0.3, away: 0.2 }, "draw"),
    ).toBeCloseTo(0.78, 10);
  });
  it("{0.5,0.3,0.2}, outcome away → 0.25+0.09+0.64 = 0.98", () => {
    expect(
      brierScoreMulticlass({ home: 0.5, draw: 0.3, away: 0.2 }, "away"),
    ).toBeCloseTo(0.98, 10);
  });
  it("predição perfeita {1,0,0}, outcome home → 0", () => {
    expect(
      brierScoreMulticlass({ home: 1, draw: 0, away: 0 }, "home"),
    ).toBe(0);
  });
  it("pior caso {0,0,1}, outcome home → 1+0+1 = 2 (limite superior)", () => {
    expect(
      brierScoreMulticlass({ home: 0, draw: 0, away: 1 }, "home"),
    ).toBeCloseTo(2, 10);
  });
  it("uniforme {1/3,1/3,1/3}, qualquer outcome → 2/3", () => {
    const u = 1 / 3;
    expect(
      brierScoreMulticlass({ home: u, draw: u, away: u }, "draw"),
    ).toBeCloseTo(2 / 3, 10);
  });
});
