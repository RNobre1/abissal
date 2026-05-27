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

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const PRIMARY_MODEL = "google/gemini-2.5-flash";
const FALLBACK_MODEL = "google/gemini-2.5-flash-lite:free";
const DEFAULT_REFERER = "https://abissal.rnobre.dev";
const DEFAULT_TITLE = "Abissal";

export class OcrParseError extends Error {
  cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "OcrParseError";
    this.cause = cause;
  }
}

const SYSTEM_PROMPT = `Você é um extrator de dados estruturados de cupons de apostas esportivas. Receba uma imagem de cupom de qualquer casa de apostas brasileira (Superbet, Bet365, Betano, Estrela, Sportingbet, etc) e devolva APENAS JSON válido (sem markdown, sem texto antes/depois) seguindo este schema:

{
  "legs": [
    {
      "home": "string (nome do time da casa, ex. 'Flamengo')",
      "away": "string (nome do time visitante, ex. 'Palmeiras')",
      "market": "string (ex. '1X2', 'Over/Under 2.5 Gols', 'BTTS', 'Asian Handicap -0.5', 'Corners Over 9.5')",
      "side": "string (ex. 'Casa', 'Empate', 'Fora', 'Over', 'Under', 'Sim', 'Não')",
      "odd_taken": number ou null (ex. 1.85 — null em cupons Bet Builder, ver abaixo),
      "league": "string ou null (ex. 'Brasileirão Série A')",
      "kickoff_iso": "string ISO 8601 UTC ou null (ex. '2026-05-26T22:00:00Z')"
    }
  ],
  "stake_total": number ou null (valor apostado total em R$, sem símbolo),
  "odd_combined": number ou null (cotação combinada das múltiplas),
  "house_detected": "string ou null (slug da casa: superbet, bet365, betano, etc)",
  "is_bet_builder": boolean (true se for cupom tipo Bet Builder / Criar Aposta, false caso contrário)
}

Regras:
- Para cupom único (não-múltipla), legs tem 1 elemento e odd_combined = legs[0].odd_taken
- Se algum campo não estiver legível, use null (NUNCA invente).
- Se a imagem não for um cupom de aposta, retorne {"legs": [], "stake_total": null, "odd_combined": null, "house_detected": null, "is_bet_builder": false} — schema vai falhar validação (esperado).
- Times com sufixo (ex. "Flamengo RJ", "Palmeiras SP"): mantenha o sufixo apenas se estiver visível no cupom.
- Datas relativas ("Hoje 22h", "Amanhã 16:00"): converta pra ISO usando "hoje" = data UTC atual (assuma a imagem foi tirada hoje).

Bet Builder / Criar Aposta:
- Se o cupom for tipo "Criar Aposta", "Bet Builder" ou "Build a Bet" (vários mercados no mesmo jogo com 1 só odd combinada e SEM odds individuais por seleção), marque is_bet_builder: true na raiz.
- Indicadores típicos: header "Criar Aposta" ou "Bet Builder", vários mercados todos do mesmo jogo (mesmo home/away), 1 só odd visível no total do bilhete.
- Nesses casos, deixe odd_taken: null em cada leg — a odd combinada vai em odd_combined (campo raiz do slip).`;

export interface ParseBetSlipOptions {
  model?: string;
  signal?: AbortSignal;
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
 * Build the OpenRouter request body for a given model and image data-URL.
 */
function buildRequestBody(model: string, dataUrl: string): Record<string, unknown> {
  return {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extraia os dados estruturados deste cupom de aposta.",
          },
          {
            type: "image_url",
            image_url: { url: dataUrl },
          },
        ],
      },
    ],
  };
}

/**
 * Call OpenRouter with the given model and image, returning a raw parsed JSON object.
 * Throws on non-2xx responses (network/auth errors — no retry).
 */
async function callOpenRouter(
  model: string,
  dataUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": DEFAULT_REFERER,
      "X-Title": DEFAULT_TITLE,
    },
    body: JSON.stringify(buildRequestBody(model, dataUrl)),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OcrParseError(`OpenRouter error ${res.status}: ${body}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = json.choices?.[0]?.message?.content ?? "";
  // Strip markdown fences if model wraps in ```json ... ```
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  return JSON.parse(cleaned);
}

/**
 * Parse a bet slip image and return a structured ParsedSlip.
 *
 * @param image - Buffer (binary image) or data-URL string ("data:image/...;base64,...")
 * @param opts  - Optional model override and AbortSignal
 * @throws OcrParseError if both primary and fallback models fail to return valid data
 */
export async function parseBetSlipImage(
  image: Buffer | string,
  opts?: ParseBetSlipOptions,
): Promise<ParsedSlip> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OcrParseError("OPENROUTER_API_KEY not set");
  }

  const dataUrl = Buffer.isBuffer(image) ? bufferToDataUrl(image) : image;
  const primaryModel = opts?.model ?? PRIMARY_MODEL;

  // ── Primary attempt ───────────────────────────────────────────────────────
  let primaryError: unknown;
  try {
    const raw = await callOpenRouter(primaryModel, dataUrl, apiKey, opts?.signal);
    const parsed = ParsedSlipSchema.safeParse(raw);
    if (parsed.success) {
      return parsed.data;
    }
    primaryError = parsed.error;
  } catch (err) {
    // Network / HTTP errors — do NOT retry, rethrow immediately
    if (err instanceof OcrParseError && err.message.startsWith("OpenRouter error")) {
      throw err;
    }
    // JSON.parse failure — treat as validation failure and try fallback
    primaryError = err;
  }

  // ── Fallback attempt (only when primary returned bad/non-schema JSON) ─────
  // Only retry with fallback if no custom model was specified
  if (opts?.model) {
    throw new OcrParseError("OCR parse failed with custom model", primaryError);
  }

  try {
    const raw = await callOpenRouter(FALLBACK_MODEL, dataUrl, apiKey, opts?.signal);
    const parsed = ParsedSlipSchema.safeParse(raw);
    if (parsed.success) {
      return parsed.data;
    }
    throw new OcrParseError("OCR parse failed on fallback model too", parsed.error);
  } catch (err) {
    if (err instanceof OcrParseError) {
      throw err;
    }
    throw new OcrParseError("OCR parse failed on fallback model too", err);
  }
}
