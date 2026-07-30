/**
 * Persist one row per LLM request to `llm_request_logs` so we can audit
 * cost, latency and error rate over time. Fire-and-forget — callers should
 * NOT await the promise inside the hot path (we don't want a logger
 * failure to break the user-facing response). Errors are swallowed.
 *
 * The shape mirrors the `llm_request_logs` schema (migration 0012).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FromSupabase = { from: (table: string) => any };

export interface LlmLogInput {
  /**
   * Origem da request LLM: 'analyze' (legado) | 'copilot' (dia) |
   * 'fixture-copilot' (jogo) | 'ocr' (bet-slip OCR via Gemini Vision —
   * Pacote B item 4a: sem isso o custo do OCR era invisível em
   * /llm-observability) | 'bilhete-critic' (F2 advogado do diabo do
   * bilhete — /api/bilhete/critic).
   */
  route: "analyze" | "copilot" | "fixture-copilot" | "ocr" | "bilhete-critic";
  fixture_id?: number | null;
  model: string;
  cached?: boolean;
  reasoner?: boolean;
  follow_up?: boolean;
  latency_ms?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  /** Custo estimado em USD (coluna da migration 0023); null quando incalculável. */
  cost_usd?: number | null;
  hops?: unknown;
  error?: string | null;
}

export async function recordLlmRequest(
  supabase: FromSupabase,
  log: LlmLogInput,
): Promise<void> {
  try {
    const { error } = await supabase.from("llm_request_logs").insert({
      route: log.route,
      fixture_id: log.fixture_id ?? null,
      model: log.model,
      cached: log.cached ?? false,
      reasoner: log.reasoner ?? false,
      follow_up: log.follow_up ?? false,
      latency_ms: log.latency_ms ?? null,
      prompt_tokens: log.prompt_tokens ?? null,
      completion_tokens: log.completion_tokens ?? null,
      total_tokens: log.total_tokens ?? null,
      cost_usd: log.cost_usd ?? null,
      hops: log.hops ?? null,
      error: log.error ?? null,
    });
    if (error) {
      console.error("[llm-logs] insert failed:", error.message ?? error);
    }
  } catch (err) {
    console.error("[llm-logs] insert threw:", err);
  }
}
