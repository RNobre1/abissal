/**
 * lib/bet-slip-ocr/ocr-attempt-logger.ts
 *
 * Logger de tentativas Gemini compartilhado entre as actions de FOTO
 * (`parse-photo-action`) e de TEXTO LIVRE (`parse-text-action`). Cada
 * tentativa vira uma linha em `llm_request_logs` (route='ocr' — item 4a),
 * com flush AGUARDADO pelo caller antes do request encerrar.
 */

import type { GeminiAttemptLog } from "./gemini-vision";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordLlmRequest } from "@/lib/llm-logs";
import { computeCostUsd } from "@/lib/ai-reco/pricing";

/**
 * Constrói o logger de tentativas do Gemini. O insert em `llm_request_logs`
 * exige service_role (não há policy de INSERT pra authenticated); se o admin
 * client não puder ser criado (env ausente em dev/test), retorna undefined e
 * o parse segue sem logging.
 */
export function buildOcrAttemptLogger():
  | { onAttempt: (a: GeminiAttemptLog) => void; flush: () => Promise<void> }
  | undefined {
  let sink: Parameters<typeof recordLlmRequest>[0] | null = null;
  try {
    sink = createAdminClient() as unknown as Parameters<typeof recordLlmRequest>[0];
  } catch {
    return undefined;
  }
  const admin = sink;
  // Inserts pendentes: a action AGUARDA todos via flush() antes de retornar.
  // Fire-and-forget num Worker CF mata o insert quando o request encerra
  // (lição já paga no /auto UX overhaul) — e era exatamente a observabilidade
  // que este logging veio criar. Cada promise já engole o próprio erro
  // (best-effort: logging jamais quebra o parse).
  const pending: Array<Promise<void>> = [];
  const onAttempt = (a: GeminiAttemptLog) => {
    const hasTokens = a.promptTokens !== null || a.completionTokens !== null;
    pending.push(
      recordLlmRequest(admin, {
        route: "ocr",
        fixture_id: null,
        model: a.model,
        latency_ms: a.latencyMs,
        prompt_tokens: a.promptTokens,
        completion_tokens: a.completionTokens,
        total_tokens: a.totalTokens,
        cost_usd: hasTokens
          ? computeCostUsd(a.model, a.promptTokens ?? 0, a.completionTokens ?? 0)
          : null,
        error: a.error,
      }).then(
        () => undefined,
        () => undefined,
      ),
    );
  };
  return {
    onAttempt,
    flush: async () => {
      await Promise.all(pending);
    },
  };
}
