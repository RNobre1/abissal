import { describe, it, expect } from "vitest";
import { isHighSignal, HIGH_SIGNAL_MIN_BADGES } from "./is-high-signal";

describe("isHighSignal", () => {
  it("≥2 badges → true", () => {
    expect(isHighSignal(["cartao-alto", "over-alto"])).toBe(true);
    expect(isHighSignal(["cartao-alto", "over-alto", "btts-alto"])).toBe(true);
  });
  it("0 ou 1 badge → false", () => {
    expect(isHighSignal([])).toBe(false);
    expect(isHighSignal(["over-alto"])).toBe(false);
  });
  it("threshold é o único ponto de decisão (constante exportada)", () => {
    expect(HIGH_SIGNAL_MIN_BADGES).toBe(2);
  });
  it("entrada não-array → false (defensivo)", () => {
    // @ts-expect-error teste de robustez
    expect(isHighSignal(undefined)).toBe(false);
  });
});
