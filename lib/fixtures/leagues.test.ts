import { describe, it, expect } from "vitest";
import { countryToFlag, groupFixturesByLeague } from "./leagues";
import type { FixtureDTO } from "./types";

function fx(overrides: Partial<FixtureDTO> & { id: number }): FixtureDTO {
  return {
    id: overrides.id,
    match_date: overrides.match_date ?? "2026-05-12",
    ko_time: overrides.ko_time ?? "20:00",
    home_team: overrides.home_team ?? "Home",
    away_team: overrides.away_team ?? "Away",
    league: overrides.league ?? null,
    country: overrides.country ?? null,
    source_url: overrides.source_url ?? null,
    has_detail: overrides.has_detail ?? true,
    kickoff_utc: overrides.kickoff_utc ?? null,
  };
}

describe("countryToFlag", () => {
  it("returns the England regional flag for 'england'", () => {
    expect(countryToFlag("england")).toBe("🏴󠁧󠁢󠁥󠁮󠁧󠁿");
  });

  it("returns 🇧🇷 for 'brazil'", () => {
    expect(countryToFlag("brazil")).toBe("🇧🇷");
  });

  it("is case-insensitive", () => {
    expect(countryToFlag("BRAZIL")).toBe("🇧🇷");
    expect(countryToFlag("Spain")).toBe("🇪🇸");
  });

  it("returns 🏳️ fallback for unknown slug", () => {
    expect(countryToFlag("atlantis")).toBe("🏳️");
  });

  it("returns 🏳️ fallback for empty / null-ish slug", () => {
    expect(countryToFlag("")).toBe("🏳️");
  });
});

describe("groupFixturesByLeague", () => {
  it("groups fixtures by composite league|country key", () => {
    const groups = groupFixturesByLeague([
      fx({ id: 1, league: "Premier League", country: "england" }),
      fx({ id: 2, league: "Premier League", country: "england" }),
      fx({ id: 3, league: "Premier League", country: "ukraine" }),
    ]);

    expect(groups).toHaveLength(2);
    const eng = groups.find((g) => g.country === "england");
    const ukr = groups.find((g) => g.country === "ukraine");
    expect(eng?.fixtures.map((f) => f.id)).toEqual([1, 2]);
    expect(ukr?.fixtures.map((f) => f.id)).toEqual([3]);
  });

  it("treats null country as its own bucket (key suffix '—')", () => {
    const groups = groupFixturesByLeague([
      fx({ id: 1, league: "Mystery Cup", country: null }),
      fx({ id: 2, league: "Mystery Cup", country: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("Mystery Cup|—");
    expect(groups[0].country).toBeNull();
    expect(groups[0].fixtures.map((f) => f.id)).toEqual([1, 2]);
  });

  it("orders groups by earliest kickoff_utc in the group (nulls last)", () => {
    const groups = groupFixturesByLeague([
      fx({
        id: 1,
        league: "Late League",
        country: "spain",
        kickoff_utc: "2026-05-12T22:00:00Z",
      }),
      fx({
        id: 2,
        league: "Early League",
        country: "italy",
        kickoff_utc: "2026-05-12T18:00:00Z",
      }),
      fx({
        id: 3,
        league: "No Time League",
        country: "germany",
        kickoff_utc: null,
      }),
    ]);

    expect(groups.map((g) => g.league)).toEqual([
      "Early League",
      "Late League",
      "No Time League",
    ]);
  });

  it("uses the group's earliest kickoff_utc (not insertion order) for sorting", () => {
    const groups = groupFixturesByLeague([
      fx({
        id: 1,
        league: "A",
        country: "spain",
        kickoff_utc: "2026-05-12T22:00:00Z",
      }),
      fx({
        id: 2,
        league: "B",
        country: "italy",
        kickoff_utc: "2026-05-12T19:00:00Z",
      }),
      fx({
        id: 3,
        league: "A",
        country: "spain",
        kickoff_utc: "2026-05-12T17:00:00Z",
      }),
    ]);

    // Group A has earliest kickoff 17:00, group B has 19:00 → A first
    expect(groups.map((g) => g.league)).toEqual(["A", "B"]);
  });

  it("emits country slug verbatim and resolves flag separately on the group", () => {
    const groups = groupFixturesByLeague([
      fx({ id: 1, league: "Liga NOS", country: "portugal" }),
    ]);
    expect(groups[0].country).toBe("portugal");
    expect(groups[0].flag).toBe("🇵🇹");
  });

  it("falls back to 🏳️ for unknown country and uses default flag when country is null", () => {
    const groups = groupFixturesByLeague([
      fx({ id: 1, league: "Cup", country: "atlantis" }),
      fx({ id: 2, league: "Friendly", country: null }),
    ]);
    const cup = groups.find((g) => g.league === "Cup");
    const friendly = groups.find((g) => g.league === "Friendly");
    expect(cup?.flag).toBe("🏳️");
    expect(friendly?.flag).toBe("🏳️");
  });

  it("returns empty array when input is empty", () => {
    expect(groupFixturesByLeague([])).toEqual([]);
  });

  it("treats null league as its own bucket labelled '—'", () => {
    const groups = groupFixturesByLeague([
      fx({ id: 1, league: null, country: "brazil" }),
    ]);
    expect(groups[0].league).toBe("—");
  });

  it("places priority leagues (Premier, La Liga, …) at the top in fixed order, regardless of kickoff", () => {
    // Random non-priority sits earlier than Premier League; Premier still wins.
    const groups = groupFixturesByLeague([
      fx({
        id: 1,
        league: "Scottish Premiership",
        country: "scotland",
        kickoff_utc: "2026-05-12T11:00:00Z",
      }),
      fx({
        id: 2,
        league: "Premier League",
        country: "england",
        kickoff_utc: "2026-05-12T21:00:00Z",
      }),
      fx({
        id: 3,
        league: "La Liga",
        country: "spain",
        kickoff_utc: "2026-05-12T22:00:00Z",
      }),
      fx({
        id: 4,
        league: "Serie A",
        country: "italy",
        kickoff_utc: "2026-05-12T20:00:00Z",
      }),
    ]);

    expect(groups.map((g) => g.league)).toEqual([
      "Premier League",
      "La Liga",
      "Serie A",
      "Scottish Premiership",
    ]);
  });

  it("disambiguates priority by country (Premier League England ranks; Premier League Ukraine doesn't)", () => {
    const groups = groupFixturesByLeague([
      fx({
        id: 1,
        league: "Premier League",
        country: "ukraine",
        kickoff_utc: "2026-05-12T13:00:00Z",
      }),
      fx({
        id: 2,
        league: "Premier League",
        country: "england",
        kickoff_utc: "2026-05-12T22:00:00Z",
      }),
    ]);

    // England version (priority) comes first; Ukraine falls back to kickoff sort.
    expect(groups.map((g) => g.country)).toEqual(["england", "ukraine"]);
  });
});
