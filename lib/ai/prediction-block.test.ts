import { describe, it, expect } from "vitest";
import { extractPrediction } from "./prediction-block";

const wrap = (j: string) => `Análise...\n\n\`\`\`json\n${j}\n\`\`\``;

describe("extractPrediction", () => {
  it("bloco válido → objeto normalizado", () => {
    expect(
      extractPrediction(
        wrap('{"prediction":{"winner":"home","confidence":0.7,"over_under_2_5":"over"}}'),
      ),
    ).toEqual({ winner: "home", confidence: 0.7, over_under_2_5: "over" });
  });

  it("sem bloco → null", () => {
    expect(extractPrediction("só prosa, nenhuma predição")).toBeNull();
  });

  it("JSON malformado → null (defensivo, nunca lança)", () => {
    expect(extractPrediction(wrap("{nao eh json"))).toBeNull();
  });

  it("não-objeto / array → null", () => {
    expect(extractPrediction(wrap("[1,2,3]"))).toBeNull();
  });

  it("winner inválido → null", () => {
    expect(
      extractPrediction(
        wrap('{"prediction":{"winner":"xpto","confidence":0.5,"over_under_2_5":"over"}}'),
      ),
    ).toBeNull();
  });

  it("confidence fora de [0,1] → clamp", () => {
    expect(
      extractPrediction(
        wrap('{"prediction":{"winner":"draw","confidence":1.5,"over_under_2_5":"under"}}'),
      ),
    ).toEqual({ winner: "draw", confidence: 1, over_under_2_5: "under" });
  });

  it("over_under_2_5 inválido → null", () => {
    expect(
      extractPrediction(
        wrap('{"prediction":{"winner":"away","confidence":0.6,"over_under_2_5":"maybe"}}'),
      ),
    ).toBeNull();
  });

  it("pega o ÚLTIMO bloco json quando há vários", () => {
    const text = `
\`\`\`json
{"prediction":{"winner":"home","confidence":0.5,"over_under_2_5":"under"}}
\`\`\`
Análise...
\`\`\`json
{"prediction":{"winner":"away","confidence":0.9,"over_under_2_5":"over"}}
\`\`\``;
    expect(extractPrediction(text)).toEqual({
      winner: "away",
      confidence: 0.9,
      over_under_2_5: "over",
    });
  });

  it("confidence negativa → clamp para 0", () => {
    expect(
      extractPrediction(
        wrap('{"prediction":{"winner":"home","confidence":-0.3,"over_under_2_5":"over"}}'),
      ),
    ).toEqual({ winner: "home", confidence: 0, over_under_2_5: "over" });
  });
});
