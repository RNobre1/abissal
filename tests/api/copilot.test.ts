import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for POST /api/copilot — the fixtures-day chat backed by tool calls.
 *
 * The route runs a loop:
 *   1. Call OpenRouter with system + messages + tools.
 *   2. If the response includes tool_calls, execute query_fixtures and
 *      re-call with the tool results appended.
 *   3. Loop bounded at MAX_TOOL_HOPS (6) to keep token cost capped.
 *   4. Return the final text content as JSON.
 *
 * No streaming for the first version — keeps the tool dance simple.
 */

type AdminState = {
  rows: unknown[];
  single?: unknown;
};

const adminState: AdminState = { rows: [] };

function buildAdminMock(state: AdminState) {
  return {
    from(table: string) {
      if (table !== "fixtures") throw new Error("unexpected table: " + table);
      const chain = {
        select() {
          return chain;
        },
        or() {
          return chain;
        },
        order() {
          return chain;
        },
        eq() {
          return chain;
        },
        maybeSingle() {
          return Promise.resolve({ data: state.single ?? null, error: null });
        },
        then(resolve: (v: { data: unknown[]; error: null }) => void) {
          resolve({ data: state.rows, error: null });
        },
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => buildAdminMock(adminState),
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  adminState.rows = [];
  adminState.single = undefined;
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function withUsage<T extends { choices: unknown[] }>(
  body: T,
  usage: { prompt_tokens: number; completion_tokens: number },
): T {
  return { ...body, usage } as T;
}

function toolCallResponse(name: string, args: object, id = "call_1") {
  return jsonResponse({
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  });
}

function finalResponse(content: string) {
  return jsonResponse({
    choices: [
      {
        message: { role: "assistant", content },
      },
    ],
  });
}

describe("POST /api/copilot", () => {
  it("returns 400 on missing messages[]", async () => {
    const { POST } = await import("@/app/api/copilot/route");
    const req = new Request("http://x/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when messages[] is empty", async () => {
    const { POST } = await import("@/app/api/copilot/route");
    const req = new Request("http://x/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 503 when OPENROUTER_API_KEY is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { POST } = await import("@/app/api/copilot/route");
    const req = new Request("http://x/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "oi" }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it("plain answer (no tool call): returns content directly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      finalResponse("oi! como posso ajudar?"),
    );
    const { POST } = await import("@/app/api/copilot/route");
    const req = new Request("http://x/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "oi" }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("oi! como posso ajudar?");
  });

  it("tool round-trip: executes query_fixtures, feeds result back, returns final text", async () => {
    adminState.rows = [
      {
        id: 7,
        match_date: "2026-05-12",
        ko_time: "20:00",
        home_team: "Botafogo",
        away_team: "Flamengo",
        league: "Brasileirão Série A",
        country: "brazil",
        source_url: null,
        kickoff_utc: "2026-05-12T23:00:00Z",
        detail_json: null,
      },
    ];

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        toolCallResponse("query_fixtures", { date: "today", country: "brazil" }),
      )
      .mockResolvedValueOnce(
        finalResponse("Encontrei 1 jogo hoje no Brasil: Botafogo vs Flamengo às 20:00 BRT."),
      );

    const { POST } = await import("@/app/api/copilot/route");
    const req = new Request("http://x/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "tem jogo no Brasil hoje?" }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toMatch(/Botafogo vs Flamengo/);

    // Two upstream calls — initial + after-tool.
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Second call must include the tool result with Botafogo data.
    const [, init2] = fetchSpy.mock.calls[1];
    const payload2 = JSON.parse(String(init2?.body)) as {
      messages: Array<{ role: string; content?: string; tool_call_id?: string }>;
    };
    const toolMsg = payload2.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.tool_call_id).toBe("call_1");
    expect(toolMsg!.content).toMatch(/Botafogo/);
  });

  it("loop cap: returns a safe message when the model never finalizes", async () => {
    // Always respond with a tool call — verify we don't loop forever.
    // mockImplementation so each call gets a fresh Response (bodies are
    // single-shot — reusing the same instance would error on hop 2).
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      toolCallResponse("query_fixtures", {}, "call_X"),
    );
    const { POST } = await import("@/app/api/copilot/route");
    const req = new Request("http://x/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "?" }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.content).toBe("string");
    expect(body.content.length).toBeGreaterThan(0);
  });

  it("upstream error: returns 502 with details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("boom", { status: 500 }),
    );
    const { POST } = await import("@/app/api/copilot/route");
    const req = new Request("http://x/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "?" }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(502);
  });

  it("response carries a meta block with model, hops, usage_total, latency_ms", async () => {
    adminState.rows = [
      {
        id: 1,
        match_date: "2026-05-12",
        ko_time: "20:00",
        home_team: "A",
        away_team: "B",
        league: "X",
        country: "brazil",
        source_url: null,
        kickoff_utc: "2026-05-12T23:00:00Z",
        detail_json: null,
      },
    ];

    const toolCall = JSON.parse(JSON.stringify(
      await (toolCallResponse("query_fixtures", { country: "brazil" })).json()
    ));
    const finalAnswer = JSON.parse(JSON.stringify(
      await (finalResponse("1 jogo: A vs B")).json()
    ));

    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () =>
        jsonResponse(withUsage(toolCall, { prompt_tokens: 1500, completion_tokens: 30 })),
      )
      .mockImplementationOnce(async () =>
        jsonResponse(withUsage(finalAnswer, { prompt_tokens: 1800, completion_tokens: 80 })),
      );

    const { POST } = await import("@/app/api/copilot/route");
    const req = new Request("http://x/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "tem jogo no Brasil?" }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toMatch(/A vs B/);
    expect(body.meta).toBeDefined();
    expect(body.meta.model).toBe("deepseek/deepseek-v3.2");
    expect(typeof body.meta.latency_ms).toBe("number");
    expect(body.meta.usage_total).toMatchObject({
      prompt_tokens: 3300,
      completion_tokens: 110,
    });
    expect(Array.isArray(body.meta.hops)).toBe(true);
    expect(body.meta.hops).toHaveLength(1);
    expect(body.meta.hops[0]).toMatchObject({
      tool: "query_fixtures",
      args: { country: "brazil" },
    });
    expect(body.meta.hops[0].result_summary).toMatch(/1 fixture/i);
    expect(typeof body.meta.hops[0].took_ms).toBe("number");
  });

  it("plain answer (no tool call): meta.hops is empty but meta.model is set", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        withUsage(
          {
            choices: [{ message: { role: "assistant", content: "oi!" } }],
          },
          { prompt_tokens: 800, completion_tokens: 20 },
        ),
      ),
    );
    const { POST } = await import("@/app/api/copilot/route");
    const req = new Request("http://x/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "oi" }],
      }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.meta.hops).toEqual([]);
    expect(body.meta.model).toBe("deepseek/deepseek-v3.2");
    expect(body.meta.usage_total.prompt_tokens).toBe(800);
  });

  it("reasoner:true switches the upstream model to deepseek/deepseek-r1", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(finalResponse("ok"));
    const { POST } = await import("@/app/api/copilot/route");
    const req = new Request("http://x/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "oi" }],
        reasoner: true,
      }),
    });
    await POST(req);
    const [, init] = fetchSpy.mock.calls[0];
    const payload = JSON.parse(String(init?.body));
    expect(payload.model).toBe("deepseek/deepseek-r1");
  });

  it("reasoner mode surfaces message.reasoning in meta.reasoning", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Resposta final.",
              reasoning: "Primeiro pensei A, depois B, conclui C.",
            },
          },
        ],
      }),
    );
    const { POST } = await import("@/app/api/copilot/route");
    const req = new Request("http://x/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "?" }],
        reasoner: true,
      }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.content).toBe("Resposta final.");
    expect(body.meta.reasoning).toBe("Primeiro pensei A, depois B, conclui C.");
    expect(body.meta.model).toBe("deepseek/deepseek-r1");
  });

  it("rejects messages[] not ending with role=user", async () => {
    const { POST } = await import("@/app/api/copilot/route");
    const req = new Request("http://x/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "a" },
          { role: "assistant", content: "b" },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("/api/copilot — 3 tools", () => {
  it("executes scan_fixtures then inspect_fixture in a tool loop", async () => {
    adminState.rows = [
      { id: 7, match_date: "2026-05-16", ko_time: "20:00", home_team: "Alpha",
        away_team: "Beta", league: "Serie A", country: "brazil", source_url: null,
        kickoff_utc: "2026-05-16T23:00:00Z",
        detail_json: { referee_record: { name: "Ref", avg_total_booking_points: 48, completed: 10, fixtures_count: 10, avg_home_booking_points: 24, avg_away_booking_points: 24, total_yellow_reds: 1 } } },
    ];
    adminState.single = { id: 7, home_team: "Alpha", away_team: "Beta", detail_json: (adminState.rows[0] as { detail_json: unknown }).detail_json };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "scan_fixtures", arguments: JSON.stringify({ date: "2026-05-16" }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "inspect_fixture", arguments: JSON.stringify({ fixture_id: 7, tool: "get_referee" }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { role: "assistant", content: "Pronto." } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));

    const { POST } = await import("@/app/api/copilot/route");
    const res = await POST(new Request("http://t/api/copilot", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "melhor árbitro hoje?" }] }) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.meta.hops.map((h: { tool: string }) => h.tool)).toEqual(["scan_fixtures", "inspect_fixture"]);
    expect(json.meta.hops[1].result_summary).toMatch(/^inspect_fixture:/);
  });
});

describe("/api/copilot — hops cap + retrocompat", () => {
  it("still answers a simple question using only query_fixtures (retrocompat)", async () => {
    adminState.rows = [];
    // 1st turn: model calls query_fixtures; 2nd turn: final content.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_rc1", type: "function", function: { name: "query_fixtures", arguments: "{}" } }] } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { role: "assistant", content: "Nenhum jogo." } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
    const { POST } = await import("@/app/api/copilot/route");
    const res = await POST(new Request("http://t/api/copilot", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "tem jogo hoje?" }] }) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.meta.hops.map((h: { tool: string }) => h.tool)).toEqual(["query_fixtures"]);
  });

  it("caps the loop at 6 hops", async () => {
    adminState.rows = [];
    // Every turn returns the same query_fixtures tool_call (model never finalizes).
    // mockImplementation creates a fresh Response each call (body stream is single-use).
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse({
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_loop", type: "function", function: { name: "query_fixtures", arguments: "{}" } }] } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    );
    const { POST } = await import("@/app/api/copilot/route");
    const res = await POST(new Request("http://t/api/copilot", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "loop" }] }) }));
    const json = await res.json();
    expect(json.meta.hops.length).toBe(6);
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });
});
