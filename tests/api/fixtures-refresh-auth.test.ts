import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auth gate + rate-limit tests for POST /api/fixtures/[id]/refresh.
 *
 * Missing gates identified in security audit 2026-06-09:
 *   1. Auth gate — any unauthenticated caller can trigger ~6 choistats
 *      upstream requests + a service-role DB write.
 *   2. Rate-limit gate — no throttle on the endpoint; scraped_at < 60s
 *      should return 429 before any fan-out.
 *
 * Pattern mirrors tests/api/ai-reco-feedback.test.ts and
 * tests/api/ai-reco-compute.test.ts (session mock via createClient).
 */

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const supabaseState = vi.hoisted(() => ({
  fixtureRow: null as { id: number; scraped_at: string | null } | null,
  updateError: null as null | { message: string },
  selectError: null as null | { message: string },
  authedUserId: null as string | null,
  authError: false,
}));

// ---------------------------------------------------------------------------
// Mock: @/lib/supabase/server — used for the auth gate
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        getUser: () => {
          if (supabaseState.authError)
            return Promise.reject(new Error("auth failure"));
          return Promise.resolve({
            data: {
              user: supabaseState.authedUserId
                ? { id: supabaseState.authedUserId }
                : null,
            },
            error: null,
          });
        },
      },
    }),
}));

// ---------------------------------------------------------------------------
// Mock: @/lib/supabase/admin — used for fixture lookup + update
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _value: number) => ({
          maybeSingle: async () => {
            if (supabaseState.selectError)
              return { data: null, error: supabaseState.selectError };
            return { data: supabaseState.fixtureRow, error: null };
          },
        }),
      }),
      update: (_payload: unknown) => ({
        eq: async (_col: string, _value: number) => ({
          error: supabaseState.updateError,
        }),
      }),
    }),
  }),
}));

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function installFetchMock() {
  const mock = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

// ---------------------------------------------------------------------------
// Route caller
// ---------------------------------------------------------------------------

async function callRoute(id = "42") {
  vi.resetModules();
  const route = await import("@/app/api/fixtures/[id]/refresh/route");
  const request = new Request(
    `http://localhost/api/fixtures/${id}/refresh`,
    { method: "POST" },
  );
  return route.POST(request, { params: Promise.resolve({ id }) });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  supabaseState.fixtureRow = { id: 42, scraped_at: null };
  supabaseState.updateError = null;
  supabaseState.selectError = null;
  supabaseState.authedUserId = "user-abc";
  supabaseState.authError = false;
  vi.stubEnv("ADAMCHOI_API_TOKEN", "test-token");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Auth gate tests
// ---------------------------------------------------------------------------

describe("POST /api/fixtures/[id]/refresh — auth gate", () => {
  it("returns 401 when no session (unauthenticated request)", async () => {
    supabaseState.authedUserId = null;
    installFetchMock();
    const res = await callRoute();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
  });

  it("returns 401 when auth.getUser() throws", async () => {
    supabaseState.authedUserId = null;
    supabaseState.authError = true;
    installFetchMock();
    const res = await callRoute();
    expect(res.status).toBe(401);
  });

  it("does NOT call upstream choistats when unauthenticated", async () => {
    supabaseState.authedUserId = null;
    const fetchMock = installFetchMock();
    await callRoute();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proceeds past auth gate when user is authenticated", async () => {
    supabaseState.authedUserId = "user-xyz";
    installFetchMock();
    // Should NOT be 401 — may be any other status (200, 429, etc.)
    const res = await callRoute();
    expect(res.status).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Rate-limit gate tests
// ---------------------------------------------------------------------------

describe("POST /api/fixtures/[id]/refresh — rate-limit gate (60s cooldown)", () => {
  it("returns 429 when scraped_at is within the last 60 seconds", async () => {
    supabaseState.authedUserId = "user-abc";
    // 30 seconds ago — well within the 60s window
    const recentScrapedAt = new Date(Date.now() - 30_000).toISOString();
    supabaseState.fixtureRow = { id: 42, scraped_at: recentScrapedAt };
    const fetchMock = installFetchMock();
    const res = await callRoute();
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string; retry_after_s?: number };
    expect(body.error).toBeDefined();
    expect(typeof body.retry_after_s).toBe("number");
    // No upstream calls should have been made
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 429 when scraped_at is exactly 1 second ago", async () => {
    supabaseState.authedUserId = "user-abc";
    const veryRecentScrapedAt = new Date(Date.now() - 1_000).toISOString();
    supabaseState.fixtureRow = { id: 42, scraped_at: veryRecentScrapedAt };
    installFetchMock();
    const res = await callRoute();
    expect(res.status).toBe(429);
  });

  it("does NOT rate-limit when scraped_at is null (never scraped)", async () => {
    supabaseState.authedUserId = "user-abc";
    supabaseState.fixtureRow = { id: 42, scraped_at: null };
    installFetchMock();
    const res = await callRoute();
    // null scraped_at means no cooldown applies
    expect(res.status).not.toBe(429);
  });

  it("does NOT rate-limit when scraped_at is older than 60 seconds", async () => {
    supabaseState.authedUserId = "user-abc";
    const oldScrapedAt = new Date(Date.now() - 120_000).toISOString(); // 2 min ago
    supabaseState.fixtureRow = { id: 42, scraped_at: oldScrapedAt };
    installFetchMock();
    const res = await callRoute();
    expect(res.status).not.toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Authenticated happy-path smoke — guards against regression after fix
// ---------------------------------------------------------------------------

describe("POST /api/fixtures/[id]/refresh — authenticated happy path", () => {
  it("returns 200 when authenticated, scraped_at is old, and upstream succeeds", async () => {
    supabaseState.authedUserId = "user-abc";
    supabaseState.fixtureRow = {
      id: 42,
      scraped_at: new Date(Date.now() - 120_000).toISOString(),
    };
    installFetchMock();
    const res = await callRoute();
    // Not 401 and not 429 — auth + rate-limit gates passed.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(429);
  });
});
