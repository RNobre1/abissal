import { z } from "zod";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  FIXTURE_TOOLS,
  executeFixtureTool,
  summarizeFixtureToolResult,
  type FixtureToolCtx,
} from "@/lib/fixtures/fixture-copilot-tools";
import { recordLlmRequest } from "@/lib/llm-logs";
import { extractPrediction } from "@/lib/ai/prediction-block";
import { recordPrediction } from "@/lib/ai/predictions-repository";

export const maxDuration = 100;

const SYSTEM_PROMPT = `Você é um copiloto de apostas analisando UM jogo específico de futebol.
Você SÓ pode afirmar números que vieram de uma das ferramentas — nunca invente
estatística, jogador, árbitro ou odd. Use as ferramentas para puxar a camada
tratada (insights, splits, radar, recent matches, etc.) e responda em português
do Brasil, em markdown, citando o valor e a leitura para aposta. Se uma
ferramenta retornar {error}, diga o que faltou e siga com o que tem.

Ao finalizar sua resposta, adicione SEMPRE um bloco de predição estruturada no
seguinte formato exato, sem comentários adicionais sobre ele na prosa:

\`\`\`json
{"prediction":{"winner":"home|draw|away","confidence":<0.0-1.0>,"over_under_2_5":"over|under"}}
\`\`\`

Onde: winner é quem você prevê vencer (home=mandante, draw=empate, away=visitante);
confidence é sua confiança de 0 a 1; over_under_2_5 é sua previsão sobre o
total de gols (over=mais de 2.5 gols, under=2.5 ou menos). Este bloco é
metadado de calibração — não comente sobre ele na sua análise.`;

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const bodySchema = z
  .object({
    fixture_id: z.number().int().positive(),
    messages: z.array(chatMessageSchema).min(1),
    reasoner: z.boolean().optional(),
  })
  .refine((b) => b.messages[b.messages.length - 1].role === "user", {
    message: "messages must end with role=user",
    path: ["messages"],
  });

// Orçamento do tool-loop. `export const maxDuration` é convenção Vercel/OpenNext
// e NÃO é garantida pelo Cloudflare Workers — trate como hint.
// O guard REAL é REQUEST_DEADLINE_MS: ele só barra o INÍCIO do próximo hop;
// NÃO interrompe a chamada OpenRouter em andamento, o tool-exec nem o write de
// log que vêm depois. Por isso o pior caso real ≈
//   REQUEST_DEADLINE_MS + OPENROUTER_CALL_TIMEOUT_MS + (~5s tool+log).
// Invariante: REQUEST_DEADLINE_MS + OPENROUTER_CALL_TIMEOUT_MS ≤ maxDuration
//   → 65_000 + 20_000 = 85_000 ≤ 100_000 ✓
// O hop cap evita loop infinito independente do wall-clock.
// Reasoner (deepseek-r1) usa 16k tokens/chamada → cap menor para não estourar orçamento.
const MAX_TOOL_HOPS = 6;
const REASONER_MAX_TOOL_HOPS = 3;
const OPENROUTER_CALL_TIMEOUT_MS = 20_000;
const REQUEST_DEADLINE_MS = 65_000;
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const REASONER_MODEL = "deepseek/deepseek-r1";
const REASONER_MAX_TOKENS = 16000;

interface UpstreamMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
}
interface UpstreamUsage { prompt_tokens: number; completion_tokens: number; total_tokens?: number }
interface UpstreamChoice { message: { role: "assistant"; content: string | null; reasoning?: string; tool_calls?: UpstreamMessage["tool_calls"] } }
interface UpstreamResponse { choices: UpstreamChoice[]; usage?: UpstreamUsage }
interface Hop { tool: string; args: unknown; result_summary: string; took_ms: number }
interface CopilotMeta {
  model: string; latency_ms: number; hops: Hop[];
  usage_total: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  reasoning?: string;
}

export async function POST(request: Request): Promise<Response> {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    return Response.json({ error: "invalid request body", details: String(err) }, { status: 400 });
  }
  if (!env.OPENROUTER_API_KEY) {
    return Response.json({ error: "OPENROUTER_API_KEY is not configured" }, { status: 503 });
  }

  const admin = createAdminClient();
  const { data: row, error: rowErr } = await (admin as unknown as {
    from: (t: string) => {
      select: (c: string) => { eq: (k: string, v: number) => { maybeSingle: () => Promise<{ data: { id: number; home_team: string; away_team: string; league: string | null; kickoff_utc: string | null; detail_json: unknown } | null; error: unknown }> } };
    };
  })
    .from("fixtures")
    .select("id, home_team, away_team, league, kickoff_utc, detail_json")
    .eq("id", parsed.fixture_id)
    .maybeSingle();

  if (rowErr || !row) {
    return Response.json({ error: "fixture not found" }, { status: 404 });
  }
  if (!row.detail_json) {
    return Response.json(
      { error: "fixture has no detail yet", hint: "POST /api/fixtures/{id}/refresh first" },
      { status: 400 },
    );
  }

  const ctx: FixtureToolCtx = {
    detail: row.detail_json,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
  };

  const messages: UpstreamMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `Jogo: ${row.home_team} (mandante) x ${row.away_team} (visitante).` },
    ...parsed.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const startedAt = Date.now();
  const hops: Hop[] = [];
  const usageTotal = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const useReasoner = parsed.reasoner === true;
  const model = useReasoner ? REASONER_MODEL : env.OPENROUTER_MODEL;
  let reasoning: string | undefined;

  function meta(): CopilotMeta {
    return { model, latency_ms: Date.now() - startedAt, hops, usage_total: usageTotal, ...(reasoning ? { reasoning } : {}) };
  }
  function accumulateUsage(u: UpstreamUsage | undefined): void {
    if (!u) return;
    usageTotal.prompt_tokens += u.prompt_tokens;
    usageTotal.completion_tokens += u.completion_tokens;
    usageTotal.total_tokens += u.total_tokens ?? u.prompt_tokens + u.completion_tokens;
  }

  const hopCap = useReasoner ? REASONER_MAX_TOOL_HOPS : MAX_TOOL_HOPS;
  let exitReason: "cap" | "deadline" = "cap";

  try {
    for (let hop = 0; hop < hopCap; hop++) {
      // Guard no TOPO: barra o início do próximo hop se o deadline foi atingido.
      if (Date.now() - startedAt > REQUEST_DEADLINE_MS) {
        exitReason = "deadline";
        break;
      }
      const upstream = await callOpenRouter(
        messages,
        env.OPENROUTER_API_KEY,
        model,
        useReasoner ? REASONER_MAX_TOKENS : undefined,
        OPENROUTER_CALL_TIMEOUT_MS,
      );
      accumulateUsage(upstream.usage);
      const msg = upstream.choices[0].message;
      if (msg.reasoning) reasoning = msg.reasoning;

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const finalMeta = meta();
        const content = msg.content ?? "";
        await recordLlmRequest(admin, {
          route: "fixture-copilot", fixture_id: parsed.fixture_id, model, cached: false,
          reasoner: useReasoner, latency_ms: finalMeta.latency_ms,
          prompt_tokens: finalMeta.usage_total.prompt_tokens,
          completion_tokens: finalMeta.usage_total.completion_tokens,
          total_tokens: finalMeta.usage_total.total_tokens, hops: finalMeta.hops,
        });
        // Extrai predição estruturada e persiste fire-and-forget (nunca bloqueia a resposta).
        const pred = extractPrediction(content);
        if (pred) {
          // Extrai o trecho do bloco para raw_excerpt
          const blockMatch = content.match(/```json[\s\S]*?```/);
          void recordPrediction(admin, {
            route: "fixture-copilot",
            fixture_id: parsed.fixture_id,
            home_team: row.home_team,
            away_team: row.away_team,
            league: row.league ?? null,
            kickoff_utc: row.kickoff_utc ?? null,
            model,
            reasoner: useReasoner,
            pred_winner: pred.winner,
            pred_confidence: pred.confidence,
            pred_over_under: pred.over_under_2_5,
            raw_excerpt: blockMatch ? blockMatch[0] : null,
          });
        }
        return Response.json({ content, meta: finalMeta });
      }

      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
      for (const call of msg.tool_calls) {
        const hopStarted = Date.now();
        let args: unknown = {};
        try { args = JSON.parse(call.function.arguments); } catch { args = { _raw: call.function.arguments }; }
        const result = await executeFixtureTool(call.function.name, args, ctx);
        hops.push({
          tool: call.function.name, args,
          result_summary: summarizeFixtureToolResult(call.function.name, result),
          took_ms: Date.now() - hopStarted,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      // Guard PÓS tool-exec: o trabalho pesado ocorreu entre os dois pontos de checagem.
      if (Date.now() - startedAt > REQUEST_DEADLINE_MS) {
        exitReason = "deadline";
        break;
      }
    }

    // Atingiu hopCap ou deadline — retorna JSON próprio com mensagem segura,
    // sem queimar mais orçamento. NUNCA deixa a plataforma matar e devolver HTML.
    const cappedMeta = meta();
    await recordLlmRequest(admin, {
      route: "fixture-copilot", fixture_id: parsed.fixture_id, model, cached: false,
      reasoner: useReasoner, latency_ms: cappedMeta.latency_ms,
      prompt_tokens: cappedMeta.usage_total.prompt_tokens,
      completion_tokens: cappedMeta.usage_total.completion_tokens,
      total_tokens: cappedMeta.usage_total.total_tokens, hops: cappedMeta.hops,
      error: exitReason === "deadline" ? "deadline_exceeded" : "max_tool_hops reached",
    });
    return Response.json({
      content:
        "Não consegui finalizar a análise a tempo. Tente uma pergunta mais específica sobre o jogo.",
      meta: cappedMeta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await recordLlmRequest(admin, {
      route: "fixture-copilot", fixture_id: parsed.fixture_id, model, cached: false,
      reasoner: useReasoner, latency_ms: Date.now() - startedAt,
      prompt_tokens: usageTotal.prompt_tokens, completion_tokens: usageTotal.completion_tokens,
      total_tokens: usageTotal.total_tokens, hops, error: message,
    });
    return Response.json({ error: "upstream copilot error", details: message }, { status: 502 });
  }
}

async function callOpenRouter(
  messages: UpstreamMessage[],
  apiKey: string,
  model: string,
  maxTokens: number | undefined,
  timeoutMs: number,
): Promise<UpstreamResponse> {
  const body: Record<string, unknown> = {
    model, messages, tools: FIXTURE_TOOLS, tool_choice: "auto",
  };
  if (maxTokens) body.max_tokens = maxTokens;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://abissal.rnobre.dev",
        "X-Title": "Abissal Fixture Copilot",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 200)}`);
    }
    return res.json() as Promise<UpstreamResponse>;
  } finally {
    clearTimeout(timer);
  }
}
