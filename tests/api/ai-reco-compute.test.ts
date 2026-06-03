import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for POST /api/ai-reco/compute — on-demand AI recommender endpoint.
 *
 * Flow:
 *   1. Validate body { fixtureId: number }
 *   2. Load fixture row (id, league, source_url, detail_json, kickoff_utc, home_team, away_team)
 *   3. Load fixture_simulations row via getFixtureSimulation
 *   4. Load bankroll (defensive query → env → 1000 fallback)
 *   5. Load active isotonic curves via getActiveCurves
 *   6. buildEdgeTable(sim, odds, bankroll, isotonicLookup)
 *   7. Filter candidates with edge_pct >= 20 (v2 — 2026-05-25 tarde)
 *   8. Detect league_calibrated via league_parameters
 *   9. buildPrompt → runRecommender
 *   10. Persist llm_request_logs + ai_recommendations
 *   11. Respond 200 { decision, reco_id, logId, costUsd, latencyMs }
 *
 * Mock pattern follows tests/api/fixtures.test.ts: a chainable supabase mock
 * with per-table behavior selectors, and a vi.fn() fetch impl for OpenRouter.
 */

// -----------------------------------------------------------------------------
// State containers + mock builders
// -----------------------------------------------------------------------------

interface FixtureRow {
  id: number;
  home_team: string;
  away_team: string;
  league: string | null;
  source_url: string | null;
  kickoff_utc: string | null;
  detail_json: Record<string, unknown> | null;
}

interface SimRow {
  id: number;
  created_at: string | null;
  fixture_id: number | null;
  home_team: string;
  away_team: string;
  league: string | null;
  kickoff_utc: string | null;
  model_version: string | null;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  p_btts: number | null;
  p_over_25: number | null;
  top_scorelines: Array<{ score: string; prob: number }>;
  sim_stats: Record<string, unknown> | null;
  per_half_available: boolean;
  market_anchor: Record<string, unknown> | null;
  player_events: unknown[];
  status: string;
  actual_home_goals: number | null;
  actual_away_goals: number | null;
  correct_winner: boolean | null;
  correct_over_under: boolean | null;
  actual_resolved_at: string | null;
}

interface CalibrationRow {
  metric: string;
  pairs: Array<[number, number]>;
  n: number;
  effective_from: string;
}

interface MockState {
  fixtureRow: FixtureRow | null;
  fixtureError: { message: string } | null;
  simRow: SimRow | null;
  calibrationRows: CalibrationRow[];
  calibratedLeagueRows: Array<{ league: string }>;
  bankrollRow: { current_balance: number } | { balance: number } | null;
  bankrollError: { message: string } | null;
  llmLogInsertId: number | null;
  llmLogInsertError: { message: string } | null;
  recoInsertId: number | null;
  recoInsertError: { message: string } | null;
  insertedLlmLog: Record<string, unknown> | null;
  insertedReco: Record<string, unknown> | null;
  authedUserId: string | null;
  authError: boolean;
  aiEnabled: boolean;
}

const mockState: MockState = {
  fixtureRow: null,
  fixtureError: null,
  simRow: null,
  calibrationRows: [],
  calibratedLeagueRows: [],
  bankrollRow: null,
  bankrollError: null,
  llmLogInsertId: 999,
  llmLogInsertError: null,
  recoInsertId: 888,
  recoInsertError: null,
  insertedLlmLog: null,
  insertedReco: null,
  authedUserId: null,
  authError: false,
  aiEnabled: true,
};

function resetMock() {
  mockState.fixtureRow = null;
  mockState.fixtureError = null;
  mockState.simRow = null;
  mockState.calibrationRows = [];
  mockState.calibratedLeagueRows = [];
  mockState.bankrollRow = null;
  mockState.bankrollError = null;
  mockState.llmLogInsertId = 999;
  mockState.llmLogInsertError = null;
  mockState.recoInsertId = 888;
  mockState.recoInsertError = null;
  mockState.insertedLlmLog = null;
  mockState.insertedReco = null;
  mockState.authedUserId = null;
  mockState.authError = false;
  mockState.aiEnabled = true;
}

function buildAdminMock() {
  return {
    from(table: string) {
      // --- app_settings (kill switch global de IA, via isAiEnabled) ---
      if (table === "app_settings") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = () =>
          Promise.resolve({ data: { value: mockState.aiEnabled }, error: null });
        return chain;
      }

      // --- fixtures (lookup by id) ---
      if (table === "fixtures") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = () =>
          Promise.resolve(
            mockState.fixtureError
              ? { data: null, error: mockState.fixtureError }
              : { data: mockState.fixtureRow, error: null },
          );
        return chain;
      }

      // --- fixture_simulations (consumed via getFixtureSimulation) ---
      if (table === "fixture_simulations") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.gte = () => chain;
        chain.lt = () => chain;
        chain.order = () => chain;
        chain.limit = () => chain;
        chain.maybeSingle = () =>
          Promise.resolve({ data: mockState.simRow ?? null, error: null });
        return chain;
      }

      // --- model_calibration (consumed via getActiveCurves) ---
      if (table === "model_calibration") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.is = () =>
          Promise.resolve({ data: mockState.calibrationRows, error: null });
        return chain;
      }

      // --- league_parameters (calibrated league detection) ---
      if (table === "league_parameters") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.is = () => chain;
        chain.limit = () => chain;
        chain.maybeSingle = () =>
          Promise.resolve({
            data: mockState.calibratedLeagueRows[0] ?? null,
            error: null,
          });
        // Some implementations may use `.then` on the full query (no maybeSingle)
        chain.then = (resolve: (v: unknown) => unknown) =>
          resolve({ data: mockState.calibratedLeagueRows, error: null });
        return chain;
      }

      // --- bankroll source (banca_snapshots — degrades gracefully) ---
      if (table === "banca_snapshots" || table === "balance_snapshots") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.order = () => chain;
        chain.limit = () => chain;
        chain.maybeSingle = () =>
          Promise.resolve(
            mockState.bankrollError
              ? { data: null, error: mockState.bankrollError }
              : { data: mockState.bankrollRow, error: null },
          );
        return chain;
      }

      // --- llm_request_logs (insert) ---
      if (table === "llm_request_logs") {
        const chain: Record<string, unknown> = {};
        chain.insert = (payload: Record<string, unknown>) => {
          mockState.insertedLlmLog = payload;
          return chain;
        };
        chain.select = () => chain;
        chain.single = () =>
          Promise.resolve(
            mockState.llmLogInsertError
              ? { data: null, error: mockState.llmLogInsertError }
              : { data: { id: mockState.llmLogInsertId }, error: null },
          );
        chain.maybeSingle = chain.single;
        return chain;
      }

      // --- ai_recommendations (insert) ---
      if (table === "ai_recommendations") {
        const chain: Record<string, unknown> = {};
        chain.insert = (payload: Record<string, unknown>) => {
          mockState.insertedReco = payload;
          return chain;
        };
        chain.select = () => chain;
        chain.single = () =>
          Promise.resolve(
            mockState.recoInsertError
              ? { data: null, error: mockState.recoInsertError }
              : { data: { id: mockState.recoInsertId }, error: null },
          );
        chain.maybeSingle = chain.single;
        return chain;
      }

      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function buildServerMock() {
  return {
    auth: {
      getUser: () => {
        if (mockState.authError) return Promise.reject(new Error("auth failure"));
        return Promise.resolve({
          data: { user: mockState.authedUserId ? { id: mockState.authedUserId } : null },
          error: null,
        });
      },
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(buildServerMock()),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => buildAdminMock(),
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  resetMock();
  // Default: authenticated user so existing tests pass after adding auth gate.
  mockState.authedUserId = "default-test-user";
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
  // Reset module cache so each test re-imports the route with fresh env.
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// -----------------------------------------------------------------------------
// Fixture builders
// -----------------------------------------------------------------------------

function makeFixtureRow(over: Partial<FixtureRow> = {}): FixtureRow {
  return {
    id: 42,
    home_team: "Liverpool",
    away_team: "Tottenham",
    league: "Premier League",
    source_url: "https://www.adamchoi.co.uk/fixture/19427226/england-premier-league-liverpool-vs-tottenham",
    kickoff_utc: "2026-05-25T15:00:00Z",
    detail_json: {
      odds_summary: {
        Result: {
          Liverpool: { bookmaker: "UNIBET", decimal_odds: 2.10 },
          Draw: { bookmaker: "UNIBET", decimal_odds: 3.50 },
          Tottenham: { bookmaker: "UNIBET", decimal_odds: 3.80 },
        },
        "Match Goals Overs/Unders": {
          "Over 2.5": { bookmaker: "UNIBET", decimal_odds: 1.85 },
          "Under 2.5": { bookmaker: "UNIBET", decimal_odds: 2.00 },
        },
        BTTS: {
          Yes: { bookmaker: "UNIBET", decimal_odds: 1.80 },
          No: { bookmaker: "UNIBET", decimal_odds: 2.10 },
        },
      },
      referee: { name: "Anthony Taylor" },
      recent_matches: {
        home: [
          { result: "W", home_goals: 3, away_goals: 1 },
          { result: "W", home_goals: 2, away_goals: 0 },
        ],
        away: [
          { result: "L", home_goals: 0, away_goals: 1 },
          { result: "W", home_goals: 2, away_goals: 1 },
        ],
      },
      h2h: [
        { home_team: "Liverpool", home_goals: 2, away_goals: 1, away_team: "Tottenham" },
      ],
    },
    ...over,
  };
}

function makeSimRow(over: Partial<SimRow> = {}): SimRow {
  return {
    id: 5,
    created_at: "2026-05-24T10:00:00Z",
    fixture_id: 19427226,
    home_team: "Liverpool",
    away_team: "Tottenham",
    league: "Premier League",
    kickoff_utc: "2026-05-25T15:00:00Z",
    model_version: "dc-poisson-1",
    p_home: 0.60, // HIGH edge home: 0.60*2.10 - 1 = 26%
    p_draw: 0.25,
    p_away: 0.15,
    p_btts: 0.55,
    p_over_25: 0.60,
    top_scorelines: [
      { score: "2-1", prob: 0.12 },
      { score: "1-1", prob: 0.10 },
    ],
    sim_stats: {
      home: { goals: { p50: 2.1 }, corners: { p50: 7.2 } },
      away: { goals: { p50: 1.3 }, corners: { p50: 4.8 } },
    },
    per_half_available: true,
    market_anchor: null,
    player_events: [],
    status: "simulated",
    actual_home_goals: null,
    actual_away_goals: null,
    correct_winner: null,
    correct_over_under: null,
    actual_resolved_at: null,
    ...over,
  };
}

const VALID_DECISION = {
  verdict: "bet" as const,
  market: "1x2",
  side: "home",
  prob_estimated: 0.60,
  units_final: 1.5,
  kelly_pre: 1.8,
  reduction_reason: "lineup incerta",
  confidence: "medio" as const,
  summary_line: "1x2/home · 1.5u · 60%",
  reasoning: "Liverpool em casa tem forma sólida e Tottenham vem de viagem complicada.",
  red_flags: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("POST /api/ai-reco/compute — body validation", () => {
  it("returns 400 when body is not JSON", async () => {
    const { POST } = await import("@/app/api/ai-reco/compute/route");
    const res = await POST(
      new Request("http://localhost/api/ai-reco/compute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when fixtureId is missing", async () => {
    const res = await callRoute({});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
  });

  it("returns 400 when fixtureId is not a number", async () => {
    const res = await callRoute({ fixtureId: "abc" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when fixtureId is not a positive integer", async () => {
    const res = await callRoute({ fixtureId: -1 });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/ai-reco/compute — preconditions", () => {
  it("returns 503 when AI is globally disabled (kill switch)", async () => {
    mockState.aiEnabled = false;
    mockState.fixtureRow = makeFixtureRow();
    const res = await callRoute({ fixtureId: 42 });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; ai_disabled?: boolean };
    expect(body.ai_disabled).toBe(true);
    expect(body.error).toMatch(/IA desativada/i);
  });

  it("returns 404 when fixture does not exist", async () => {
    mockState.fixtureRow = null;
    const res = await callRoute({ fixtureId: 9999 });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/fixture/i);
  });

  it("returns 400 when sim is missing", async () => {
    mockState.fixtureRow = makeFixtureRow();
    mockState.simRow = null;
    const res = await callRoute({ fixtureId: 42 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/sim|odds/i);
  });

  it("returns 400 when odds are missing from detail_json", async () => {
    mockState.fixtureRow = makeFixtureRow({ detail_json: { referee: { name: "X" } } });
    mockState.simRow = makeSimRow({ p_home: 0.75, p_draw: 0.15, p_away: 0.10 });
    const res = await callRoute({ fixtureId: 42 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/sim|odds/i);
  });

  it("returns 400 when detail_json is null", async () => {
    mockState.fixtureRow = makeFixtureRow({ detail_json: null });
    mockState.simRow = makeSimRow({ p_home: 0.75, p_draw: 0.15, p_away: 0.10 });
    const res = await callRoute({ fixtureId: 42 });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/ai-reco/compute — happy path", () => {
  it("returns 200 with decision, reco_id, costUsd, latencyMs when OpenRouter succeeds", async () => {
    mockState.fixtureRow = makeFixtureRow();
    // p_home=0.75 → blended α=0.3 com mercado devigado (~0.4645) = 0.5501
    // → edge_blended ~15.5% (passa threshold v3=10%, abaixo sanity 50%).
    // Default p_home=0.60 daria edge_blended ~3.5% (skip no v3).
    // VALID_DECISION.units_final=1.5 → capped a 1.0u (R2: cap calibrada 2.0→1.0).
    mockState.simRow = makeSimRow({ p_home: 0.75, p_draw: 0.15, p_away: 0.10 });
    mockState.calibratedLeagueRows = [{ league: "Premier League" }];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(VALID_DECISION) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
        model: "deepseek/deepseek-r1",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await callRoute({ fixtureId: 42 });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      decision: { verdict: string; units_final: number };
      reco_id: number;
      logId: number;
      costUsd: number;
      latencyMs: number;
    };

    expect(body.decision.verdict).toBe("bet");
    expect(body.decision.units_final).toBe(1.0); // capped 1.5→1.0 (R2)
    expect(body.reco_id).toBe(888);
    expect(body.logId).toBe(999);
    expect(typeof body.costUsd).toBe("number");
    expect(body.costUsd).toBeGreaterThan(0);
    expect(typeof body.latencyMs).toBe("number");

    // Confirms persistence happened
    expect(mockState.insertedLlmLog).not.toBeNull();
    expect(mockState.insertedLlmLog!.route).toBe("ai-reco-on-demand");
    expect(mockState.insertedReco).not.toBeNull();
    expect(mockState.insertedReco!.verdict).toBe("bet");
  });

  it("returns skip path when no candidates have edge >= 20%", async () => {
    // Probs tuned so EVERY market (após blending α=0.5) sits under the
    // 20% edge threshold (v2 — backtest D20 ROI +14.4%). Edges raw:
    // home: 0.45*2.10-1 = -5.5% | draw: 0.28*3.50-1 = -2% | away: 0.27*3.80-1 = 2.6%
    // over: 0.50*1.85-1 = -7.5% | under: 0.50*2.00-1 = 0%
    // btts_sim: 0.55*1.80-1 = -1% | btts_nao: 0.45*2.10-1 = -5.5%
    mockState.fixtureRow = makeFixtureRow();
    mockState.simRow = makeSimRow({
      p_home: 0.45,
      p_draw: 0.28,
      p_away: 0.27,
      p_over_25: 0.50,
      p_btts: 0.55,
    });

    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const res = await callRoute({ fixtureId: 42 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decision: { verdict: string }; reco_id: number };
    expect(body.decision.verdict).toBe("skip");
    expect(body.reco_id).toBe(888);
    // OpenRouter must NOT have been called when skip
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai-reco/compute — model selection", () => {
  it("sends AI_RECO_MODEL_ONDEMAND (deepseek/deepseek-r1) to OpenRouter", async () => {
    // 2026-05-25 (decisão de produto): on-demand revertido pra deepseek-r1
    // (mesmo modelo do batch noturno) por consistência. Latência ~40s p50,
    // aceitável pra uso pessoal de 1 usuário.
    process.env.AI_RECO_MODEL = "deepseek/deepseek-r1";
    process.env.AI_RECO_MODEL_ONDEMAND = "deepseek/deepseek-r1";

    mockState.fixtureRow = makeFixtureRow();
    mockState.simRow = makeSimRow({ p_home: 0.75, p_draw: 0.15, p_away: 0.10 });
    mockState.calibratedLeagueRows = [{ league: "Premier League" }];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(VALID_DECISION) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
        model: "deepseek/deepseek-r1",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await callRoute({ fixtureId: 42 });
    expect(res.status).toBe(200);

    // Inspect the JSON payload sent to OpenRouter
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string) as { model: string };
    expect(sentBody.model).toBe("deepseek/deepseek-r1");

    // ai_recommendations.llm_model must reflect what was actually used
    expect(mockState.insertedReco).not.toBeNull();
    expect(mockState.insertedReco!.llm_model).toBe("deepseek/deepseek-r1");
  });

  it("respects AI_RECO_MODEL_ONDEMAND override (separate from AI_RECO_MODEL)", async () => {
    // O env é separado do batch — se alguém quiser experimentar outro modelo
    // só no on-demand, o override é honrado.
    process.env.AI_RECO_MODEL = "deepseek/deepseek-r1";
    process.env.AI_RECO_MODEL_ONDEMAND = "anthropic/claude-sonnet-4.5";

    mockState.fixtureRow = makeFixtureRow();
    mockState.simRow = makeSimRow({ p_home: 0.75, p_draw: 0.15, p_away: 0.10 });
    mockState.calibratedLeagueRows = [{ league: "Premier League" }];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(VALID_DECISION) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
        model: "anthropic/claude-sonnet-4.5",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await callRoute({ fixtureId: 42 });
    expect(res.status).toBe(200);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string) as { model: string };
    expect(sentBody.model).toBe("anthropic/claude-sonnet-4.5");
  });
});

describe("POST /api/ai-reco/compute — error paths", () => {
  it("returns 502 when OpenRouter responds with non-200", async () => {
    mockState.fixtureRow = makeFixtureRow();
    mockState.simRow = makeSimRow({ p_home: 0.75, p_draw: 0.15, p_away: 0.10 });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal error",
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await callRoute({ fixtureId: 42 });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/openrouter|upstream|500/i);
  });

  it("returns 502 when OpenRouter returns non-parseable content", async () => {
    mockState.fixtureRow = makeFixtureRow();
    mockState.simRow = makeSimRow({ p_home: 0.75, p_draw: 0.15, p_away: 0.10 });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "this is not JSON, just prose" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await callRoute({ fixtureId: 42 });
    expect(res.status).toBe(502);
  });

  it("returns 503 when OPENROUTER_API_KEY is missing and IA is needed", async () => {
    delete process.env.OPENROUTER_API_KEY;
    mockState.fixtureRow = makeFixtureRow();
    mockState.simRow = makeSimRow({ p_home: 0.75, p_draw: 0.15, p_away: 0.10 });
    const res = await callRoute({ fixtureId: 42 });
    expect(res.status).toBe(503);
  });
});

describe("POST /api/ai-reco/compute — cap enforcement", () => {
  it("enforces 0.1u cap when league is NOT calibrated (R3 walk-forward: 0.5→0.1)", async () => {
    mockState.fixtureRow = makeFixtureRow({ league: "Obscure League" });
    mockState.simRow = makeSimRow({ league: "Obscure League", p_home: 0.75, p_draw: 0.15, p_away: 0.10 });
    mockState.calibratedLeagueRows = []; // not calibrated

    const overUnitsDecision = { ...VALID_DECISION, units_final: 1.5 };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(overUnitsDecision) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
        model: "deepseek/deepseek-r1",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await callRoute({ fixtureId: 42 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decision: { units_final: number } };
    // Cap 0.1u enforced (was 1.5, R3 walk-forward)
    expect(body.decision.units_final).toBe(0.1);
  });

  it("enforces 1.0u cap when league IS calibrated (R2 walk-forward: 2.0→1.0)", async () => {
    mockState.fixtureRow = makeFixtureRow();
    mockState.simRow = makeSimRow({ p_home: 0.75, p_draw: 0.15, p_away: 0.10 });
    mockState.calibratedLeagueRows = [{ league: "Premier League" }];

    const overUnitsDecision = { ...VALID_DECISION, units_final: 3.5 };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(overUnitsDecision) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
        model: "deepseek/deepseek-r1",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await callRoute({ fixtureId: 42 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decision: { units_final: number } };
    // Cap 1.0u enforced (was 3.5, R2 walk-forward)
    expect(body.decision.units_final).toBe(1.0);
  });
});

// Avoid unused-var lint for the helper
void jsonResponse;

// Auth gate (added 2026-05-27 -- lockdown Acao 1)

describe("POST /api/ai-reco/compute -- auth gate", () => {
  it("returns 401 when no session (unauthenticated request)", async () => {
    mockState.authedUserId = null;
    mockState.fixtureRow = makeFixtureRow();
    const res = await callRoute({ fixtureId: 42 });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBeDefined();
  });

  it("returns 401 when auth throws", async () => {
    mockState.authedUserId = null;
    mockState.authError = true;
    mockState.fixtureRow = makeFixtureRow();
    expect((await callRoute({ fixtureId: 42 })).status).toBe(401);
  });
});
