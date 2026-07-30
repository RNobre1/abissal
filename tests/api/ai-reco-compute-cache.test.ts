/**
 * Tests for /api/ai-reco/compute — idempotency cache + GET status.
 *
 * Motivação de produção: p95 do R1 on-demand = 153s e o client desconecta
 * antes disso; sem idempotência, 5 cliques = 5 chamadas LLM pagas para o
 * MESMO fixture. Telemetria real: 49 cliques → 36 respostas.
 *
 * Contrato novo:
 *  POST — ANTES de chamar o LLM, consulta `ai_recommendations` por
 *    (fixture_id [choistats id], prompt_version atual, llm_model atual,
 *    forced=false, created_at recente). Hit → 200 { cached: true, ... }
 *    SEM nova chamada LLM e SEM novo insert. `force: true` bypassa o cache.
 *  GET ?fixtureId= — status barato (escalares apenas): existe reco cacheada
 *    para (fixture, prompt_version, model)? Usado pelo polling de recuperação
 *    do client quando o fetch do POST morre com o server ainda processando.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROMPT_VERSION } from "@/lib/ai-reco/prompts";

// ── mock state ────────────────────────────────────────────────────────────────

interface FixtureRow {
  id: number;
  home_team: string;
  away_team: string;
  league: string | null;
  source_url: string | null;
  kickoff_utc: string | null;
  detail_json: Record<string, unknown> | null;
}

interface CachedRecoRow {
  id: number;
  verdict: string;
  market: string | null;
  side: string | null;
  prob_estimated: number | null;
  units_final: number | null;
  kelly_pre: number | null;
  reduction_reason: string | null;
  confidence: string | null;
  summary_line: string | null;
  reasoning_full: string | null;
  red_flags: string[] | null;
  llm_log_id: number | null;
  created_at: string;
}

interface MockState {
  fixtureRow: FixtureRow | null;
  simRow: Record<string, unknown> | null;
  cachedRecoRow: CachedRecoRow | null;
  /** filtros aplicados na consulta de cache (eq/gte) — pra validar a chave */
  cacheFilters: Array<[string, unknown]>;
  insertedRecos: Array<Record<string, unknown>>;
  authedUserId: string | null;
  aiEnabled: boolean;
}

const mockState: MockState = {
  fixtureRow: null,
  simRow: null,
  cachedRecoRow: null,
  cacheFilters: [],
  insertedRecos: [],
  authedUserId: "test-user",
  aiEnabled: true,
};

function reset() {
  mockState.fixtureRow = null;
  mockState.simRow = null;
  mockState.cachedRecoRow = null;
  mockState.cacheFilters = [];
  mockState.insertedRecos = [];
  mockState.authedUserId = "test-user";
  mockState.aiEnabled = true;
}

function buildAdminMock() {
  return {
    from(table: string) {
      if (table === "app_settings") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () =>
          Promise.resolve({ data: { value: mockState.aiEnabled }, error: null });
        return c;
      }
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
        c.maybeSingle = () => Promise.resolve({ data: null, error: null });
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
        // Um chain novo por chamada de from(): o caminho de INSERT usa
        // .insert().select().single(); o caminho de SELECT (cache lookup) usa
        // .select().eq()...gte().order().limit().maybeSingle().
        const c: Record<string, unknown> = {};
        let inserted = false;
        c.insert = (payload: Record<string, unknown>) => {
          mockState.insertedRecos.push(payload);
          inserted = true;
          return c;
        };
        c.select = () => c;
        c.eq = (col: string, val: unknown) => {
          mockState.cacheFilters.push([col, val]);
          return c;
        };
        c.gte = (col: string, val: unknown) => {
          mockState.cacheFilters.push([`gte:${col}`, val]);
          return c;
        };
        c.order = () => c;
        c.limit = () => c;
        c.single = () => Promise.resolve({ data: { id: 888 }, error: null });
        c.maybeSingle = () =>
          Promise.resolve(
            inserted
              ? { data: { id: 888 }, error: null }
              : { data: mockState.cachedRecoRow, error: null },
          );
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
            data: {
              user: mockState.authedUserId ? { id: mockState.authedUserId } : null,
            },
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
    kickoff_utc: "2026-08-01T20:00:00Z",
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

// home blended edge >= 10% → caminho de LLM no miss
function makeSimRowWithEdge(): Record<string, unknown> {
  return {
    id: 10,
    created_at: "2026-08-01T09:00:00Z",
    fixture_id: 99999,
    home_team: "Flamengo",
    away_team: "Fluminense",
    league: "Brasileirao",
    kickoff_utc: "2026-08-01T20:00:00Z",
    model_version: "dc-poisson-1",
    p_home: 0.8,
    p_draw: 0.12,
    p_away: 0.08,
    p_btts: 0.5,
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

function makeCachedReco(over: Partial<CachedRecoRow> = {}): CachedRecoRow {
  return {
    id: 777,
    verdict: "bet",
    market: "1x2",
    side: "home",
    prob_estimated: 0.61,
    units_final: 1.0,
    kelly_pre: 1.2,
    reduction_reason: null,
    confidence: "medio",
    summary_line: "1x2/home · 1.0u",
    reasoning_full: "Análise cacheada.",
    red_flags: [],
    llm_log_id: 555,
    created_at: new Date(Date.now() - 60_000).toISOString(),
    ...over,
  };
}

const VALID_DECISION = {
  verdict: "bet" as const,
  market: "1x2",
  side: "home",
  prob_estimated: 0.6,
  units_final: 0.1,
  kelly_pre: 0.1,
  reduction_reason: null,
  confidence: "baixo" as const,
  summary_line: "1x2/home",
  reasoning: "ok",
  red_flags: [],
};

function mockLlmFetch() {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(VALID_DECISION) } }],
      usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 },
      model: "deepseek/deepseek-r1",
    }),
  });
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

async function callPost(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/ai-reco/compute/route");
  return POST(
    new Request("http://localhost/api/ai-reco/compute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function callGet(query: string): Promise<Response> {
  const { GET } = await import("@/app/api/ai-reco/compute/route");
  return GET(new Request(`http://localhost/api/ai-reco/compute${query}`));
}

// ── route config: request honesto ─────────────────────────────────────────────

describe("route config", () => {
  it("declara maxDuration=300 — o p95 real (153s) não pode morrer por construção", async () => {
    const route = await import("@/app/api/ai-reco/compute/route");
    expect(route.maxDuration).toBe(300);
  });
});

// ── POST: idempotency cache ───────────────────────────────────────────────────

describe("POST /api/ai-reco/compute — idempotency cache", () => {
  it("cache HIT: returns 200 {cached:true} without calling the LLM or inserting", async () => {
    mockState.fixtureRow = makeFixture();
    mockState.simRow = makeSimRowWithEdge();
    mockState.cachedRecoRow = makeCachedReco();

    const mockFetch = mockLlmFetch();

    const res = await callPost({ fixtureId: 42 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cached: boolean;
      reco_id: number;
      decision: { verdict: string; summary_line: string | null };
      costUsd: number;
    };

    expect(body.cached).toBe(true);
    expect(body.reco_id).toBe(777);
    expect(body.decision.verdict).toBe("bet");
    expect(body.decision.summary_line).toBe("1x2/home · 1.0u");
    expect(body.costUsd).toBe(0);
    // Nenhuma chamada LLM paga, nenhum insert duplicado
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockState.insertedRecos).toHaveLength(0);
  });

  it("cache key: filters by fixture_id (choistats), prompt_version, llm_model, forced=false and recency", async () => {
    mockState.fixtureRow = makeFixture();
    mockState.cachedRecoRow = makeCachedReco();
    mockLlmFetch();

    await callPost({ fixtureId: 42 });

    const eqFilters = mockState.cacheFilters.filter(([k]) => !k.startsWith("gte:"));
    expect(eqFilters).toContainEqual(["fixture_id", 99999]);
    expect(eqFilters).toContainEqual(["prompt_version", PROMPT_VERSION]);
    expect(eqFilters).toContainEqual(["llm_model", "deepseek/deepseek-r1"]);
    expect(eqFilters).toContainEqual(["forced", false]);
    // recência: um gte em created_at
    expect(
      mockState.cacheFilters.some(([k]) => k === "gte:created_at"),
    ).toBe(true);
  });

  it("cache MISS: proceeds to the normal flow (LLM called, reco inserted)", async () => {
    mockState.fixtureRow = makeFixture();
    mockState.simRow = makeSimRowWithEdge();
    mockState.cachedRecoRow = null;

    const mockFetch = mockLlmFetch();

    const res = await callPost({ fixtureId: 42 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cached?: boolean; reco_id: number };

    expect(body.cached).toBeFalsy();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockState.insertedRecos).toHaveLength(1);
  });

  it("force=true BYPASSES the cache (LLM called even with a cached reco present)", async () => {
    mockState.fixtureRow = makeFixture();
    mockState.simRow = makeSimRowWithEdge();
    mockState.cachedRecoRow = makeCachedReco();

    const mockFetch = mockLlmFetch();

    const res = await callPost({ fixtureId: 42, force: true });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockState.insertedRecos).toHaveLength(1);
  });
});

// ── GET: cheap status probe ───────────────────────────────────────────────────

describe("GET /api/ai-reco/compute — status probe", () => {
  it("returns exists:true with scalar fields when a cached reco exists", async () => {
    mockState.fixtureRow = makeFixture();
    mockState.cachedRecoRow = makeCachedReco();

    const res = await callGet("?fixtureId=42");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      exists: boolean;
      reco_id: number | null;
      verdict: string | null;
      created_at: string | null;
    };
    expect(body.exists).toBe(true);
    expect(body.reco_id).toBe(777);
    expect(body.verdict).toBe("bet");
    expect(typeof body.created_at).toBe("string");
  });

  it("returns exists:false when there is no cached reco", async () => {
    mockState.fixtureRow = makeFixture();
    mockState.cachedRecoRow = null;

    const res = await callGet("?fixtureId=42");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { exists: boolean; reco_id: number | null };
    expect(body.exists).toBe(false);
    expect(body.reco_id).toBeNull();
  });

  it("returns 400 for a missing/invalid fixtureId", async () => {
    expect((await callGet("")).status).toBe(400);
    expect((await callGet("?fixtureId=abc")).status).toBe(400);
    expect((await callGet("?fixtureId=-3")).status).toBe(400);
  });

  it("returns 401 without a session", async () => {
    mockState.authedUserId = null;
    mockState.fixtureRow = makeFixture();
    expect((await callGet("?fixtureId=42")).status).toBe(401);
  });

  it("returns 404 when fixture does not exist", async () => {
    mockState.fixtureRow = null;
    expect((await callGet("?fixtureId=42")).status).toBe(404);
  });
});
