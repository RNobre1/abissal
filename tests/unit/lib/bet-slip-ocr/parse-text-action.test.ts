/**
 * F6 — parseBetSlipText server action (fallback de texto do OCR).
 *
 * Mesmos gates da irmã de foto (sessão, kill switch) + validação de texto
 * (10-2000 chars). Devolve o MESMO ParsePhotoResult (incl. Bet Builder
 * redirect e fuzzy-match) pra reusar a UI de revisão sem mudança. Loga
 * tentativas em llm_request_logs route='ocr' com flush AGUARDADO.
 *
 * Cenários:
 *  1. sem sessão → no-session, sem gastar LLM
 *  2. kill switch OFF → ai-disabled, sem gastar LLM
 *  3. sem texto → no-text; curto (<10) → text-too-short; longo (>2000) →
 *     text-too-long — nenhum chama o LLM
 *  4. happy path via {text} e via FormData → ok, legs com match
 *  5. OcrParseError kind='invalid-json' → error_kind + mensagem acionável
 *  6. bet builder → redirect_to
 *  7. logging: aguarda o insert antes de retornar (fire-and-forget morre no Worker)
 *  8. erro inesperado → unexpected
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedSlip } from "@/lib/bet-slip-ocr/schema";
import type { GeminiAttemptLog } from "@/lib/bet-slip-ocr/gemini-vision";
import type { MatchResult } from "@/lib/bet-slip-ocr/match-fixture";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockParseBetSlipFromText = vi.fn<
  (
    text: string,
    opts?: { onAttempt?: (a: GeminiAttemptLog) => void },
  ) => Promise<ParsedSlip>
>();
vi.mock("@/lib/bet-slip-ocr/parse-text", () => ({
  parseBetSlipFromText: (
    text: string,
    opts?: { onAttempt?: (a: GeminiAttemptLog) => void },
  ) => mockParseBetSlipFromText(text, opts),
}));

const mockMatchFixture = vi.fn<(input: unknown) => Promise<MatchResult>>();
vi.mock("@/lib/bet-slip-ocr/match-fixture", () => ({
  matchFixture: (input: unknown) => mockMatchFixture(input),
  CONFIDENCE_AUTO_LINK: 0.85,
  CONFIDENCE_MIN: 0.4,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockIsAiEnabled = vi.fn<() => Promise<boolean>>();
vi.mock("@/lib/settings/ai-toggle", () => ({
  isAiEnabled: () => mockIsAiEnabled(),
}));

const mockGetUser = vi.fn(async () => ({
  data: { user: { id: "user-1" } },
  error: null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: () => mockGetUser() } })),
}));

// admin client — captura inserts em llm_request_logs (logger compartilhado)
const insertedLogs: Array<Record<string, unknown>> = [];
let insertGate: Promise<{ error: null }> | null = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        if (table === "llm_request_logs") insertedLogs.push(payload);
        return insertGate ?? Promise.resolve({ error: null });
      },
    }),
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_TEXT =
  "Flamengo x Palmeiras, aposta no Flamengo vencer, odd 2.10, R$ 50 na Superbet";

const PARSED_SLIP: ParsedSlip = {
  legs: [
    {
      home: "Flamengo",
      away: "Palmeiras",
      market: "1X2",
      side: "Casa",
      odd_taken: 2.1,
      league: "Brasileirão Série A",
      kickoff_iso: "2026-07-30T22:00:00Z",
    },
  ],
  stake_total: 50,
  odd_combined: 2.1,
  house_detected: "superbet",
  is_bet_builder: false,
};

const MATCH_FOUND: MatchResult = {
  best: {
    fixture_id: 999,
    home_team: "Flamengo",
    away_team: "Palmeiras",
    league: "Brasileirão Série A",
    country: "brazil",
    kickoff_utc: "2026-07-30T22:00:00Z",
    confidence: 0.95,
  },
  candidates: [],
};

function makeFormData(text: string): FormData {
  const fd = new FormData();
  fd.append("text", text);
  return fd;
}

async function loadAction() {
  const { parseBetSlipText } = await import(
    "@/lib/bet-slip-ocr/parse-text-action"
  );
  return parseBetSlipText;
}

beforeEach(() => {
  vi.clearAllMocks();
  insertedLogs.length = 0;
  insertGate = null;
  mockIsAiEnabled.mockResolvedValue(true);
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mockMatchFixture.mockResolvedValue({ best: null, candidates: [] });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("parseBetSlipText — gates", () => {
  it("recusa sem sessão, ANTES de gastar LLM", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    } as unknown as { data: { user: { id: string } }; error: null });

    const parseBetSlipText = await loadAction();
    const result = await parseBetSlipText({ text: VALID_TEXT });

    expect(result.ok).toBe(false);
    expect(result.error_kind).toBe("no-session");
    expect(mockParseBetSlipFromText).not.toHaveBeenCalled();
  });

  it("kill switch: IA desativada → ai-disabled sem chamar LLM", async () => {
    mockIsAiEnabled.mockResolvedValue(false);

    const parseBetSlipText = await loadAction();
    const result = await parseBetSlipText({ text: VALID_TEXT });

    expect(result.ok).toBe(false);
    expect(result.error_kind).toBe("ai-disabled");
    expect(result.error).toMatch(/IA desativada/i);
    expect(mockParseBetSlipFromText).not.toHaveBeenCalled();
  });

  it("sem texto → no-text, sem chamar LLM", async () => {
    const parseBetSlipText = await loadAction();
    const result = await parseBetSlipText({ text: "   " });

    expect(result.ok).toBe(false);
    expect(result.error_kind).toBe("no-text");
    expect(mockParseBetSlipFromText).not.toHaveBeenCalled();
  });

  it("texto < 10 chars → text-too-short, sem chamar LLM", async () => {
    const parseBetSlipText = await loadAction();
    const result = await parseBetSlipText({ text: "Fla 2.1" });

    expect(result.ok).toBe(false);
    expect(result.error_kind).toBe("text-too-short");
    expect(mockParseBetSlipFromText).not.toHaveBeenCalled();
  });

  it("texto > 2000 chars → text-too-long, sem chamar LLM", async () => {
    const parseBetSlipText = await loadAction();
    const result = await parseBetSlipText({ text: "x".repeat(2001) });

    expect(result.ok).toBe(false);
    expect(result.error_kind).toBe("text-too-long");
    expect(mockParseBetSlipFromText).not.toHaveBeenCalled();
  });
});

describe("parseBetSlipText — happy path", () => {
  it("via {text}: ok true, leg com match e metadados do slip", async () => {
    mockParseBetSlipFromText.mockResolvedValueOnce(PARSED_SLIP);
    mockMatchFixture.mockResolvedValueOnce(MATCH_FOUND);

    const parseBetSlipText = await loadAction();
    const result = await parseBetSlipText({ text: VALID_TEXT });

    expect(result.ok).toBe(true);
    expect(result.slip).toBeDefined();
    expect(result.slip!.legs).toHaveLength(1);
    expect(result.slip!.legs[0].match.best!.fixture_id).toBe(999);
    expect(result.slip!.stake_total).toBe(50);
    expect(result.slip!.house_detected).toBe("superbet");
    // o texto do usuário chegou (trimado) no parser
    expect(mockParseBetSlipFromText.mock.calls[0][0]).toBe(VALID_TEXT);
  });

  it("via FormData (campo 'text'): ok true", async () => {
    mockParseBetSlipFromText.mockResolvedValueOnce(PARSED_SLIP);
    mockMatchFixture.mockResolvedValueOnce(MATCH_FOUND);

    const parseBetSlipText = await loadAction();
    const result = await parseBetSlipText(makeFormData(VALID_TEXT));

    expect(result.ok).toBe(true);
    expect(result.slip!.legs).toHaveLength(1);
  });

  it("bet builder → redirect_to /bilhete/builder (mesma resolução da foto)", async () => {
    mockParseBetSlipFromText.mockResolvedValueOnce({
      ...PARSED_SLIP,
      legs: [
        { ...PARSED_SLIP.legs[0], odd_taken: null },
        { ...PARSED_SLIP.legs[0], market: "Cartoes", side: "Over 3.5", odd_taken: null },
      ],
      odd_combined: 8.5,
      is_bet_builder: true,
    });
    mockMatchFixture.mockResolvedValueOnce(MATCH_FOUND);

    const parseBetSlipText = await loadAction();
    const result = await parseBetSlipText({ text: VALID_TEXT });

    expect(result.ok).toBe(true);
    expect(result.slip).toBeUndefined();
    expect(result.redirect_to).toContain("/bilhete/builder");
    expect(result.redirect_to).toContain("fixture_id=999");
  });
});

describe("parseBetSlipText — falhas de parse", () => {
  it("OcrParseError kind='invalid-json' → error_kind + mensagem acionável", async () => {
    const { OcrParseError } = await import("@/lib/bet-slip-ocr/gemini-vision");
    mockParseBetSlipFromText.mockRejectedValueOnce(
      new OcrParseError("parse failed", undefined, "invalid-json"),
    );

    const parseBetSlipText = await loadAction();
    const result = await parseBetSlipText({ text: VALID_TEXT });

    expect(result.ok).toBe(false);
    expect(result.error_kind).toBe("invalid-json");
    expect(result.error).toMatch(/tenta de novo/i);
  });

  it("OcrParseError kind='no-legs-found' → mensagem pede times/mercado/odd", async () => {
    const { OcrParseError } = await import("@/lib/bet-slip-ocr/gemini-vision");
    mockParseBetSlipFromText.mockRejectedValueOnce(
      new OcrParseError("no legs", undefined, "no-legs-found"),
    );

    const parseBetSlipText = await loadAction();
    const result = await parseBetSlipText({ text: VALID_TEXT });

    expect(result.ok).toBe(false);
    expect(result.error_kind).toBe("no-legs-found");
    expect(result.error).toMatch(/times/i);
  });

  it("erro inesperado → error_kind='unexpected'", async () => {
    mockParseBetSlipFromText.mockRejectedValueOnce(new Error("timeout"));

    const parseBetSlipText = await loadAction();
    const result = await parseBetSlipText({ text: VALID_TEXT });

    expect(result.ok).toBe(false);
    expect(result.error_kind).toBe("unexpected");
    expect(result.error).toContain("Erro inesperado");
  });
});

describe("parseBetSlipText — logging em llm_request_logs (route='ocr')", () => {
  it("grava uma linha por tentativa via onAttempt", async () => {
    mockParseBetSlipFromText.mockImplementationOnce(async (_text, opts) => {
      opts?.onAttempt?.({
        model: "google/gemini-2.5-flash",
        latencyMs: 800,
        promptTokens: 500,
        completionTokens: 60,
        totalTokens: 560,
        error: null,
      });
      return PARSED_SLIP;
    });

    const parseBetSlipText = await loadAction();
    const result = await parseBetSlipText({ text: VALID_TEXT });

    expect(result.ok).toBe(true);
    expect(insertedLogs).toHaveLength(1);
    expect(insertedLogs[0]).toMatchObject({
      route: "ocr",
      model: "google/gemini-2.5-flash",
      latency_ms: 800,
      error: null,
    });
  });

  it("aguarda o insert do log antes de retornar — fire-and-forget morre no Worker", async () => {
    mockParseBetSlipFromText.mockImplementationOnce(async (_text, opts) => {
      opts?.onAttempt?.({
        model: "google/gemini-2.5-flash",
        latencyMs: 500,
        promptTokens: 400,
        completionTokens: 40,
        totalTokens: 440,
        error: null,
      });
      return PARSED_SLIP;
    });

    let release!: () => void;
    insertGate = new Promise((resolve) => {
      release = () => resolve({ error: null });
    });

    const parseBetSlipText = await loadAction();
    let settled = false;
    const pending = parseBetSlipText({ text: VALID_TEXT }).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(settled).toBe(false);

    release();
    const result = await pending;
    expect(settled).toBe(true);
    expect(result.ok).toBe(true);
    expect(insertedLogs).toHaveLength(1);
  });
});
