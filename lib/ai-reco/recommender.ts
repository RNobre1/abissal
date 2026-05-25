/**
 * Recommender — chama OpenRouter com prompt versionado, parseia output,
 * valida schema mínimo, aplica caps de units.
 *
 * Defensivo: JSON parse nunca lança (lição copilot-prod-incident).
 * Schema validation rejeita decision sem 'verdict'.
 *
 * Spec §3 Camada 2 + §5.
 */

export interface AiDecision {
  verdict: "bet" | "skip";
  market?: string;
  side?: string;
  prob_estimated?: number;
  units_final?: number;
  kelly_pre?: number;
  reduction_reason?: string | null;
  confidence?: "alto" | "medio" | "baixo";
  summary_line?: string;
  reasoning?: string;
  red_flags?: string[];
}

export interface RunOptions {
  model: string;
  apiKey: string;
  leagueCalibrated: boolean;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  maxTokens?: number;
}

export interface RunResult {
  ok: boolean;
  decision?: AiDecision;
  rawContent?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  modelReturned?: string;
  latencyMs?: number;
  error?: string;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MAX_TOKENS = 4000;

/**
 * Parseia JSON robusto: aceita string crua, ```json fence, ou JSON
 * dentro de texto. Retorna null em qualquer falha (nunca lança).
 */
export function parseDecision(content: string): AiDecision | null {
  if (!content || typeof content !== "string") return null;

  // Strip markdown ```json fence se presente
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  // Tenta direto
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && "verdict" in parsed) {
      return parsed as AiDecision;
    }
  } catch {
    // fall through
  }

  // Extrai primeiro bloco { ... } do texto
  const blockMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!blockMatch) return null;
  try {
    const parsed = JSON.parse(blockMatch[0]);
    if (parsed && typeof parsed === "object" && "verdict" in parsed) {
      return parsed as AiDecision;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Garante que units_final respeita o cap absoluto.
 *  - liga calibrada: 2.0u
 *  - liga NÃO calibrada: 0.5u
 * verdict='skip' não tem units pra cappear (passa through).
 */
export function enforceCaps(d: AiDecision, leagueCalibrated: boolean): AiDecision {
  if (d.verdict !== "bet") return d;
  const cap = leagueCalibrated ? 2.0 : 0.5;
  if (typeof d.units_final !== "number" || !Number.isFinite(d.units_final)) {
    return { ...d, units_final: 0 };
  }
  const capped = Math.max(0, Math.min(d.units_final, cap));
  return { ...d, units_final: Number(capped.toFixed(2)) };
}

export async function runRecommender(
  prompt: { system: string; user: string },
  opts: RunOptions,
): Promise<RunResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const t0 = Date.now();

  try {
    const resp = await fetchFn(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        max_tokens: maxTokens,
        temperature: 0.4,
      }),
    });

    const latencyMs = Date.now() - t0;

    if (!resp.ok) {
      const text = await resp.text().catch(() => "<no body>");
      return {
        ok: false,
        error: `OpenRouter HTTP ${resp.status}: ${text.slice(0, 500)}`,
        latencyMs,
      };
    }

    const body = await resp.json();
    const rawContent: string = body?.choices?.[0]?.message?.content ?? "";
    const usage = body?.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const modelReturned: string | undefined = body?.model;

    const parsed = parseDecision(rawContent);
    if (!parsed) {
      return {
        ok: false,
        error: "Failed to parse decision JSON from LLM response (schema mismatch or invalid JSON)",
        rawContent,
        usage,
        modelReturned,
        latencyMs,
      };
    }

    const decision = enforceCaps(parsed, opts.leagueCalibrated);
    return {
      ok: true,
      decision,
      rawContent,
      usage,
      modelReturned,
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      error: `runRecommender threw: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - t0,
    };
  }
}
