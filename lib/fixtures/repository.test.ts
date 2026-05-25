import { describe, it, expect } from "vitest";
import {
  fixturesForBrtDay,
  fixturesWithBadgesForDashboard,
} from "./repository";

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

/**
 * Mock that serves N tables/relations: `fixtures` (scalar list),
 * `fixture_badges_view` (computed scalars), `ai_recommendations`
 * (scalar list keyed by choistats id). It captures the `.select()`
 * string PER relation so tests can assert no heavy detail_json crosses
 * the wire on any path. `.in()`, `.eq()`, `.gt()` are supported.
 */
function buildMultiMock(rowsByTable: Record<string, unknown[]>) {
  const captured: Record<string, string> = {};
  const eqs: Record<string, Array<{ column: string; value: unknown }>> = {};
  const gts: Record<string, Array<{ column: string; value: unknown }>> = {};
  const ins: Record<string, Array<{ column: string; value: unknown }>> = {};
  function chainFor(table: string) {
    eqs[table] = eqs[table] ?? [];
    gts[table] = gts[table] ?? [];
    ins[table] = ins[table] ?? [];
    const chain = {
      select(arg: string) {
        captured[table] = arg;
        return this;
      },
      or() {
        return this;
      },
      in(column: string, value: unknown) {
        ins[table].push({ column, value });
        return this;
      },
      eq(column: string, value: unknown) {
        eqs[table].push({ column, value });
        return this;
      },
      gt(column: string, value: unknown) {
        gts[table].push({ column, value });
        return this;
      },
      order() {
        return this;
      },
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        resolve({ data: rowsByTable[table] ?? [], error: null });
      },
    };
    return chain;
  }
  const client = {
    from(table: string) {
      return chainFor(table);
    },
  };
  return { client, captured, eqs, gts, ins };
}

describe("fixturesWithBadgesForDashboard — badges via Postgres view (B12 follow-up #1)", () => {
  it("queries fixtures (scalars only) AND fixture_badges_view (no detail_json on either)", async () => {
    const { client, captured } = buildMultiMock({
      fixtures: [compactRow({ id: 1, hd_probe: "Home" })],
      fixture_badges_view: [
        { fixture_id: 1, badges: ["cartao-alto", "over-alto"], high_signal: true },
      ],
    });

    await fixturesWithBadgesForDashboard("2026-05-12", client);

    // The fixtures select is the compact scalar one — no heavy sub-paths.
    expect(captured.fixtures).toBeDefined();
    expect(captured.fixtures).not.toContain("detail_json->streaks");
    expect(captured.fixtures).not.toContain("detail_json->referee_record");
    expect(captured.fixtures).not.toMatch(/detail_json(?!->)/);

    // The badges come from the view — scalars only.
    expect(captured.fixture_badges_view).toBeDefined();
    expect(captured.fixture_badges_view).not.toContain("detail_json");
    expect(captured.fixture_badges_view).toContain("fixture_id");
    expect(captured.fixture_badges_view).toContain("badges");
    expect(captured.fixture_badges_view).toContain("high_signal");
  });

  it("maps view badge slugs to Badge objects on the matching fixture", async () => {
    const { client } = buildMultiMock({
      fixtures: [
        compactRow({ id: 1, hd_probe: "Home" }),
        compactRow({ id: 2, hd_probe: "Home" }),
      ],
      fixture_badges_view: [
        {
          fixture_id: 1,
          badges: ["cartao-alto", "over-alto"],
          high_signal: true,
        },
        { fixture_id: 2, badges: [], high_signal: false },
      ],
    });

    const out = await fixturesWithBadgesForDashboard("2026-05-12", client);
    const f1 = out.find((f) => f.id === 1)!;
    const f2 = out.find((f) => f.id === 2)!;

    expect(f1.badges?.map((b) => b.id)).toEqual(["cartao-alto", "over-alto"]);
    expect(f1.badges?.[0]).toMatchObject({
      id: "cartao-alto",
      label: "cartão alto",
      tone: "cards",
    });
    expect(f2.badges).toEqual([]);
  });

  it("fixture with no view row gets empty badges (graceful)", async () => {
    const { client } = buildMultiMock({
      fixtures: [compactRow({ id: 9, hd_probe: "Home" })],
      fixture_badges_view: [],
    });
    const out = await fixturesWithBadgesForDashboard("2026-05-12", client);
    expect(out[0].badges).toEqual([]);
  });
});

describe("fixturesForBrtDay — high_signal exposed for /fixtures realce", () => {
  it("joins the view's high_signal scalar without pulling badges/detail_json", async () => {
    const { client, captured } = buildMultiMock({
      fixtures: [
        compactRow({ id: 1, hd_probe: "Home" }),
        compactRow({ id: 2, hd_probe: null }),
      ],
      fixture_badges_view: [{ fixture_id: 1, high_signal: true }],
    });

    const out = await fixturesForBrtDay("2026-05-12", client);

    // The supplementary view query selects ONLY scalars.
    expect(captured.fixture_badges_view).toBeDefined();
    expect(captured.fixture_badges_view).not.toContain("detail_json");
    expect(captured.fixture_badges_view).toContain("high_signal");
    expect(captured.fixture_badges_view).not.toContain("badges");

    const f1 = out.find((f) => f.id === 1)!;
    const f2 = out.find((f) => f.id === 2)!;
    expect(f1.high_signal).toBe(true);
    expect(f2.high_signal).toBe(false);
    // Still no badges array on the list DTO (payload minimal).
    expect(f1).not.toHaveProperty("badges");
  });
});

describe("fixturesForBrtDay — ai_has_bet from ai_recommendations (Wave 4)", () => {
  it("queries ai_recommendations with scalar select, filtered by verdict='bet' + kickoff>now + choistats IN", async () => {
    const { client, captured, eqs, gts, ins } = buildMultiMock({
      fixtures: [
        compactRow({
          id: 1,
          hd_probe: "Home",
          source_url: "https://www.adamchoi.co.uk/fixture/19427226/eng-prem-a-vs-b",
        }),
        compactRow({
          id: 2,
          hd_probe: "Home",
          source_url: "https://www.adamchoi.co.uk/fixture/19427227/eng-prem-c-vs-d",
        }),
      ],
      ai_recommendations: [{ fixture_id: 19427226 }],
    });

    const out = await fixturesForBrtDay("2026-05-12", client);

    // ai_recommendations select: scalar only, NO detail_json.
    expect(captured.ai_recommendations).toBeDefined();
    expect(captured.ai_recommendations).not.toContain("detail_json");
    expect(captured.ai_recommendations).toContain("fixture_id");

    // Filters applied: verdict='bet', kickoff_utc>now, fixture_id IN [...]
    expect(
      eqs.ai_recommendations.some(
        (e) => e.column === "verdict" && e.value === "bet",
      ),
    ).toBe(true);
    expect(
      gts.ai_recommendations.some((g) => g.column === "kickoff_utc"),
    ).toBe(true);
    expect(
      ins.ai_recommendations.some(
        (i) =>
          i.column === "fixture_id" &&
          Array.isArray(i.value) &&
          (i.value as unknown[]).includes(19427226),
      ),
    ).toBe(true);

    const f1 = out.find((f) => f.id === 1)!;
    const f2 = out.find((f) => f.id === 2)!;
    expect(f1.ai_has_bet).toBe(true);
    expect(f2.ai_has_bet).toBe(false);
  });

  it("fixture without source_url -> ai_has_bet = false (graceful)", async () => {
    const { client } = buildMultiMock({
      fixtures: [compactRow({ id: 1, hd_probe: "Home", source_url: null })],
      ai_recommendations: [],
    });
    const out = await fixturesForBrtDay("2026-05-12", client);
    expect(out[0].ai_has_bet).toBe(false);
  });

  it("does NOT call ai_recommendations when no fixture has a parseable choistats id", async () => {
    const { client, captured } = buildMultiMock({
      fixtures: [compactRow({ id: 1, hd_probe: "Home", source_url: null })],
      ai_recommendations: [{ fixture_id: 999 }], // would be returned IF queried
    });
    const out = await fixturesForBrtDay("2026-05-12", client);
    expect(out[0].ai_has_bet).toBe(false);
    // Defensive: when there are zero ids to look up, the query is skipped
    // entirely (no need to round-trip an empty IN clause).
    expect(captured.ai_recommendations).toBeUndefined();
  });
});

describe("fixturesWithBadgesForDashboard — ai_has_bet from ai_recommendations (Wave 4)", () => {
  it("attaches ai_has_bet alongside badges", async () => {
    const { client } = buildMultiMock({
      fixtures: [
        compactRow({
          id: 1,
          hd_probe: "Home",
          source_url: "https://www.adamchoi.co.uk/fixture/100/x-vs-y",
        }),
        compactRow({
          id: 2,
          hd_probe: "Home",
          source_url: "https://www.adamchoi.co.uk/fixture/200/m-vs-n",
        }),
      ],
      fixture_badges_view: [
        { fixture_id: 1, badges: ["over-alto"], high_signal: false },
        { fixture_id: 2, badges: [], high_signal: false },
      ],
      ai_recommendations: [{ fixture_id: 200 }],
    });
    const out = await fixturesWithBadgesForDashboard("2026-05-12", client);
    expect(out.find((f) => f.id === 1)!.ai_has_bet).toBe(false);
    expect(out.find((f) => f.id === 2)!.ai_has_bet).toBe(true);
  });
});
