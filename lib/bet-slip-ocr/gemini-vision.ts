/**
 * lib/bet-slip-ocr/gemini-vision.ts
 *
 * Parses a bet slip image using Gemini 2.5 Flash via OpenRouter.
 *
 * Accepts Buffer (converts to data-URL) or data-URL string.
 * Returns a validated ParsedSlip.
 *
 * Retry strategy:
 *   - Primary model: google/gemini-2.5-flash (default)
 *   - On validation failure only: retry once with google/gemini-2.5-flash-lite:free
 *   - Network errors (non-2xx): thrown immediately, no retry
 */

import { ParsedSlipSchema, type ParsedSlip } from "./schema";

// Base configurável (proxy/AI Gateway/mock de teste). OPENROUTER_BASE_URL =
// base sem /chat/completions, ex.: "https://openrouter.ai/api/v1".
const OPENROUTER_BASE =
  process.env.OPENROUTER_BASE_URL?.replace(/\/$/, "") ??
  "https://openrouter.ai/api/v1";
const ENDPOINT = `${OPENROUTER_BASE}/chat/completions`;
const PRIMARY_MODEL = "google/gemini-2.5-flash";
const FALLBACK_MODEL = "google/gemini-2.5-flash-lite:free";
const DEFAULT_REFERER = "https://abissal.rnobre.dev";
const DEFAULT_TITLE = "Abissal";

/**
 * Taxonomia estruturada de falha do OCR (Pacote B, item 4c) — torna o funil
 * diagnosticável (21 fotos → 14 falhas eram indistinguíveis):
 *  - "gemini-error":   upstream falhou (HTTP non-2xx / config) — culpa do serviço;
 *  - "invalid-json":   o modelo devolveu prosa/JSON quebrado;
 *  - "no-legs-found":  JSON válido mas sem nenhuma seleção detectada;
 *  - "unreadable":     JSON com legs mas fora do schema (leitura parcial ruim).
 */
export type OcrErrorKind =
  | "gemini-error"
  | "invalid-json"
  | "no-legs-found"
  | "unreadable";

export class OcrParseError extends Error {
  cause: unknown;
  /** Categoria estruturada da falha; default "unreadable" (pior caso de foto). */
  kind: OcrErrorKind;
  constructor(message: string, cause?: unknown, kind: OcrErrorKind = "unreadable") {
    super(message);
    this.name = "OcrParseError";
    this.cause = cause;
    this.kind = kind;
  }
}

/**
 * Bloco de schema JSON compartilhado entre o prompt de FOTO (este arquivo) e o
 * prompt de TEXTO LIVRE (`parse-text.ts`) — mantém as duas entradas produzindo
 * o mesmo `ParsedSlip` sem duplicar a especificação.
 */
export const SLIP_JSON_SCHEMA_BLOCK = `{
  "legs": [
    {
      "home": "string (nome do time da casa, ex. 'Flamengo')",
      "away": "string (nome do time visitante, ex. 'Palmeiras')",
      "market": "string (ex. '1X2', 'Over/Under 2.5 Gols', 'BTTS', 'Asian Handicap -0.5', 'Corners Over 9.5')",
      "side": "string (ex. 'Casa', 'Empate', 'Fora', 'Over', 'Under', 'Sim', 'Não')",
      "odd_taken": number ou null (ex. 1.85 — null em cupons Bet Builder, ver abaixo),
      "league": "string ou null (ex. 'Brasileirão Série A')",
      "kickoff_iso": "string ISO 8601 UTC ou null (ex. '2026-05-26T22:00:00Z')",
      "builder_selections": array de strings ou null (SÓ para perna-grupo 'Criar Aposta' dentro de uma múltipla mista — lista das seleções internas do grupo, ex. ["Menos de 2.5 - Total de Gols", "Menos de 9.5 - Total de Escanteios"]; null em perna simples)
    }
  ],
  "stake_total": number ou null (valor apostado total em R$, sem símbolo),
  "odd_combined": number ou null (cotação combinada das múltiplas),
  "house_detected": "string ou null (slug da casa: superbet, bet365, betano, etc)",
  "is_bet_builder": boolean (true se for cupom tipo Bet Builder / Criar Aposta, false caso contrário)
}`;

const SYSTEM_PROMPT = `Você é um extrator de dados estruturados de cupons de apostas esportivas. Receba uma imagem de cupom de qualquer casa de apostas brasileira (Superbet, Bet365, Betano, Estrela, Sportingbet, etc) e devolva APENAS JSON válido (sem markdown, sem texto antes/depois) seguindo este schema:

${SLIP_JSON_SCHEMA_BLOCK}

Regras:
- Para cupom único (não-múltipla), legs tem 1 elemento e odd_combined = legs[0].odd_taken
- Se algum campo não estiver legível, use null (NUNCA invente).
- Se a imagem não for um cupom de aposta, retorne {"legs": [], "stake_total": null, "odd_combined": null, "house_detected": null, "is_bet_builder": false} — schema vai falhar validação (esperado).
- Times com sufixo (ex. "Flamengo RJ", "Palmeiras SP"): mantenha o sufixo apenas se estiver visível no cupom.
- Datas relativas ("Hoje 22h", "Amanhã 16:00"): converta pra ISO usando "hoje" = data UTC atual (assuma a imagem foi tirada hoje).

Bet Builder / Criar Aposta:
- is_bet_builder: true SOMENTE quando o cupom INTEIRO é de um único jogo ("Criar Aposta", "Bet Builder", "Build a Bet": vários mercados do mesmo home/away com 1 só odd combinada e SEM odds individuais por seleção).
- Nesse caso, deixe odd_taken: null em cada leg — a odd combinada vai em odd_combined (campo raiz do slip).

Múltipla MISTA (jogos diferentes onde alguma perna é um grupo "Criar Aposta"):
- Cada grupo "Criar Aposta" vira UMA leg: home/away do jogo do grupo, market: "Criar Aposta", side: resumo curto das seleções unidas por " + ", odd_taken: a odd DO GRUPO (aparece ao lado do header "Criar Aposta" daquele jogo), builder_selections: a lista completa das seleções internas.
- Pernas simples da mesma múltipla seguem o formato normal (builder_selections: null).
- is_bet_builder fica false — o campo raiz é só pro cupom inteiro de um jogo só.
- odd_combined = cotação combinada total do bilhete (multiplicação de todas as pernas, visível no rodapé).`;

/**
 * Log de UMA tentativa de OCR (Pacote B, item 4a). Emitido via
 * `ParseBetSlipOptions.onAttempt` para cada chamada real ao OpenRouter
 * (primária e retry), com o que der pra medir: latência sempre; tokens
 * quando o payload traz `usage`; `error` null no sucesso.
 */
export interface GeminiAttemptLog {
  model: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  /** null = tentativa OK; senão categoria/descrição curta da falha. */
  error: string | null;
}

/**
 * Addendum do MODO TOLERANTE (Pacote B, item 4b) — anexado ao system prompt
 * só no retry, após a 1ª tentativa falhar o parse. Instrui a extrair o que
 * conseguir e marcar campos incertos como null em vez de desistir com legs
 * vazias. Compartilhado com o modo texto (`parse-text.ts`).
 */
export const TOLERANT_MODE_ADDENDUM = `MODO TOLERANTE (retry — a primeira leitura falhou). Extraia o que conseguir:
- Prefira devolver legs PARCIAIS a devolver legs vazias: inclua a leg mesmo que só home/away/market/side estejam legíveis.
- Qualquer campo ilegível, cortado ou incerto: use null (NUNCA invente valores).
- Só retorne legs: [] se nem os nomes dos times forem legíveis.`;

/**
 * Variante TOLERANTE do prompt de foto — usada só no retry.
 */
const TOLERANT_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

${TOLERANT_MODE_ADDENDUM}`;

export interface ParseBetSlipOptions {
  model?: string;
  signal?: AbortSignal;
  /**
   * Observabilidade: chamado uma vez POR tentativa (best-effort — exceções
   * do callback são engolidas; logging nunca quebra o parse).
   */
  onAttempt?: (log: GeminiAttemptLog) => void;
}

/**
 * Convert a Buffer to a base64 data-URL.
 * Detects MIME type from the first bytes (PNG, JPEG, WEBP, GIF).
 * Falls back to image/jpeg for unknown formats.
 */
function bufferToDataUrl(buf: Buffer): string {
  let mime = "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) mime = "image/png";
  else if (buf[0] === 0xff && buf[1] === 0xd8) mime = "image/jpeg";
  else if (buf[0] === 0x52 && buf[1] === 0x49) mime = "image/webp";
  else if (buf[0] === 0x47 && buf[1] === 0x49) mime = "image/gif";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * Build the OpenRouter request body for a given model and user content
 * (array de content parts pra imagem, string pra texto livre).
 */
function buildRequestBody(
  model: string,
  userContent: unknown,
  systemPrompt: string,
): Record<string, unknown> {
  return {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userContent,
      },
    ],
  };
}

/** Monta o user content multimodal (texto + imagem) do modo FOTO. */
function buildImageUserContent(dataUrl: string): unknown {
  return [
    {
      type: "text",
      text: "Extraia os dados estruturados deste cupom de aposta.",
    },
    {
      type: "image_url",
      image_url: { url: dataUrl },
    },
  ];
}

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface AttemptFailure {
  /** Categoria da falha de parse desta tentativa. */
  reason: Extract<OcrErrorKind, "invalid-json" | "no-legs-found" | "unreadable">;
  cause: unknown;
}

type AttemptResult = { slip: ParsedSlip } | { failure: AttemptFailure };

/** Best-effort emit do log da tentativa — exceções do callback são engolidas. */
function emitAttempt(
  onAttempt: ((log: GeminiAttemptLog) => void) | undefined,
  model: string,
  startedMs: number,
  usage: OpenRouterUsage | null,
  error: string | null,
): void {
  if (!onAttempt) return;
  try {
    onAttempt({
      model,
      latencyMs: Date.now() - startedMs,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      error,
    });
  } catch {
    // logging nunca quebra o parse
  }
}

/** JSON válido mas com `legs: []` — cupom sem seleções detectadas. */
function hasEmptyLegs(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    Array.isArray((raw as Record<string, unknown>).legs) &&
    ((raw as Record<string, unknown>).legs as unknown[]).length === 0
  );
}

/**
 * Uma tentativa completa: chamada OpenRouter + parse + validação de schema.
 * - Erros de rede/abort e HTTP non-2xx são LANÇADOS (sem retry — comportamento
 *   histórico preservado), com a tentativa logada via onAttempt.
 * - Falha de parse/validação retorna `{ failure }` pro caller decidir o retry.
 */
async function attemptOnce(args: {
  model: string;
  userContent: unknown;
  apiKey: string;
  systemPrompt: string;
  signal?: AbortSignal;
  onAttempt?: (log: GeminiAttemptLog) => void;
}): Promise<AttemptResult> {
  const { model, userContent, apiKey, systemPrompt, signal, onAttempt } = args;
  const started = Date.now();

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": DEFAULT_REFERER,
        "X-Title": DEFAULT_TITLE,
      },
      body: JSON.stringify(buildRequestBody(model, userContent, systemPrompt)),
      signal,
    });
  } catch (err) {
    emitAttempt(onAttempt, model, started, null, err instanceof Error ? err.message : String(err));
    throw err;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    emitAttempt(onAttempt, model, started, null, `OpenRouter error ${res.status}`);
    throw new OcrParseError(`OpenRouter error ${res.status}: ${body}`, undefined, "gemini-error");
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: OpenRouterUsage;
  };
  const usage = json.usage ?? null;

  const content = json.choices?.[0]?.message?.content ?? "";
  // Strip markdown fences if model wraps in ```json ... ```
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch (err) {
    emitAttempt(onAttempt, model, started, usage, "invalid-json");
    return { failure: { reason: "invalid-json", cause: err } };
  }

  const parsed = ParsedSlipSchema.safeParse(raw);
  if (parsed.success) {
    emitAttempt(onAttempt, model, started, usage, null);
    return { slip: parsed.data };
  }

  const reason = hasEmptyLegs(raw) ? "no-legs-found" : "unreadable";
  emitAttempt(onAttempt, model, started, usage, reason);
  return { failure: { reason, cause: parsed.error } };
}

/**
 * Pipeline compartilhado de parse (foto E texto): tentativa primária com o
 * prompt normal → retry único no modelo fallback com a variante TOLERANTE do
 * prompt. Comportamento idêntico ao histórico de `parseBetSlipImage`:
 *  - erros de rede/HTTP non-2xx são lançados sem retry;
 *  - modelo customizado (`opts.model`) desabilita o retry;
 *  - falha nas duas tentativas → OcrParseError com o `kind` da última.
 */
export async function runSlipParsePipeline(args: {
  userContent: unknown;
  systemPrompt: string;
  tolerantSystemPrompt: string;
  opts?: ParseBetSlipOptions;
}): Promise<ParsedSlip> {
  const { userContent, systemPrompt, tolerantSystemPrompt, opts } = args;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OcrParseError("OPENROUTER_API_KEY not set", undefined, "gemini-error");
  }

  const primaryModel = opts?.model ?? PRIMARY_MODEL;

  // ── Primary attempt ───────────────────────────────────────────────────────
  const first = await attemptOnce({
    model: primaryModel,
    userContent,
    apiKey,
    systemPrompt,
    signal: opts?.signal,
    onAttempt: opts?.onAttempt,
  });
  if ("slip" in first) return first.slip;

  // ── Fallback attempt (only when primary returned bad/non-schema JSON) ─────
  // Only retry with fallback if no custom model was specified
  if (opts?.model) {
    throw new OcrParseError(
      "OCR parse failed with custom model",
      first.failure.cause,
      first.failure.reason,
    );
  }

  // Retry único (item 4b): modelo fallback + variante de prompt tolerante.
  const second = await attemptOnce({
    model: FALLBACK_MODEL,
    userContent,
    apiKey,
    systemPrompt: tolerantSystemPrompt,
    signal: opts?.signal,
    onAttempt: opts?.onAttempt,
  });
  if ("slip" in second) return second.slip;

  throw new OcrParseError(
    "OCR parse failed on fallback model too",
    second.failure.cause,
    second.failure.reason,
  );
}

/**
 * Parse a bet slip image and return a structured ParsedSlip.
 *
 * @param image - Buffer (binary image) or data-URL string ("data:image/...;base64,...")
 * @param opts  - Optional model override, AbortSignal and onAttempt logger
 * @throws OcrParseError if both primary and fallback models fail to return valid data
 */
export async function parseBetSlipImage(
  image: Buffer | string,
  opts?: ParseBetSlipOptions,
): Promise<ParsedSlip> {
  const dataUrl = Buffer.isBuffer(image) ? bufferToDataUrl(image) : image;
  return runSlipParsePipeline({
    userContent: buildImageUserContent(dataUrl),
    systemPrompt: SYSTEM_PROMPT,
    tolerantSystemPrompt: TOLERANT_SYSTEM_PROMPT,
    opts,
  });
}
