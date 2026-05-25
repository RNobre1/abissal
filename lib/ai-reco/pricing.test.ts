import { describe, it, expect } from "vitest";
import { computeCostUsd, MODEL_PRICING_USD_PER_1M_TOKENS } from "./pricing";

describe("computeCostUsd", () => {
  it("calcula custo correto pra deepseek-r1", () => {
    // R1: in=$0.55/M, out=$2.19/M
    // 10k input + 2k output = 0.0055 + 0.00438 = 0.00988
    expect(computeCostUsd("deepseek/deepseek-r1", 10_000, 2_000)).toBeCloseTo(0.00988, 5);
  });

  it("retorna 0 pra modelo desconhecido", () => {
    expect(computeCostUsd("foo/bar", 1000, 1000)).toBe(0);
  });

  it("trata 0 tokens", () => {
    expect(computeCostUsd("deepseek/deepseek-r1", 0, 0)).toBe(0);
  });

  it("expõe tabela de preços", () => {
    expect(MODEL_PRICING_USD_PER_1M_TOKENS["deepseek/deepseek-r1"]).toEqual({ in: 0.55, out: 2.19 });
  });
});
