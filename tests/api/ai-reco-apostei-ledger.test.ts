/**
 * TDD — POST /api/ai-reco/apostei ledger correctness (Bug 2 fix)
 *
 * RED phase: verifies that the UPDATE path (idempotent re-stake) calls
 * the adjust_bet_stake RPC instead of doing a direct UPDATE on bets.
 *
 * Bug being fixed: the old UPDATE path called supabase.from('bets').update(...)
 * which changed total_stake/house_id on the bets row but left the original
 * bet_stake transaction unchanged → house_balance diverged.
 *
 * Contract:
 *  - INSERT path (new bet): uses place_bet RPC (unchanged, no ledger bug)
 *  - UPDATE path (pending bet exists): must call adjust_bet_stake RPC with
 *    (bet_id, new_stake, new_house_id) — NOT do a direct bets.update()
 *  - Free bet UPDATE: must NOT call adjust_bet_stake (no transactions to adjust)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

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
  is_free_bet: boolean;
}

interface MockState {
  authUserId: string | null;
  reco: RecoLookup | null;
  house: HouseLookup | null;
  existingBet: ExistingBet | null;
  // RPC call tracking
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  rpcError: { message: string } | null;
  // Direct bets.update() call tracking (should NOT happen in UPDATE path)
  directBetsUpdateCalled: boolean;
  directBetsUpdatePayload: Record<string, unknown> | null;
}

const mockState: MockState = {
  authUserId: "user-uuid-1",
  reco: null,
  house: null,
  existingBet: null,
  rpcCalls: [],
  rpcError: null,
  directBetsUpdateCalled: false,
  directBetsUpdatePayload: null,
};

function resetMock(): void {
  mockState.authUserId = "user-uuid-1";
  mockState.reco = null;
  mockState.house = null;
  mockState.existingBet = null;
  mockState.rpcCalls = [];
  mockState.rpcError = null;
  mockState.directBetsUpdateCalled = false;
  mockState.directBetsUpdatePayload = null;
}

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------

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
      if (table === "ai_recommendations") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = () =>
          Promise.resolve({ data: mockState.reco, error: null });
        return chain;
      }

      if (table === "houses") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.is = () => chain;
        chain.maybeSingle = () =>
          Promise.resolve({ data: mockState.house, error: null });
        return chain;
      }

      if (table === "bets") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = () =>
          Promise.resolve({ data: mockState.existingBet, error: null });

        // Track direct UPDATE calls — these should NOT happen in the UPDATE path anymore
        chain.update = (payload: Record<string, unknown>) => {
          mockState.directBetsUpdateCalled = true;
          mockState.directBetsUpdatePayload = payload;
          const updChain: Record<string, unknown> = {};
          updChain.eq = () => updChain;
          updChain.select = () => updChain;
          updChain.single = () =>
            Promise.resolve({
              data: { id: mockState.existingBet?.id ?? "bet-uuid-upd" },
              error: null,
            });
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
        const chain: Record<string, unknown> = {};
        chain.upsert = () => Promise.resolve({ error: null });
        return chain;
      }

      // Fallback
      const fallback: Record<string, unknown> = {};
      fallback.select = () => fallback;
      fallback.eq = () => fallback;
      fallback.update = () => fallback;
      fallback.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return fallback;
    },
    rpc(name: string, args: Record<string, unknown>) {
      mockState.rpcCalls.push({ name, args });
      if (mockState.rpcError) {
        return Promise.resolve({ data: null, error: mockState.rpcError });
      }
      // place_bet returns a new bet uuid; adjust_bet_stake returns void (no data needed)
      if (name === "place_bet") {
        return Promise.resolve({ data: "bet-uuid-new", error: null });
      }
      if (name === "adjust_bet_stake") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc: ${name}` } });
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
      body: JSON.stringify(body),
    }),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recoOk(over: Partial<RecoLookup> = {}): RecoLookup {
  return { id: 123, market: "btts-sim", side: "yes", odd_captured: 2.1, units_final: 1.5, ...over };
}

function houseOk(over: Partial<HouseLookup> = {}): HouseLookup {
  return { id: "00000000-0000-0000-0000-000000000001", name: "Bet365", ...over };
}

function existingPendingBet(over: Partial<ExistingBet> = {}): ExistingBet {
  return {
    id: "bet-uuid-existing",
    ai_recommendation_id: 123,
    status: "pending",
    is_free_bet: false,
    ...over,
  };
}

const BASE_BODY = {
  aiRecommendationId: 123,
  houseId: "00000000-0000-0000-0000-000000000001",
  stake: 30,
  odd: 2.05,
};

// ---------------------------------------------------------------------------
// UPDATE path: must use adjust_bet_stake RPC
// ---------------------------------------------------------------------------

describe("POST /api/ai-reco/apostei — UPDATE path uses adjust_bet_stake RPC (Bug 2 fix)", () => {
  it("calls adjust_bet_stake RPC when a pending bet already exists", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    mockState.existingBet = existingPendingBet();

    await callRoute(BASE_BODY);

    const adjustCall = mockState.rpcCalls.find((c) => c.name === "adjust_bet_stake");
    expect(adjustCall).toBeDefined();
  });

  it("adjust_bet_stake receives correct bet_id", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    mockState.existingBet = existingPendingBet({ id: "bet-uuid-existing" });

    await callRoute(BASE_BODY);

    const adjustCall = mockState.rpcCalls.find((c) => c.name === "adjust_bet_stake");
    const payload = adjustCall?.args.p_payload as Record<string, unknown>;
    expect(payload?.bet_id).toBe("bet-uuid-existing");
  });

  it("adjust_bet_stake receives new stake", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    mockState.existingBet = existingPendingBet();

    await callRoute({ ...BASE_BODY, stake: 50 });

    const adjustCall = mockState.rpcCalls.find((c) => c.name === "adjust_bet_stake");
    const payload = adjustCall?.args.p_payload as Record<string, unknown>;
    expect(payload?.new_stake).toBe(50);
  });

  it("adjust_bet_stake receives new house_id", async () => {
    const newHouseId = "11111111-1111-1111-1111-111111111111";
    mockState.reco = recoOk();
    mockState.house = houseOk({ id: newHouseId });
    mockState.existingBet = existingPendingBet();

    await callRoute({ ...BASE_BODY, houseId: newHouseId });

    const adjustCall = mockState.rpcCalls.find((c) => c.name === "adjust_bet_stake");
    const payload = adjustCall?.args.p_payload as Record<string, unknown>;
    expect(payload?.new_house_id).toBe(newHouseId);
  });

  it("does NOT call direct bets.update() with stake/odds in UPDATE path", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    mockState.existingBet = existingPendingBet();

    await callRoute(BASE_BODY);

    // If direct update was called, it should NOT contain ledger-relevant fields
    // (stake, odds) — only non-ledger fields (like ai_recommendation_id patch) are allowed
    if (mockState.directBetsUpdateCalled && mockState.directBetsUpdatePayload) {
      const payload = mockState.directBetsUpdatePayload;
      expect(payload).not.toHaveProperty("total_stake");
      expect(payload).not.toHaveProperty("total_odds");
      expect(payload).not.toHaveProperty("house_id");
      expect(payload).not.toHaveProperty("expected_return");
    }
  });

  it("returns 200 with betId after successful RPC call", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    mockState.existingBet = existingPendingBet({ id: "bet-uuid-existing" });

    const res = await callRoute(BASE_BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { betId: string };
    expect(body.betId).toBe("bet-uuid-existing");
  });

  it("returns 500 when adjust_bet_stake RPC fails", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    mockState.existingBet = existingPendingBet();
    mockState.rpcError = { message: "ledger error" };

    const res = await callRoute(BASE_BODY);
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Free bet UPDATE path: must NOT call adjust_bet_stake
// ---------------------------------------------------------------------------

describe("POST /api/ai-reco/apostei — free bet UPDATE path skips adjust_bet_stake", () => {
  it("does NOT call adjust_bet_stake for a free bet pending update", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    mockState.existingBet = existingPendingBet({ is_free_bet: true });

    await callRoute(BASE_BODY);

    const adjustCall = mockState.rpcCalls.find((c) => c.name === "adjust_bet_stake");
    expect(adjustCall).toBeUndefined();
  });

  it("returns 200 for free bet UPDATE path", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    mockState.existingBet = existingPendingBet({ is_free_bet: true });

    const res = await callRoute(BASE_BODY);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// INSERT path: uses place_bet RPC (unchanged)
// ---------------------------------------------------------------------------

describe("POST /api/ai-reco/apostei — INSERT path still uses place_bet RPC", () => {
  it("calls place_bet RPC when no pending bet exists", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    mockState.existingBet = null;

    await callRoute(BASE_BODY);

    const placeBetCall = mockState.rpcCalls.find((c) => c.name === "place_bet");
    expect(placeBetCall).toBeDefined();
  });

  it("does NOT call adjust_bet_stake for INSERT path", async () => {
    mockState.reco = recoOk();
    mockState.house = houseOk();
    mockState.existingBet = null;

    await callRoute(BASE_BODY);

    const adjustCall = mockState.rpcCalls.find((c) => c.name === "adjust_bet_stake");
    expect(adjustCall).toBeUndefined();
  });
});
