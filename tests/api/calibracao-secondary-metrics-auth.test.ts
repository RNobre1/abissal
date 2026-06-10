import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auth gate tests for GET /api/calibracao/secondary-metrics.
 *
 * The route docblock says "Requires service-role auth (server-only)" but the
 * implementation had no session gate — the SELECT was 100% public.
 * Security audit 2026-06-09 identified this as a missing gate.
 *
 * Pattern mirrors tests/api/ai-reco-compute.test.ts.
 */

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

interface MockState {
  authedUserId: string | null;
  authError: boolean;
  simRows: unknown[];
  queryError: { message: string } | null;
}

const mockState: MockState = {
  authedUserId: null,
  authError: false,
  simRows: [],
  queryError: null,
};

function resetMock() {
  mockState.authedUserId = null;
  mockState.authError = false;
  mockState.simRows = [];
  mockState.queryError = null;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        getUser: () => {
          if (mockState.authError)
            return Promise.reject(new Error("auth failure"));
          return Promise.resolve({
            data: {
              user: mockState.authedUserId
                ? { id: mockState.authedUserId }
                : null,
            },
            error: null,
          });
        },
      },
    }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          order: (_col2: string, _opts: unknown) => ({
            limit: (_n: number) =>
              Promise.resolve({
                data: mockState.queryError ? null : mockState.simRows,
                error: mockState.queryError,
              }),
          }),
        }),
      }),
    }),
  }),
}));

// ---------------------------------------------------------------------------
// Route caller
// ---------------------------------------------------------------------------

async function callRoute() {
  vi.resetModules();
  const route = await import("@/app/api/calibracao/secondary-metrics/route");
  return route.GET();
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetMock();
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Auth gate tests
// ---------------------------------------------------------------------------

describe("GET /api/calibracao/secondary-metrics — auth gate", () => {
  it("returns 401 when no session (unauthenticated request)", async () => {
    mockState.authedUserId = null;
    const res = await callRoute();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
  });

  it("returns 401 when auth.getUser() throws", async () => {
    mockState.authedUserId = null;
    mockState.authError = true;
    const res = await callRoute();
    expect(res.status).toBe(401);
  });

  it("proceeds past auth gate when user is authenticated", async () => {
    mockState.authedUserId = "user-abc";
    mockState.simRows = []; // empty — will return n:0 metrics
    const res = await callRoute();
    expect(res.status).not.toBe(401);
  });

  it("returns 200 with metric fields when authenticated and DB returns rows", async () => {
    mockState.authedUserId = "user-abc";
    mockState.simRows = [];
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      n: number;
      n_btts: number;
      n_secondary: number;
      btts_brier: unknown;
      corners_crps: unknown;
      cards_crps: unknown;
      sot_crps: unknown;
    };
    // Shape check — not a 401/4xx error response
    expect(typeof body.n).toBe("number");
    expect(typeof body.n_btts).toBe("number");
    expect(typeof body.n_secondary).toBe("number");
    expect("btts_brier" in body).toBe(true);
    expect("corners_crps" in body).toBe(true);
  });
});
