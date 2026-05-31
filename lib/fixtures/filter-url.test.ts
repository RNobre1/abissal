import { describe, it, expect } from "vitest";
import { DEFAULT_FILTER_STATE, type FilterState } from "./filter-sort";
import { encodeFilters, decodeFilters } from "./filter-url";

function state(over: Partial<FilterState> = {}): FilterState {
  return { ...DEFAULT_FILTER_STATE, ...over };
}

describe("encodeFilters", () => {
  it("estado default -> string vazia (URL limpa)", () => {
    expect(encodeFilters(DEFAULT_FILTER_STATE)).toBe("");
  });

  it("inclui só os campos não-default", () => {
    const qs = encodeFilters(state({ sort: "edge", hideOff: true }));
    expect(qs).toContain("sort=edge");
    expect(qs).toContain("off=1");
    expect(qs).not.toContain("view=");
    expect(qs).not.toContain("hs=");
  });
});

describe("decodeFilters", () => {
  it("string vazia -> {}", () => {
    expect(decodeFilters("")).toEqual({});
  });

  it("round-trip preserva o estado", () => {
    const s = state({
      view: "flat",
      sort: "edge",
      leagues: ["Premier League|england", "Serie A|brazil"],
      ia: ["bet", "novalue"],
      minEdge: 8,
      highSignalOnly: true,
      hideOff: true,
      query: "fla",
    });
    const decoded = decodeFilters(encodeFilters(s));
    expect({ ...DEFAULT_FILTER_STATE, ...decoded }).toEqual(s);
  });

  it("preserva keys de liga com '|' e nomes com espaço", () => {
    const decoded = decodeFilters(encodeFilters(state({ leagues: ["La Liga|spain"] })));
    expect(decoded.leagues).toEqual(["La Liga|spain"]);
  });

  it("ignora edge inválido", () => {
    expect(decodeFilters("edge=abc").minEdge).toBeUndefined();
  });
});
