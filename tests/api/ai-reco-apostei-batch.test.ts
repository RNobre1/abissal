import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for POST /api/ai-reco/apostei/batch
 *
 * Body:
 *   {
 *     recommendations: Array<{
 *       ai_recommendation_id: number;
 *       effectiveOdd: number;
 *       stake?: number;
 *       houseId?: string;
 *     }>;
 *     defaultHouseId?: string;
 *     defaultStake?: number;
 *   }
 *
 * Response:
 *   { created: number; failed: Array<{ ai_recommendation_id: number; error: string }> }
 */

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

interface MockReco {
  id: number;
  market: string;
  side: string;
  odd_captured: number;
  units_final: number;
}

interface MockState {
  authUserId: string | null;
  recos: Map<number, MockReco>;
  houses: Map<string, { id: string; name: string }>;
  placeBetIds: string[];
  placeBetCallCount: number;
}

const mockState: MockState = {
  authUserId: "user-1",
  recos: new Map(),
  houses: new Map(),
  placeBetIds: [],
  placeBetCallCount: 0,
};

function resetMock(): void {
  mockState.authUserId = "user-1";
  mockState.recos.clear();
  mockState.houses.clear();
  mockState.placeBetIds = ["bet-1", "bet-2", "bet-3", "bet-4", "bet-5"];
  mockState.placeBetCallCount = 0;
}

// ---------------------------------------------------------------------------
// Supabase mock builder
// ---------------------------------------------------------------------------

function buildMock() {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: {
            user: mockState.authUserId ? { id: mockState.authUserId } : null,
          },
          error: null,
        }),
    },
    from(table: string) {
      if (table === "ai_recommendations") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = (_col: string, val: unknown) => {
          const reco = mockState.recos.get(val as number) ?? null;
          const c2: Record<string, unknown> = {};
          c2.maybeSingle = () => Promise.resolve({ data: reco, error: null });
          return c2;
        };
        return chain;
      }

      if (table === "houses") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = (_col: string, val: unknown) => {
          const house = mockState.houses.get(val as string) ?? null;
          const c2: Record<string, unknown> = {};
          c2.is = () => c2;
          c2.maybeSingle = () => Promise.resolve({ data: house, error: null });
          return c2;
        };
        return chain;
      }

      if (table === "bets") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        // No existing pending bets in mock (INSERT path)
        chain.eq = () => {
          const c2: Record<string, unknown> = {};
          c2.eq = () => c2;
          c2.maybeSingle = () => Promise.resolve({ data: null, error: null });
          return c2;
        };
        chain.update = (_data: unknown) => {
          const c2: Record<string, unknown> = {};
          c2.eq = () => Promise.resolve({ error: null });
          return c2;
        };
        return chain;
      }

      if (table === "ai_reco_feedback") {
        return {
          upsert: () => Promise.resolve({ error: null }),
        };
      }

      // Silently handle unknown tables
      const fallback: Record<string, unknown> = {};
      fallback.select = () => fallback;
      fallback.eq = () => fallback;
      fallback.is = () => fallback;
      fallback.upsert = () => Promise.resolve({ error: null });
      fallback.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return fallback;
    },
    rpc(name: string, _args: unknown) {
      if (name === "place_bet") {
        const betId =
          mockState.placeBetIds[mockState.placeBetCallCount] ??
          `bet-${mockState.placeBetCallCount}`;
        mockState.placeBetCallCount++;
        return Promise.resolve({ data: betId, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc: ${name}` } });
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(buildMock()),
}));

// ---------------------------------------------------------------------------
// Route import (after mocks)
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetMock();
  vi.resetModules();
});

async function callRoute(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/ai-reco/apostei/batch/route");
  return POST(
    new Request("http://localhost/api/ai-reco/apostei/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Valid UUIDs for testing
const HOUSE_UUID_1 = "11111111-1111-1111-1111-111111111111";
const HOUSE_UUID_2 = "22222222-2222-2222-2222-222222222222";

describe("POST /api/ai-reco/apostei/batch", () => {
  it("returns 401 when unauthenticated", async () => {
    mockState.authUserId = null;
    const res = await callRoute({
      recommendations: [{ ai_recommendation_id: 1, effectiveOdd: 2.0 }],
      defaultHouseId: HOUSE_UUID_1,
      defaultStake: 10,
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid body (missing recommendations)", async () => {
    const res = await callRoute({ not_recommendations: true });
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty recommendations array", async () => {
    const res = await callRoute({
      recommendations: [],
      defaultHouseId: HOUSE_UUID_1,
      defaultStake: 10,
    });
    expect(res.status).toBe(400);
  });

  it("processes 3 recommendations successfully", async () => {
    mockState.recos.set(1, { id: 1, market: "1x2", side: "home", odd_captured: 2.1, units_final: 1 });
    mockState.recos.set(2, { id: 2, market: "over25", side: "yes", odd_captured: 1.9, units_final: 1 });
    mockState.recos.set(3, { id: 3, market: "btts", side: "yes", odd_captured: 1.75, units_final: 1 });
    mockState.houses.set(HOUSE_UUID_1, { id: HOUSE_UUID_1, name: "Bet365" });

    const res = await callRoute({
      recommendations: [
        { ai_recommendation_id: 1, effectiveOdd: 2.1 },
        { ai_recommendation_id: 2, effectiveOdd: 1.9 },
        { ai_recommendation_id: 3, effectiveOdd: 1.75 },
      ],
      defaultHouseId: HOUSE_UUID_1,
      defaultStake: 10,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { created: number; failed: unknown[] };
    expect(body.created).toBe(3);
    expect(body.failed).toHaveLength(0);
  });

  it("reports failed items without aborting the whole batch", async () => {
    // Only reco 1 exists; reco 99 does not
    mockState.recos.set(1, { id: 1, market: "1x2", side: "home", odd_captured: 2.0, units_final: 1 });
    mockState.houses.set(HOUSE_UUID_1, { id: HOUSE_UUID_1, name: "Bet365" });

    const res = await callRoute({
      recommendations: [
        { ai_recommendation_id: 1, effectiveOdd: 2.0 },
        { ai_recommendation_id: 99, effectiveOdd: 1.5 },
      ],
      defaultHouseId: HOUSE_UUID_1,
      defaultStake: 10,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { created: number; failed: Array<{ ai_recommendation_id: number; error: string }> };
    expect(body.created).toBe(1);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]!.ai_recommendation_id).toBe(99);
  });

  it("per-item houseId + stake override defaults", async () => {
    mockState.recos.set(5, { id: 5, market: "1x2", side: "draw", odd_captured: 3.2, units_final: 1 });
    mockState.houses.set(HOUSE_UUID_2, { id: HOUSE_UUID_2, name: "Betano" });

    const res = await callRoute({
      recommendations: [
        { ai_recommendation_id: 5, effectiveOdd: 3.2, stake: 25, houseId: HOUSE_UUID_2 },
      ],
      // Note: no defaultHouseId — item provides its own UUID
      defaultStake: 10,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { created: number; failed: unknown[] };
    expect(body.created).toBe(1);
    expect(body.failed).toHaveLength(0);
  });
});
