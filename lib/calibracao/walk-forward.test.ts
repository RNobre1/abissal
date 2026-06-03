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
