/**
 * TDD — Free bet: commitSlip passes is_free_bet to place_bet RPC
 *
 * RED: tests written before implementation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ────────────────────────────────────────────────────────────
const mockRpc = vi.fn();
const mockGetUser = vi.fn();

// commitSlip uses supabaseRaw (the actual Supabase client) for .rpc(),
// and supabase (as AnyClient) for .from(). Both come from same createClient().
const mockMaybeSingle = vi.fn();
const mockEq3 = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockEq2 = vi.fn(() => ({ eq: mockEq3 }));
const mockEq1 = vi.fn(() => ({ eq: mockEq2 }));
const mockSelect = vi.fn(() => ({ eq: mockEq1 }));
const mockUpdate = vi.fn(() => ({ eq: mockEq1 }));
const mockFrom = vi.fn((table: string) => {
  if (table === "bet_slips") return { select: mockSelect, update: mockUpdate };
  return { select: mockSelect, update: mockUpdate };
});

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
  redirect: vi.fn(),
}));

import { commitSlip } from "@/lib/bet-slip/actions";

// ── helpers ───────────────────────────────────────────────────────────────────
const DRAFT_SLIP = {
  id: 1,
  user_id: "user-1",
  status: "draft",
  stake_total: 50,
  odd_combined: 2.5,
  potential_return: 125,
  bet_id: null,
  created_at: "2026-05-27T10:00:00Z",
  updated_at: "2026-05-27T10:00:00Z",
  bet_slip_legs: [
    {
      id: 1,
      home_team: "Flamengo",
      away_team: "Palmeiras",
      market: "Resultado Final",
      side: "Mandante",
      odd_taken: 1.5,
      league: "Brasileirão",
      kickoff_utc: "2026-05-27T20:00:00Z",
      sport_id: null,
      market_id: null,
    },
    {
      id: 2,
      home_team: "Real Madrid",
      away_team: "Barcelona",
      market: "Ambas Marcam",
      side: "Sim",
      odd_taken: 1.8,
      league: "La Liga",
      kickoff_utc: "2026-05-27T20:00:00Z",
      sport_id: null,
      market_id: null,
    },
  ],
};

describe("commitSlip — is_free_bet flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockRpc.mockResolvedValue({ data: "bet-uuid-slip", error: null });

    // Mock the from("bet_slips").select("*, bet_slip_legs(*)").eq(...).eq(...).eq(...).maybeSingle()
    mockMaybeSingle.mockResolvedValue({ data: DRAFT_SLIP, error: null });
    // Mock update (for marking slip as committed)
    mockEq2.mockReturnValue({ eq: mockEq3 });
    mockEq3.mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockEqUpdate = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockEq1Update = vi.fn(() => ({ eq: mockEqUpdate }));
    mockUpdate.mockReturnValue({ eq: mockEq1Update });
  });

  it("passes is_free_bet=true to place_bet RPC when flag is set", async () => {
    const result = await commitSlip(1, "house-uuid-001", true);
    expect(result.error).toBeUndefined();
    expect(mockRpc).toHaveBeenCalledOnce();
    const [fnName, args] = mockRpc.mock.calls[0] as [
      string,
      { p_payload: { is_free_bet: boolean } },
    ];
    expect(fnName).toBe("place_bet");
    expect(args.p_payload.is_free_bet).toBe(true);
  });

  it("passes is_free_bet=false by default", async () => {
    await commitSlip(1, "house-uuid-001");
    const [, args] = mockRpc.mock.calls[0] as [
      string,
      { p_payload: { is_free_bet: boolean } },
    ];
    expect(args.p_payload.is_free_bet).toBe(false);
  });
});
