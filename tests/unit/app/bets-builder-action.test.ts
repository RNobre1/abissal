/**
 * TDD — createBetBuilderAction
 *
 * Tests schema validation, auth gate, disciplina guard, and INSERT path.
 * Supabase client is fully mocked — no real DB needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ─────────────────────────────────────────────────────────────
const mockGetUser = vi.fn();
const mockInsertSingle = vi.fn();
const mockInsert = vi.fn(() => ({ select: vi.fn(() => ({ single: mockInsertSingle })) }));
const mockInsertSelections = vi.fn().mockResolvedValue({ error: null });
const mockFrom = vi.fn((table: string) => {
  if (table === "bets") return { insert: mockInsert };
  if (table === "bet_selections") return { insert: mockInsertSelections };
  return { insert: vi.fn() };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
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
    mockInsertSingle.mockResolvedValue({ data: { id: BET_UUID }, error: null });
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
    // Should not return a validation error
    expect(thrown || mockInsertSingle.mock.calls.length > 0).toBe(true);
  });
});

// ── disciplina guard ──────────────────────────────────────────────────────────
describe("createBetBuilderAction — disciplina guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockInsertSingle.mockResolvedValue({ data: { id: BET_UUID }, error: null });
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
    mockInsertSingle.mockResolvedValue({ data: { id: BET_UUID }, error: null });
    mockInsertSelections.mockResolvedValue({ error: null });
    let redirected = false;
    try {
      await createBetBuilderAction(makeValidInput());
    } catch (e) {
      if ((e as Error).message === "REDIRECT") redirected = true;
    }
    expect(redirected || mockInsertSingle.mock.calls.length > 0).toBe(true);
  });
});

// ── INSERT path ───────────────────────────────────────────────────────────────
describe("createBetBuilderAction — INSERT path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockInsertSingle.mockResolvedValue({ data: { id: BET_UUID }, error: null });
    mockInsertSelections.mockResolvedValue({ error: null });
  });

  it("inserts bets row with kind=bet_builder and correct fields", async () => {
    try {
      await createBetBuilderAction(makeValidInput());
    } catch {
      // redirect
    }
    expect(mockFrom).toHaveBeenCalledWith("bets");
    const [betPayload] = mockInsert.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(betPayload.kind).toBe("bet_builder");
    expect(betPayload.total_odds).toBe(5.5);
    expect(betPayload.total_stake).toBe(20);
    expect(betPayload.status).toBe("pending");
    expect(betPayload.house_id).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("inserts N bet_selections rows (one per leg) with odd_taken=null", async () => {
    try {
      await createBetBuilderAction(makeValidInput());
    } catch {
      // redirect
    }
    expect(mockFrom).toHaveBeenCalledWith("bet_selections");
    const [selectionsPayload] = mockInsertSelections.mock.calls[0] as [
      Array<Record<string, unknown>>,
    ];
    expect(selectionsPayload).toHaveLength(2);
    // odd_taken must be null for bet_builder legs
    expect(selectionsPayload[0]?.odd_taken).toBeNull();
    expect(selectionsPayload[1]?.odd_taken).toBeNull();
    // odds must be odd_combined (satisfies CHECK > 1); not 0
    expect(selectionsPayload[0]?.odds).toBe(5.5);
    // event_label and selection_label populated
    expect(String(selectionsPayload[0]?.event_label)).toContain("Flamengo");
    expect(String(selectionsPayload[0]?.selection_label)).toContain("Mais 10.5");
  });

  it("returns error when bets INSERT fails", async () => {
    mockInsertSingle.mockResolvedValue({ data: null, error: { message: "db fail" } });
    const result = await createBetBuilderAction(makeValidInput());
    expect("error" in result).toBe(true);
  });

  // ── NEW: odds CHECK constraint + selError atomicity ───────────────────────

  it("odds field passes the CHECK constraint (odds > 1) — stores odd_combined not 0", async () => {
    try {
      await createBetBuilderAction(makeValidInput());
    } catch {
      // redirect
    }
    const [selectionsPayload] = mockInsertSelections.mock.calls[0] as [
      Array<Record<string, unknown>>,
    ];
    // odd_combined is 5.5 in makeValidInput; each selection must carry that value
    expect(Number(selectionsPayload[0]?.odds)).toBeGreaterThan(1);
    expect(selectionsPayload[0]?.odds).toBe(5.5);
  });

  it("selError DELETEs the bets row and returns error (atomicity)", async () => {
    const mockDeleteEq = vi.fn().mockResolvedValue({ error: null });
    const mockDelete = vi.fn(() => ({ eq: mockDeleteEq }));
    mockFrom.mockImplementation((table: string) => {
      if (table === "bets") return { insert: mockInsert, delete: mockDelete };
      if (table === "bet_selections")
        return { insert: vi.fn().mockResolvedValue({ error: { message: "check_violation" } }) };
      return { insert: vi.fn() };
    });

    const result = await createBetBuilderAction(makeValidInput());

    expect("error" in result).toBe(true);
    expect(mockDelete).toHaveBeenCalled();

    // restore mock for other tests
    mockFrom.mockImplementation((table: string) => {
      if (table === "bets") return { insert: mockInsert };
      if (table === "bet_selections") return { insert: mockInsertSelections };
      return { insert: vi.fn() };
    });
  });
});
