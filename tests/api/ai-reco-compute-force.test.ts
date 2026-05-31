/**
 * Tests for POST /api/ai-reco/compute — force=true path.
 *
 * When force=true and ALL candidates are below EDGE_THRESHOLD_PCT (10%),
 * the route must:
 *  1. NOT call persistSkip.
 *  2. Pick the candidate with the highest edge_pct (even if negative).
 *  3. Call the LLM (OpenRouter).
 *  4. Persist the reco with forced=true.
 *  5. Return 200 with the decision.
 *
 * When force=false/absent and no candidates pass the gate → normal skip (unchanged).
 * When force=true and candidates DO pass the gate → normal bet path (forced=false).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── minimal mock re-use (mirrors ai-reco-compute.test.ts pattern) ─────────────

interface FixtureRow {
  id: number;
  home_team: string;
  away_team: string;
  league: string | null;
  source_url: string | null;
  kickoff_utc: string | null;
  detail_json: Record<string, unknown> | null;
}

interface MockState {
  fixtureRow: FixtureRow | null;
  simRow: Record<string, unknown> | null;
  calibratedLeagueRows: Array<{ league: string }>;
  insertedReco: Record<string, unknown> | null;
  authedUserId: string | null;
}

const mockState: MockState = {
  fixtureRow: null,
  simRow: null,
  calibratedLeagueRows: [],
  insertedReco: null,
  authedUserId: "test-user",
};

function reset() {
  mockState.fixtureRow = null;
  mockState.simRow = null;
  mockState.calibratedLeagueRows = [];
  mockState.insertedReco = null;
  mockState.authedUserId = "test-user";
}

function buildAdminMock() {
  return {
    from(table: string) {
      if (table === "fixtures") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () =>
          Promise.resolve({ data: mockState.fixtureRow, error: null });
        return c;
      }
      if (table === "fixture_simulations") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.gte = () => c;
        c.lt = () => c;
        c.order = () => c;
        c.limit = () => c;
        c.maybeSingle = () =>
          Promise.resolve({ data: mockState.simRow ?? null, error: null });
        return c;
      }
      if (table === "model_calibration") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.is = () => Promise.resolve({ data: [], error: null });
        return c;
      }
      if (table === "league_parameters") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.is = () => c;
        c.limit = () => c;
        c.maybeSingle = () =>
          Promise.resolve({
            data: mockState.calibratedLeagueRows[0] ?? null,
            error: null,
          });
        return c;
      }
      if (table === "banca_snapshots" || table === "balance_snapshots") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.order = () => c;
        c.limit = () => c;
        c.maybeSingle = () => Promise.resolve({ data: null, error: null });
        return c;
      }
      if (table === "llm_request_logs") {
        const c: Record<string, unknown> = {};
        c.insert = () => c;
        c.select = () => c;
        c.single = () => Promise.resolve({ data: { id: 999 }, error: null });
        c.maybeSingle = c.single;
        return c;
      }
      if (table === "ai_recommendations") {
        const c: Record<string, unknown> = {};
        c.insert = (payload: Record<string, unknown>) => {
          mockState.insertedReco = payload;
          return c;
        };
        c.select = () => c;
        c.single = () => Promise.resolve({ data: { id: 888 }, error: null });
        c.maybeSingle = c.single;
        return c;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: mockState.authedUserId ? { id: mockState.authedUserId } : null },
          }),
      },
    }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => buildAdminMock(),
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  reset();
  process.env = {
    ...ORIGINAL_ENV,
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk_test_1",
    SUPABASE_SERVICE_ROLE_KEY: "sk_test_1",
    OPENROUTER_API_KEY: "sk-or-test-1",
    OPENROUTER_MODEL: "deepseek/deepseek-r1",
    AI_RECO_MODEL: "deepseek/deepseek-r1",
    AI_RECO_MODEL_ONDEMAND: "deepseek/deepseek-r1",
  };
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeFixture(): FixtureRow {
  return {
    id: 42,
    home_team: "Flamengo",
    away_team: "Fluminense",
    league: "Brasileirao",
    source_url: "https://www.adamchoi.co.uk/fixture/99999/brazil-serie-a",
    kickoff_utc: "2026-06-01T20:00:00Z",
    detail_json: {
      odds_summary: {
        Result: {
          Flamengo: { bookmaker: "BET365", decimal_odds: 1.9 },
          Draw: { bookmaker: "BET365", decimal_odds: 3.4 },
          Fluminense: { bookmaker: "BET365", decimal_odds: 4.2 },
        },
        "Match Goals Overs/Unders": {
          "Over 2.5": { bookmaker: "BET365", decimal_odds: 2.0 },
          "Under 2.5": { bookmaker: "BET365", decimal_odds: 1.9 },
        },
        BTTS: {
          Yes: { bookmaker: "BET365", decimal_odds: 1.75 },
          No: { bookmaker: "BET365", decimal_odds: 2.1 },
        },
      },
    },
  };
}

// Probs such that NO market crosses edge>=10% (home: 0.45*1.9-1 = -14.5%)
function makeSimRowAllBelow(): Record<string, unknown> {
  return {
    id: 10,
    created_at: "2026-06-01T09:00:00Z",
    fixture_id: 99999,
    home_team: "Flamengo",
    away_team: "Fluminense",
    league: "Brasileirao",
    kickoff_utc: "2026-06-01T20:00:00Z",
    model_version: "dc-poisson-1",
    p_home: 0.45,
    p_draw: 0.30,
    p_away: 0.25,
    p_btts: 0.50,
    p_over_25: 0.48,
    top_scorelines: [],
    sim_stats: null,
    per_half_available: false,
    market_anchor: null,
    player_events: [],
    status: "simulated",
    actual_home_goals: null,
    actual_away_goals: null,
    correct_winner: null,
    correct_over_under: null,
    actual_resolved_at: null,
  };
}

// Probs such that home blended edge >= 10%
// blendAlpha=0.3, devigado_home≈1/1.9=0.526
// blended = 0.3*0.80 + 0.7*0.526 ≈ 0.608, edge = 0.608*1.9-1 ≈ 15.5%
function makeSimRowWithEdge(): Record<string, unknown> {
  return {
    ...makeSimRowAllBelow(),
    p_home: 0.80,
    p_draw: 0.12,
    p_away: 0.08,
  };
}

const VALID_DECISION = {
  verdict: "bet" as const,
  market: "1x2",
  side: "home",
  prob_estimated: 0.45,
  units_final: 0.1,
  kelly_pre: 0.1,
  reduction_reason: null,
  confidence: "baixo" as const,
  summary_line: "1x2/home forçado",
  reasoning: "Forçado pelo usuário abaixo do edge mínimo.",
  red_flags: ["edge abaixo do threshold"],
};

async function callRoute(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/ai-reco/compute/route");
  return POST(
    new Request("http://localhost/api/ai-reco/compute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/ai-reco/compute — force=true path", () => {
  it("calls LLM and persists forced=true when force=true and all candidates below threshold", async () => {
    mockState.fixtureRow = makeFixture();
    mockState.simRow = makeSimRowAllBelow();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(VALID_DECISION) } }],
        usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 },
        model: "deepseek/deepseek-r1",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await callRoute({ fixtureId: 42, force: true });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { decision: { verdict: string }; reco_id: number };
    // Should call LLM and return a decision (not skip)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(body.decision.verdict).toBe("bet");
    expect(body.reco_id).toBe(888);

    // forced=true must be persisted
    expect(mockState.insertedReco).not.toBeNull();
    expect(mockState.insertedReco!.forced).toBe(true);
  });

  it("normal skip path when force=false/absent and no candidates pass gate", async () => {
    mockState.fixtureRow = makeFixture();
    mockState.simRow = makeSimRowAllBelow();

    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const res = await callRoute({ fixtureId: 42 }); // no force
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decision: { verdict: string } };
    expect(body.decision.verdict).toBe("skip");
    expect(mockFetch).not.toHaveBeenCalled();
    // forced should be false/absent on skip
    expect(mockState.insertedReco!.forced).toBeFalsy();
  });

  it("uses normal bet path (forced=false) when force=true but candidates DO pass gate", async () => {
    mockState.fixtureRow = makeFixture();
    mockState.simRow = makeSimRowWithEdge(); // home edge ~23.5% > 10%
    mockState.calibratedLeagueRows = [{ league: "Brasileirao" }];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(VALID_DECISION) } }],
        usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 },
        model: "deepseek/deepseek-r1",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await callRoute({ fixtureId: 42, force: true });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // forced must be false when natural gate would have passed anyway
    expect(mockState.insertedReco!.forced).toBe(false);
  });

  it("returns 400 if fixtureId missing (force present but id absent)", async () => {
    const res = await callRoute({ force: true });
    expect(res.status).toBe(400);
  });

  it("returns 404 if fixture not found even with force=true", async () => {
    mockState.fixtureRow = null;
    const res = await callRoute({ fixtureId: 9999, force: true });
    expect(res.status).toBe(404);
  });
});
