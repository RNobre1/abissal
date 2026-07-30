import { describe, it, expect, vi } from "vitest";
import { recordLlmRequest, type LlmLogInput } from "@/lib/llm-logs";

describe("recordLlmRequest route union", () => {
  it("accepts route='fixture-copilot' and inserts it verbatim", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const admin = { from: () => ({ insert }) };
    const log: LlmLogInput = {
      route: "fixture-copilot",
      fixture_id: 42,
      model: "deepseek/deepseek-v3.2",
      hops: [{ tool: "get_insights", args: {}, result_summary: "ok", took_ms: 3 }],
    };
    await recordLlmRequest(admin, log);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ route: "fixture-copilot", fixture_id: 42 }),
    );
  });

  it("accepts route='ocr' with cost_usd and inserts both verbatim (Pacote B item 4a)", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const admin = { from: () => ({ insert }) };
    const log: LlmLogInput = {
      route: "ocr",
      model: "google/gemini-2.5-flash",
      latency_ms: 1234,
      prompt_tokens: 1000,
      completion_tokens: 50,
      total_tokens: 1050,
      cost_usd: 0.000425,
      error: null,
    };
    await recordLlmRequest(admin, log);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ route: "ocr", cost_usd: 0.000425 }),
    );
  });
});
