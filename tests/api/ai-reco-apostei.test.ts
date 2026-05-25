import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for POST /api/ai-reco/apostei — registra a bet manual vinculada
 * a uma ai_recommendation no domínio banca (tabela `bets`) e marca o
 * feedback humano `user_decision='bet'` em `ai_reco_feedback`.
 *
 * Schema relevante (migration 0025_link_bets_to_ai_recos.sql):
 *   - bets.ai_recommendation_id BIGINT NULL REFERENCES ai_recommendations(id)
 *   - UNIQUE (ai_recommendation_id) WHERE status='pending'
 *
 * Body do request:
 *   {
 *     "aiRecommendationId": 123,
 *     "houseId": "uuid-da-casa",
 *     "stake": 21.00,          // BRL
 *     "odd": 2.10?,             // default = reco.odd_captured
 *     "market": "btts-sim"?,    // default = reco.market (locked na UI)
 *     "side": "yes"?            // default = reco.side
 *   }
 *
 * Comportamento:
 *   - 400 se body inválido / stake ≤ 0.
 *   - 404 se ai_recommendation_id não existir.
 *   - 404 se house_id não existir / pertencer a outro user.
 *   - 200 + { betId, aiRecommendationId } se bet criada.
 *   - Idempotência: 2º POST com mesmo (aiRecommendationId) onde a bet
 *     anterior está pending → UPDATE (não cria duplicata).
 *   - Marca ai_reco_feedback.user_decision='bet' (upsert).
 *
 * Auth: server client (createClient) — auth.uid() precisa estar setado
 * pra place_bet RPC funcionar; o handler valida sessão e devolve 401
 * se ausente.
 */

// -----------------------------------------------------------------------------
// Mock state
// -----------------------------------------------------------------------------

interface RecoLookup {
  id: number;
  market: string | null;
  side: string | null;
  odd_captured: number | null;
  units_final: number | null;
}

interface HouseLookup {
  id: string;
  name: string;
}

interface ExistingBet {
  id: string;
  ai_recommendation_id: number;
  status: string;
}

interface MockState {
  authUserId: string | null;
  reco: RecoLookup | null;
  recoLookupError: { message: string } | null;
  house: HouseLookup | null;
  houseLookupError: { message: string } | null;
  existingBet: ExistingBet | null;
  insertedBet: Record<string, unknown> | null;
  insertedBetId: string;
  insertBetError: { message: string } | null;
  updatedBet: Record<string, unknown> | null;
  updateBetError: { message: string } | null;
  feedbackUpserted: Record<string, unknown> | null;
  feedbackUpsertError: { message: string } | null;
}

const mockState: MockState = {
  authUserId: "user-uuid-1",
  reco: null,
  recoLookupError: null,
  house: null,
  houseLookupError: null,
  existingBet: null,
  insertedBet: null,
  insertedBetId: "bet-uuid-new",
  insertBetError: null,
  updatedBet: null,
  updateBetError: null,
  feedbackUpserted: null,
  feedbackUpsertError: null,
};

function resetMock(): void {
  mockState.authUserId = "user-uuid-1";
  mockState.reco = null;
  mockState.recoLookupError = null;
  mockState.house = null;
  mockState.houseLookupError = null;
  mockState.existingBet = null;
  mockState.insertedBet = null;
  mockState.insertedBetId = "bet-uuid-new";
  mockState.insertBetError = null;
  mockState.updatedBet = null;
  mockState.updateBetError = null;
  mockState.feedbackUpserted = null;
  mockState.feedbackUpsertError = null;
}

// -----------------------------------------------------------------------------
// Supabase mock (server-side, auth-aware)
// -----------------------------------------------------------------------------

function buildSupabaseMock() {
  return {
    auth: {
      getUser: () =>
        Promise.resolve(
          mockState.authUserId
            ? { data: { user: { id: mockState.authUserId } }, error: null }
            : { data: { user: null }, error: null },
        ),
    },
    from(table: string) {
      // ── ai_recommendations: pra ler defaults (market/side/odd/units) e validar FK
      if (table === "ai_recommendations") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = () =>
          Promise.resolve(
            mockState.recoLookupError
              ? { data: null, error: mockState.recoLookupError }
              : { data: mockState.reco, error: null },
          );
        return chain;
      }

      // ── houses: validar que a casa existe e está acessível pelo user
      if (table === "houses") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.is = () => chain;
        chain.maybeSingle = () =>
          Promise.resolve(
            mockState.houseLookupError
              ? { data: null, error: mockState.houseLookupError }
              : { data: mockState.house, error: null },
          );
        return chain;
      }

      // ── bets: buscar pending por reco + insert/update
      if (table === "bets") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = () =>
          Promise.resolve({ data: mockState.existingBet, error: null });

        // Update path: builder.update(payload).eq(...).select().single()
        chain.update = (payload: Record<string, unknown>) => {
          mockState.updatedBet = payload;
          const updChain: Record<string, unknown> = {};
          updChain.eq = () => updChain;
          updChain.select = () => updChain;
          updChain.single = () =>
            Promise.resolve(
              mockState.updateBetError
                ? { data: null, error: mockState.updateBetError }
                : {
                    data: { id: mockState.existingBet?.id ?? "bet-uuid-upd" },
                    error: null,
                  },
            );
          return updChain;
        };

        return chain;
      }

      // ── ai_reco_feedback: upsert 'bet' decision
      if (table === "ai_reco_feedback") {
        const chain: Record<string, unknown> = {};
        chain.upsert = (payload: Record<string, unknown>) => {
          mockState.feedbackUpserted = payload;
          return chain;
        };
        chain.select = () => chain;
        chain.single = () =>
          Promise.resolve(
            mockState.feedbackUpsertError
              ? { data: null, error: mockState.feedbackUpsertError }
              : { data: { id: 999 }, error: null },
          );
        chain.maybeSingle = chain.single;
        return chain;
      }

      throw new Error(`unexpected table: ${table}`);
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "place_bet") {
        // Capture payload pra inspeção
        const payload = (args.p_payload ?? {}) as Record<string, unknown>;
        mockState.insertedBet = payload;
        if (mockState.insertBetError) {
          return Promise.resolve({ data: null, error: mockState.insertBetError });
        }
        return Promise.resolve({ data: mockState.insertedBetId, error: null });
      }
      throw new Error(`unexpected rpc: ${name}`);
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(buildSupabaseMock()),
}));

beforeEach(() => {
  resetMock();
  vi.resetModules();
});

async function callRoute(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/ai-reco/apostei/route");
  return POST(
    new Request("http://localhost/api/ai-reco/apostei", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

// -----------------------------------------------------------------------------
// Body validation
// -----------------------------------------------------------------------------

describe("POST /api/ai-reco/apostei — body validation", () => {
  it("returns 400 when body is not valid JSON", async () => {
    const res = await callRoute("not-json{");
    expect(res.status).toBe(400);
  });

  it("returns 400 when aiRecommendationId is missing", async () => {
    const res = await callRoute({
      houseId: "00000000-0000-0000-0000-000000000001",
      stake: 21,
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when houseId is missing", async () => {
    const res = await callRoute({ aiRecommendationId: 123, stake: 21 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when stake is <= 0", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    const res = await callRoute({
      aiRecommendationId: 123,
      houseId: "00000000-0000-0000-0000-000000000001",
      stake: 0,
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when stake is negative", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    const res = await callRoute({
      aiRecommendationId: 123,
      houseId: "00000000-0000-0000-0000-000000000001",
      stake: -10,
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when aiRecommendationId is not a positive integer", async () => {
    const res = await callRoute({
      aiRecommendationId: -1,
      houseId: "00000000-0000-0000-0000-000000000001",
      stake: 21,
    });
    expect(res.status).toBe(400);
  });
});

// -----------------------------------------------------------------------------
// Auth gate
// -----------------------------------------------------------------------------

describe("POST /api/ai-reco/apostei — auth gate", () => {
  it("returns 401 when user is not signed in", async () => {
    mockState.authUserId = null;
    mockState.reco = recoOk();
    mockState.house = houseOk();
    const res = await callRoute({
      aiRecommendationId: 123,
      houseId: "00000000-0000-0000-0000-000000000001",
      stake: 21,
    });
    expect(res.status).toBe(401);
  });
});

// -----------------------------------------------------------------------------
// FK validation
// -----------------------------------------------------------------------------

describe("POST /api/ai-reco/apostei — FK validation", () => {
  it("returns 404 when ai_recommendation_id does not exist", async () => {
    mockState.reco = null;
    mockState.house = houseOk();
    const res = await callRoute({
      aiRecommendationId: 999999,
      houseId: "00000000-0000-0000-0000-000000000001",
      stake: 21,
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/recommendation|not found/i);
  });

  it("returns 404 when house_id does not exist", async () => {
    mockState.reco = recoOk();
    mockState.house = null;
    const res = await callRoute({
      aiRecommendationId: 123,
      houseId: "00000000-0000-0000-0000-000000000099",
      stake: 21,
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/house|casa|not found/i);
  });
});

// -----------------------------------------------------------------------------
// Happy path
// -----------------------------------------------------------------------------

describe("POST /api/ai-reco/apostei — happy path", () => {
  it("returns 200 + { betId } when bet is created", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    mockState.insertedBetId = "bet-uuid-new";
    const res = await callRoute({
      aiRecommendationId: 123,
      houseId: "00000000-0000-0000-0000-000000000001",
      stake: 21,
      odd: 2.1,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { betId: string; aiRecommendationId: number };
    expect(body.betId).toBe("bet-uuid-new");
    expect(body.aiRecommendationId).toBe(123);
  });

  it("bet inserted via place_bet RPC has the ai_recommendation_id linked", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    await callRoute({
      aiRecommendationId: 123,
      houseId: "00000000-0000-0000-0000-000000000001",
      stake: 21,
      odd: 2.1,
    });
    expect(mockState.insertedBet).not.toBeNull();
    expect(mockState.insertedBet!.ai_recommendation_id).toBe(123);
  });

  it("uses ai_recommendations.odd_captured as default odd when omitted", async () => {
    mockState.reco = recoOk({ odd_captured: 1.85 });
    mockState.house = houseOk();
    await callRoute({
      aiRecommendationId: 123,
      houseId: "00000000-0000-0000-0000-000000000001",
      stake: 21,
    });
    const payload = mockState.insertedBet as Record<string, unknown>;
    // total_stake and total_odds passed to place_bet
    expect(payload.total_stake).toBe(21);
    // Inspect the single selection's odds
    const selections = payload.selections as Array<Record<string, unknown>>;
    expect(selections[0].odds).toBe(1.85);
  });

  it("uses the supplied odd when provided (overrides reco default)", async () => {
    mockState.reco = recoOk({ odd_captured: 1.85 });
    mockState.house = houseOk();
    await callRoute({
      aiRecommendationId: 123,
      houseId: "00000000-0000-0000-0000-000000000001",
      stake: 21,
      odd: 2.4,
    });
    const payload = mockState.insertedBet as Record<string, unknown>;
    const selections = payload.selections as Array<Record<string, unknown>>;
    expect(selections[0].odds).toBe(2.4);
  });

  it("uses ai_recommendations.market and side as defaults", async () => {
    mockState.reco = recoOk({ market: "btts-sim", side: "yes" });
    mockState.house = houseOk();
    await callRoute({
      aiRecommendationId: 123,
      houseId: "00000000-0000-0000-0000-000000000001",
      stake: 21,
    });
    const payload = mockState.insertedBet as Record<string, unknown>;
    const selections = payload.selections as Array<Record<string, unknown>>;
    // selection_label embeds market/side; assert it mentions both
    const label = String(selections[0].selection_label ?? "");
    expect(label).toMatch(/btts-sim/i);
    expect(label).toMatch(/yes/i);
  });

  it("upserts ai_reco_feedback.user_decision='bet' after creating the bet", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    await callRoute({
      aiRecommendationId: 123,
      houseId: "00000000-0000-0000-0000-000000000001",
      stake: 21,
    });
    expect(mockState.feedbackUpserted).not.toBeNull();
    const p = mockState.feedbackUpserted!;
    expect(p.ai_recommendation_id).toBe(123);
    expect(p.user_decision).toBe("bet");
  });
});

// -----------------------------------------------------------------------------
// Idempotency
// -----------------------------------------------------------------------------

describe("POST /api/ai-reco/apostei — idempotency", () => {
  it("updates an existing pending bet instead of creating a duplicate", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    mockState.existingBet = {
      id: "bet-uuid-existing",
      ai_recommendation_id: 123,
      status: "pending",
    };
    const res = await callRoute({
      aiRecommendationId: 123,
      houseId: "00000000-0000-0000-0000-000000000002",
      stake: 30,
      odd: 2.05,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { betId: string };
    expect(body.betId).toBe("bet-uuid-existing");
    // place_bet RPC was NOT called (update path)
    expect(mockState.insertedBet).toBeNull();
    // update was called with new values
    expect(mockState.updatedBet).not.toBeNull();
    expect(mockState.updatedBet!.total_stake).toBe(30);
  });

  it("creates a new bet when no pending bet exists for the reco", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    mockState.existingBet = null;
    const res = await callRoute({
      aiRecommendationId: 123,
      houseId: "00000000-0000-0000-0000-000000000001",
      stake: 21,
    });
    expect(res.status).toBe(200);
    // INSERT path: place_bet RPC was called (insertedBet captured)
    expect(mockState.insertedBet).not.toBeNull();
    // After place_bet, the route patches bets.ai_recommendation_id via
    // UPDATE — that's fine; we just assert the patch payload is the link,
    // not a fresh stake/odds rewrite (which is the UPDATE-only path).
    if (mockState.updatedBet !== null) {
      const keys = Object.keys(mockState.updatedBet);
      // Patch should only set ai_recommendation_id, not stake/odds.
      expect(keys).toEqual(["ai_recommendation_id"]);
    }
  });
});

// -----------------------------------------------------------------------------
// Error paths
// -----------------------------------------------------------------------------

describe("POST /api/ai-reco/apostei — DB error paths", () => {
  it("returns 500 when place_bet RPC fails", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    mockState.insertBetError = { message: "boom" };
    const res = await callRoute({
      aiRecommendationId: 123,
      houseId: "00000000-0000-0000-0000-000000000001",
      stake: 21,
    });
    expect(res.status).toBe(500);
  });
});

// -----------------------------------------------------------------------------
// Builders
// -----------------------------------------------------------------------------

function recoOk(over: Partial<RecoLookup> = {}): RecoLookup {
  return {
    id: 123,
    market: "btts-sim",
    side: "yes",
    odd_captured: 2.1,
    units_final: 1.5,
    ...over,
  };
}

function houseOk(over: Partial<HouseLookup> = {}): HouseLookup {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Bet365",
    ...over,
  };
}
