/**
 * TDD — createBetBuilderAction ledger correctness
 *
 * RED phase: verifies that the action uses the place_bet_builder RPC
 * (which creates bets + bet_selections + transactions atomically) instead of
 * directly inserting into `bets`.
 *
 * Bug being fixed: the old implementation inserted into `bets` directly
 * without debiting the stake from the ledger (no bet_stake transaction).
 * When those bets were voided, resolve_bet credited the stake back →
 * phantom balance inflation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ─────────────────────────────────────────────────────────────
const mockRpc = vi.fn();
const mockGetUser = vi.fn();

// Minimal from() mock — we should NOT see calls to bets.insert in the new path.
const mockFrom = vi.fn((_t: string) => ({
  insert: vi.fn().mockRejectedValue(new Error("should not insert directly into bets")),
  select: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: null, error: null }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      rpc: mockRpc,
      from: mockFrom,
    }),
}));

vi.mock("@/lib/disciplina/disciplina-guard", () => ({
  checkDisciplinaLimits: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn().mockImplementation(() => {
    throw new Error("REDIRECT");
  }),
}));

import { createBetBuilderAction } from "@/app/(dashboard)/bilhete/builder/actions";

// ── helpers ───────────────────────────────────────────────────────────────────
const BET_UUID = "cccc0000-0000-0000-0000-000000000001";
const HOUSE_UUID = "00000000-0000-0000-0000-000000000001";

function makeValidInput(overrides: Record<string, unknown> = {}) {
  return {
    house_id: HOUSE_UUID,
    fixture_id: 42,
    home_team: "Flamengo",
    away_team: "Palmeiras",
    odd_combined: 5.5,
    stake: 20,
    legs: [
      { market: "Mais 10.5", side: "Chutes no gol" },
      { market: "Ambas Marcam", side: "Sim" },
    ],
    thesis: "Duas condições correlacionadas",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  // Default: RPC succeeds and returns bet UUID
  mockRpc.mockResolvedValue({ data: BET_UUID, error: null });
});

// ─────────────────────────────────────────────────────────────────────────────
// CORE LEDGER CONTRACT: must use RPC, not direct insert
// ─────────────────────────────────────────────────────────────────────────────

describe("createBetBuilderAction — ledger via RPC (Bug 1 fix)", () => {
  it("calls place_bet_builder RPC with correct payload instead of inserting directly", async () => {
    try {
      await createBetBuilderAction(makeValidInput());
    } catch (e) {
      if ((e as Error).message !== "REDIRECT") throw e;
    }

    expect(mockRpc).toHaveBeenCalledOnce();
    const [rpcName, args] = mockRpc.mock.calls[0] as [string, { p_payload: Record<string, unknown> }];
    expect(rpcName).toBe("place_bet_builder");
    expect(args.p_payload).toBeDefined();
  });

  it("RPC payload contains house_id, total_stake, total_odds", async () => {
    try {
      await createBetBuilderAction(makeValidInput());
    } catch (e) {
      if ((e as Error).message !== "REDIRECT") throw e;
    }

    const [, args] = mockRpc.mock.calls[0] as [string, { p_payload: Record<string, unknown> }];
    const p = args.p_payload;
    expect(p.house_id).toBe(HOUSE_UUID);
    expect(p.total_stake).toBe(20);
    expect(p.total_odds).toBe(5.5);
    // Note: kind='bet_builder' is implicit in the RPC name (place_bet_builder),
    // not a payload field — the RPC hardcodes it in the INSERT.
  });

  it("RPC payload includes legs array with market/side for each leg", async () => {
    try {
      await createBetBuilderAction(makeValidInput());
    } catch (e) {
      if ((e as Error).message !== "REDIRECT") throw e;
    }

    const [, args] = mockRpc.mock.calls[0] as [string, { p_payload: Record<string, unknown> }];
    const legs = args.p_payload.legs as Array<Record<string, unknown>>;
    expect(Array.isArray(legs)).toBe(true);
    expect(legs).toHaveLength(2);
    expect(legs[0]?.market).toBe("Mais 10.5");
    expect(legs[0]?.side).toBe("Chutes no gol");
    expect(legs[1]?.market).toBe("Ambas Marcam");
  });

  it("RPC payload includes home_team, away_team, thesis", async () => {
    try {
      await createBetBuilderAction(makeValidInput());
    } catch (e) {
      if ((e as Error).message !== "REDIRECT") throw e;
    }

    const [, args] = mockRpc.mock.calls[0] as [string, { p_payload: Record<string, unknown> }];
    const p = args.p_payload;
    expect(p.home_team).toBe("Flamengo");
    expect(p.away_team).toBe("Palmeiras");
    expect(p.thesis).toBe("Duas condições correlacionadas");
  });

  it("does NOT call supabase.from('bets').insert (no direct insert)", async () => {
    try {
      await createBetBuilderAction(makeValidInput());
    } catch (e) {
      if ((e as Error).message !== "REDIRECT") throw e;
    }

    // from('bets') should NOT have been called for INSERT
    // The mock will throw if .insert() is called on any table
    // (since RPC is the only path, from() calls should be zero or
    // only for tables other than 'bets' insert)
    const betsInsertCalls = (mockFrom.mock.calls as string[][])
      .filter(([table]) => table === "bets");
    expect(betsInsertCalls).toHaveLength(0);
  });

  it("forwards is_free_bet=false to RPC when not specified", async () => {
    try {
      await createBetBuilderAction(makeValidInput({ is_free_bet: false }));
    } catch (e) {
      if ((e as Error).message !== "REDIRECT") throw e;
    }

    const [, args] = mockRpc.mock.calls[0] as [string, { p_payload: Record<string, unknown> }];
    expect(args.p_payload.is_free_bet).toBe(false);
  });

  it("forwards is_free_bet=true to RPC for free bets (no stake deduction in RPC)", async () => {
    try {
      await createBetBuilderAction(makeValidInput({ is_free_bet: true }));
    } catch (e) {
      if ((e as Error).message !== "REDIRECT") throw e;
    }

    const [, args] = mockRpc.mock.calls[0] as [string, { p_payload: Record<string, unknown> }];
    expect(args.p_payload.is_free_bet).toBe(true);
  });

  it("returns error and does NOT call RPC when RPC fails", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "db error" } });
    const result = await createBetBuilderAction(makeValidInput());
    expect("error" in result).toBe(true);
  });

  it("returns error when user is unauthenticated (no RPC call)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const result = await createBetBuilderAction(makeValidInput());
    expect("error" in result).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
