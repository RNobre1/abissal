/**
 * Testes para predictions-repository (fire-and-forget).
 * Espelha o padrão de lib/llm-logs.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { recordPrediction } from "./predictions-repository";
import type { PredictionInput } from "./predictions-repository";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeClient(insertResult: { error: null | { message: string } }) {
  const insertSpy = vi.fn().mockResolvedValue(insertResult);
  return {
    from: (_table: string) => ({ insert: insertSpy }),
    _insertSpy: insertSpy,
  };
}

const validPayload: PredictionInput = {
  fixture_id: 42,
  route: "fixture-copilot",
  model: "deepseek/deepseek-v3.2",
  reasoner: false,
  home_team: "Flamengo",
  away_team: "Palmeiras",
  league: "Brazil Serie A",
  kickoff_utc: "2026-05-20T00:00:00Z",
  pred_winner: "home",
  pred_confidence: 0.72,
  pred_over_under: "over",
  raw_excerpt: "```json\n{...}\n```",
};

// ── testes ────────────────────────────────────────────────────────────────────

describe("recordPrediction", () => {
  it("chama .from('ai_predictions').insert(payload) com o payload correto", async () => {
    const client = makeClient({ error: null });
    await recordPrediction(client as unknown as Parameters<typeof recordPrediction>[0], validPayload);
    expect(client._insertSpy).toHaveBeenCalledOnce();
    expect(client._insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      route: "fixture-copilot",
      home_team: "Flamengo",
      pred_winner: "home",
      pred_confidence: 0.72,
      pred_over_under: "over",
    }));
  });

  it("erro do Supabase é engolido — nunca lança (fire-and-forget)", async () => {
    const client = makeClient({ error: { message: "constraint violation" } });
    await expect(
      recordPrediction(client as unknown as Parameters<typeof recordPrediction>[0], validPayload)
    ).resolves.not.toThrow();
  });

  it("exceção no insert é engolida — nunca lança", async () => {
    const client = {
      from: (_: string) => ({
        insert: vi.fn().mockRejectedValue(new Error("network error")),
      }),
    };
    await expect(
      recordPrediction(client as unknown as Parameters<typeof recordPrediction>[0], validPayload)
    ).resolves.not.toThrow();
  });

  it("não lança mesmo quando o client lança no .from()", async () => {
    const client = {
      from: () => { throw new Error("client explodiu"); },
    };
    await expect(
      recordPrediction(client as unknown as Parameters<typeof recordPrediction>[0], validPayload)
    ).resolves.not.toThrow();
  });
});
