/**
 * TDD — BetsPage filters: league + market URL params applied to query
 *
 * We test the filter-URL building helper extracted from the page,
 * since the page itself is a Server Component (RSC) and hits Supabase.
 * The relevant logic: given searchParams, build the correct supabase query
 * chain. We test the pure URL-param → filter-key mapping via the helper.
 */
import { describe, it, expect } from "vitest";
import { buildBetsFilter } from "@/app/(dashboard)/bets/filter-helpers";

describe("buildBetsFilter", () => {
  it("returns empty filters for default params", () => {
    const f = buildBetsFilter({});
    expect(f.statusValues).toEqual([]);
    expect(f.houseSlug).toBeUndefined();
    expect(f.league).toBeUndefined();
    expect(f.marketId).toBeUndefined();
  });

  it("parses status filter", () => {
    const f = buildBetsFilter({ status: "won" });
    expect(f.statusValues).toEqual(["won", "half_won"]);
  });

  it("parses league filter", () => {
    const f = buildBetsFilter({ league: "Premier League" });
    expect(f.league).toBe("Premier League");
  });

  it("parses market filter", () => {
    const f = buildBetsFilter({ market: "m-uuid-123" });
    expect(f.marketId).toBe("m-uuid-123");
  });

  it("parses house slug filter", () => {
    const f = buildBetsFilter({ house: "bet365" });
    expect(f.houseSlug).toBe("bet365");
  });

  it("parses combined filters", () => {
    const f = buildBetsFilter({
      status: "lost",
      league: "La Liga",
      market: "market-id",
      house: "betano",
    });
    expect(f.statusValues).toEqual(["lost", "half_lost"]);
    expect(f.league).toBe("La Liga");
    expect(f.marketId).toBe("market-id");
    expect(f.houseSlug).toBe("betano");
  });
});
