/**
 * Pacote B, item 4a — parseBetSlipPhoto grava cada chamada Gemini em
 * `llm_request_logs` (route='ocr', modelo, latência, tokens, custo, erro)
 * via client admin (service_role — a tabela não tem policy de INSERT pra
 * authenticated). Best-effort: falha do logger jamais quebra o OCR.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedSlip } from "@/lib/bet-slip-ocr/schema";
import type { GeminiAttemptLog } from "@/lib/bet-slip-ocr/gemini-vision";

// ── mocks ─────────────────────────────────────────────────────────────────────

const PARSED_SLIP: ParsedSlip = {
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
  is_bet_builder: false,
};

// O mock do gemini-vision INVOCA o onAttempt recebido — simulando 2 tentativas
// (primária falhou parse, fallback OK) — e devolve o slip.
const attemptsToEmit: GeminiAttemptLog[] = [];
const mockParseBetSlipImage = vi.fn(
  async (
    _image: Buffer | string,
    opts?: { onAttempt?: (a: GeminiAttemptLog) => void },
  ): Promise<ParsedSlip> => {
    for (const a of attemptsToEmit) opts?.onAttempt?.(a);
    return PARSED_SLIP;
  },
);

vi.mock("@/lib/bet-slip-ocr/gemini-vision", () => ({
  parseBetSlipImage: (
    image: Buffer | string,
    opts?: { onAttempt?: (a: GeminiAttemptLog) => void },
  ) => mockParseBetSlipImage(image, opts),
  OcrParseError: class OcrParseError extends Error {},
}));

vi.mock("@/lib/bet-slip-ocr/match-fixture", () => ({
  matchFixture: vi.fn(async () => ({ best: null, candidates: [] })),
  CONFIDENCE_AUTO_LINK: 0.85,
  CONFIDENCE_MIN: 0.4,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/settings/ai-toggle", () => ({
  isAiEnabled: vi.fn(async () => true),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
    },
  })),
}));

// admin client — captura inserts em llm_request_logs
const insertedLogs: Array<Record<string, unknown>> = [];
let adminThrows = false;
// Quando setado, o insert só resolve quando o teste liberar — usado pra
// provar que a action AGUARDA o insert (fire-and-forget morre no Worker).
let insertGate: Promise<{ error: null }> | null = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (adminThrows) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    return {
      from: (table: string) => ({
        insert: (payload: Record<string, unknown>) => {
          if (table === "llm_request_logs") insertedLogs.push(payload);
          return insertGate ?? Promise.resolve({ error: null });
        },
      }),
    };
  },
}));

function makeFormData(): FormData {
  const file = new File([new Uint8Array(1024)], "cupom.jpg", { type: "image/jpeg" });
  const fd = new FormData();
  fd.append("image", file);
  return fd;
}

async function flushMicrotasks() {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  insertedLogs.length = 0;
  attemptsToEmit.length = 0;
  adminThrows = false;
  insertGate = null;
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("parseBetSlipPhoto — logging em llm_request_logs (route='ocr')", () => {
  it("grava uma linha por tentativa Gemini com modelo/latência/tokens/custo/erro", async () => {
    attemptsToEmit.push(
      {
        model: "google/gemini-2.5-flash",
        latencyMs: 1234,
        promptTokens: 1000,
        completionTokens: 50,
        totalTokens: 1050,
        error: "invalid-json",
      },
      {
        model: "google/gemini-2.5-flash-lite:free",
        latencyMs: 900,
        promptTokens: 1000,
        completionTokens: 60,
        totalTokens: 1060,
        error: null,
      },
    );

    const { parseBetSlipPhoto } = await import("@/lib/bet-slip-ocr/parse-photo-action");
    const result = await parseBetSlipPhoto(makeFormData());
    await flushMicrotasks();

    expect(result.ok).toBe(true);
    expect(insertedLogs).toHaveLength(2);

    expect(insertedLogs[0]).toMatchObject({
      route: "ocr",
      model: "google/gemini-2.5-flash",
      latency_ms: 1234,
      prompt_tokens: 1000,
      completion_tokens: 50,
      total_tokens: 1050,
      error: "invalid-json",
    });
    // custo calculável: pricing do gemini-2.5-flash na tabela
    expect(typeof insertedLogs[0].cost_usd).toBe("number");
    expect(insertedLogs[0].cost_usd as number).toBeGreaterThan(0);

    expect(insertedLogs[1]).toMatchObject({
      route: "ocr",
      model: "google/gemini-2.5-flash-lite:free",
      error: null,
    });
  });

  it("aguarda o insert do log antes de retornar — fire-and-forget num Worker CF mata o insert", async () => {
    attemptsToEmit.push({
      model: "google/gemini-2.5-flash",
      latencyMs: 500,
      promptTokens: 1000,
      completionTokens: 40,
      totalTokens: 1040,
      error: null,
    });

    let release!: () => void;
    insertGate = new Promise((resolve) => {
      release = () => resolve({ error: null });
    });

    const { parseBetSlipPhoto } = await import("@/lib/bet-slip-ocr/parse-photo-action");
    let settled = false;
    const pending = parseBetSlipPhoto(makeFormData()).then((r) => {
      settled = true;
      return r;
    });
    await flushMicrotasks();

    // A action NÃO pode resolver com o insert do log ainda pendente: no
    // Worker, o request encerra e a linha de llm_request_logs some.
    expect(settled).toBe(false);

    release();
    const result = await pending;
    expect(settled).toBe(true);
    expect(result.ok).toBe(true);
    expect(insertedLogs).toHaveLength(1);
  });

  it("admin client indisponível → OCR segue funcionando sem logging", async () => {
    adminThrows = true;
    attemptsToEmit.push({
      model: "google/gemini-2.5-flash",
      latencyMs: 100,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      error: null,
    });

    const { parseBetSlipPhoto } = await import("@/lib/bet-slip-ocr/parse-photo-action");
    const result = await parseBetSlipPhoto(makeFormData());

    expect(result.ok).toBe(true);
    expect(insertedLogs).toHaveLength(0);
  });
});
