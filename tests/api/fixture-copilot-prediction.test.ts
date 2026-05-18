/**
 * Testes de integração da predição no /api/fixture-copilot.
 *
 * Verifica:
 *   - Resposta com bloco JSON válido → recordPrediction é chamado 1x com os campos corretos
 *   - Resposta sem bloco → recordPrediction NÃO é chamado
 *   - recordPrediction lançando → não afeta a resposta (fire-and-forget)
 *   - Content retornado ao usuário é INALTERADO (inclui o bloco se presente)
 *
 * Os testes de hardening existentes (fixture-copilot.test.ts) devem continuar
 * verdes — este arquivo é aditivo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PRED_BLOCK = '```json\n{"prediction":{"winner":"home","confidence":0.75,"over_under_2_5":"over"}}\n```';

const fixtureRowFull = {
  id: 7,
  home_team: "Aston Villa",
  away_team: "Liverpool",
  league: "Premier League",
  kickoff_utc: "2026-05-20T19:00:00Z",
  detail_json: {
    referee_record: { name: "Mike Dean", avg_booking_points: 42 },
    recent_matches: { home: [], away: [] },
  },
};

// ── mocks ─────────────────────────────────────────────────────────────────────

const recordPredictionSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/ai/predictions-repository", () => ({
  recordPrediction: (...args: unknown[]) => recordPredictionSpy(...args),
}));

vi.mock("@/lib/ai/prediction-block", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/prediction-block")>();
  return actual; // usa a implementação real
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "fixtures") {
        return {
          select: () => ({
            eq: (_k: string, v: number) => ({
              maybeSingle: async () => {
                if (v === fixtureRowFull.id) return { data: fixtureRowFull, error: null };
                return { data: null, error: null };
              },
            }),
          }),
        };
      }
      if (table === "llm_request_logs") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      if (table === "ai_predictions") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      return {};
    },
  }),
}));

vi.mock("@/lib/env", () => ({
  env: { OPENROUTER_API_KEY: "test-key", OPENROUTER_MODEL: "deepseek/deepseek-v3.2" },
}));

import { POST } from "@/app/api/fixture-copilot/route";

// ── helpers ───────────────────────────────────────────────────────────────────

function finalResponseWith(content: string) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content } }],
      usage: { prompt_tokens: 8, completion_tokens: 9 },
    }),
    { status: 200 },
  );
}

function makeRequest(content = "analisa o jogo") {
  return new Request("http://t", {
    method: "POST",
    body: JSON.stringify({
      fixture_id: fixtureRowFull.id,
      messages: [{ role: "user", content }],
    }),
  });
}

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ── testes ────────────────────────────────────────────────────────────────────

describe("fixture-copilot — emissão e persistência de predição", () => {
  it("resposta com bloco válido → recordPrediction chamado 1x com campos corretos", async () => {
    const finalContent = `Análise completa do jogo.\n\n${PRED_BLOCK}`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(finalResponseWith(finalContent));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // recordPrediction deve ter sido chamado (fire-and-forget)
    // Aguarda microtask queue para fire-and-forget processar
    await Promise.resolve();

    expect(recordPredictionSpy).toHaveBeenCalledOnce();
    const [, payload] = recordPredictionSpy.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.route).toBe("fixture-copilot");
    expect(payload.home_team).toBe("Aston Villa");
    expect(payload.away_team).toBe("Liverpool");
    expect(payload.pred_winner).toBe("home");
    expect(payload.pred_confidence).toBe(0.75);
    expect(payload.pred_over_under).toBe("over");
    expect(payload.model).toBeDefined();
  });

  it("content retornado é INALTERADO (bloco permanece no conteúdo)", async () => {
    const finalContent = `Análise.\n\n${PRED_BLOCK}`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(finalResponseWith(finalContent));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: string };
    // O bloco JSON de predição deve permanecer no content devolvido ao cliente
    expect(body.content).toContain("prediction");
    expect(body.content).toContain("home");
  });

  it("resposta sem bloco → recordPrediction NÃO é chamado", async () => {
    const finalContent = "Análise completa sem predição estruturada.";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(finalResponseWith(finalContent));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    await Promise.resolve();
    expect(recordPredictionSpy).not.toHaveBeenCalled();
  });

  it("recordPrediction lançando → não afeta a resposta (fire-and-forget)", async () => {
    recordPredictionSpy.mockRejectedValueOnce(new Error("DB explodiu"));
    const finalContent = `Análise.\n\n${PRED_BLOCK}`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(finalResponseWith(finalContent));

    const res = await POST(makeRequest());
    // A resposta deve ser 200 mesmo com o recordPrediction falhando
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: string };
    expect(typeof body.content).toBe("string");
  });
});
