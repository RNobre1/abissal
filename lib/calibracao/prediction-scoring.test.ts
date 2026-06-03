import { describe, it, expect } from "vitest";
import {
  logLoss,
  brier,
  rps1x2Score,
  poissonPmf,
} from "./prediction-scoring";

// ── poissonPmf ─────────────────────────────────────────────────────────────────

describe("poissonPmf", () => {
  it("P(X=0 | λ=1) ≈ e⁻¹", () => {
    expect(poissonPmf(1, 0)).toBeCloseTo(Math.exp(-1), 9);
  });

  it("P(X=1 | λ=1) ≈ e⁻¹", () => {
    expect(poissonPmf(1, 1)).toBeCloseTo(Math.exp(-1), 9);
  });

  it("k negativo → 0", () => {
    expect(poissonPmf(5, -1)).toBe(0);
  });

  it("mean muito pequeno usa clamp e não crashar", () => {
    expect(poissonPmf(0, 0)).toBeGreaterThan(0);
  });
});

// ── logLoss ────────────────────────────────────────────────────────────────────

describe("logLoss — mercado 1x2", () => {
  it("previsão perfeita (p=1) → logLoss≈0", () => {
    const ll = logLoss("1x2", { home: 1, draw: 0, away: 0 }, { result: "home" });
    expect(ll).toBeCloseTo(0, 5);
  });

  it("previsão ruim (p=1e-9) → logLoss alto (≈20.7)", () => {
    const ll = logLoss("1x2", { home: 1e-9, draw: 0.5, away: 0.5 - 1e-9 }, { result: "home" });
    expect(ll).toBeGreaterThan(15);
  });

  it("acerta draw → usa probs.draw", () => {
    const ll = logLoss("1x2", { home: 0.3, draw: 0.5, away: 0.2 }, { result: "draw" });
    expect(ll).toBeCloseTo(-Math.log(0.5), 9);
  });

  it("probs[result]=0 → usa floor 1e-9 (não Infinity)", () => {
    const ll = logLoss("1x2", { home: 0, draw: 0.5, away: 0.5 }, { result: "home" });
    expect(Number.isFinite(ll)).toBe(true);
    expect(ll).toBeGreaterThan(15);
  });
});

describe("logLoss — mercado over25", () => {
  it("previsão perfeita over → logLoss≈0", () => {
    expect(logLoss("over25", { over: 1, under: 0 }, { over: true })).toBeCloseTo(0, 5);
  });

  it("prevê under=0.8 e sai under → usa 0.8", () => {
    const ll = logLoss("over25", { over: 0.2, under: 0.8 }, { over: false });
    expect(ll).toBeCloseTo(-Math.log(0.8), 9);
  });

  it("over=0.5 → log(0.5)≈0.693", () => {
    const ll = logLoss("over25", { over: 0.5, under: 0.5 }, { over: true });
    expect(ll).toBeCloseTo(Math.log(2), 9);
  });
});

describe("logLoss — mercado btts", () => {
  it("previsão perfeita (sim=1, outcome btts=true) → logLoss≈0", () => {
    expect(logLoss("btts", { sim: 1, nao: 0 }, { btts: true })).toBeCloseTo(0, 5);
  });

  it("btts=false usa probs.nao", () => {
    const ll = logLoss("btts", { sim: 0.3, nao: 0.7 }, { btts: false });
    expect(ll).toBeCloseTo(-Math.log(0.7), 9);
  });
});

describe("logLoss — mercado scoreline", () => {
  it("placar real está na lista → usa prob da lista", () => {
    const probs = [
      { score: "1-1", prob: 0.12 },
      { score: "1-0", prob: 0.09 },
    ];
    const ll = logLoss("scoreline", probs, { score: "1-1" });
    expect(ll).toBeCloseTo(-Math.log(0.12), 9);
  });

  it("placar ausente na lista → usa massa-restante", () => {
    // Σprob = 0.12+0.09 = 0.21 → massa-restante = 0.79
    const probs = [
      { score: "1-1", prob: 0.12 },
      { score: "1-0", prob: 0.09 },
    ];
    const ll = logLoss("scoreline", probs, { score: "9-9" });
    expect(ll).toBeCloseTo(-Math.log(0.79), 9);
  });

  it("lista vazia → massa-restante=1 → logLoss≈0", () => {
    const ll = logLoss("scoreline", [], { score: "0-0" });
    expect(ll).toBeCloseTo(0, 5);
  });

  it("probs somam 1 e placar ausente → usa floor 1e-9", () => {
    const probs = [
      { score: "1-0", prob: 0.6 },
      { score: "2-0", prob: 0.4 },
    ];
    const ll = logLoss("scoreline", probs, { score: "9-9" });
    expect(Number.isFinite(ll)).toBe(true);
    expect(ll).toBeGreaterThan(15); // −ln(1e-9)≈20.7
  });
});

describe("logLoss — mercados de contagem (corners/cards/sot)", () => {
  it("total=mean (média esperada) → logLoss razoável (não-zero mas finito)", () => {
    const ll = logLoss("corners", { mean: 9.5 }, { total: 10 });
    expect(Number.isFinite(ll)).toBe(true);
    expect(ll).toBeGreaterThan(0);
  });

  it("previsão exata (total ≈ round(mean)) → logLoss baixo", () => {
    // Poisson(9,9) → P(X=10) é razoável (~0.12); logLoss deve ser <4
    const ll = logLoss("corners", { mean: 10 }, { total: 10 });
    expect(ll).toBeLessThan(5);
  });

  it("total muito distante da média → logLoss alto", () => {
    // Poisson(1, 100) → prob ≈ 0 → logLoss alto
    const ll = logLoss("corners", { mean: 1 }, { total: 100 });
    expect(ll).toBeGreaterThan(15);
  });

  it("mean=0 usa clamp → não crashar", () => {
    const ll = logLoss("sot", { mean: 0 }, { total: 5 });
    expect(Number.isFinite(ll)).toBe(true);
  });
});

// ── brier ──────────────────────────────────────────────────────────────────────

describe("brier — 1x2 multiclasse", () => {
  it("previsão perfeita home → brier=0", () => {
    expect(brier("1x2", { home: 1, draw: 0, away: 0 }, { result: "home" })).toBeCloseTo(0, 9);
  });

  it("prevê [1/3,1/3,1/3] → brier=4/9 (pior que chute certo)", () => {
    // Σ(p_i - o_i)²: home=(1/3-1)²+(1/3-0)²+(1/3-0)²= (4/9+1/9+1/9) = 6/9 ≈ 0.667
    const b = brier("1x2", { home: 1 / 3, draw: 1 / 3, away: 1 / 3 }, { result: "home" });
    expect(b).toBeCloseTo(6 / 9, 5);
  });
});

describe("brier — over25 binário", () => {
  it("previsão perfeita → brier=0", () => {
    expect(brier("over25", { over: 1, under: 0 }, { over: true })).toBeCloseTo(0, 9);
  });

  it("prevê over=0.5 → brier=0.25 (máxima incerteza)", () => {
    expect(brier("over25", { over: 0.5, under: 0.5 }, { over: true })).toBeCloseTo(0.25, 9);
  });
});

describe("brier — btts binário", () => {
  it("previsão perfeita nao → brier=0", () => {
    expect(brier("btts", { sim: 0, nao: 1 }, { btts: false })).toBeCloseTo(0, 9);
  });
});

describe("brier — mercados de contagem", () => {
  it("corners/cards/sot → retorna NaN (não aplicável)", () => {
    const b = brier("corners", { mean: 9.5 }, { total: 10 });
    expect(Number.isNaN(b)).toBe(true);
  });
});

// ── rps1x2Score ───────────────────────────────────────────────────────────────

describe("rps1x2Score", () => {
  it("previsão perfeita home → rps=0", () => {
    expect(rps1x2Score({ home: 1, draw: 0, away: 0 }, { result: "home" })).toBeCloseTo(0, 9);
  });

  it("previsão perfeita draw → rps=0", () => {
    expect(rps1x2Score({ home: 0, draw: 1, away: 0 }, { result: "draw" })).toBeCloseTo(0, 9);
  });

  it("erro distante (prevê home, sai away) → rps maior", () => {
    const far = rps1x2Score({ home: 0.8, draw: 0.1, away: 0.1 }, { result: "away" });
    const near = rps1x2Score({ home: 0.4, draw: 0.4, away: 0.2 }, { result: "draw" });
    expect(far).toBeGreaterThan(near);
  });

  it("fórmula = 0.5*[(pH-oH)²+(pH+pD-oH-oD)²]", () => {
    const pH = 0.5, pD = 0.3, pA = 0.2;
    const outcome = "away" as const;
    const oH = 0, oD = 0;
    const expected = 0.5 * ((pH - oH) ** 2 + (pH + pD - oH - oD) ** 2);
    expect(rps1x2Score({ home: pH, draw: pD, away: pA }, { result: outcome })).toBeCloseTo(expected, 9);
  });
});
