/**
 * F6 — OCR que conversa quando falha: parseBetSlipFromText.
 *
 * Modo TEXTO LIVRE do parser de bilhete: o usuário descreve o bilhete em
 * linguagem natural e o LLM estrutura no MESMO ParsedSlip do modo foto.
 * Reusa o pipeline do gemini-vision (primária + retry tolerante no fallback),
 * mesmos modelos do OCR (decisão: zero env novo, pricing já coberto).
 *
 * Cenários:
 *  1. request: modelo primário do OCR, temperature 0, json_object, e o
 *     TEXTO DO USUÁRIO presente na mensagem user
 *  2. system prompt é a variante de TEXTO (fala de descrição, não de imagem)
 *     e inclui o schema compartilhado
 *  3. JSON válido → ParsedSlip validado
 *  4. prosa nas duas tentativas → OcrParseError kind='invalid-json';
 *     2ª chamada usa modelo fallback + prompt tolerante
 *  5. OPENROUTER_API_KEY ausente → OcrParseError kind='gemini-error'
 *  6. onAttempt é chamado uma vez POR tentativa
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseBetSlipFromText } from "@/lib/bet-slip-ocr/parse-text";
import { OcrParseError, type GeminiAttemptLog } from "@/lib/bet-slip-ocr/gemini-vision";

// ── helpers ───────────────────────────────────────────────────────────────────

function orResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content } }] }),
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

const GOOD_JSON = JSON.stringify({
  legs: [
    {
      home: "Flamengo",
      away: "Palmeiras",
      market: "1X2",
      side: "Casa",
      odd_taken: 2.1,
      league: null,
      kickoff_iso: null,
    },
  ],
  stake_total: 50,
  odd_combined: 2.1,
  house_detected: "superbet",
  is_bet_builder: false,
});

const USER_TEXT =
  "Flamengo x Palmeiras, aposta no Flamengo vencer, odd 2.10, R$ 50 na Superbet";

interface CapturedBody {
  model: string;
  temperature: number;
  response_format: { type: string };
  messages: Array<{ role: string; content: unknown }>;
}

function bodyOf(call: unknown[]): CapturedBody {
  return JSON.parse((call[1] as RequestInit).body as string) as CapturedBody;
}

function userContentOf(body: CapturedBody): string {
  const user = body.messages.find((m) => m.role === "user")!;
  return typeof user.content === "string"
    ? user.content
    : JSON.stringify(user.content);
}

function systemOf(body: CapturedBody): string {
  return body.messages.find((m) => m.role === "system")!.content as string;
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("parseBetSlipFromText — request", () => {
  it("usa o modelo primário do OCR, temperature 0, json_object e inclui o texto do usuário", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(orResponse(GOOD_JSON));
    vi.stubGlobal("fetch", mockFetch);

    await parseBetSlipFromText(USER_TEXT);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = bodyOf(mockFetch.mock.calls[0]);
    expect(body.model).toBe("google/gemini-2.5-flash");
    expect(body.temperature).toBe(0);
    expect(body.response_format.type).toBe("json_object");
    expect(userContentOf(body)).toContain(USER_TEXT);
  });

  it("system prompt é a variante de TEXTO (descrição livre) e inclui o schema compartilhado", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(orResponse(GOOD_JSON));
    vi.stubGlobal("fetch", mockFetch);

    await parseBetSlipFromText(USER_TEXT);

    const system = systemOf(bodyOf(mockFetch.mock.calls[0]));
    expect(system).toMatch(/descrição/i);
    expect(system).not.toMatch(/imagem de cupom/i);
    // schema compartilhado com o modo foto
    expect(system).toContain('"legs"');
    expect(system).toContain('"is_bet_builder"');
    // não inventar: regra central preservada
    expect(system).toMatch(/NUNCA invente/);
  });

  it("system prompt informa a data ATUAL (senão o LLM chuta 'amanhã' e contamina o fuzzy-match)", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(orResponse(GOOD_JSON));
    vi.stubGlobal("fetch", mockFetch);

    await parseBetSlipFromText(USER_TEXT);

    const system = systemOf(bodyOf(mockFetch.mock.calls[0]));
    const todayIso = new Date().toISOString().slice(0, 10);
    expect(system).toContain(`AGORA é ${todayIso}`);
  });
});

describe("parseBetSlipFromText — parse e retry", () => {
  it("JSON válido → ParsedSlip validado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(orResponse(GOOD_JSON)));

    const slip = await parseBetSlipFromText(USER_TEXT);

    expect(slip.legs).toHaveLength(1);
    expect(slip.legs[0].home).toBe("Flamengo");
    expect(slip.stake_total).toBe(50);
    expect(slip.is_bet_builder).toBe(false);
  });

  it("prosa nas duas tentativas → OcrParseError kind='invalid-json'; retry usa fallback + prompt tolerante", async () => {
    const mockFetch = vi.fn().mockResolvedValue(orResponse("não é json"));
    vi.stubGlobal("fetch", mockFetch);

    let caught: unknown;
    try {
      await parseBetSlipFromText(USER_TEXT);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(OcrParseError);
    expect((caught as OcrParseError).kind).toBe("invalid-json");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const second = bodyOf(mockFetch.mock.calls[1]);
    expect(second.model).toBe("google/gemini-2.5-flash-lite:free");
    expect(systemOf(second)).toMatch(/TOLERANTE/i);
  });

  it("OPENROUTER_API_KEY ausente → OcrParseError kind='gemini-error'", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    let caught: unknown;
    try {
      await parseBetSlipFromText(USER_TEXT);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(OcrParseError);
    expect((caught as OcrParseError).kind).toBe("gemini-error");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("onAttempt é chamado uma vez por tentativa", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(orResponse("prosa"))
      .mockResolvedValueOnce(orResponse(GOOD_JSON));
    vi.stubGlobal("fetch", mockFetch);

    const attempts: GeminiAttemptLog[] = [];
    const slip = await parseBetSlipFromText(USER_TEXT, {
      onAttempt: (a) => attempts.push(a),
    });

    expect(slip.legs).toHaveLength(1);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].error).toBe("invalid-json");
    expect(attempts[1].error).toBeNull();
  });
});
