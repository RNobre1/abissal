import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Raw row shape as returned by the COMPACT list select (post outage-1101 fix):
 * scalar columns + ONE tiny scalar probe (`hd_probe`). The repository no
 * longer pulls the full detail_json blob nor any heavy sub-paths, so the mock
 * must mirror this minimal shape.
 */
type CompactRow = {
  id: number;
  match_date: string;
  ko_time: string | null;
  home_team: string;
  away_team: string;
  league: string | null;
  country: string | null;
  source_url: string | null;
  kickoff_utc: string | null;
  hd_probe: string | null;
};

/**
 * In-memory Supabase mock — captures the query chain calls and returns the
 * fixtures rows we set via `setRows`. The chain we replicate is:
 *
 *   client.from("fixtures")
 *         .select("...")
 *         .or("...")
 *         .order("kickoff_utc", { ascending: true, nullsFirst: false })
 *         .order("ko_time", { ascending: true, nullsFirst: false })
 *         .order("id", { ascending: true })
 *
 * The final `.order(...)` call must resolve like a thenable to `{ data, error }`.
 */
type MockState = {
  rows: CompactRow[];
  error: { message: string } | null;
  lastTable: string | null;
  lastSelect: string | null;
  lastOr: string | null;
  lastOrders: Array<{ column: string; opts?: { ascending?: boolean; nullsFirst?: boolean } }>;
};

const mockState: MockState = {
  rows: [],
  error: null,
  lastTable: null,
  lastSelect: null,
  lastOr: null,
  lastOrders: [],
};

function setRows(rows: CompactRow[]) {
  mockState.rows = rows;
  mockState.error = null;
}

function setError(message: string) {
  mockState.rows = [];
  mockState.error = { message };
}

function resetMock() {
  mockState.rows = [];
  mockState.error = null;
  mockState.lastTable = null;
  mockState.lastSelect = null;
  mockState.lastOr = null;
  mockState.lastOrders = [];
}

function buildQueryBuilder() {
  const builder: Record<string, unknown> = {};
  builder.select = (cols: string) => {
    mockState.lastSelect = cols;
    return builder;
  };
  builder.or = (expr: string) => {
    mockState.lastOr = expr;
    return builder;
  };
  builder.order = (
    column: string,
    opts?: { ascending?: boolean; nullsFirst?: boolean },
  ) => {
    mockState.lastOrders.push({ column, opts });
    // Return a thenable so `await` resolves the chain on the final order().
    return {
      then(onFulfilled: (value: { data: CompactRow[] | null; error: { message: string } | null }) => unknown) {
        if (mockState.error) {
          return Promise.resolve(onFulfilled({ data: null, error: mockState.error }));
        }
        return Promise.resolve(onFulfilled({ data: mockState.rows, error: null }));
      },
      // If for some reason the route chains another `.order()` after this one,
      // delegate back to the builder so we don't break.
      order: builder.order,
    };
  };
  return builder;
}

const mockClient = {
  from: (table: string) => {
    mockState.lastTable = table;
    return buildQueryBuilder();
  },
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockClient,
}));

// Import AFTER vi.mock so the route binds to the mocked admin client.
import { GET } from "@/app/api/fixtures/route";

const SAMPLE_DATE = "2026-05-12";

function makeRow(overrides: Partial<CompactRow>): CompactRow {
  return {
    id: 1,
    match_date: SAMPLE_DATE,
    ko_time: "20:00:00",
    home_team: "Home",
    away_team: "Away",
    league: "Premier League",
    country: "england",
    source_url: "https://www.adamchoi.co.uk/fixture/1",
    hd_probe: null,
    kickoff_utc: "2026-05-12T19:00:00+00:00",
    ...overrides,
  };
}

function makeRequest(url: string): Request {
  return new Request(url);
}

beforeEach(() => {
  resetMock();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/fixtures", () => {
  it("resolves ?date=today to the current BRT date and returns matching rows", async () => {
    // 15:00 UTC on 2026-05-12 = 12:00 BRT on 2026-05-12 → today BRT = 2026-05-12.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T15:00:00Z"));

    setRows([
      makeRow({ id: 10, kickoff_utc: "2026-05-12T19:00:00+00:00" }),
    ]);

    const res = await GET(makeRequest("http://localhost/api/fixtures?date=today"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(10);

    // The OR clause must reference the resolved BRT date window: 03:00 UTC bounds.
    expect(mockState.lastOr).toContain("2026-05-12T03:00:00.000Z");
    expect(mockState.lastOr).toContain("2026-05-13T03:00:00.000Z");
    expect(mockState.lastOr).toContain("match_date.eq.2026-05-12");
  });

  it("resolves ?date=tomorrow to BRT+1", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T15:00:00Z"));

    setRows([]);

    const res = await GET(makeRequest("http://localhost/api/fixtures?date=tomorrow"));
    expect(res.status).toBe(200);

    expect(mockState.lastOr).toContain("2026-05-13T03:00:00.000Z");
    expect(mockState.lastOr).toContain("2026-05-14T03:00:00.000Z");
    expect(mockState.lastOr).toContain("match_date.eq.2026-05-13");
  });

  it("accepts explicit ?date=YYYY-MM-DD and passes through", async () => {
    setRows([makeRow({ id: 1 })]);

    const res = await GET(
      makeRequest("http://localhost/api/fixtures?date=2026-05-12"),
    );
    expect(res.status).toBe(200);
    expect(mockState.lastOr).toContain("match_date.eq.2026-05-12");
    expect(mockState.lastTable).toBe("fixtures");
  });

  it("returns 400 with { error } when ?date is missing", async () => {
    const res = await GET(makeRequest("http://localhost/api/fixtures"));
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 for invalid date values", async () => {
    for (const bad of ["12/05/2026", "not-a-date", "2026-13-01"]) {
      const res = await GET(
        makeRequest(`http://localhost/api/fixtures?date=${encodeURIComponent(bad)}`),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBeDefined();
    }
  });

  it("returns 200 with [] when no rows match", async () => {
    setRows([]);
    const res = await GET(
      makeRequest("http://localhost/api/fixtures?date=2026-05-12"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual([]);
  });

  it("orders rows: kickoff_utc asc (nulls last), then ko_time asc (nulls last), then id asc", async () => {
    // Intentionally shuffled to ensure the route sorts (not the mock).
    setRows([
      makeRow({ id: 3, kickoff_utc: null, ko_time: null, match_date: SAMPLE_DATE }),
      makeRow({ id: 1, kickoff_utc: "2026-05-12T21:00:00+00:00", ko_time: "21:00:00" }),
      makeRow({ id: 4, kickoff_utc: null, ko_time: "18:00:00", match_date: SAMPLE_DATE }),
      makeRow({ id: 2, kickoff_utc: "2026-05-12T19:00:00+00:00", ko_time: "19:00:00" }),
      makeRow({ id: 5, kickoff_utc: null, ko_time: null, match_date: SAMPLE_DATE }),
    ]);

    const res = await GET(
      makeRequest("http://localhost/api/fixtures?date=2026-05-12"),
    );
    const body = (await res.json()) as Array<{ id: number }>;
    // 2 (19:00 UTC) → 1 (21:00 UTC) → 4 (null kickoff, 18:00 ko_time)
    //   → 3 (null kickoff, null ko_time, id 3) → 5 (null kickoff, null ko_time, id 5)
    expect(body.map((r) => r.id)).toEqual([2, 1, 4, 3, 5]);
  });

  it("derives has_detail from the scalar probe and never ships detail_json", async () => {
    setRows([
      makeRow({ id: 1, hd_probe: "Home" }),
      makeRow({
        id: 2,
        hd_probe: null,
        kickoff_utc: "2026-05-12T20:00:00+00:00",
      }),
    ]);

    const res = await GET(
      makeRequest("http://localhost/api/fixtures?date=2026-05-12"),
    );
    const body = (await res.json()) as Array<Record<string, unknown>>;
    const byId = Object.fromEntries(body.map((r) => [r.id, r]));
    expect(byId[1].has_detail).toBe(true);
    expect(byId[2].has_detail).toBe(false);
    expect(byId[1]).not.toHaveProperty("detail_json");
    expect(byId[2]).not.toHaveProperty("detail_json");
  });

  it("includes rows with kickoff_utc=null when match_date equals the requested date (fallback)", async () => {
    setRows([
      makeRow({
        id: 99,
        kickoff_utc: null,
        ko_time: null,
        match_date: SAMPLE_DATE,
      }),
    ]);

    const res = await GET(
      makeRequest("http://localhost/api/fixtures?date=2026-05-12"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(99);
    expect(body[0].kickoff_utc).toBeNull();

    // The query must include the fallback branch in the OR clause.
    expect(mockState.lastOr).toContain("kickoff_utc.is.null");
    expect(mockState.lastOr).toContain("match_date.eq.2026-05-12");
  });

  it("normalises kickoff_utc to ISO-8601 Z form in every row", async () => {
    setRows([
      // Postgres usually returns "+00:00"; we want "...Z".
      makeRow({ id: 1, kickoff_utc: "2026-05-12T19:00:00+00:00" }),
      // Non-zero offset should still resolve to UTC Z.
      makeRow({ id: 2, kickoff_utc: "2026-05-12T16:00:00-03:00" }),
      // Milliseconds .000Z should be stripped.
      makeRow({ id: 3, kickoff_utc: "2026-05-12T21:30:00.000Z" }),
    ]);

    const res = await GET(
      makeRequest("http://localhost/api/fixtures?date=2026-05-12"),
    );
    const body = (await res.json()) as Array<{ id: number; kickoff_utc: string }>;
    const byId = Object.fromEntries(body.map((r) => [r.id, r.kickoff_utc]));
    expect(byId[1]).toBe("2026-05-12T19:00:00Z");
    expect(byId[2]).toBe("2026-05-12T19:00:00Z");
    expect(byId[3]).toBe("2026-05-12T21:30:00Z");
  });

  it("trims ko_time HH:MM:SS to HH:MM", async () => {
    setRows([
      makeRow({ id: 1, ko_time: "20:30:00" }),
      makeRow({ id: 2, ko_time: null, kickoff_utc: "2026-05-12T22:00:00+00:00" }),
    ]);

    const res = await GET(
      makeRequest("http://localhost/api/fixtures?date=2026-05-12"),
    );
    const body = (await res.json()) as Array<{ id: number; ko_time: string | null }>;
    const byId = Object.fromEntries(body.map((r) => [r.id, r.ko_time]));
    expect(byId[1]).toBe("20:30");
    expect(byId[2]).toBeNull();
  });

  it("returns 500 with { error } when Supabase returns an error", async () => {
    setError("boom");
    const res = await GET(
      makeRequest("http://localhost/api/fixtures?date=2026-05-12"),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
  });
});
