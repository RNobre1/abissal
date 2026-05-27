/**
 * TDD — placeBetAction: sport_id, market_id, league persistence + odd_taken patch
 *
 * Tests the schema validation layer of placeBetAction. The Supabase client
 * is mocked so no real DB is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock — factory avoids hoisting TDZ issue ───────────────────────
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

// Wave F: mock disciplina-guard para evitar chamadas .from() no mock de Supabase acima
// (que não possui esse método). Testes de guard ficam em lib/disciplina/__tests__/.
vi.mock("@/lib/disciplina/disciplina-guard", () => ({
  checkDisciplinaLimits: vi.fn().mockResolvedValue({ allowed: true }),
}));

// next/cache + next/navigation stubs
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
    total_stake: "10,00",
    placed_at: "2026-05-25T10:00",
    note: "",
    event_label: "Flamengo × Palmeiras",
    selection_label: "vitória mandante",
    odds: "1,85",
    event_date: "",
    sport_id: "00000000-0000-0000-0000-000000000010",
    market_id: "00000000-0000-0000-0000-000000000020",
    league: "Brasileirão Série A",
  };
  const merged = { ...defaults, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    if (Array.isArray(v)) v.forEach((val) => fd.append(k, val));
    else fd.append(k, v);
  }
  return fd;
}

// ── tests ────────────────────────────────────────────────────────────────────
describe("placeBetAction — sport_id / market_id / league", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockRpc.mockResolvedValue({ data: "bet-uuid-abc", error: null });
    mockEq2.mockResolvedValue({ error: null });
  });

  it("passes sport_id, market_id, league to place_bet RPC payload", async () => {
    const fd = buildFormData();
    try {
      await placeBetAction({}, fd);
    } catch {
      // redirect throws — expected
    }

    expect(mockRpc).toHaveBeenCalledOnce();
    const [fnName, args] = mockRpc.mock.calls[0] as [string, { p_payload: { selections: Array<{ sport_id: string; market_id: string; league: string }> } }];
    expect(fnName).toBe("place_bet");
    const sel = args.p_payload.selections[0];
    expect(sel.sport_id).toBe("00000000-0000-0000-0000-000000000010");
    expect(sel.market_id).toBe("00000000-0000-0000-0000-000000000020");
    expect(sel.league).toBe("Brasileirão Série A");
  });

  it("omits sport_id/market_id/league when empty strings → null", async () => {
    const fd = buildFormData({ sport_id: "", market_id: "", league: "" });
    try {
      await placeBetAction({}, fd);
    } catch {
      // redirect
    }

    const [, args] = mockRpc.mock.calls[0] as [string, { p_payload: { selections: Array<Record<string, unknown>> } }];
    const sel = args.p_payload.selections[0];
    // empty string → null in action
    expect(sel.sport_id).toBeNull();
    expect(sel.market_id).toBeNull();
    expect(sel.league).toBeNull();
  });

  it("propagates multiple legs with per-leg league/sport/market", async () => {
    const fd = buildFormData({
      kind: "multiple",
      event_label: ["Jogo A", "Jogo B"],
      selection_label: ["sel A", "sel B"],
      odds: ["1,50", "2,00"],
      event_date: ["", ""],
      sport_id: ["sport-1", "sport-1"],
      market_id: ["market-1", "market-2"],
      league: ["Premier League", "La Liga"],
    });
    try {
      await placeBetAction({}, fd);
    } catch {
      // redirect
    }

    const [, args] = mockRpc.mock.calls[0] as [string, { p_payload: { selections: Array<Record<string, unknown>> } }];
    const sels = args.p_payload.selections;
    expect(sels).toHaveLength(2);
    expect(sels[0]?.league).toBe("Premier League");
    expect(sels[1]?.league).toBe("La Liga");
    expect(sels[1]?.market_id).toBe("market-2");
  });

  it("returns error when Supabase RPC fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "DB error" } });
    const result = await placeBetAction({}, buildFormData());
    expect(result.error).toBe("DB error");
  });
});

// ── odd_taken patch tests ─────────────────────────────────────────────────────
describe("placeBetAction — odd_taken patch em bet_selections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockRpc.mockResolvedValue({ data: "bet-uuid-abc", error: null });
    mockEq2.mockResolvedValue({ error: null });
  });

  it("1 leg — atualiza bet_selections com odd_taken correto", async () => {
    const fd = buildFormData({ odds: "1,85" });
    try {
      await placeBetAction({}, fd);
    } catch {
      // redirect throws — expected
    }

    // from("bet_selections") chamado exatamente 1x (1 leg)
    expect(mockFrom).toHaveBeenCalledWith("bet_selections");
    expect(mockUpdate).toHaveBeenCalledWith({ odd_taken: 1.85 });
    // eq("bet_id", <betId>) → eq("position_index", 0)
    expect(mockEq1).toHaveBeenCalledWith("bet_id", "bet-uuid-abc");
    expect(mockEq2).toHaveBeenCalledWith("position_index", 0);
  });

  it("múltiplas legs — cada leg tem odd_taken e position_index correto", async () => {
    const fd = buildFormData({
      kind: "multiple",
      event_label: ["Jogo A", "Jogo B"],
      selection_label: ["sel A", "sel B"],
      odds: ["1,50", "2,00"],
      event_date: ["", ""],
      sport_id: ["", ""],
      market_id: ["", ""],
      league: ["", ""],
    });
    try {
      await placeBetAction({}, fd);
    } catch {
      // redirect
    }

    // from("bet_selections") chamado 2x (2 legs)
    expect(mockFrom).toHaveBeenCalledTimes(2);

    // Primeira leg: odd 1.50 → position_index 0
    expect(mockUpdate.mock.calls[0]).toEqual([{ odd_taken: 1.5 }]);
    expect(mockEq2.mock.calls[0]).toEqual(["position_index", 0]);

    // Segunda leg: odd 2.00 → position_index 1
    expect(mockUpdate.mock.calls[1]).toEqual([{ odd_taken: 2.0 }]);
    expect(mockEq2.mock.calls[1]).toEqual(["position_index", 1]);
  });
});
