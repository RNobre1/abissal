/**
 * Observabilidade do OCR (Pacote B, item 4a) — parseBetSlipImage expõe um
 * callback `onAttempt` chamado UMA vez por tentativa (primária e retry) com
 * modelo, latência, tokens e erro. O caller (parse-photo-action) usa isso pra
 * gravar `llm_request_logs` com route='ocr' — hoje o custo do OCR é invisível
 * em /llm-observability (21 fotos → 14 falhas sem rastro).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseBetSlipImage,
  OcrParseError,
  type GeminiAttemptLog,
} from "@/lib/bet-slip-ocr/gemini-vision";

// ── helpers ───────────────────────────────────────────────────────────────────

const GOOD_SLIP_JSON = JSON.stringify({
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
  stake_total: 20,
  odd_combined: 2.1,
  house_detected: "superbet",
});

const USAGE = { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 };

function orResponse(content: string, usage?: typeof USAGE): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content } }], usage }),
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error("not json")),
    text: () => Promise.resolve("upstream error"),
  } as unknown as Response;
}

function makePng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
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

describe("parseBetSlipImage — onAttempt observability", () => {
  it("sucesso: 1 tentativa logada com modelo, latência, tokens e error=null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(orResponse(GOOD_SLIP_JSON, USAGE)),
    );

    const attempts: GeminiAttemptLog[] = [];
    await parseBetSlipImage(makePng(), { onAttempt: (a) => attempts.push(a) });

    expect(attempts).toHaveLength(1);
    expect(attempts[0].model).toBe("google/gemini-2.5-flash");
    expect(typeof attempts[0].latencyMs).toBe("number");
    expect(attempts[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(attempts[0].promptTokens).toBe(1000);
    expect(attempts[0].completionTokens).toBe(50);
    expect(attempts[0].totalTokens).toBe(1050);
    expect(attempts[0].error).toBeNull();
  });

  it("fallback: 2 tentativas logadas — 1ª com erro, 2ª (flash-lite) com error=null", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(orResponse("não é json", USAGE))
        .mockResolvedValueOnce(orResponse(GOOD_SLIP_JSON, USAGE)),
    );

    const attempts: GeminiAttemptLog[] = [];
    await parseBetSlipImage(makePng(), { onAttempt: (a) => attempts.push(a) });

    expect(attempts).toHaveLength(2);
    expect(attempts[0].error).toBeTruthy();
    expect(attempts[0].promptTokens).toBe(1000); // tokens PAGOS mesmo na falha
    expect(attempts[1].model).toBe("google/gemini-2.5-flash-lite:free");
    expect(attempts[1].error).toBeNull();
  });

  it("erro HTTP: tentativa logada com o status no erro, e o throw preservado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(500)));

    const attempts: GeminiAttemptLog[] = [];
    await expect(
      parseBetSlipImage(makePng(), { onAttempt: (a) => attempts.push(a) }),
    ).rejects.toThrow(OcrParseError);

    expect(attempts).toHaveLength(1);
    expect(attempts[0].error).toContain("500");
    expect(attempts[0].promptTokens).toBeNull();
  });

  it("onAttempt que lança NUNCA quebra o parse (logging é best-effort)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(orResponse(GOOD_SLIP_JSON, USAGE)),
    );

    const result = await parseBetSlipImage(makePng(), {
      onAttempt: () => {
        throw new Error("logger exploded");
      },
    });
    expect(result.legs).toHaveLength(1);
  });
});
