import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks -----------------------------------------------------------------

// Hoisted-safe holders for the Supabase admin client mock.
const supabaseState = vi.hoisted(() => {
  return {
    // scraped_at: null means "never scraped" → no rate-limit applies.
    fixtureRow: null as { id: number; scraped_at: string | null } | null,
    updateError: null as null | { message: string },
    updatePayloadCaptured: null as null | {
      detail_json: unknown;
      scraped_at: unknown;
      status: unknown;
    },
    updateEqId: null as null | number,
    selectEqId: null as null | number,
    // Auth state for the session gate added 2026-06-09.
    authedUserId: "test-user" as string | null,
  };
});

// Mock the server client for the auth gate.
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        getUser: () =>
          Promise.resolve({
            data: {
              user: supabaseState.authedUserId
                ? { id: supabaseState.authedUserId }
                : null,
            },
            error: null,
          }),
      },
    }),
}));

vi.mock("@/lib/supabase/admin", () => {
  return {
    createAdminClient: () => {
      return {
        from: (_table: string) => {
          return {
            // SELECT path: .from("fixtures").select("id, scraped_at").eq("id", id).maybeSingle()
            select: (_cols: string) => ({
              eq: (_col: string, value: number) => {
                supabaseState.selectEqId = value;
                return {
                  maybeSingle: async () => ({
                    data: supabaseState.fixtureRow,
                    error: null,
                  }),
                };
              },
            }),
            // UPDATE path: .from("fixtures").update({...}).eq("id", id)
            update: (payload: {
              detail_json: unknown;
              scraped_at: unknown;
              status: unknown;
            }) => {
              supabaseState.updatePayloadCaptured = payload;
              return {
                eq: async (_col: string, value: number) => {
                  supabaseState.updateEqId = value;
                  return { error: supabaseState.updateError };
                },
              };
            },
          };
        },
      };
    },
  };
});

// We don't mock the env module — we just stub process.env.ADAMCHOI_API_TOKEN
// before each test through vi.stubEnv, and re-import the route lazily so it
// picks up the current value.

// --- Test helpers ----------------------------------------------------------

const WIDGET_BODIES = {
  recent: { recent: "ok" },
  team: { team: "ok" },
  players: { players: "ok" },
  chances: { chances: "ok" },
  odds: { odds: "ok" },
  predictions: { predictions: "ok" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function installFetchMock(handler: (url: string) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const mocked = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler(url);
  });
  vi.stubGlobal("fetch", mocked);
  return { mocked, calls };
}

async function callRoute(id: string) {
  // Lazy-import the route after env stubbing so the env zod parse picks up
  // the right ADAMCHOI_API_TOKEN value for this test.
  const route = await import("@/app/api/fixtures/[id]/refresh/route");
  const request = new Request(
    `http://localhost/api/fixtures/${id}/refresh`,
    { method: "POST" },
  );
  return route.POST(request, { params: Promise.resolve({ id }) });
}

// --- Tests -----------------------------------------------------------------

describe("POST /api/fixtures/[id]/refresh", () => {
  beforeEach(() => {
    // scraped_at: null → never scraped, rate-limit gate skipped.
    supabaseState.fixtureRow = { id: 42, scraped_at: null };
    supabaseState.updateError = null;
    supabaseState.updatePayloadCaptured = null;
    supabaseState.updateEqId = null;
    supabaseState.selectEqId = null;
    supabaseState.authedUserId = "test-user";
    vi.stubEnv("ADAMCHOI_API_TOKEN", "test-token");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("happy path: merges 6 widgets, updates DB, returns 200", async () => {
    const { calls } = installFetchMock((url) => {
      if (url.includes("/recent-results")) return jsonResponse(WIDGET_BODIES.recent);
      if (url.includes("/team-records")) return jsonResponse(WIDGET_BODIES.team);
      if (url.includes("/players")) return jsonResponse(WIDGET_BODIES.players);
      if (url.includes("/chances/fixture/")) return jsonResponse(WIDGET_BODIES.chances);
      if (url.includes("/odds/fixture/")) return jsonResponse(WIDGET_BODIES.odds);
      if (url.includes("/predictions/fixture/"))
        return jsonResponse(WIDGET_BODIES.predictions);
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const res = await callRoute("42");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ has_detail: true, fixture_id: 42 });

    // 6 widget requests issued.
    expect(calls.length).toBe(6);

    // Supabase UPDATE payload looks right.
    expect(supabaseState.updateEqId).toBe(42);
    expect(supabaseState.updatePayloadCaptured?.status).toBe("parsed");
    expect(supabaseState.updatePayloadCaptured?.detail_json).toEqual({
      recent_matches: WIDGET_BODIES.recent,
      team_records: WIDGET_BODIES.team,
      players: WIDGET_BODIES.players,
      chances: WIDGET_BODIES.chances,
      odds: WIDGET_BODIES.odds,
      predictions: WIDGET_BODIES.predictions,
    });
    expect(typeof supabaseState.updatePayloadCaptured?.scraped_at).toBe("string");
  });

  it("tolerates predictions 404 (sets predictions: null)", async () => {
    installFetchMock((url) => {
      if (url.includes("/predictions/fixture/"))
        return jsonResponse({ error: "not found" }, 404);
      if (url.includes("/recent-results")) return jsonResponse(WIDGET_BODIES.recent);
      if (url.includes("/team-records")) return jsonResponse(WIDGET_BODIES.team);
      if (url.includes("/players")) return jsonResponse(WIDGET_BODIES.players);
      if (url.includes("/chances/fixture/")) return jsonResponse(WIDGET_BODIES.chances);
      if (url.includes("/odds/fixture/")) return jsonResponse(WIDGET_BODIES.odds);
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const res = await callRoute("42");
    expect(res.status).toBe(200);
    expect(supabaseState.updatePayloadCaptured?.detail_json).toMatchObject({
      predictions: null,
      recent_matches: WIDGET_BODIES.recent,
    });
  });

  it("returns 502 when recent-results fails with 500", async () => {
    installFetchMock((url) => {
      if (url.includes("/recent-results"))
        return jsonResponse({ error: "boom" }, 500);
      return jsonResponse({ ok: true });
    });

    const res = await callRoute("42");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: "upstream choistats failed" });
    // No UPDATE should have happened.
    expect(supabaseState.updatePayloadCaptured).toBeNull();
  });

  it("returns 400 for non-numeric id", async () => {
    installFetchMock(() => jsonResponse({}));
    const res = await callRoute("abc");
    expect(res.status).toBe(400);
  });

  it("returns 400 for id = 0", async () => {
    installFetchMock(() => jsonResponse({}));
    const res = await callRoute("0");
    expect(res.status).toBe(400);
  });

  it("returns 400 for negative id", async () => {
    installFetchMock(() => jsonResponse({}));
    const res = await callRoute("-1");
    expect(res.status).toBe(400);
  });

  it("returns 404 when fixture row is missing", async () => {
    supabaseState.fixtureRow = null;
    const { calls } = installFetchMock(() => jsonResponse(WIDGET_BODIES.recent));
    const res = await callRoute("999");
    expect(res.status).toBe(404);
    // No upstream calls should be made when the row is missing.
    expect(calls.length).toBe(0);
  });

  it("returns 500 when ADAMCHOI_API_TOKEN is missing", async () => {
    // Schema treats "" as invalid and undefined as missing; we want the latter.
    const original = process.env.ADAMCHOI_API_TOKEN;
    delete process.env.ADAMCHOI_API_TOKEN;
    try {
      installFetchMock(() => jsonResponse({}));
      const res = await callRoute("42");
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ error: "ADAMCHOI_API_TOKEN not configured" });
    } finally {
      if (original !== undefined) process.env.ADAMCHOI_API_TOKEN = original;
    }
  });

  it("includes the X-Adamchoi-Api-Token and Referer headers on every upstream request", async () => {
    const { calls } = installFetchMock(() => jsonResponse({ ok: true }));
    await callRoute("42");
    expect(calls.length).toBe(6);
    for (const c of calls) {
      const headers = new Headers(c.init?.headers ?? {});
      expect(headers.get("X-Adamchoi-Api-Token")).toBe("test-token");
      expect(headers.get("Referer")).toBe("https://www.adamchoi.co.uk/");
      expect(headers.get("Accept")).toBe("application/json");
    }
  });

  it("hits exactly the 6 documented widget URLs", async () => {
    const { calls } = installFetchMock(() => jsonResponse({ ok: true }));
    await callRoute("42");
    const urls = calls.map((c) => c.url).sort();
    expect(urls).toEqual(
      [
        "https://api.choistats.com/api/widget/chances/fixture/42",
        "https://api.choistats.com/api/widget/match/42/players",
        "https://api.choistats.com/api/widget/match/42/recent-results",
        "https://api.choistats.com/api/widget/match/42/team-records",
        "https://api.choistats.com/api/widget/odds/fixture/42",
        "https://api.choistats.com/api/widget/predictions/fixture/42",
      ].sort(),
    );
  });
});
