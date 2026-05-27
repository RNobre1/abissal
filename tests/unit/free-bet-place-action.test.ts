/**
 * TDD — Free bet flag: placeBetAction passes is_free_bet to place_bet RPC
 *
 * RED: tests written before implementation.
 * Verifies:
 *  1. is_free_bet=true is forwarded to the RPC payload
 *  2. is_free_bet=false (default) when not supplied
 *  3. is_free_bet=false when explicitly false
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ────────────────────────────────────────────────────────────
const mockRpc = vi.fn();
const mockGetUser = vi.fn();
const mockEq2 = vi.fn().mockResolvedValue({ error: null });
const mockEq1 = vi.fn(() => ({ eq: mockEq2 }));
const mockUpdate = vi.fn(() => ({ eq: mockEq1 }));
const mockFrom = vi.fn(() => ({ update: mockUpdate }));

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

import { placeBetAction } from "@/app/(dashboard)/bets/actions";

// ── helpers ──────────────────────────────────────────────────────────────────
function buildFormData(overrides: Record<string, string | string[]> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string | string[]> = {
    house_id: "00000000-0000-0000-0000-000000000001",
    kind: "single",
    total_stake: "50,00",
    placed_at: "2026-05-27T10:00",
    note: "",
    event_label: "Flamengo × Palmeiras",
    selection_label: "vitória mandante",
    odds: "3,00",
    event_date: "",
    sport_id: "",
    market_id: "",
    league: "",
  };
  const merged = { ...defaults, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    if (Array.isArray(v)) v.forEach((val) => fd.append(k, val));
    else fd.append(k, v);
  }
  return fd;
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe("placeBetAction — is_free_bet flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockRpc.mockResolvedValue({ data: "bet-uuid-free", error: null });
    mockEq2.mockResolvedValue({ error: null });
  });

  it("passes is_free_bet=true to place_bet RPC when checkbox is checked", async () => {
    const fd = buildFormData({ is_free_bet: "true" });
    try {
      await placeBetAction({}, fd);
    } catch {
      // redirect throws — expected
    }

    expect(mockRpc).toHaveBeenCalledOnce();
    const [fnName, args] = mockRpc.mock.calls[0] as [
      string,
      { p_payload: { is_free_bet: boolean } },
    ];
    expect(fnName).toBe("place_bet");
    expect(args.p_payload.is_free_bet).toBe(true);
  });

  it("passes is_free_bet=false when not supplied", async () => {
    const fd = buildFormData(); // no is_free_bet field
    try {
      await placeBetAction({}, fd);
    } catch {
      // redirect
    }

    const [, args] = mockRpc.mock.calls[0] as [
      string,
      { p_payload: { is_free_bet: boolean } },
    ];
    expect(args.p_payload.is_free_bet).toBe(false);
  });

  it("passes is_free_bet=false when explicitly false", async () => {
    const fd = buildFormData({ is_free_bet: "false" });
    try {
      await placeBetAction({}, fd);
    } catch {
      // redirect
    }

    const [, args] = mockRpc.mock.calls[0] as [
      string,
      { p_payload: { is_free_bet: boolean } },
    ];
    expect(args.p_payload.is_free_bet).toBe(false);
  });
});
