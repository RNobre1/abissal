import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAiEnabled } from "@/lib/settings/ai-toggle";
import { getFixtureSimulation } from "@/lib/fixtures/simulation-repository";
import {
  FIXTURE_TOOLS,
  executeFixtureTool,
  summarizeFixtureToolResult,
  type FixtureToolCtx,
} from "@/lib/fixtures/fixture-copilot-tools";
import { recordLlmRequest } from "@/lib/llm-logs";
import { computeCostUsd } from "@/lib/ai-reco/pricing";

/**
 * POST /api/fixture-copilot — copilot agêntico de UM jogo ("pergunte ao jogo").
 *
 * Body: { fixture_id, messages: [{role:'user'|'assistant', content}] }
 * (stateless: o client manda o histórico curto da sessão; nada persiste).
 *
 * Fluxo:
 *   1. body 400 → auth 401 (padrão das rotas irmãs, ex. /api/ai-reco/compute)
 *   2. kill switch global `isAiEnabled()` → 503 {ai_disabled:true}
 *   3. carrega fixture (PK) + simulação UMA vez; tools fecham sobre o
 *      detail_json — o blob NUNCA cruza pro client (só escalares/resumos).
 *   4. tool-loop com OPENROUTER_MODEL (deepseek v3.2), MAX_TOOL_HOPS=6,
 *      upstream em `stream:true`; resposta ao client em **SSE**:
 *        event: hop   {tool, ok, result_summary, took_ms}
 *        event: delta {text}
 *        event: done  {meta:{model, latency_ms, hops, usage_total}}
 *        event: error {message}
 *   5. auditoria em llm_request_logs (route='fixture-copilot', hops=[...]),
 *      SEMPRE awaited antes de fechar o stream (fire-and-forget morre no
 *      Worker CF — lição do /auto UX overhaul).
 *
 * ADR-002: o Worker CF não tem wall-clock timeout com o client conectado —
 * streaming SSE longo é seguro. `maxDuration` é hint do Next/OpenNext.
 */
export const maxDuration = 300;

const MAX_TOOL_HOPS = 6;
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `Você é o copiloto de apostas do Abissal analisando UM jogo específico de futebol.
Você SÓ pode afirmar números que vieram de uma das ferramentas ou do contexto
fornecido — nunca invente estatística, jogador, árbitro ou odd. Use as
ferramentas para puxar a camada tratada (insights, splits, radar, últimos
jogos, árbitro, odds, etc.) e responda em português do Brasil, em markdown
curto, citando o valor e a leitura para aposta. Se uma ferramenta retornar
{error}, diga o que faltou e siga com o que tem.`;

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const bodySchema = z
  .object({
    fixture_id: z.number().int().positive(),
    messages: z.array(chatMessageSchema).min(1).max(30),
  })
  .refine((b) => b.messages[b.messages.length - 1].role === "user", {
    message: "messages must end with role=user",
    path: ["messages"],
  });

// ─── Upstream types ─────────────────────────────────────────────────────

interface UpstreamToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface UpstreamMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: UpstreamToolCall[];
}

interface UpstreamUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
}

interface Hop {
  tool: string;
  args: unknown;
  result_summary: string;
  took_ms: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

interface FixtureRowLite {
  id: number;
  home_team: string;
  away_team: string;
  source_url: string | null;
  kickoff_utc: string | null;
  detail_json: unknown;
}

export async function POST(request: Request): Promise<Response> {
  // 1. Body -----------------------------------------------------------------
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid request body", details: String(err) },
      { status: 400 },
    );
  }

  // 1b. Auth gate — chamada LLM é cara; só usuário logado dispara ------------
  try {
    const serverClient = (await createClient()) as AnySupabase;
    const { data: { user } = { user: null } } = await serverClient.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient() as AnySupabase;

  // 2. Kill switch global de IA ---------------------------------------------
  if (!(await isAiEnabled(admin))) {
    return NextResponse.json(
      { error: "IA desativada globalmente", ai_disabled: true },
      { status: 503 },
    );
  }

  if (!env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not configured" },
      { status: 503 },
    );
  }

  // 3. Fixture + simulação, carregados UMA vez ------------------------------
  let fixture: FixtureRowLite | null = null;
  try {
    const { data, error } = await admin
      .from("fixtures")
      .select("id, home_team, away_team, source_url, kickoff_utc, detail_json")
      .eq("id", parsed.fixture_id)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: "database error", details: String(error.message ?? error) },
        { status: 500 },
      );
    }
    fixture = data as FixtureRowLite | null;
  } catch (err) {
    return NextResponse.json(
      { error: "fixture lookup failed", details: String(err) },
      { status: 500 },
    );
  }

  if (!fixture) {
    return NextResponse.json({ error: "fixture not found" }, { status: 404 });
  }
  if (!fixture.detail_json) {
    return NextResponse.json(
      { error: "fixture has no detail yet", hint: "abra o jogo e atualize o detalhe primeiro" },
      { status: 400 },
    );
  }

  // Simulação: escalares no contexto (graceful null — jogo sem sim segue).
  let simContext = "";
  try {
    const sim = await getFixtureSimulation(
      {
        sourceUrl: fixture.source_url,
        homeTeam: fixture.home_team,
        awayTeam: fixture.away_team,
        kickoffUtc: fixture.kickoff_utc,
      },
      admin,
    );
    if (sim && typeof sim.p_home === "number") {
      const pct = (v: unknown) =>
        typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—";
      const tops = Array.isArray(sim.top_scorelines)
        ? sim.top_scorelines
            .slice(0, 3)
            .map((s: { score: string; prob: number }) => `${s.score} (${pct(s.prob)})`)
            .join(", ")
        : "—";
      simContext =
        `Simulação Monte Carlo pré-computada (${sim.model_version ?? "?"}): ` +
        `casa ${pct(sim.p_home)}, empate ${pct(sim.p_draw)}, fora ${pct(sim.p_away)}; ` +
        `over 2.5 ${pct(sim.p_over_25)}; BTTS ${pct(sim.p_btts)}. ` +
        `Placares mais prováveis: ${tops}.`;
    }
  } catch {
    simContext = "";
  }

  const toolCtx: FixtureToolCtx = {
    detail: fixture.detail_json,
    homeTeam: fixture.home_team,
    awayTeam: fixture.away_team,
  };

  const messages: UpstreamMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content:
        `Jogo: ${fixture.home_team} (mandante) x ${fixture.away_team} (visitante).` +
        (simContext ? `\n${simContext}` : ""),
    },
    ...parsed.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const model = env.OPENROUTER_MODEL;
  const fixtureId = parsed.fixture_id;
  const apiKey = env.OPENROUTER_API_KEY;
  const startedAt = Date.now();
  const hops: Hop[] = [];
  const usageTotal = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  const encoder = new TextEncoder();

  // 4. Tool-loop dentro do stream SSE ---------------------------------------
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const audit = async (error: string | null) => {
        await recordLlmRequest(admin, {
          route: "fixture-copilot",
          fixture_id: fixtureId,
          model,
          latency_ms: Date.now() - startedAt,
          prompt_tokens: usageTotal.prompt_tokens,
          completion_tokens: usageTotal.completion_tokens,
          total_tokens: usageTotal.total_tokens,
          cost_usd: computeCostUsd(
            model,
            usageTotal.prompt_tokens,
            usageTotal.completion_tokens,
          ),
          hops,
          error,
        });
      };

      const meta = () => ({
        model,
        latency_ms: Date.now() - startedAt,
        hops,
        usage_total: usageTotal,
      });

      try {
        for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
          const { content, toolCalls, usage } = await callOpenRouterStream(
            messages,
            apiKey,
            model,
            (text) => send("delta", { text }),
          );
          if (usage) {
            usageTotal.prompt_tokens += usage.prompt_tokens;
            usageTotal.completion_tokens += usage.completion_tokens;
            usageTotal.total_tokens +=
              usage.total_tokens ?? usage.prompt_tokens + usage.completion_tokens;
          }

          if (toolCalls.length === 0) {
            // Resposta final — já streamada via deltas.
            void content;
            await audit(null);
            send("done", { meta: meta() });
            controller.close();
            return;
          }

          messages.push({
            role: "assistant",
            content: content || null,
            tool_calls: toolCalls,
          });

          for (const call of toolCalls) {
            const hopStarted = Date.now();
            let args: unknown = {};
            try {
              args = call.function.arguments
                ? JSON.parse(call.function.arguments)
                : {};
            } catch {
              args = { _raw: call.function.arguments };
            }
            const result = await executeFixtureTool(
              call.function.name,
              args,
              toolCtx,
            );
            const summary = summarizeFixtureToolResult(call.function.name, result);
            const took = Date.now() - hopStarted;
            hops.push({
              tool: call.function.name,
              args,
              result_summary: summary,
              took_ms: took,
            });
            send("hop", {
              tool: call.function.name,
              ok: !summary.startsWith("error:"),
              result_summary: summary,
              took_ms: took,
            });
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
          }
        }

        // Teto de hops atingido sem resposta final.
        await audit("max_tool_hops reached");
        send("delta", {
          text: "Não consegui concluir em até 6 consultas. Tente uma pergunta mais direta.",
        });
        send("done", { meta: meta() });
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        await audit(message);
        send("error", { message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

// ─── Upstream streaming call ────────────────────────────────────────────

/**
 * Chama o OpenRouter em `stream:true` e consome o SSE upstream:
 *  - deltas de `content` são repassados via `onDelta` (token streaming real);
 *  - deltas de `tool_calls` são acumulados por `index` (formato OpenAI);
 *  - `usage` chega no chunk final (`usage: {include:true}`).
 */
async function callOpenRouterStream(
  messages: UpstreamMessage[],
  apiKey: string,
  model: string,
  onDelta: (text: string) => void,
): Promise<{
  content: string;
  toolCalls: UpstreamToolCall[];
  usage: UpstreamUsage | null;
}> {
  const res = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://abissal.rnobre.dev",
      "X-Title": "Abissal Fixture Copilot",
    },
    body: JSON.stringify({
      model,
      messages,
      tools: FIXTURE_TOOLS,
      tool_choice: "auto",
      stream: true,
      usage: { include: true },
    }),
  });

  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 200)}`);
  }

  let content = "";
  let usage: UpstreamUsage | null = null;
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line: string) => {
    if (!line.startsWith("data: ")) return;
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") return;
    let chunk: {
      choices?: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
      usage?: UpstreamUsage;
    };
    try {
      chunk = JSON.parse(payload);
    } catch {
      return; // chunk malformado — tolera
    }
    if (chunk.usage && typeof chunk.usage.prompt_tokens === "number") {
      usage = chunk.usage;
    }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === "string" && delta.content.length > 0) {
      content += delta.content;
      // Só repassa como resposta se este turno não é de tool-calls: o texto
      // que acompanha tool_calls é "pensamento" intermediário, não resposta.
      if (toolAcc.size === 0) onDelta(delta.content);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const acc = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.args += tc.function.arguments;
        toolAcc.set(idx, acc);
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      handleLine(line);
    }
  }
  if (buffer.length > 0) handleLine(buffer.replace(/\r$/, ""));

  const toolCalls: UpstreamToolCall[] = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, acc]) => ({
      id: acc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      type: "function" as const,
      function: { name: acc.name, arguments: acc.args },
    }));

  return { content, toolCalls, usage };
}
