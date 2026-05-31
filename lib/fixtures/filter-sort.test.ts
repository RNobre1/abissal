import { describe, it, expect } from "vitest";
import type { FixtureDTO } from "./types";
import {
  DEFAULT_FILTER_STATE,
  availableLeagues,
  iaCategory,
  normalize,
  applyFiltersAndSort,
  type FilterState,
} from "./filter-sort";

function fx({ id, ...over }: Partial<FixtureDTO> & { id: number }): FixtureDTO {
  return {
    id,
    match_date: "2026-05-30",
    ko_time: "16:00",
    home_team: "Home",
    away_team: "Away",
    league: "Premier League",
    country: "england",
    source_url: null,
    has_detail: true,
    kickoff_utc: "2026-05-30T19:00:00Z",
    ...over,
  };
}

function state(over: Partial<FilterState> = {}): FilterState {
  return { ...DEFAULT_FILTER_STATE, ...over };
}

describe("normalize — busca sem acento/case", () => {
  it("remove acento e baixa caixa", () => {
    expect(normalize("São Paulo")).toBe("sao paulo");
    expect(normalize("Atlético-MG")).toBe("atletico-mg");
    expect(normalize("GRÊMIO")).toBe("gremio");
  });
});

describe("iaCategory", () => {
  it("bet > novalue > unanalyzed", () => {
    expect(iaCategory(fx({ id: 1, ai_has_bet: true }))).toBe("bet");
    expect(iaCategory(fx({ id: 1, ai_has_bet: true, ai_no_value: true }))).toBe("bet");
    expect(iaCategory(fx({ id: 1, ai_no_value: true }))).toBe("novalue");
    expect(iaCategory(fx({ id: 1 }))).toBe("unanalyzed");
  });
});

describe("availableLeagues", () => {
  it("lista ligas presentes com contagem (só as do dia)", () => {
    const opts = availableLeagues([
      fx({ id: 1, league: "Premier League", country: "england" }),
      fx({ id: 2, league: "Premier League", country: "england" }),
      fx({ id: 3, league: "Serie A", country: "brazil" }),
    ]);
    const pl = opts.find((o) => o.league === "Premier League")!;
    const sa = opts.find((o) => o.league === "Serie A")!;
    expect(pl.count).toBe(2);
    expect(pl.key).toBe("Premier League|england");
    expect(pl.flag.length).toBeGreaterThan(0);
    expect(sa.count).toBe(1);
    expect(sa.country).toBe("brazil");
  });

  it("desambigua mesma liga em países diferentes (key composta)", () => {
    const opts = availableLeagues([
      fx({ id: 1, league: "Premier League", country: "england" }),
      fx({ id: 2, league: "Premier League", country: "ukraine" }),
    ]);
    expect(opts).toHaveLength(2);
    expect(new Set(opts.map((o) => o.key)).size).toBe(2);
  });
});

describe("applyFiltersAndSort — filtros", () => {
  const data = [
    fx({ id: 1, home_team: "Arsenal", away_team: "Chelsea", league: "Premier League", country: "england", kickoff_utc: "2026-05-30T16:00:00Z", ai_has_bet: true, ai_edge_pct: 18, high_signal: true }),
    fx({ id: 2, home_team: "Flamengo", away_team: "Palmeiras", league: "Serie A", country: "brazil", kickoff_utc: "2026-05-30T21:00:00Z", ai_no_value: true }),
    fx({ id: 3, home_team: "Spurs", away_team: "Everton", league: "Premier League", country: "england", kickoff_utc: "2026-05-30T18:00:00Z", has_detail: false }),
    fx({ id: 4, home_team: "Betis", away_team: "Cádiz", league: "La Liga", country: "spain", kickoff_utc: "2026-05-30T19:00:00Z", ai_has_bet: true, ai_edge_pct: 6 }),
  ];

  it("vazio = retorna tudo (ordenado por horário asc)", () => {
    const out = applyFiltersAndSort(data, state());
    expect(out.map((f) => f.id)).toEqual([1, 3, 4, 2]);
  });

  it("filtra por liga (key composta, multi)", () => {
    const out = applyFiltersAndSort(data, state({ leagues: ["Premier League|england"] }));
    expect(out.map((f) => f.id).sort()).toEqual([1, 3]);
  });

  it("filtra por IA = bet", () => {
    const out = applyFiltersAndSort(data, state({ ia: ["bet"] }));
    expect(out.map((f) => f.id).sort()).toEqual([1, 4]);
  });

  it("filtra por IA = unanalyzed", () => {
    const out = applyFiltersAndSort(data, state({ ia: ["unanalyzed"] }));
    expect(out.map((f) => f.id)).toEqual([3]);
  });

  it("filtra por edge mínimo (só fixtures com edge >= n)", () => {
    const out = applyFiltersAndSort(data, state({ minEdge: 10 }));
    expect(out.map((f) => f.id)).toEqual([1]);
  });

  it("só destaques (high_signal)", () => {
    const out = applyFiltersAndSort(data, state({ highSignalOnly: true }));
    expect(out.map((f) => f.id)).toEqual([1]);
  });

  it("esconder OFF (has_detail=false)", () => {
    const out = applyFiltersAndSort(data, state({ hideOff: true }));
    expect(out.map((f) => f.id)).not.toContain(3);
  });

  it("busca por time (substring, sem acento, home OU away)", () => {
    expect(applyFiltersAndSort(data, state({ query: "cadiz" })).map((f) => f.id)).toEqual([4]);
    expect(applyFiltersAndSort(data, state({ query: "FLA" })).map((f) => f.id)).toEqual([2]);
    expect(applyFiltersAndSort(data, state({ query: "xyz" }))).toHaveLength(0);
  });

  it("combina filtros (AND)", () => {
    const out = applyFiltersAndSort(data, state({ leagues: ["Premier League|england"], ia: ["bet"] }));
    expect(out.map((f) => f.id)).toEqual([1]);
  });
});

describe("applyFiltersAndSort — ordenação", () => {
  const data = [
    fx({ id: 1, kickoff_utc: "2026-05-30T21:00:00Z", ai_edge_pct: 5, ai_has_bet: true }),
    fx({ id: 2, kickoff_utc: "2026-05-30T16:00:00Z", ai_edge_pct: 18, ai_has_bet: true, high_signal: true }),
    fx({ id: 3, kickoff_utc: "2026-05-30T18:00:00Z" }),
  ];

  it("kickoff: asc, nulls last", () => {
    const withNull = [...data, fx({ id: 4, kickoff_utc: null })];
    const out = applyFiltersAndSort(withNull, state({ sort: "kickoff" }));
    expect(out.map((f) => f.id)).toEqual([2, 3, 1, 4]);
  });

  it("edge: desc, sem-edge no fim", () => {
    const out = applyFiltersAndSort(data, state({ sort: "edge" }));
    expect(out.map((f) => f.id)).toEqual([2, 1, 3]);
  });

  it("destaques primeiro (ai_has_bet/high_signal no topo), depois horário", () => {
    const out = applyFiltersAndSort(data, state({ sort: "signal" }));
    // id 2 (bet+signal) e id 1 (bet) no topo por horário; id 3 (nada) por último
    expect(out[0].id).toBe(2);
    expect(out[out.length - 1].id).toBe(3);
  });
});
