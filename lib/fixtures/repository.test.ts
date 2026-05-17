import { describe, it, expect } from "vitest";
import { fixturesForBrtDay } from "./repository";

/**
 * Mock the supabase chain `.from().select().or().order().order().order()`
 * resolving (thenable) to `{ data, error }`. The mock CAPTURES the string
 * passed to `.select(...)` so the regression test can assert the bug fix:
 * NO `detail_json` blob and NO heavy sub-paths (`streaks`,
 * `referee_record`) may be selected anymore — only scalars + a tiny probe.
 */
function buildMock(rows: unknown[]) {
  const captured: { select?: string } = {};
  const chain = {
    select(arg: string) {
      captured.select = arg;
      return this;
    },
    or() {
      return this;
    },
    order() {
      return this;
    },
    then(resolve: (v: { data: unknown[]; error: null }) => void) {
      resolve({ data: rows, error: null });
    },
  };
  const client = {
    from(table: string) {
      if (table !== "fixtures") throw new Error(`unexpected table: ${table}`);
      return chain;
    },
  };
  return { client, captured };
}

/** A row shaped like the NEW compact select (scalars + scalar probe). */
function compactRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    match_date: "2026-05-12",
    ko_time: "20:00",
    home_team: "A",
    away_team: "B",
    league: "Serie A",
    country: "brazil",
    source_url: null,
    kickoff_utc: "2026-05-12T23:00:00Z",
    hd_probe: null,
    ...over,
  };
}

describe("fixturesForBrtDay — payload regression (outage 1101)", () => {
  it("selects NO detail_json blob and NO heavy sub-paths, only scalars + probe", async () => {
    const { client, captured } = buildMock([]);
    await fixturesForBrtDay("2026-05-12", client);

    expect(captured.select).toBeDefined();
    const sel = captured.select as string;

    // The previous (insufficient) fix still pulled these heavy sub-paths,
    // which alone were ~26MB/day. They must be gone entirely.
    expect(sel).not.toContain("detail_json->streaks");
    expect(sel).not.toContain("detail_json->referee_record");

    // No standalone `detail_json` blob token (not part of a `detail_json->` path).
    // Matches `detail_json` NOT immediately followed by `->`.
    expect(sel).not.toMatch(/detail_json(?!->)/);

    // Only the presence probe for has_detail is allowed to touch detail_json.
    // It MUST be the team_record-subtree probe (non-null iff detail present,
    // 0 false-negatives vs prod), NOT a deep leaf like ->home->overall->>type
    // (a real 1-row false-negative was observed against prod) and NOT
    // ->team_record->home->>type (always null — wrong path, breaks has_detail).
    expect(sel).toContain("hd_probe:detail_json->>team_record");
    expect(sel).not.toContain("detail_json->team_record->home->>type");
    expect(sel).not.toContain("detail_json->team_record->home->overall");
  });
});

describe("fixturesForBrtDay — DTO contract preserved", () => {
  it("sets has_detail=true and emits NO badges when the probe is present", async () => {
    const { client } = buildMock([
      compactRow({
        id: 7,
        hd_probe: "Home",
      }),
    ]);

    const out = await fixturesForBrtDay("2026-05-12", client);
    expect(out).toHaveLength(1);
    const dto = out[0];

    // Badges are intentionally NOT computed for the list anymore (payload
    // minimisation; restored later via a Postgres view/RPC follow-up).
    expect(dto).not.toHaveProperty("badges");
    expect(dto.has_detail).toBe(true);

    // Scalar fields intact (byte-identical to before).
    expect(dto.id).toBe(7);
    expect(dto.match_date).toBe("2026-05-12");
    expect(dto.ko_time).toBe("20:00");
    expect(dto.home_team).toBe("A");
    expect(dto.away_team).toBe("B");
    expect(dto.league).toBe("Serie A");
    expect(dto.country).toBe("brazil");
    expect(dto.source_url).toBeNull();
    expect(dto.kickoff_utc).toBe("2026-05-12T23:00:00Z");
    // No raw blob leaks into the DTO.
    expect(dto).not.toHaveProperty("detail_json");
  });

  it("has_detail false and no badges when the probe is null", async () => {
    const { client } = buildMock([
      compactRow({ id: 9, hd_probe: null }),
    ]);
    const out = await fixturesForBrtDay("2026-05-12", client);
    expect(out).toHaveLength(1);
    expect(out[0].has_detail).toBe(false);
    expect(out[0]).not.toHaveProperty("badges");
  });

  it("has_detail true when the probe returns any non-null string", async () => {
    const { client } = buildMock([
      compactRow({
        id: 10,
        hd_probe: "Away",
      }),
    ]);
    const out = await fixturesForBrtDay("2026-05-12", client);
    expect(out[0].has_detail).toBe(true);
    expect(out[0]).not.toHaveProperty("badges");
  });

  it("orders by kickoff_utc asc (nulls last), then ko_time, then id", async () => {
    const { client } = buildMock([
      compactRow({ id: 3, kickoff_utc: null, ko_time: "22:00" }),
      compactRow({ id: 2, kickoff_utc: "2026-05-12T23:00:00Z" }),
      compactRow({ id: 1, kickoff_utc: "2026-05-12T21:00:00Z" }),
    ]);
    const out = await fixturesForBrtDay("2026-05-12", client);
    expect(out.map((f) => f.id)).toEqual([1, 2, 3]);
  });
});
