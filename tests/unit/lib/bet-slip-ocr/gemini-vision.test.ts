/**
 * Unit tests for parseBetSlipImage (gemini-vision.ts).
 *
 * All OpenRouter HTTP calls are intercepted via vi.stubGlobal("fetch", ...).
 * No real network traffic.
 *
 * Scenarios covered:
 *   1. Happy path (múltipla Superbet 3 legs) — Buffer input
 *   2. Cupom único (1 leg, odd_combined = odd_taken)
 *   3. Fallback: primary model returns invalid JSON → secondary (gemini-2.5-flash-lite) returns valid
 *   4. Ambos falham → throws OcrParseError
 *   5. Aceita data-URL string como input
 *   6. AbortSignal propagado pro fetch
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseBetSlipImage, OcrParseError } from "@/lib/bet-slip-ocr/gemini-vision";
import superbetTripleFixture from "./fixtures/superbet-triple.json";
import type { ParsedSlip } from "@/lib/bet-slip-ocr/schema";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function makeErrorResponse(status: number, body = ""): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error("not json")),
    text: () => Promise.resolve(body),
    body: null,
  } as unknown as Response;
}

/** Minimal PNG Buffer (1×1 transparent pixel) */
function makeMinimalPngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
}

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Ensure OPENROUTER_API_KEY is set for all tests (setup-env.ts leaves it unset)
  vi.stubEnv("OPENROUTER_API_KEY", "test-or-key-abc123");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("parseBetSlipImage", () => {
  it("happy path: Buffer input → múltipla Superbet 3 legs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(makeOkResponse(superbetTripleFixture)));

    const result: ParsedSlip = await parseBetSlipImage(makeMinimalPngBuffer());

    expect(result.legs).toHaveLength(3);
    expect(result.house_detected).toBe("superbet");
    expect(result.stake_total).toBe(50);
    expect(result.odd_combined).toBeCloseTo(6.68);

    // Leg 1: Flamengo × Palmeiras
    expect(result.legs[0].home).toBe("Flamengo");
    expect(result.legs[0].away).toBe("Palmeiras");
    expect(result.legs[0].market).toBe("1X2");
    expect(result.legs[0].side).toBe("Casa");
    expect(result.legs[0].odd_taken).toBe(2.1);
    expect(result.legs[0].league).toBe("Brasileirão Série A");
    expect(result.legs[0].kickoff_iso).toBe("2026-05-26T22:00:00Z");

    // Leg 2
    expect(result.legs[1].home).toBe("Arsenal");
    expect(result.legs[1].market).toBe("Over/Under 2.5 Gols");
    expect(result.legs[1].side).toBe("Over");

    // Leg 3
    expect(result.legs[2].home).toBe("Real Madrid");
    expect(result.legs[2].market).toBe("BTTS");
  });

  it("cupom único: 1 leg, odd_combined = odd_taken da leg", async () => {
    const singleLegResponse = {
      id: "chatcmpl-single",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify({
              legs: [
                {
                  home: "São Paulo",
                  away: "Corinthians",
                  market: "1X2",
                  side: "Casa",
                  odd_taken: 2.5,
                  league: "Brasileirão Série A",
                  kickoff_iso: "2026-05-27T20:00:00Z",
                },
              ],
              stake_total: 20,
              odd_combined: 2.5,
              house_detected: "betano",
            }),
          },
          finish_reason: "stop",
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(makeOkResponse(singleLegResponse)));

    const result = await parseBetSlipImage(makeMinimalPngBuffer());

    expect(result.legs).toHaveLength(1);
    expect(result.odd_combined).toBe(result.legs[0].odd_taken);
    expect(result.house_detected).toBe("betano");
  });

  it("fallback: primary retorna JSON inválido → secondary (flash-lite) retorna válido", async () => {
    const badResponse = {
      id: "chatcmpl-bad",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Desculpe, não consigo extrair os dados.",
          },
          finish_reason: "stop",
        },
      ],
    };

    const goodResponse = {
      id: "chatcmpl-fallback-ok",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify({
              legs: [
                {
                  home: "Atlético Mineiro",
                  away: "Botafogo",
                  market: "1X2",
                  side: "Fora",
                  odd_taken: 3.2,
                  league: null,
                  kickoff_iso: null,
                },
              ],
              stake_total: null,
              odd_combined: 3.2,
              house_detected: "bet365",
            }),
          },
          finish_reason: "stop",
        },
      ],
    };

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeOkResponse(badResponse))     // primary fails parse
      .mockResolvedValueOnce(makeOkResponse(goodResponse));   // fallback succeeds

    vi.stubGlobal("fetch", mockFetch);

    const result = await parseBetSlipImage(makeMinimalPngBuffer());

    expect(result.legs).toHaveLength(1);
    expect(result.legs[0].home).toBe("Atlético Mineiro");
    // Verifies fallback model was called (2 fetch calls total)
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Second call should use the fallback model
    const secondCallBody = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string);
    expect(secondCallBody.model).toBe("google/gemini-2.5-flash-lite:free");
  });

  it("ambos falham → throws OcrParseError", async () => {
    const badResponse = {
      id: "chatcmpl-both-fail",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "não é json",
          },
          finish_reason: "stop",
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeOkResponse(badResponse)),
    );

    await expect(parseBetSlipImage(makeMinimalPngBuffer())).rejects.toThrow(OcrParseError);
  });

  it("aceita data-URL string como input", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(makeOkResponse(superbetTripleFixture)));

    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const result = await parseBetSlipImage(dataUrl);

    expect(result.legs).toHaveLength(3);

    // Verify the data-URL was passed as-is to the image_url content
    const mockFetch = vi.mocked(global.fetch);
    const callBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    const userContent = callBody.messages.find((m: { role: string }) => m.role === "user").content;
    const imageContent = userContent.find((c: { type: string }) => c.type === "image_url");
    expect(imageContent.image_url.url).toBe(dataUrl);
  });

  it("Buffer é convertido para data-URL base64 antes de enviar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(makeOkResponse(superbetTripleFixture)));

    const buf = makeMinimalPngBuffer();
    await parseBetSlipImage(buf);

    const mockFetch = vi.mocked(global.fetch);
    const callBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    const userContent = callBody.messages.find((m: { role: string }) => m.role === "user").content;
    const imageContent = userContent.find((c: { type: string }) => c.type === "image_url");
    expect(imageContent.image_url.url).toMatch(/^data:image\//);
    expect(imageContent.image_url.url).toContain(";base64,");
  });

  it("AbortSignal propagado pro fetch", async () => {
    const controller = new AbortController();
    controller.abort();

    const mockFetch = vi.fn().mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      parseBetSlipImage(makeMinimalPngBuffer(), { signal: controller.signal }),
    ).rejects.toThrow();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("usa modelo google/gemini-2.5-flash por padrão", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(makeOkResponse(superbetTripleFixture)));

    await parseBetSlipImage(makeMinimalPngBuffer());

    const mockFetch = vi.mocked(global.fetch);
    const callBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(callBody.model).toBe("google/gemini-2.5-flash");
  });

  it("opts.model sobrescreve o modelo padrão", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(makeOkResponse(superbetTripleFixture)));

    await parseBetSlipImage(makeMinimalPngBuffer(), { model: "google/gemini-2.0-flash" });

    const mockFetch = vi.mocked(global.fetch);
    const callBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(callBody.model).toBe("google/gemini-2.0-flash");
  });

  it("errores de rede (não-2xx) são relançados sem retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeErrorResponse(429, "rate limited")),
    );

    await expect(parseBetSlipImage(makeMinimalPngBuffer())).rejects.toThrow();
    // Only 1 attempt — network errors do not trigger the validation-failure retry
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });

  it("bet builder: is_bet_builder true + legs com odd_taken null são aceitos", async () => {
    const betBuilderResponse = {
      id: "chatcmpl-bet-builder",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify({
              legs: [
                {
                  home: "Flamengo",
                  away: "Palmeiras",
                  market: "1X2",
                  side: "Casa",
                  odd_taken: null,
                  league: "Brasileirão Série A",
                  kickoff_iso: "2026-05-27T22:00:00Z",
                },
                {
                  home: "Flamengo",
                  away: "Palmeiras",
                  market: "Over/Under 2.5 Gols",
                  side: "Over",
                  odd_taken: null,
                  league: "Brasileirão Série A",
                  kickoff_iso: "2026-05-27T22:00:00Z",
                },
              ],
              stake_total: 15,
              odd_combined: 3.75,
              house_detected: "betano",
              is_bet_builder: true,
            }),
          },
          finish_reason: "stop",
        },
      ],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(makeOkResponse(betBuilderResponse)));

    const result = await parseBetSlipImage(makeMinimalPngBuffer());

    expect(result.is_bet_builder).toBe(true);
    expect(result.legs).toHaveLength(2);
    expect(result.legs[0].odd_taken).toBeNull();
    expect(result.legs[1].odd_taken).toBeNull();
    expect(result.odd_combined).toBe(3.75);
  });

  it("bet builder ausente no JSON → is_bet_builder default false", async () => {
    const normalResponse = {
      id: "chatcmpl-normal",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify({
              legs: [
                {
                  home: "São Paulo",
                  away: "Corinthians",
                  market: "1X2",
                  side: "Casa",
                  odd_taken: 2.0,
                  league: null,
                  kickoff_iso: null,
                },
              ],
              stake_total: 10,
              odd_combined: 2.0,
              house_detected: "bet365",
              // is_bet_builder ausente — deve default false
            }),
          },
          finish_reason: "stop",
        },
      ],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(makeOkResponse(normalResponse)));

    const result = await parseBetSlipImage(makeMinimalPngBuffer());

    expect(result.is_bet_builder).toBe(false);
  });
});
