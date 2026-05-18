import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fixtureRow = {
  id: 7,
  home_team: "Aston Villa",
  away_team: "Liverpool",
  detail_json: {
    referee_record: { name: "Mike Dean", avg_booking_points: 42 },
    recent_matches: { home: [], away: [] },
  },
};

const fixtureRowNoDetail = {
  id: 8,
  home_team: "Chelsea",
  away_team: "Manchester City",
  detail_json: null,
};

function adminMock() {
  return {
    from: (table: string) => {
      if (table === "fixtures") {
        return {
          select: () => ({
            eq: (_k: string, v: number) => ({
              maybeSingle: async () => {
                if (v === fixtureRow.id) {
                  return { data: fixtureRow, error: null };
                }
                if (v === fixtureRowNoDetail.id) {
                  return { data: fixtureRowNoDetail, error: null };
                }
                return { data: null, error: null };
              },
            }),
          }),
        };
      }
      if (table === "llm_request_logs") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      return {};
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminMock() }));
vi.mock("@/lib/env", () => ({
  env: { OPENROUTER_API_KEY: "test-key", OPENROUTER_MODEL: "deepseek/deepseek-v3.2" },
}));

import { POST } from "@/app/api/fixture-copilot/route";

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

// ── helpers ──────────────────────────────────────────────────────────────────

function toolCallResponse(name: string, args: object = {}, id = "call_1") {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id, type: "function", function: { name, arguments: JSON.stringify(args) } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    { status: 200 },
  );
}

function finalResponse(content: string) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content } }],
      usage: { prompt_tokens: 8, completion_tokens: 9 },
    }),
    { status: 200 },
  );
}

// ── existing tests (unchanged) ────────────────────────────────────────────────

describe("POST /api/fixture-copilot", () => {
  it("400 quando body inválido", async () => {
    const res = await POST(new Request("http://t", { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
  });

  it("loop executa tool e devolve {content, meta.hops}", async () => {
    const calls: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      calls.push(init);
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: null,
              tool_calls: [{ id: "c1", type: "function",
                function: { name: "get_referee", arguments: "{}" } }] } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "O árbitro é o Mike Dean (42)." } }],
          usage: { prompt_tokens: 8, completion_tokens: 9 },
        }),
        { status: 200 },
      );
    });

    const res = await POST(new Request("http://t", {
      method: "POST",
      body: JSON.stringify({ fixture_id: 7, messages: [{ role: "user", content: "quem apita?" }] }),
    }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { content: string; meta: { hops: Array<{ tool: string }> } };
    expect(json.content).toContain("Mike Dean");
    expect(json.meta.hops.map((h) => h.tool)).toContain("get_referee");
  });

  it("404 quando fixture não existe", async () => {
    const res = await POST(new Request("http://t", {
      method: "POST",
      body: JSON.stringify({ fixture_id: 999999, messages: [{ role: "user", content: "x" }] }),
    }));
    expect(res.status).toBe(404);
  });

  it("400 quando fixture existe mas detail_json é null", async () => {
    const res = await POST(new Request("http://t", {
      method: "POST",
      body: JSON.stringify({ fixture_id: 8, messages: [{ role: "user", content: "x" }] }),
    }));
    expect(res.status).toBe(400);
  });
});

// ── novos testes: orçamento server-side (RED → GREEN) ────────────────────────

describe("/api/fixture-copilot — loop budget (hardening)", () => {
  it("caps the loop at MAX_TOOL_HOPS (6): responde JSON 200 com mensagem segura, nunca HTML", async () => {
    // Model always returns a tool call → nunca finaliza → deve bater o cap.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      toolCallResponse("get_referee", {}, "loop_call"),
    );

    const res = await POST(
      new Request("http://t", {
        method: "POST",
        body: JSON.stringify({ fixture_id: 7, messages: [{ role: "user", content: "?" }] }),
      }),
    );

    // Deve ser 200 com JSON próprio — NUNCA HTML nem exceção não tratada.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content?: string };
    expect(typeof body.content).toBe("string");
    expect(body.content!.length).toBeGreaterThan(0);
  });

  it("deadline excedido antes do primeiro hop → JSON 200 com mensagem segura, fetch não chamado", async () => {
    // Date.now: 1ª chamada = startedAt; 2ª+ = muito acima do deadline.
    let n = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (n++ === 0 ? 1_000 : 1_000 + 10 * 60_000));
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      toolCallResponse("get_referee", {}, "d"),
    );

    const res = await POST(
      new Request("http://t", {
        method: "POST",
        body: JSON.stringify({ fixture_id: 7, messages: [{ role: "user", content: "?" }] }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { content?: string };
    expect(typeof body.content).toBe("string");
    expect(body.content!.length).toBeGreaterThan(0);
    // Não deve ter chamado OpenRouter — o deadline barrou antes.
    expect(spy).not.toHaveBeenCalled();
  });

  it("deadline excedido APÓS tool execution → JSON 200, apenas 1 chamada ao OpenRouter", async () => {
    // n=1 startedAt; n=2 loop-top iter0 (passa); n>=3 check pós-tool (falha).
    let n = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      n += 1;
      return n <= 2 ? 1_000 : 1_000 + 10 * 60_000;
    });
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      toolCallResponse("get_referee", {}, "p"),
    );

    const res = await POST(
      new Request("http://t", {
        method: "POST",
        body: JSON.stringify({ fixture_id: 7, messages: [{ role: "user", content: "?" }] }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { content?: string };
    expect(typeof body.content).toBe("string");
    // Um hop ocorreu, depois o deadline barrou o próximo.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("passa AbortSignal para o fetch do OpenRouter e retorna 502 JSON em abort", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: unknown, init?: { signal?: unknown }) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    const res = await POST(
      new Request("http://t", {
        method: "POST",
        body: JSON.stringify({ fixture_id: 7, messages: [{ role: "user", content: "?" }] }),
      }),
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });

  it("upstream 500 → retorna 502 JSON (nunca HTML)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    const res = await POST(
      new Request("http://t", {
        method: "POST",
        body: JSON.stringify({ fixture_id: 7, messages: [{ role: "user", content: "?" }] }),
      }),
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });

  it("resposta feliz ainda funciona depois do hardening (retrocompat)", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(toolCallResponse("get_referee", {}, "c1"))
      .mockResolvedValueOnce(finalResponse("O árbitro é o Mike Dean."));

    const res = await POST(
      new Request("http://t", {
        method: "POST",
        body: JSON.stringify({ fixture_id: 7, messages: [{ role: "user", content: "árbitro?" }] }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { content?: string; meta?: { hops: unknown[] } };
    expect(body.content).toContain("Mike Dean");
    expect(body.meta?.hops).toHaveLength(1);
  });
});

// ── reasoner hop cap (RED → GREEN) ───────────────────────────────────────────

describe("/api/fixture-copilot — reasoner hop cap", () => {
  it("reasoner:true respeita REASONER_MAX_TOOL_HOPS=3 (nunca executa o 4º hop)", async () => {
    // Modelo sempre retorna tool_call → sem stop natural.
    // Com MAX_TOOL_HOPS=6 (sem cap), fetch seria chamado 6x.
    // Com REASONER_MAX_TOOL_HOPS=3, deve ser chamado exatamente 3x e parar com JSON 200.
    let fetchCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      fetchCount += 1;
      return toolCallResponse("get_referee", {}, `r_call_${fetchCount}`);
    });

    const res = await POST(
      new Request("http://t", {
        method: "POST",
        body: JSON.stringify({
          fixture_id: 7,
          messages: [{ role: "user", content: "análise profunda" }],
          reasoner: true,
        }),
      }),
    );

    // Deve sair com JSON 200 seguro (cap atingido, não erro não tratado).
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content?: string; meta?: { hops: unknown[] } };
    expect(typeof body.content).toBe("string");
    expect(body.content!.length).toBeGreaterThan(0);
    // Exatamente 3 chamadas ao OpenRouter — cap do reasoner, não o 6 do padrão.
    expect(fetchCount).toBe(3);
  });
});
