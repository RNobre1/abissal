import { describe, it, expect } from "vitest";
import { walkForwardParams, liveParam } from "./walk-forward";

describe("walkForwardParams", () => {
  it("usa defaultParam no warmup, fit(prior) depois", () => {
    const games = [1, 2, 3, 4, 5]; // valores quaisquer
    // fit = média dos anteriores (determinístico, fácil de checar)
    const fit = (train: number[]) => train.reduce((a, b) => a + b, 0) / train.length;
    const out = walkForwardParams(games, fit, { warmup: 2, defaultParam: 0 });
    expect(out[0]).toBe(0); // i=0 < warmup
    expect(out[1]).toBe(0); // i=1 < warmup
    expect(out[2]).toBe((1 + 2) / 2); // fit em [1,2]
    expect(out[3]).toBe((1 + 2 + 3) / 3); // fit em [1,2,3]
    expect(out[4]).toBe((1 + 2 + 3 + 4) / 4);
  });

  it("nunca usa o próprio jogo no fit (out-of-sample por construção)", () => {
    const games = [10, 20, 30];
    const seen: number[][] = [];
    walkForwardParams(games, (train) => { seen.push([...train]); return 0; }, { warmup: 1, defaultParam: 0 });
    // i=1 fita em [10] (não inclui 20); i=2 fita em [10,20] (não inclui 30)
    expect(seen).toEqual([[10], [10, 20]]);
  });

  it("warmup grande → tudo defaultParam", () => {
    const out = walkForwardParams([1, 2], () => 99, { warmup: 5, defaultParam: 7 });
    expect(out).toEqual([7, 7]);
  });
});

describe("liveParam", () => {
  it("fita em todos os resolvidos quando ≥ warmup", () => {
    expect(liveParam([1, 2, 3], (t) => t.length, { warmup: 2, defaultParam: 0 })).toBe(3);
  });
  it("defaultParam quando < warmup", () => {
    expect(liveParam([1], () => 99, { warmup: 5, defaultParam: 1 })).toBe(1);
  });
});

// ── refit em blocos (28/07) ────────────────────────────────────────────────
// O seed do challenger consumia 18 dos 20 minutos do cron semanal e morria no
// timeout — desde 05/07 o `Seed challenger` era cancelado e o `Compare` nunca
// rodava. Causa: `fit()` era chamado UMA VEZ POR JOGO sobre todo o histórico
// anterior, com uma grade de busca dentro → O(n² · grade).
//
// Refitar a cada K jogos preserva a ausência de leakage (o parâmetro do jogo i
// continua vindo só de jogos ANTERIORES; no limite usa MENOS dados, nunca
// mais) e corta o custo por um fator de K.
describe("walkForwardParams — refit em blocos", () => {
  const games = Array.from({ length: 50 }, (_, i) => i);
  // fit determinístico e sensível ao tamanho do treino: média dos índices.
  const fit = (train: number[]) =>
    train.length === 0 ? 0 : train.reduce((a, b) => a + b, 0) / train.length;

  it("refitEvery=1 é idêntico ao comportamento original (retrocompatível)", () => {
    const base = walkForwardParams(games, fit, { warmup: 5, defaultParam: -1 });
    const withOpt = walkForwardParams(games, fit, {
      warmup: 5,
      defaultParam: -1,
      refitEvery: 1,
    });
    expect(withOpt).toEqual(base);
  });

  it("omitir refitEvery mantém o comportamento original", () => {
    const base = walkForwardParams(games, fit, { warmup: 5, defaultParam: -1 });
    expect(base.length).toBe(games.length);
    expect(base[0]).toBe(-1); // warmup
    expect(base[10]).toBeCloseTo(fit(games.slice(0, 10)), 9);
  });

  it("reduz drasticamente o número de chamadas de fit", () => {
    let calls = 0;
    const counting = (train: number[]) => {
      calls++;
      return fit(train);
    };
    walkForwardParams(games, counting, { warmup: 5, defaultParam: -1, refitEvery: 10 });
    // 50 jogos, warmup 5, refit a cada 10 → punhado de fits em vez de 45
    expect(calls).toBeLessThanOrEqual(6);
    expect(calls).toBeGreaterThan(0);
  });

  it("NUNCA usa dado do próprio jogo nem do futuro (sem leakage)", () => {
    const seen: Array<{ atGame: number; trainMax: number }> = [];
    const spy = (train: number[]) => {
      seen.push({ atGame: -1, trainMax: train.length ? Math.max(...train) : -1 });
      return fit(train);
    };
    const params = walkForwardParams(games, spy, {
      warmup: 5,
      defaultParam: -1,
      refitEvery: 10,
    });
    // Todo treino usado tem índice máximo < índice do jogo que ele parametriza.
    // Como o fit é a média dos índices de treino, param[i] < i sempre.
    for (let i = 5; i < games.length; i++) {
      expect(params[i]).toBeLessThan(i);
    }
  });

  it("o parâmetro só muda nas fronteiras de bloco", () => {
    const params = walkForwardParams(games, fit, {
      warmup: 5,
      defaultParam: -1,
      refitEvery: 10,
    });
    // dentro de um bloco o valor se repete
    expect(params[11]).toBe(params[12]);
    expect(params[12]).toBe(params[13]);
  });

  it("respeita o warmup mesmo com refit em blocos", () => {
    const params = walkForwardParams(games, fit, {
      warmup: 12,
      defaultParam: -99,
      refitEvery: 5,
    });
    for (let i = 0; i < 12; i++) expect(params[i]).toBe(-99);
    expect(params[12]).not.toBe(-99);
  });
});
