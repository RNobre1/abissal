import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TDD — POST /api/bilhete/critic (F2 "Advogado do diabo do bilhete").
 *
 * Contrato:
 *   - auth obrigatória (401 sem sessão);
 *   - kill switch global de IA → 503 { ai_disabled: true };
 *   - body { legs: [{fixtureId?, home, away, market, side, odd}], stakeTotal?, oddCombined? };
 *   - por perna COM fixture no banco: sim via getFixtureSimulation + prob
 *     calibrada reusando a MESMA fiação do compute (isotônica + dist_k +
 *     temperature via buildEdgeTable) → edge da perna vs odd informada;
 *   - perna SEM fixture entra no prompt marcada "sem dados do modelo";
 *   - LLM (OPENROUTER_MODEL) responde JSON {legs:[{verdict,why}],overall:{...}};
 *   - JSON inválido → 502 com erro limpo (e log com error preenchido);
 *   - toda chamada grava llm_request_logs com route='bilhete-critic'.
 *
 * Mock pattern espelha tests/api/ai-reco-compute.test.ts.
 */

interface FixtureRow {
  id: number;
  home_team: string;
  away_team: string;
  league: string | null;
  source_url: string | null;
  kickoff_utc: string | null;
}

interface MockState {
  fixturesById: Record<number, FixtureRow>;
  simByApiId: Record<number, Record<string, unknown>>;
  calibrationRows: Array<{ metric: string; pairs: unknown }>;
  calibratedLeagueRows: Array<{ league: string }>;
  insertedLlmLog: Record<string, unknown> | null;
  authedUserId: string | null;
  aiEnabled: boolean;
}

const mockState: MockState = {
  fixturesById: {},
  simByApiId: {},
  calibrationRows: [],
  calibratedLeagueRows: [],
  insertedLlmLog: null,
  authedUserId: null,
  aiEnabled: true,
};

function resetMock() {
  mockState.fixturesById = {};
  mockState.simByApiId = {};
  mockState.calibrationRows = [];
  mockState.calibratedLeagueRows = [];
  mockState.insertedLlmLog = null;
  mockState.authedUserId = null;
  mockState.aiEnabled = true;
}

function buildAdminMock() {
  return {
    from(table: string) {
      if (table === "app_settings") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = () =>
          Promise.resolve({ data: { value: mockState.aiEnabled }, error: null });
        return chain;
      }

      if (table === "fixtures") {
        const chain: Record<string, unknown> = {};
        let requestedId: number | null = null;
        chain.select = () => chain;
        chain.eq = (col: string, val: unknown) => {
          if (col === "id") requestedId = Number(val);
          return chain;
        };
        chain.maybeSingle = () =>
          Promise.resolve({
            data: requestedId != null ? mockState.fixturesById[requestedId] ?? null : null,
            error: null,
          });
        return chain;
      }

      if (table === "fixture_simulations") {
        const chain: Record<string, unknown> = {};
        let requestedApiId: number | null = null;
        chain.select = () => chain;
        chain.eq = (col: string, val: unknown) => {
          if (col === "fixture_id") requestedApiId = Number(val);
          return chain;
        };
        chain.gte = () => chain;
        chain.lt = () => chain;
        chain.not = () => chain;
        chain.order = () => chain;
        chain.limit = () => chain;
        chain.maybeSingle = () =>
          Promise.resolve({
            data:
              requestedApiId != null
                ? mockState.simByApiId[requestedApiId] ?? null
                : null,
            error: null,
          });
        // getLeaguePerformance aguarda o builder direto (thenable) — devolve
        // vazio: o painel de histórico degrada pra "sem histórico".
        chain.then = (resolve: (v: unknown) => unknown) =>
          resolve({ data: [], error: null });
        return chain;
      }

      if (table === "model_calibration") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.is = () =>
          Promise.resolve({ data: mockState.calibrationRows, error: null });
        return chain;
      }

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
        return chain;
      }

      if (table === "llm_request_logs") {
        const chain: Record<string, unknown> = {};
        chain.insert = (payload: Record<string, unknown>) => {
          mockState.insertedLlmLog = payload;
          return Promise.resolve({ error: null });
        };
        return chain;
      }

      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function buildServerMock() {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: {
            user: mockState.authedUserId ? { id: mockState.authedUserId } : null,
          },
          error: null,
        }),
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
  mockState.authedUserId = "user-1";
  process.env = {
    ...ORIGINAL_ENV,
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk_test_1",
    SUPABASE_SERVICE_ROLE_KEY: "sk_test_1",
    OPENROUTER_API_KEY: "sk-or-test-1",
    OPENROUTER_MODEL: "deepseek/deepseek-v3.2",
  };
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// ── fixtures/builders ───────────────────────────────────────────────────────

const CHOISTATS_ID = 19427226;

function seedModeledFixture() {
  mockState.fixturesById[42] = {
    id: 42,
    home_team: "Liverpool",
    away_team: "Tottenham",
    league: "Premier League",
    source_url: `https://www.adamchoi.co.uk/fixture/${CHOISTATS_ID}/england-liverpool-vs-tottenham`,
    kickoff_utc: "2026-07-31T15:00:00Z",
  };
  mockState.simByApiId[CHOISTATS_ID] = {
    id: 5,
    created_at: "2026-07-30T10:00:00Z",
    fixture_id: CHOISTATS_ID,
    home_team: "Liverpool",
    away_team: "Tottenham",
    league: "Premier League",
    kickoff_utc: "2026-07-31T15:00:00Z",
    model_version: "v8",
    p_home: 0.6,
    p_draw: 0.25,
    p_away: 0.15,
    p_btts: 0.55,
    p_over_25: 0.6,
    top_scorelines: [],
    sim_stats: {
      home: { corners: { p50: 6.0 } },
      away: { corners: { p50: 4.0 } },
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
  };
}

const TWO_LEGS_BODY = {
  legs: [
    {
      fixtureId: 42,
      home: "Liverpool",
      away: "Tottenham",
      market: "1x2",
      side: "home",
      odd: 2.1,
    },
    {
      home: "Foo FC",
      away: "Bar FC",
      market: "over25",
      side: "over",
      odd: 1.9,
    },
  ],
  stakeTotal: 50,
  oddCombined: 3.99,
};

const VALID_CRITIC_JSON = {
  legs: [
    { verdict: "atencao", why: "Edge ok mas favorito moderado fura por empate." },
    { verdict: "fuga", why: "Sem dados do modelo pra sustentar." },
  ],
  overall: {
    summary: "Bilhete com risco concentrado.",
    correlation_flags: ["duas pernas de gols"],
    ev_comment: "EV combinado marginal.",
  },
};

function okLlmFetch(content: unknown = VALID_CRITIC_JSON) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content:
              typeof content === "string" ? content : JSON.stringify(content),
          },
        },
      ],
      usage: { prompt_tokens: 800, completion_tokens: 300, total_tokens: 1100 },
      model: "deepseek/deepseek-v3.2",
    }),
  });
}

async function callRoute(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/bilhete/critic/route");
  return POST(
    new Request("http://localhost/api/bilhete/critic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

// ── testes ──────────────────────────────────────────────────────────────────

describe("POST /api/bilhete/critic — validação e gates", () => {
  it("400 quando body não é JSON", async () => {
    expect((await callRoute("not-json")).status).toBe(400);
  });

  it("400 quando legs está vazio", async () => {
    expect((await callRoute({ legs: [] })).status).toBe(400);
  });

  it("400 quando uma perna tem odd inválida", async () => {
    const body = {
      legs: [{ home: "A", away: "B", market: "1x2", side: "home", odd: 0.9 }],
    };
    expect((await callRoute(body)).status).toBe(400);
  });

  it("400 quando um campo de texto estoura o teto — custo LLM não pode ser drenável", async () => {
    const body = {
      legs: [
        { home: "x".repeat(201), away: "B", market: "1x2", side: "home", odd: 2.0 },
      ],
    };
    expect((await callRoute(body)).status).toBe(400);
  });

  it("401 sem sessão", async () => {
    mockState.authedUserId = null;
    expect((await callRoute(TWO_LEGS_BODY)).status).toBe(401);
  });

  it("503 quando o kill switch global de IA está desligado", async () => {
    mockState.aiEnabled = false;
    const res = await callRoute(TWO_LEGS_BODY);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ai_disabled?: boolean };
    expect(body.ai_disabled).toBe(true);
  });

  it("503 quando OPENROUTER_API_KEY falta", async () => {
    delete process.env.OPENROUTER_API_KEY;
    expect((await callRoute(TWO_LEGS_BODY)).status).toBe(503);
  });
});

describe("POST /api/bilhete/critic — happy path", () => {
  it("monta contexto por perna (sim + edge) e devolve veredicto por perna + geral", async () => {
    seedModeledFixture();
    const mockFetch = okLlmFetch();
    vi.stubGlobal("fetch", mockFetch);

    const res = await callRoute(TWO_LEGS_BODY);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      legs: Array<{
        verdict: string;
        why: string;
        has_model_data: boolean;
        prob_calibrated: number | null;
        edge_pct: number | null;
      }>;
      overall: { summary: string; correlation_flags: string[]; ev_comment: string };
      latencyMs: number;
    };

    expect(body.legs).toHaveLength(2);
    expect(body.legs[0].verdict).toBe("atencao");
    expect(body.legs[0].has_model_data).toBe(true);
    // p_home=0.6 sem curvas → prob calibrada 0.6; edge = 0.6*2.1-1 = +26%
    expect(body.legs[0].prob_calibrated).toBeCloseTo(0.6, 3);
    expect(body.legs[0].edge_pct).toBeCloseTo(26.0, 1);
    expect(body.legs[1].verdict).toBe("fuga");
    expect(body.legs[1].has_model_data).toBe(false);
    expect(body.legs[1].prob_calibrated).toBeNull();
    expect(body.overall.summary).toBe("Bilhete com risco concentrado.");
    expect(typeof body.latencyMs).toBe("number");

    // Prompt enviado ao LLM: perna modelada com números; perna sem fixture
    // marcada "sem dados do modelo"; system com os fatos do modelo.
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(sent.model).toBe("deepseek/deepseek-v3.2");
    const system = sent.messages.find((m) => m.role === "system")!.content;
    const user = sent.messages.find((m) => m.role === "user")!.content;
    expect(system).toContain("3,1");
    expect(system).toContain("corners-under");
    expect(user).toContain("60.0%");
    expect(user).toContain("+26.0%");
    expect(user.toLowerCase()).toContain("sem dados do modelo");
  });

  it("aplica a curva isotônica na prob da perna (mesma fiação do compute)", async () => {
    seedModeledFixture();
    // Curva linear achatando: p → p*0.8. ATENÇÃO: getFixtureSimulation também
    // aplica curvas 1x2 ativas e renormaliza — usar métrica que só o edge-table
    // enxerga não existe pra 1x2; então validamos via over25 (curva única).
    mockState.calibrationRows = [
      { metric: "over25", pairs: [[0, 0], [1, 0.8]] },
    ];
    const body = {
      legs: [
        {
          fixtureId: 42,
          home: "Liverpool",
          away: "Tottenham",
          market: "over25",
          side: "over",
          odd: 1.9,
        },
      ],
    };
    const mockFetch = okLlmFetch({
      legs: [{ verdict: "ok", why: "x" }],
      overall: { summary: "s", correlation_flags: [], ev_comment: "" },
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await callRoute(body);
    expect(res.status).toBe(200);
    const out = (await res.json()) as {
      legs: Array<{ prob_calibrated: number | null }>;
    };
    // p_over_25=0.6 → getFixtureSimulation aplica curva (0.48) → edge table
    // aplica de novo (0.384) — comportamento ESPELHADO do compute (que também
    // compõe as duas camadas). O que importa: a curva foi aplicada.
    expect(out.legs[0].prob_calibrated).not.toBeNull();
    expect(out.legs[0].prob_calibrated!).toBeLessThan(0.6);
  });

  it("grava llm_request_logs com route='bilhete-critic'", async () => {
    seedModeledFixture();
    vi.stubGlobal("fetch", okLlmFetch());

    const res = await callRoute(TWO_LEGS_BODY);
    expect(res.status).toBe(200);

    expect(mockState.insertedLlmLog).not.toBeNull();
    expect(mockState.insertedLlmLog!.route).toBe("bilhete-critic");
    expect(mockState.insertedLlmLog!.model).toBe("deepseek/deepseek-v3.2");
    expect(mockState.insertedLlmLog!.error).toBeNull();
    expect(typeof mockState.insertedLlmLog!.cost_usd).toBe("number");
    expect(mockState.insertedLlmLog!.cost_usd as number).toBeGreaterThan(0);
  });

  it("perna com fixtureId inexistente degrada pra 'sem dados do modelo'", async () => {
    // fixturesById vazio — lookup devolve null, sem crash.
    const body = {
      legs: [
        {
          fixtureId: 777,
          home: "Ghost",
          away: "Team",
          market: "1x2",
          side: "home",
          odd: 2.0,
        },
      ],
    };
    const mockFetch = okLlmFetch({
      legs: [{ verdict: "atencao", why: "sem dados" }],
      overall: { summary: "s", correlation_flags: [], ev_comment: "" },
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await callRoute(body);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { legs: Array<{ has_model_data: boolean }> };
    expect(out.legs[0].has_model_data).toBe(false);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const user = sent.messages.find((m) => m.role === "user")!.content;
    expect(user.toLowerCase()).toContain("sem dados do modelo");
  });
});

describe("POST /api/bilhete/critic — erros do LLM", () => {
  it("502 com erro limpo quando o LLM devolve JSON inválido (e loga o erro)", async () => {
    seedModeledFixture();
    vi.stubGlobal("fetch", okLlmFetch("isto não é JSON, é prosa"));

    const res = await callRoute(TWO_LEGS_BODY);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/ia|inválid/i);

    expect(mockState.insertedLlmLog).not.toBeNull();
    expect(mockState.insertedLlmLog!.route).toBe("bilhete-critic");
    expect(mockState.insertedLlmLog!.error).toBeTruthy();
  });

  it("502 quando OpenRouter responde não-200", async () => {
    seedModeledFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "internal error",
      }),
    );

    const res = await callRoute(TWO_LEGS_BODY);
    expect(res.status).toBe(502);
    expect(mockState.insertedLlmLog).not.toBeNull();
    expect(mockState.insertedLlmLog!.error).toBeTruthy();
  });

  it("502 quando o número de vereditos não bate com o de pernas", async () => {
    seedModeledFixture();
    vi.stubGlobal(
      "fetch",
      okLlmFetch({
        legs: [{ verdict: "ok", why: "só uma" }],
        overall: { summary: "s", correlation_flags: [], ev_comment: "" },
      }),
    );

    const res = await callRoute(TWO_LEGS_BODY);
    expect(res.status).toBe(502);
  });
});
