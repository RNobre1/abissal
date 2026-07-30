import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/fixture-copilot — tool-loop agêntico escopado a UM jogo.
 *
 * Cobre: auth 401, kill switch 503, body 400, fixture 404/400,
 * tool-loop com fetch mockado (SSE upstream: 1ª resposta pede tool,
 * 2ª devolve o texto final em deltas), auditoria em llm_request_logs
 * com hops, e o teto MAX_TOOL_HOPS.
 *
 * Pattern de mocks espelha tests/api/fixtures-refresh-auth.test.ts.
 */

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  authedUserId: "user-1" as string | null,
  aiEnabled: true,
  fixtureRow: null as Record<string, unknown> | null,
  llmLogInserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        getUser: () =>
          Promise.resolve({
            data: {
              user: state.authedUserId ? { id: state.authedUserId } : null,
            },
            error: null,
          }),
      },
    }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "fixtures") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: state.fixtureRow, error: null }),
            }),
          }),
        };
      }
      if (table === "llm_request_logs") {
        return {
          insert: (row: Record<string, unknown>) => {
            state.llmLogInserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {};
    },
  }),
}));

vi.mock("@/lib/settings/ai-toggle", () => ({
  isAiEnabled: () => Promise.resolve(state.aiEnabled),
}));

vi.mock("@/lib/fixtures/simulation-repository", () => ({
  getFixtureSimulation: () => Promise.resolve(null),
}));

vi.mock("@/lib/env", () => ({
  env: {
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_MODEL: "deepseek/deepseek-v3.2",
  },
}));

import { POST } from "@/app/api/fixture-copilot/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURE_ROW = {
  id: 7,
  home_team: "Aston Villa",
  away_team: "Liverpool",
  source_url: "https://www.adamchoi.co.uk/match/12345",
  kickoff_utc: "2026-07-30T19:00:00Z",
  detail_json: {
    referee_record: {
      name: "Mike Dean",
      avg_total_booking_points: 42,
      completed: 20,
      fixtures_count: 22,
      avg_home_booking_points: 20,
      avg_away_booking_points: 22,
      total_yellow_reds: 3,
    },
    recent_matches: { home: [], away: [] },
  },
};

/** Monta uma Response SSE upstream (formato OpenRouter stream). */
function sseUpstream(chunks: Array<Record<string, unknown>>): Response {
  const body =
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
    "data: [DONE]\n\n";
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function toolCallChunks(): Array<Record<string, unknown>> {
  return [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "c1",
                type: "function",
                function: { name: "get_referee", arguments: "" },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        { delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } },
      ],
    },
    {
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    },
  ];
}

function finalChunks(): Array<Record<string, unknown>> {
  return [
    { choices: [{ delta: { content: "O árbitro é " } }] },
    { choices: [{ delta: { content: "o Mike Dean (42)." } }] },
    {
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 8, completion_tokens: 9 },
    },
  ];
}

function makeRequest(body: unknown): Request {
  return new Request("http://test/api/fixture-copilot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function readAll(res: Response): Promise<string> {
  return await res.text();
}

beforeEach(() => {
  vi.restoreAllMocks();
  state.authedUserId = "user-1";
  state.aiEnabled = true;
  state.fixtureRow = { ...FIXTURE_ROW };
  state.llmLogInserts = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/fixture-copilot", () => {
  it("401 sem sessão", async () => {
    state.authedUserId = null;
    const res = await POST(
      makeRequest({ fixture_id: 7, messages: [{ role: "user", content: "oi" }] }),
    );
    expect(res.status).toBe(401);
  });

  it("400 quando body inválido", async () => {
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(400);
  });

  it("400 quando messages não termina em role=user", async () => {
    const res = await POST(
      makeRequest({
        fixture_id: 7,
        messages: [{ role: "assistant", content: "eu" }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("503 com ai_disabled quando o kill switch está OFF", async () => {
    state.aiEnabled = false;
    const res = await POST(
      makeRequest({ fixture_id: 7, messages: [{ role: "user", content: "oi" }] }),
    );
    expect(res.status).toBe(503);
    const json = (await res.json()) as { ai_disabled?: boolean };
    expect(json.ai_disabled).toBe(true);
  });

  it("404 quando fixture não existe", async () => {
    state.fixtureRow = null;
    const res = await POST(
      makeRequest({
        fixture_id: 999,
        messages: [{ role: "user", content: "x" }],
      }),
    );
    expect(res.status).toBe(404);
  });

  it("400 quando fixture não tem detail_json", async () => {
    state.fixtureRow = { ...FIXTURE_ROW, detail_json: null };
    const res = await POST(
      makeRequest({ fixture_id: 7, messages: [{ role: "user", content: "x" }] }),
    );
    expect(res.status).toBe(400);
  });

  it("tool-loop: SSE com hop de get_referee, deltas do texto final e done com meta.hops; auditoria gravada", async () => {
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call += 1;
      return call === 1 ? sseUpstream(toolCallChunks()) : sseUpstream(finalChunks());
    });

    const res = await POST(
      makeRequest({
        fixture_id: 7,
        messages: [{ role: "user", content: "quem apita?" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await readAll(res);
    // hop do get_referee visível no stream
    expect(text).toContain("event: hop");
    expect(text).toContain("get_referee");
    // texto final chega em deltas
    expect(text).toContain("event: delta");
    expect(text).toContain("Mike Dean");
    // done com meta
    expect(text).toContain("event: done");
    const doneLine = text
      .split("\n\n")
      .find((b) => b.startsWith("event: done"));
    const doneData = JSON.parse(doneLine!.split("\ndata: ")[1]) as {
      meta: {
        model: string;
        hops: Array<{ tool: string; result_summary: string; took_ms: number }>;
        usage_total: { prompt_tokens: number; completion_tokens: number };
      };
    };
    expect(doneData.meta.hops.map((h) => h.tool)).toContain("get_referee");
    expect(doneData.meta.usage_total.prompt_tokens).toBe(18);
    expect(doneData.meta.usage_total.completion_tokens).toBe(14);

    // auditoria: 1 insert em llm_request_logs com route + hops
    expect(state.llmLogInserts).toHaveLength(1);
    const log = state.llmLogInserts[0];
    expect(log.route).toBe("fixture-copilot");
    expect(log.fixture_id).toBe(7);
    expect(Array.isArray(log.hops)).toBe(true);
    expect((log.hops as Array<{ tool: string }>)[0].tool).toBe("get_referee");
  });

  it("teto de hops: 6 chamadas upstream no máximo, done com aviso e auditoria com erro", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => sseUpstream(toolCallChunks()));

    const res = await POST(
      makeRequest({ fixture_id: 7, messages: [{ role: "user", content: "x" }] }),
    );
    const text = await readAll(res);
    expect(fetchSpy).toHaveBeenCalledTimes(6);
    expect(text).toContain("event: done");
    expect(state.llmLogInserts).toHaveLength(1);
    expect(String(state.llmLogInserts[0].error)).toContain("max_tool_hops");
  });

  it("erro upstream: SSE event error + auditoria com a mensagem", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream down", { status: 500 }),
    );
    const res = await POST(
      makeRequest({ fixture_id: 7, messages: [{ role: "user", content: "x" }] }),
    );
    // Resposta já é o stream (200); o erro chega como evento SSE.
    const text = await readAll(res);
    expect(text).toContain("event: error");
    expect(state.llmLogInserts).toHaveLength(1);
    expect(state.llmLogInserts[0].error).toBeTruthy();
  });
});
