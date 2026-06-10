/**
 * TDD — POST /api/ai-reco/apostei/batch ledger correctness (Bug 2 fix)
 *
 * RED phase: verifies that the batch UPDATE path (idempotent re-stake)
 * calls adjust_bet_stake RPC instead of doing direct bets.update().
 *
 * Same bug as single /apostei: the UPDATE path bypassed the ledger.
 * Free bet UPDATE must skip adjust_bet_stake entirely.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

interface MockBet {
  id: string;
  ai_recommendation_id: number;
  status: string;
  is_free_bet: boolean;
}

interface MockState {
  authUserId: string | null;
  recos: Map<number, MockReco>;
  houses: Map<string, { id: string; name: string }>;
  existingBets: Map<number, MockBet>; // keyed by ai_recommendation_id
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  directBetsUpdateCalls: Array<Record<string, unknown>>;
}

const mockState: MockState = {
  authUserId: "user-1",
  recos: new Map(),
  houses: new Map(),
  existingBets: new Map(),
  rpcCalls: [],
  directBetsUpdateCalls: [],
};

function resetMock(): void {
  mockState.authUserId = "user-1";
  mockState.recos.clear();
  mockState.houses.clear();
  mockState.existingBets.clear();
  mockState.rpcCalls = [];
  mockState.directBetsUpdateCalls = [];
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
        // eq chains for idempotency lookup: .eq(ai_reco_id).eq(status)
        chain.eq = (_col: string, val: unknown) => {
          // Look up by ai_recommendation_id
          const existing = mockState.existingBets.get(val as number) ?? null;
          const c2: Record<string, unknown> = {};
          c2.eq = () => {
            const c3: Record<string, unknown> = {};
            c3.maybeSingle = () => Promise.resolve({ data: existing, error: null });
            return c3;
          };
          c2.maybeSingle = () => Promise.resolve({ data: existing, error: null });
          return c2;
        };

        // Track direct UPDATE calls — should NOT contain ledger fields
        chain.update = (payload: Record<string, unknown>) => {
          mockState.directBetsUpdateCalls.push(payload);
          const updChain: Record<string, unknown> = {};
          updChain.eq = () => Promise.resolve({ error: null });
          return updChain;
        };

        return chain;
      }

      if (table === "bet_selections") {
        const chain: Record<string, unknown> = {};
        chain.update = () => chain;
        chain.eq = () => chain;
        return Promise.resolve({ error: null });
      }

      if (table === "ai_reco_feedback") {
        return {
          upsert: () => Promise.resolve({ error: null }),
        };
      }

      // Fallback
      const fallback: Record<string, unknown> = {};
      fallback.select = () => fallback;
      fallback.eq = () => fallback;
      fallback.is = () => fallback;
      fallback.upsert = () => Promise.resolve({ error: null });
      fallback.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return fallback;
    },
    rpc(name: string, args: Record<string, unknown>) {
      mockState.rpcCalls.push({ name, args });
      if (name === "place_bet") {
        const count = mockState.rpcCalls.filter((c) => c.name === "place_bet").length;
        return Promise.resolve({ data: `bet-${count}`, error: null });
      }
      if (name === "adjust_bet_stake") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc: ${name}` } });
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(buildMock()),
}));

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

const HOUSE_UUID = "11111111-1111-1111-1111-111111111111";

// ---------------------------------------------------------------------------
// UPDATE path: must use adjust_bet_stake RPC
// ---------------------------------------------------------------------------

describe("POST /api/ai-reco/apostei/batch — UPDATE path uses adjust_bet_stake RPC (Bug 2 fix)", () => {
  it("calls adjust_bet_stake RPC when a pending non-free bet exists for the reco", async () => {
    mockState.recos.set(1, { id: 1, market: "1x2", side: "home", odd_captured: 2.1, units_final: 1 });
    mockState.houses.set(HOUSE_UUID, { id: HOUSE_UUID, name: "Bet365" });
    mockState.existingBets.set(1, {
      id: "bet-existing-1",
      ai_recommendation_id: 1,
      status: "pending",
      is_free_bet: false,
    });

    await callRoute({
      recommendations: [{ ai_recommendation_id: 1, effectiveOdd: 2.1 }],
      defaultHouseId: HOUSE_UUID,
      defaultStake: 25,
    });

    const adjustCall = mockState.rpcCalls.find((c) => c.name === "adjust_bet_stake");
    expect(adjustCall).toBeDefined();
  });

  it("adjust_bet_stake called with bet_id, new_stake, new_house_id", async () => {
    mockState.recos.set(1, { id: 1, market: "1x2", side: "home", odd_captured: 2.0, units_final: 1 });
    mockState.houses.set(HOUSE_UUID, { id: HOUSE_UUID, name: "Bet365" });
    mockState.existingBets.set(1, {
      id: "bet-existing-1",
      ai_recommendation_id: 1,
      status: "pending",
      is_free_bet: false,
    });

    await callRoute({
      recommendations: [{ ai_recommendation_id: 1, effectiveOdd: 2.0, stake: 40, houseId: HOUSE_UUID }],
    });

    const adjustCall = mockState.rpcCalls.find((c) => c.name === "adjust_bet_stake");
    const payload = adjustCall?.args.p_payload as Record<string, unknown>;
    expect(payload?.bet_id).toBe("bet-existing-1");
    expect(payload?.new_stake).toBe(40);
    expect(payload?.new_house_id).toBe(HOUSE_UUID);
  });

  it("direct bets.update() payload does NOT contain ledger fields (stake/odds/house_id)", async () => {
    mockState.recos.set(1, { id: 1, market: "1x2", side: "home", odd_captured: 2.0, units_final: 1 });
    mockState.houses.set(HOUSE_UUID, { id: HOUSE_UUID, name: "Bet365" });
    mockState.existingBets.set(1, {
      id: "bet-existing-1",
      ai_recommendation_id: 1,
      status: "pending",
      is_free_bet: false,
    });

    await callRoute({
      recommendations: [{ ai_recommendation_id: 1, effectiveOdd: 2.0 }],
      defaultHouseId: HOUSE_UUID,
      defaultStake: 25,
    });

    // Any direct bets.update() should not set ledger fields
    for (const updatePayload of mockState.directBetsUpdateCalls) {
      expect(updatePayload).not.toHaveProperty("total_stake");
      expect(updatePayload).not.toHaveProperty("total_odds");
      expect(updatePayload).not.toHaveProperty("house_id");
      expect(updatePayload).not.toHaveProperty("expected_return");
    }
  });

  it("processes mixed INSERT+UPDATE batch correctly", async () => {
    // reco 1: new bet (INSERT path)
    // reco 2: existing pending bet (UPDATE path)
    mockState.recos.set(1, { id: 1, market: "1x2", side: "home", odd_captured: 2.0, units_final: 1 });
    mockState.recos.set(2, { id: 2, market: "over25", side: "yes", odd_captured: 1.8, units_final: 1 });
    mockState.houses.set(HOUSE_UUID, { id: HOUSE_UUID, name: "Bet365" });
    mockState.existingBets.set(2, {
      id: "bet-existing-2",
      ai_recommendation_id: 2,
      status: "pending",
      is_free_bet: false,
    });

    const res = await callRoute({
      recommendations: [
        { ai_recommendation_id: 1, effectiveOdd: 2.0 },
        { ai_recommendation_id: 2, effectiveOdd: 1.8 },
      ],
      defaultHouseId: HOUSE_UUID,
      defaultStake: 10,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: number; failed: unknown[] };
    expect(body.created).toBe(2);
    expect(body.failed).toHaveLength(0);

    // Reco 1: INSERT via place_bet
    const placeBetCall = mockState.rpcCalls.find((c) => c.name === "place_bet");
    expect(placeBetCall).toBeDefined();

    // Reco 2: UPDATE via adjust_bet_stake
    const adjustCall = mockState.rpcCalls.find((c) => c.name === "adjust_bet_stake");
    expect(adjustCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Free bet UPDATE path: must NOT call adjust_bet_stake
// ---------------------------------------------------------------------------

describe("POST /api/ai-reco/apostei/batch — free bet UPDATE path skips adjust_bet_stake", () => {
  it("does NOT call adjust_bet_stake for a free bet pending update", async () => {
    mockState.recos.set(1, { id: 1, market: "1x2", side: "home", odd_captured: 2.0, units_final: 1 });
    mockState.houses.set(HOUSE_UUID, { id: HOUSE_UUID, name: "Bet365" });
    mockState.existingBets.set(1, {
      id: "bet-free-1",
      ai_recommendation_id: 1,
      status: "pending",
      is_free_bet: true,
    });

    const res = await callRoute({
      recommendations: [{ ai_recommendation_id: 1, effectiveOdd: 2.0 }],
      defaultHouseId: HOUSE_UUID,
      defaultStake: 10,
    });

    expect(res.status).toBe(200);

    const adjustCall = mockState.rpcCalls.find((c) => c.name === "adjust_bet_stake");
    expect(adjustCall).toBeUndefined();
  });
});
