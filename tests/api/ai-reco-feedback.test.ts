import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for POST /api/ai-reco/feedback — captura feedback humano sobre uma
 * ai_recommendation (concordo, discordo, apostei, não apostei).
 *
 * Schema (migration 0024_ai_reco_feedback.sql):
 *   - id BIGSERIAL PK
 *   - ai_recommendation_id BIGINT NOT NULL REFERENCES ai_recommendations(id)
 *   - user_decision TEXT CHECK IN ('agree','disagree','bet','no_bet')
 *   - comment TEXT
 *   - created_at TIMESTAMPTZ DEFAULT now()
 *   - updated_at TIMESTAMPTZ DEFAULT now()
 *   - UNIQUE (ai_recommendation_id, user_decision)
 *
 * Semantica:
 *   - Upsert por (ai_recommendation_id, user_decision) — re-clicar
 *     sobrescreve `comment` e bumpa `updated_at` mas não duplica linha.
 *   - 404 se ai_recommendation_id não existir.
 *   - 400 se user_decision não estiver no enum.
 */

interface MockState {
  recoExists: boolean;
  recoLookupError: { message: string } | null;
  insertId: number | null;
  insertError: { message: string } | null;
  insertedPayload: Record<string, unknown> | null;
  upsertConflict: string | null;
}

const mockState: MockState = {
  recoExists: false,
  recoLookupError: null,
  insertId: 777,
  insertError: null,
  insertedPayload: null,
  upsertConflict: null,
};

function resetMock() {
  mockState.recoExists = false;
  mockState.recoLookupError = null;
  mockState.insertId = 777;
  mockState.insertError = null;
  mockState.insertedPayload = null;
  mockState.upsertConflict = null;
}

function buildAdminMock() {
  return {
    from(table: string) {
      // --- ai_recommendations (lookup pra validar FK) ---
      if (table === "ai_recommendations") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = () =>
          Promise.resolve(
            mockState.recoLookupError
              ? { data: null, error: mockState.recoLookupError }
              : {
                  data: mockState.recoExists ? { id: 123 } : null,
                  error: null,
                },
          );
        return chain;
      }

      // --- ai_reco_feedback (upsert) ---
      if (table === "ai_reco_feedback") {
        const chain: Record<string, unknown> = {};
        chain.upsert = (
          payload: Record<string, unknown>,
          opts?: { onConflict?: string },
        ) => {
          mockState.insertedPayload = payload;
          mockState.upsertConflict = opts?.onConflict ?? null;
          return chain;
        };
        chain.insert = (payload: Record<string, unknown>) => {
          // Fallback in case the route uses insert+onConflict differently.
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

// -----------------------------------------------------------------------------
// Body validation
// -----------------------------------------------------------------------------

describe("POST /api/ai-reco/feedback — body validation", () => {
  it("returns 400 when body is not valid JSON", async () => {
    const res = await callRoute("not-json{");
    expect(res.status).toBe(400);
  });

  it("returns 400 when aiRecommendationId is missing", async () => {
    const res = await callRoute({ userDecision: "agree" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when userDecision is missing", async () => {
    const res = await callRoute({ aiRecommendationId: 123 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when userDecision is not in the enum ('maybe' rejected)", async () => {
    mockState.recoExists = true;
    const res = await callRoute({
      aiRecommendationId: 123,
      userDecision: "maybe",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
  });

  it("returns 400 when aiRecommendationId is not a positive integer", async () => {
    const res = await callRoute({
      aiRecommendationId: -1,
      userDecision: "agree",
    });
    expect(res.status).toBe(400);
  });

  it("accepts all four valid decisions", async () => {
    mockState.recoExists = true;
    for (const decision of ["agree", "disagree", "bet", "no_bet"]) {
      resetMock();
      mockState.recoExists = true;
      const res = await callRoute({
        aiRecommendationId: 123,
        userDecision: decision,
      });
      expect(res.status, `decision=${decision}`).toBe(200);
    }
  });
});

// -----------------------------------------------------------------------------
// FK validation
// -----------------------------------------------------------------------------

describe("POST /api/ai-reco/feedback — FK validation", () => {
  it("returns 404 when ai_recommendation_id does not exist", async () => {
    mockState.recoExists = false;
    const res = await callRoute({
      aiRecommendationId: 9999999,
      userDecision: "agree",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/recommendation|not found/i);
  });
});

// -----------------------------------------------------------------------------
// Happy path + idempotency
// -----------------------------------------------------------------------------

describe("POST /api/ai-reco/feedback — happy path", () => {
  it("returns 200 + { id } when insert succeeds", async () => {
    mockState.recoExists = true;
    mockState.insertId = 777;
    const res = await callRoute({
      aiRecommendationId: 123,
      userDecision: "bet",
      comment: "vou pra cima",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number };
    expect(body.id).toBe(777);
  });

  it("passes ai_recommendation_id, user_decision and comment to the DB", async () => {
    mockState.recoExists = true;
    await callRoute({
      aiRecommendationId: 123,
      userDecision: "agree",
      comment: "razão",
    });
    expect(mockState.insertedPayload).not.toBeNull();
    const p = mockState.insertedPayload!;
    expect(p.ai_recommendation_id).toBe(123);
    expect(p.user_decision).toBe("agree");
    expect(p.comment).toBe("razão");
  });

  it("accepts payloads without a comment", async () => {
    mockState.recoExists = true;
    const res = await callRoute({
      aiRecommendationId: 123,
      userDecision: "no_bet",
    });
    expect(res.status).toBe(200);
    expect(mockState.insertedPayload).not.toBeNull();
    // Either null or omitted is fine; just must not be a non-null undefined leak.
    const p = mockState.insertedPayload!;
    if ("comment" in p) {
      expect(p.comment === null || p.comment === undefined).toBe(true);
    }
  });

  it("uses upsert on (ai_recommendation_id, user_decision) so re-click sobrescreve em vez de duplicar", async () => {
    mockState.recoExists = true;
    await callRoute({
      aiRecommendationId: 123,
      userDecision: "bet",
      comment: "primeiro",
    });
    expect(mockState.upsertConflict).not.toBeNull();
    expect(mockState.upsertConflict).toMatch(/ai_recommendation_id/);
    expect(mockState.upsertConflict).toMatch(/user_decision/);
  });
});

// -----------------------------------------------------------------------------
// DB error paths
// -----------------------------------------------------------------------------

describe("POST /api/ai-reco/feedback — error paths", () => {
  it("returns 500 when DB insert fails", async () => {
    mockState.recoExists = true;
    mockState.insertError = { message: "boom" };
    const res = await callRoute({
      aiRecommendationId: 123,
      userDecision: "agree",
    });
    expect(res.status).toBe(500);
  });
});
