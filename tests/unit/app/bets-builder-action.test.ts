/**
 * TDD — createBetBuilderAction
 *
 * Tests schema validation, auth gate, disciplina guard, and RPC path.
 * Supabase client is fully mocked — no real DB needed.
 *
 * NOTE (2026-06-09, Bug 1 fix / migration 0051): the action now delegates
 * all inserts to the `place_bet_builder` RPC, which handles bets +
 * bet_selections + transactions atomically. Direct insertion into `bets`
 * has been removed to close the ledger debit gap.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ─────────────────────────────────────────────────────────────
const mockGetUser = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      rpc: mockRpc,
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
import { checkDisciplinaLimits } from "@/lib/disciplina/disciplina-guard";

// ── helpers ───────────────────────────────────────────────────────────────────
function makeValidInput() {
  return {
    house_id: "00000000-0000-0000-0000-000000000001",
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
  };
}

const BET_UUID = "aaaabbbb-0000-0000-0000-000000000001";

// ── auth gate ─────────────────────────────────────────────────────────────────
describe("createBetBuilderAction — auth gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when user is null", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const result = await createBetBuilderAction(makeValidInput());
    expect("error" in result && result.error).toMatch(/sess/i);
  });
});

// ── schema validation ─────────────────────────────────────────────────────────
describe("createBetBuilderAction — schema validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockRpc.mockResolvedValue({ data: BET_UUID, error: null });
  });

  it("rejects odd_combined <= 1.01", async () => {
    const input = { ...makeValidInput(), odd_combined: 1.0 };
    const result = await createBetBuilderAction(input);
    expect("error" in result).toBe(true);
  });

  it("rejects stake <= 0", async () => {
    const input = { ...makeValidInput(), stake: 0 };
    const result = await createBetBuilderAction(input);
    expect("error" in result).toBe(true);
  });

  it("rejects empty legs array", async () => {
    const input = { ...makeValidInput(), legs: [] };
    const result = await createBetBuilderAction(input);
    expect("error" in result).toBe(true);
  });

  it("rejects leg with empty market", async () => {
    const input = { ...makeValidInput(), legs: [{ market: "", side: "Sim" }] };
    const result = await createBetBuilderAction(input);
    expect("error" in result).toBe(true);
  });

  it("accepts fixture_id null (sem fixture)", async () => {
    const input = { ...makeValidInput(), fixture_id: null };
    let thrown = false;
    try {
      await createBetBuilderAction(input);
    } catch (e) {
      thrown = (e as Error).message === "REDIRECT";
    }
    // Should not return a validation error — either redirected or RPC called
    expect(thrown || mockRpc.mock.calls.length > 0).toBe(true);
  });
});

// ── disciplina guard ──────────────────────────────────────────────────────────
describe("createBetBuilderAction — disciplina guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockRpc.mockResolvedValue({ data: BET_UUID, error: null });
  });

  it("blocks bet when disciplina guard disallows", async () => {
    vi.mocked(checkDisciplinaLimits).mockResolvedValueOnce({
      allowed: false,
      reason: "limite diário atingido",
    });
    const result = await createBetBuilderAction(makeValidInput());
    expect("error" in result && result.error).toMatch(/limite|disciplina/i);
  });

  it("proceeds when disciplina guard allows", async () => {
    vi.mocked(checkDisciplinaLimits).mockResolvedValueOnce({ allowed: true });
    mockRpc.mockResolvedValue({ data: BET_UUID, error: null });
    let redirected = false;
    try {
      await createBetBuilderAction(makeValidInput());
    } catch (e) {
      if ((e as Error).message === "REDIRECT") redirected = true;
    }
    expect(redirected || mockRpc.mock.calls.length > 0).toBe(true);
  });
});

// ── RPC path (replaces the old direct INSERT path) ────────────────────────────
describe("createBetBuilderAction — RPC path (place_bet_builder)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockRpc.mockResolvedValue({ data: BET_UUID, error: null });
  });

  it("calls place_bet_builder RPC with total_odds, total_stake, house_id", async () => {
    try {
      await createBetBuilderAction(makeValidInput());
    } catch {
      // redirect
    }
    expect(mockRpc).toHaveBeenCalledOnce();
    const [rpcName, args] = mockRpc.mock.calls[0] as [string, { p_payload: Record<string, unknown> }];
    expect(rpcName).toBe("place_bet_builder");
    const p = args.p_payload;
    // Note: kind='bet_builder' is implicit in the RPC name, not a payload field.
    expect(p.total_odds).toBe(5.5);
    expect(p.total_stake).toBe(20);
    expect(p.house_id).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("passes legs array with market+side per leg to the RPC", async () => {
    try {
      await createBetBuilderAction(makeValidInput());
    } catch {
      // redirect
    }
    const [, args] = mockRpc.mock.calls[0] as [string, { p_payload: Record<string, unknown> }];
    const legs = args.p_payload.legs as Array<Record<string, unknown>>;
    expect(legs).toHaveLength(2);
    expect(legs[0]?.market).toBe("Mais 10.5");
    expect(legs[0]?.side).toBe("Chutes no gol");
    expect(legs[1]?.market).toBe("Ambas Marcam");
  });

  it("passes home_team, away_team, thesis to the RPC", async () => {
    try {
      await createBetBuilderAction(makeValidInput());
    } catch {
      // redirect
    }
    const [, args] = mockRpc.mock.calls[0] as [string, { p_payload: Record<string, unknown> }];
    expect(args.p_payload.home_team).toBe("Flamengo");
    expect(args.p_payload.away_team).toBe("Palmeiras");
    expect(args.p_payload.thesis).toBe("Duas condições correlacionadas");
  });

  it("returns error when RPC fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "db fail" } });
    const result = await createBetBuilderAction(makeValidInput());
    expect("error" in result).toBe(true);
  });

  it("passes is_free_bet=false by default", async () => {
    try {
      await createBetBuilderAction(makeValidInput());
    } catch {
      // redirect
    }
    const [, args] = mockRpc.mock.calls[0] as [string, { p_payload: Record<string, unknown> }];
    expect(args.p_payload.is_free_bet).toBe(false);
  });

  it("passes is_free_bet=true when specified (free bet — RPC skips ledger debit)", async () => {
    try {
      await createBetBuilderAction({ ...makeValidInput(), is_free_bet: true });
    } catch {
      // redirect
    }
    const [, args] = mockRpc.mock.calls[0] as [string, { p_payload: Record<string, unknown> }];
    expect(args.p_payload.is_free_bet).toBe(true);
  });
});
