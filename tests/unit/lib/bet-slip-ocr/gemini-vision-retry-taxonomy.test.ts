/**
 * Pacote B, itens 4b/4c (lado gemini-vision):
 *  (b) retry único em falha de parse usa uma variante de prompt MAIS TOLERANTE
 *      (instrui a extrair o que conseguir e marcar campos incertos como null)
 *      — o funil real era 21 fotos → 14 falhas de parse;
 *  (c) OcrParseError carrega `kind` estruturado pra taxonomia diagnosticável:
 *      "gemini-error" | "invalid-json" | "no-legs-found" | "unreadable".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseBetSlipImage, OcrParseError } from "@/lib/bet-slip-ocr/gemini-vision";

// ── helpers ───────────────────────────────────────────────────────────────────

function orResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content } }] }),
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error("not json")),
    text: () => Promise.resolve("boom"),
  } as unknown as Response;
}

const EMPTY_LEGS_JSON = JSON.stringify({
  legs: [],
  stake_total: null,
  odd_combined: null,
  house_detected: null,
  is_bet_builder: false,
});

// JSON válido mas fora do schema (legs presentes porém incompletas)
const BAD_SCHEMA_JSON = JSON.stringify({
  legs: [{ home: "Flamengo" }],
  stake_total: 10,
  odd_combined: 2.0,
  house_detected: "bet365",
});

function makePng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
}

async function expectKind(kind: string): Promise<OcrParseError> {
  try {
    await parseBetSlipImage(makePng());
  } catch (err) {
    expect(err).toBeInstanceOf(OcrParseError);
    expect((err as OcrParseError).kind).toBe(kind);
    return err as OcrParseError;
  }
  throw new Error("expected parseBetSlipImage to throw");
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── (b) retry com prompt tolerante ────────────────────────────────────────────

describe("parseBetSlipImage — retry tolerante", () => {
  it("a 2ª chamada usa uma variante de system prompt mais tolerante", async () => {
    const goodJson = JSON.stringify({
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
      stake_total: null,
      odd_combined: 2.1,
      house_detected: null,
    });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(orResponse("prosa ilegível"))
      .mockResolvedValueOnce(orResponse(goodJson));
    vi.stubGlobal("fetch", mockFetch);

    const result = await parseBetSlipImage(makePng());
    expect(result.legs).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const systemOf = (call: unknown[]) => {
      const body = JSON.parse((call[1] as RequestInit).body as string) as {
        messages: Array<{ role: string; content: string }>;
      };
      return body.messages.find((m) => m.role === "system")!.content;
    };
    const firstSystem = systemOf(mockFetch.mock.calls[0]);
    const secondSystem = systemOf(mockFetch.mock.calls[1]);

    expect(secondSystem).not.toBe(firstSystem);
    expect(secondSystem).toMatch(/TOLERANTE/i);
    expect(secondSystem).toMatch(/o que conseguir/i);
  });
});

// ── (c) taxonomia estruturada no OcrParseError ────────────────────────────────

describe("OcrParseError.kind — taxonomia", () => {
  it("ambas as tentativas devolvem prosa → kind='invalid-json'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(orResponse("não é json")));
    await expectKind("invalid-json");
  });

  it("JSON válido com legs:[] nas duas → kind='no-legs-found'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(orResponse(EMPTY_LEGS_JSON)));
    await expectKind("no-legs-found");
  });

  it("JSON fora do schema (legs incompletas) nas duas → kind='unreadable'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(orResponse(BAD_SCHEMA_JSON)));
    await expectKind("unreadable");
  });

  it("HTTP non-2xx → kind='gemini-error' (sem retry)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(errorResponse(500));
    vi.stubGlobal("fetch", mockFetch);
    await expectKind("gemini-error");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
