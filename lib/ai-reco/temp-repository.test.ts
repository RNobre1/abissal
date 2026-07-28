import { describe, it, expect } from "vitest";
import { getTemperature, tFromPairs } from "./temp-repository";

// Espelha temp_lookup_spec.rb — os dois caminhos precisam ler o mesmo dado
// da mesma forma (B16/B25).
function sbWith(rows: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: async () => ({ data: rows, error: null }),
        }),
      }),
    }),
  };
}

describe("tFromPairs", () => {
  it("extrai T de [[1, T]]", () => {
    expect(tFromPairs([[1, 1.7]])).toBeCloseTo(1.7, 9);
  });
  it("aceita string JSON", () => {
    expect(tFromPairs("[[1, 2.15]]")).toBeCloseTo(2.15, 9);
  });
  it("rejeita malformado, não-numérico e não-positivo", () => {
    expect(tFromPairs([])).toBeNull();
    expect(tFromPairs([[1]])).toBeNull();
    expect(tFromPairs([[1, "x"]])).toBeNull();
    expect(tFromPairs([[1, 0]])).toBeNull();
    expect(tFromPairs([[0, 2]])).toBeNull();
    expect(tFromPairs("nao-json")).toBeNull();
  });
});

describe("getTemperature", () => {
  it("carrega o T de cada mercado principal", async () => {
    const out = await getTemperature("v7", sbWith([
      { metric: "1x2-temp", pairs: [[1, 1.7]] },
      { metric: "over25-temp", pairs: [[1, 2.15]] },
      { metric: "btts-temp", pairs: [[1, 2.6]] },
    ]));
    expect(out["1x2"]).toBeCloseTo(1.7, 6);
    expect(out.over25).toBeCloseTo(2.15, 6);
    expect(out.btts).toBeCloseTo(2.6, 6);
  });

  it("ignora métricas que não são -temp (isotônica e -dist)", async () => {
    const out = await getTemperature("v7", sbWith([
      { metric: "over25", pairs: [[0.1, 0.2]] },
      { metric: "corners-dist", pairs: [[9, 9.5]] },
      { metric: "over25-temp", pairs: [[1, 2.15]] },
    ]));
    expect(Object.keys(out)).toEqual(["over25"]);
  });

  it("ignora mercado desconhecido (corners usa o k, não o T)", async () => {
    const out = await getTemperature("v7", sbWith([{ metric: "corners-temp", pairs: [[1, 2]] }]));
    expect(out).toEqual({});
  });

  it("devolve {} sem modelVersion", async () => {
    expect(await getTemperature("", sbWith([]))).toEqual({});
  });

  it("nunca lança — erro do supabase vira {}", async () => {
    const boom = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: async () => {
              throw new Error("boom");
            },
          }),
        }),
      }),
    };
    expect(await getTemperature("v7", boom)).toEqual({});
  });
});
