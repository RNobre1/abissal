import { describe, it, expect } from "vitest";
import {
  clvPercent,
  summarizeClv,
  groupClvByLeague,
  groupClvByMarket,
  type ClvSample,
} from "./clv-metrics";

function sample(over: Partial<ClvSample> = {}): ClvSample {
  return {
    ai_recommendation_id: 1,
    league: "Premier League",
    market: "1x2",
    side: "home",
    odd_taken: 2.0,
    odd_close: 1.9,
    ...over,
  };
}

describe("clvPercent", () => {
  it("calcula CLV positivo quando peguei odd maior que a fechada", () => {
    expect(clvPercent(2.5, 2.4)).toBeCloseTo(4.1667, 3);
  });

  it("calcula CLV negativo quando peguei odd menor que a fechada", () => {
    expect(clvPercent(2.0, 2.2)).toBeCloseTo(-9.0909, 3);
  });

  it("retorna 0 quando as odds são iguais", () => {
    expect(clvPercent(2.0, 2.0)).toBe(0);
  });

  it("retorna null pra odd_close inválida (<= 0)", () => {
    expect(clvPercent(2.0, 0)).toBeNull();
    expect(clvPercent(2.0, -1.5)).toBeNull();
  });

  it("retorna null pra odd_taken inválida (<= 0)", () => {
    expect(clvPercent(0, 1.9)).toBeNull();
    expect(clvPercent(-2.0, 1.9)).toBeNull();
  });

  it("retorna null pra NaN/Infinity em qualquer lado", () => {
    expect(clvPercent(Number.NaN, 1.9)).toBeNull();
    expect(clvPercent(2.0, Number.NaN)).toBeNull();
    expect(clvPercent(Number.POSITIVE_INFINITY, 1.9)).toBeNull();
  });
});

describe("summarizeClv", () => {
  it("retorna n=0 sem amostras", () => {
    const s = summarizeClv([]);
    expect(s).toEqual({ n: 0, mean: null, ci95Lower: null, ci95Upper: null });
  });

  it("calcula média sobre amostras válidas", () => {
    const s = summarizeClv([
      sample({ odd_taken: 2.0, odd_close: 1.9 }), // ~+5.26%
      sample({ odd_taken: 2.0, odd_close: 2.0 }), // 0%
      sample({ odd_taken: 2.0, odd_close: 2.1 }), // ~-4.76%
    ]);
    expect(s.n).toBe(3);
    expect(s.mean).not.toBeNull();
    // soma: 5.26 + 0 + (-4.76) = 0.50 → média ~0.17
    expect(s.mean!).toBeCloseTo(0.17, 1);
  });

  it("ignora amostras com odd_close inválida", () => {
    const s = summarizeClv([
      sample({ odd_taken: 2.0, odd_close: 1.9 }),
      sample({ odd_taken: 2.0, odd_close: 0 }),
      sample({ odd_taken: 2.0, odd_close: -1 }),
    ]);
    expect(s.n).toBe(1);
  });

  it("calcula IC95 via sigma/sqrt(n) * 1.96 quando n >= 2", () => {
    // Amostras determinísticas pra checar fórmula. CLVs: +5%, -5%, +10%, -10%
    // → média = 0, σ ≈ 8.165 (amostra), n=4, ic95 = 1.96 * 8.165 / 2 ≈ 8.00
    const s = summarizeClv([
      sample({ odd_taken: 1.05, odd_close: 1.0 }), // +5
      sample({ odd_taken: 0.95, odd_close: 1.0 }), // -5
      sample({ odd_taken: 1.10, odd_close: 1.0 }), // +10
      sample({ odd_taken: 0.90, odd_close: 1.0 }), // -10
    ]);
    expect(s.n).toBe(4);
    expect(s.mean!).toBeCloseTo(0, 5);
    // Sample std (n-1): sqrt(((5)²+(-5)²+(10)²+(-10)²)/3) = sqrt(250/3) ≈ 9.1287
    // ic95 half-width = 1.96 * 9.1287 / sqrt(4) ≈ 8.946
    expect(s.ci95Lower!).toBeCloseTo(-8.946, 1);
    expect(s.ci95Upper!).toBeCloseTo(8.946, 1);
  });

  it("retorna IC95 null quando n=1 (sem desvio padrão)", () => {
    const s = summarizeClv([sample()]);
    expect(s.n).toBe(1);
    expect(s.ci95Lower).toBeNull();
    expect(s.ci95Upper).toBeNull();
  });
});

describe("groupClvByLeague", () => {
  it("retorna array vazio sem amostras", () => {
    expect(groupClvByLeague([])).toEqual([]);
  });

  it("agrupa por liga com média + n", () => {
    const rows = groupClvByLeague([
      sample({ league: "Premier League", odd_taken: 2.0, odd_close: 1.9 }),
      sample({ league: "Premier League", odd_taken: 2.0, odd_close: 2.0 }),
      sample({ league: "La Liga", odd_taken: 2.0, odd_close: 2.1 }),
    ]);
    expect(rows).toHaveLength(2);
    const pl = rows.find((r) => r.league === "Premier League")!;
    expect(pl.n).toBe(2);
    expect(pl.mean!).toBeGreaterThan(0);
    const ll = rows.find((r) => r.league === "La Liga")!;
    expect(ll.n).toBe(1);
    expect(ll.mean!).toBeLessThan(0);
  });

  it("ordena por volume (n) desc", () => {
    const rows = groupClvByLeague([
      sample({ league: "A" }),
      sample({ league: "B" }),
      sample({ league: "B" }),
      sample({ league: "C" }),
      sample({ league: "C" }),
      sample({ league: "C" }),
    ]);
    expect(rows.map((r) => r.league)).toEqual(["C", "B", "A"]);
  });

  it("trata league null como '(sem liga)'", () => {
    const rows = groupClvByLeague([sample({ league: null })]);
    expect(rows[0].league).toBe("(sem liga)");
  });
});

describe("groupClvByMarket", () => {
  it("agrupa por market preservando ordem fixa 1x2/over25/btts", () => {
    const rows = groupClvByMarket([
      sample({ market: "btts" }),
      sample({ market: "1x2" }),
      sample({ market: "over25" }),
      sample({ market: "1x2" }),
    ]);
    expect(rows.map((r) => r.market)).toEqual(["1x2", "over25", "btts"]);
    expect(rows.find((r) => r.market === "1x2")!.n).toBe(2);
  });

  it("omite markets sem amostras", () => {
    const rows = groupClvByMarket([sample({ market: "1x2" })]);
    expect(rows.map((r) => r.market)).toEqual(["1x2"]);
  });

  it("ignora market desconhecido", () => {
    const rows = groupClvByMarket([
      sample({ market: "1x2" }),
      // @ts-expect-error testando market inválido em runtime
      sample({ market: "asian" }),
    ]);
    expect(rows.map((r) => r.market)).toEqual(["1x2"]);
  });
});
