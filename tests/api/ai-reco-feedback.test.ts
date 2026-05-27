import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for POST /api/ai-reco/feedback.
 *   - 401 sem sessao (auth gate adicionado 2026-05-27 -- lockdown Acao 1).
 */

interface MockState {
  recoExists: boolean;
  recoLookupError: { message: string } | null;
  insertId: number | null;
  insertError: { message: string } | null;
  insertedPayload: Record<string, unknown> | null;
  upsertConflict: string | null;
  authedUserId: string | null;
  authError: boolean;
}

const mockState: MockState = {
  recoExists: false,
  recoLookupError: null,
  insertId: 777,
  insertError: null,
  insertedPayload: null,
  upsertConflict: null,
  authedUserId: null,
  authError: false,
};

function resetMock() {
  mockState.recoExists = false;
  mockState.recoLookupError = null;
  mockState.insertId = 777;
  mockState.insertError = null;
  mockState.insertedPayload = null;
  mockState.upsertConflict = null;
  mockState.authedUserId = null;
  mockState.authError = false;
}

function buildAdminMock() {
  return {
    from(table: string) {
      if (table === "ai_recommendations") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = () =>
          Promise.resolve(
            mockState.recoLookupError
              ? { data: null, error: mockState.recoLookupError }
              : { data: mockState.recoExists ? { id: 123 } : null, error: null },
          );
        return chain;
      }
      if (table === "ai_reco_feedback") {
        const chain: Record<string, unknown> = {};
        chain.upsert = (payload: Record<string, unknown>, opts?: { onConflict?: string }) => {
          mockState.insertedPayload = payload;
          mockState.upsertConflict = opts?.onConflict ?? null;
          return chain;
        };
        chain.insert = (payload: Record<string, unknown>) => {
          mockState.insertedPayload = payload;
          return chain;
        };
        chain.select = () => chain;
        chain.single = () =>
          Promise.resolve(
            mockState.insertError
              ? { data: null, error: mockState.insertError }
              : { data: { id: mockState.insertId }, error: null },
          );
        chain.maybeSingle = chain.single;
        return chain;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function buildServerMock() {
  return {
    auth: {
      getUser: () => {
        if (mockState.authError) return Promise.reject(new Error("auth failure"));
        return Promise.resolve({
          data: { user: mockState.authedUserId ? { id: mockState.authedUserId } : null },
          error: null,
        });
      },
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(buildServerMock()),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => buildAdminMock(),
}));

beforeEach(() => {
  resetMock();
  vi.resetModules();
  vi.restoreAllMocks();
});

async function callRoute(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/ai-reco/feedback/route");
  return POST(
    new Request("http://localhost/api/ai-reco/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/ai-reco/feedback -- body validation", () => {
  it("returns 400 when body is not valid JSON", async () => {
    expect((await callRoute("not-json{")).status).toBe(400);
  });

  it("returns 400 when aiRecommendationId is missing", async () => {
    expect((await callRoute({ userDecision: "agree" })).status).toBe(400);
  });

  it("returns 400 when userDecision is missing", async () => {
    expect((await callRoute({ aiRecommendationId: 123 })).status).toBe(400);
  });

  it("returns 400 when userDecision is not in the enum (maybe rejected)", async () => {
    mockState.recoExists = true;
    mockState.authedUserId = "user-123";
    const res = await callRoute({ aiRecommendationId: 123, userDecision: "maybe" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBeDefined();
  });

  it("returns 400 when aiRecommendationId is not a positive integer", async () => {
    expect((await callRoute({ aiRecommendationId: -1, userDecision: "agree" })).status).toBe(400);
  });

  it("accepts all four valid decisions", async () => {
    for (const decision of ["agree", "disagree", "bet", "no_bet"]) {
      resetMock();
      mockState.recoExists = true;
      mockState.authedUserId = "user-123";
      const res = await callRoute({ aiRecommendationId: 123, userDecision: decision });
      expect(res.status, `decision=${decision}`).toBe(200);
    }
  });
});

describe("POST /api/ai-reco/feedback -- auth gate", () => {
  it("returns 401 when no session (unauthenticated request)", async () => {
    mockState.recoExists = true;
    const res = await callRoute({ aiRecommendationId: 123, userDecision: "agree" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBeDefined();
  });

  it("returns 401 when auth throws", async () => {
    mockState.authError = true;
    mockState.recoExists = true;
    expect((await callRoute({ aiRecommendationId: 123, userDecision: "agree" })).status).toBe(401);
  });

  it("returns 200 when user is authenticated", async () => {
    mockState.authedUserId = "user-abc";
    mockState.recoExists = true;
    mockState.insertId = 777;
    expect((await callRoute({ aiRecommendationId: 123, userDecision: "agree" })).status).toBe(200);
  });
});

describe("POST /api/ai-reco/feedback -- FK validation", () => {
  it("returns 404 when ai_recommendation_id does not exist", async () => {
    mockState.recoExists = false;
    mockState.authedUserId = "user-123";
    const res = await callRoute({ aiRecommendationId: 9999999, userDecision: "agree" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/recommendation|not found/i);
  });
});

describe("POST /api/ai-reco/feedback -- happy path", () => {
  it("returns 200 + { id } when insert succeeds", async () => {
    mockState.recoExists = true;
    mockState.authedUserId = "user-123";
    mockState.insertId = 777;
    const res = await callRoute({ aiRecommendationId: 123, userDecision: "bet", comment: "vou pra cima" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: number }).id).toBe(777);
  });

  it("passes ai_recommendation_id, user_decision and comment to the DB", async () => {
    mockState.recoExists = true;
    mockState.authedUserId = "user-123";
    await callRoute({ aiRecommendationId: 123, userDecision: "agree", comment: "razao" });
    expect(mockState.insertedPayload).not.toBeNull();
    const p = mockState.insertedPayload!;
    expect(p.ai_recommendation_id).toBe(123);
    expect(p.user_decision).toBe("agree");
    expect(p.comment).toBe("razao");
  });

  it("accepts payloads without a comment", async () => {
    mockState.recoExists = true;
    mockState.authedUserId = "user-123";
    const res = await callRoute({ aiRecommendationId: 123, userDecision: "no_bet" });
    expect(res.status).toBe(200);
    const p = mockState.insertedPayload!;
    if ("comment" in p) expect(p.comment === null || p.comment === undefined).toBe(true);
  });

  it("uses upsert on (ai_recommendation_id, user_decision)", async () => {
    mockState.recoExists = true;
    mockState.authedUserId = "user-123";
    await callRoute({ aiRecommendationId: 123, userDecision: "bet", comment: "primeiro" });
    expect(mockState.upsertConflict).not.toBeNull();
    expect(mockState.upsertConflict).toMatch(/ai_recommendation_id/);
    expect(mockState.upsertConflict).toMatch(/user_decision/);
  });
});

describe("POST /api/ai-reco/feedback -- error paths", () => {
  it("returns 500 when DB insert fails", async () => {
    mockState.recoExists = true;
    mockState.authedUserId = "user-123";
    mockState.insertError = { message: "boom" };
    expect((await callRoute({ aiRecommendationId: 123, userDecision: "agree" })).status).toBe(500);
  });
});
