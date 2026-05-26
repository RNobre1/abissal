/**
 * TDD — actions.ts: addLegToSlip, removeLegFromSlip, updateSlipStake,
 * commitSlip, cancelSlip, getDraftSlip
 *
 * Supabase client is fully mocked — no real DB required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ─────────────────────────────────────────────────────────────
const mockGetUser = vi.fn();

// Mock supabase factory — simplified
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
    }),
}));

// next/cache stub
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  addLegToSlip,
  getDraftSlip,
  updateSlipStake,
  removeLegFromSlip,
  cancelSlip,
} from "../actions";

// ── helpers ──────────────────────────────────────────────────────────────────
const MOCK_USER_ID = "user-uuid-1";

function setupAuth(userId = MOCK_USER_ID) {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
}

// ── getDraftSlip ──────────────────────────────────────────────────────────────
describe("getDraftSlip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
  });

  it("returns null when no draft slip exists", async () => {
    // Chain: from('bet_slips').select(...).eq('user_id',...).eq('status','draft').maybeSingle()
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    });

    const result = await getDraftSlip();
    expect(result).toBeNull();
  });

  it("returns draft slip with legs when found", async () => {
    const mockSlip = {
      id: 1,
      user_id: MOCK_USER_ID,
      status: "draft",
      stake_total: null,
      odd_combined: null,
      potential_return: null,
      bet_id: null,
      thesis: null,
      created_at: "2026-05-26T12:00:00Z",
      updated_at: "2026-05-26T12:00:00Z",
      bet_slip_legs: [
        {
          id: 1,
          slip_id: 1,
          fixture_id: 100,
          home_team: "Liverpool",
          away_team: "Chelsea",
          market: "1x2",
          side: "home",
          odd_taken: 2.0,
          league: "Premier League",
          kickoff_utc: null,
          created_at: "2026-05-26T12:00:00Z",
          ai_recommendation_id: null,
          sport_id: null,
          market_id: null,
        },
      ],
    };

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: mockSlip, error: null }),
          }),
        }),
      }),
    });

    const result = await getDraftSlip();
    expect(result).not.toBeNull();
    expect(result?.status).toBe("draft");
    expect(result?.bet_slip_legs).toHaveLength(1);
  });

  it("returns null when user is not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await getDraftSlip();
    expect(result).toBeNull();
  });
});

// ── addLegToSlip ──────────────────────────────────────────────────────────────
describe("addLegToSlip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
  });

  it("returns error when user is not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await addLegToSlip({
      fixture_id: 100,
      home_team: "A",
      away_team: "B",
      market: "1x2",
      side: "home",
      odd_taken: 2.0,
    });
    expect(result.error).toContain("autenticado");
  });

  it("creates a new draft slip if none exists, then inserts leg", async () => {
    // getDraftSlip returns null → create slip → insert leg → recalculate
    const slipsCalls = { count: 0 };
    const legsCalls = { count: 0 };

    mockFrom.mockImplementation((table: string) => {
      if (table === "bet_slips") {
        slipsCalls.count++;
        if (slipsCalls.count === 1) {
          // getDraftSlip check — returns null
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          };
        } else {
          // insert new slip + update (recalculate)
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi
                  .fn()
                  .mockResolvedValue({ data: { id: 42 }, error: null }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          };
        }
      }
      if (table === "bet_slip_legs") {
        legsCalls.count++;
        if (legsCalls.count === 1) {
          // insert leg
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi
                  .fn()
                  .mockResolvedValue({ data: { id: 10, slip_id: 42 }, error: null }),
              }),
            }),
          };
        } else {
          // recalculate — fetch legs
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ odd_taken: 2.0 }],
                error: null,
              }),
            }),
          };
        }
      }
      return {};
    });

    const result = await addLegToSlip({
      fixture_id: 100,
      home_team: "Liverpool",
      away_team: "Chelsea",
      market: "1x2",
      side: "home",
      odd_taken: 2.0,
      league: "Premier League",
    });

    expect(result.error).toBeUndefined();
    expect(result.legId).toBe(10);
    expect(result.slipId).toBe(42);
  });

  it("reuses existing draft slip when one exists", async () => {
    const existingSlip = {
      id: 99,
      user_id: MOCK_USER_ID,
      status: "draft",
      stake_total: null,
      odd_combined: null,
      potential_return: null,
      bet_id: null,
      thesis: null,
      created_at: "2026-05-26T12:00:00Z",
      updated_at: "2026-05-26T12:00:00Z",
      bet_slip_legs: [],
    };

    const legsCalls = { count: 0 };

    mockFrom.mockImplementation((table: string) => {
      if (table === "bet_slips") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: existingSlip, error: null }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "bet_slip_legs") {
        legsCalls.count++;
        if (legsCalls.count === 1) {
          // insert
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi
                  .fn()
                  .mockResolvedValue({ data: { id: 55, slip_id: 99 }, error: null }),
              }),
            }),
          };
        } else {
          // recalculate
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ odd_taken: 1.75 }],
                error: null,
              }),
            }),
          };
        }
      }
      return {};
    });

    const result = await addLegToSlip({
      fixture_id: 200,
      home_team: "Arsenal",
      away_team: "Man City",
      market: "btts",
      side: "yes",
      odd_taken: 1.75,
    });

    expect(result.error).toBeUndefined();
    expect(result.slipId).toBe(99);
    expect(result.legId).toBe(55);
  });
});

// ── removeLegFromSlip ─────────────────────────────────────────────────────────
describe("removeLegFromSlip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
  });

  it("returns error when user is not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await removeLegFromSlip(1);
    expect(result.error).toContain("autenticado");
  });

  it("deletes the leg and recalculates combined odd", async () => {
    // Setup: find the leg → delete → find remaining legs → update slip
    mockFrom.mockImplementation((table: string) => {
      if (table === "bet_slip_legs") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi
                .fn()
                .mockResolvedValue({ data: { id: 1, slip_id: 10 }, error: null }),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
          // remaining legs after delete
        };
      }
      if (table === "bet_slips") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 10, user_id: MOCK_USER_ID, status: "draft", bet_slip_legs: [] },
                  error: null,
                }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    const result = await removeLegFromSlip(1);
    expect(result.error).toBeUndefined();
  });
});

// ── updateSlipStake ───────────────────────────────────────────────────────────
describe("updateSlipStake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
  });

  it("returns error for non-positive stake", async () => {
    const result = await updateSlipStake(1, -5);
    expect(result.error).toContain("positivo");
  });

  it("returns error when user is not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await updateSlipStake(1, 50);
    expect(result.error).toContain("autenticado");
  });
});

// ── cancelSlip ────────────────────────────────────────────────────────────────
describe("cancelSlip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
  });

  it("returns error when user is not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await cancelSlip(1);
    expect(result.error).toContain("autenticado");
  });

  it("sets status to cancelled", async () => {
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });

    const result = await cancelSlip(1);
    expect(result.error).toBeUndefined();
  });
});
