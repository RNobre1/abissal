/**
 * TDD — parseBetSlipPhoto server action
 *
 * Mocks: parseBetSlipImage, matchFixture
 *
 * Cenários:
 *  1. Happy path: 1 leg parseada + match auto-link → result.ok true, legs[0].match.best não-null
 *  2. OCR fail: parseBetSlipImage lança OcrParseError → result.ok false, error "Não consegui ler"
 *  3. Image MIME inválido (não é image/*) → result.ok false
 *  4. Image > 8MB → result.ok false
 *  5. Match não acha fixture → result.slip.legs[0].match.best === null
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedSlip } from "@/lib/bet-slip-ocr/schema";
import type { MatchResult } from "@/lib/bet-slip-ocr/match-fixture";

// ── Mocks ──────────────────────────────────────────────────────────────────────
const mockParseBetSlipImage = vi.fn<(image: Buffer | string) => Promise<ParsedSlip>>();
const mockMatchFixture = vi.fn<(input: { home: string; away: string; kickoffIso?: string | null; league?: string | null }) => Promise<MatchResult>>();

vi.mock("@/lib/bet-slip-ocr/gemini-vision", () => ({
  parseBetSlipImage: (image: Buffer | string) => mockParseBetSlipImage(image),
  OcrParseError: class OcrParseError extends Error {
    cause: unknown;
    constructor(message: string, cause?: unknown) {
      super(message);
      this.name = "OcrParseError";
      this.cause = cause;
    }
  },
}));

vi.mock("@/lib/bet-slip-ocr/match-fixture", () => ({
  matchFixture: (input: { home: string; away: string; kickoffIso?: string | null; league?: string | null }) => mockMatchFixture(input),
  CONFIDENCE_AUTO_LINK: 0.85,
  CONFIDENCE_MIN: 0.4,
}));

// next/cache stub (server action calls revalidatePath if needed)
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFormData(opts: { size?: number; mime?: string } = {}): FormData {
  const { size = 1024, mime = "image/jpeg" } = opts;
  const bytes = new Uint8Array(size);
  const file = new File([bytes], "cupom.jpg", { type: mime });
  const fd = new FormData();
  fd.append("image", file);
  return fd;
}

const PARSED_SLIP_FIXTURE: ParsedSlip = {
  legs: [
    {
      home: "Flamengo",
      away: "Palmeiras",
      market: "1X2",
      side: "Casa",
      odd_taken: 2.1,
      league: "Brasileirão Série A",
      kickoff_iso: "2026-05-26T22:00:00Z",
    },
  ],
  stake_total: 50,
  odd_combined: 2.1,
  house_detected: "superbet",
};

const MATCH_RESULT_FOUND: MatchResult = {
  best: {
    fixture_id: 999,
    home_team: "Flamengo",
    away_team: "Palmeiras",
    league: "Brasileirão Série A",
    country: "brazil",
    kickoff_utc: "2026-05-26T22:00:00Z",
    confidence: 0.95,
  },
  candidates: [
    {
      fixture_id: 999,
      home_team: "Flamengo",
      away_team: "Palmeiras",
      league: "Brasileirão Série A",
      country: "brazil",
      kickoff_utc: "2026-05-26T22:00:00Z",
      confidence: 0.95,
    },
  ],
};

const MATCH_RESULT_NOT_FOUND: MatchResult = {
  best: null,
  candidates: [],
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("parseBetSlipPhoto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: 1 leg parseada + match auto-link → ok true, best não-null", async () => {
    mockParseBetSlipImage.mockResolvedValueOnce(PARSED_SLIP_FIXTURE);
    mockMatchFixture.mockResolvedValueOnce(MATCH_RESULT_FOUND);

    const { parseBetSlipPhoto } = await import(
      "@/lib/bet-slip-ocr/parse-photo-action"
    );
    const fd = makeFormData();
    const result = await parseBetSlipPhoto(fd);

    expect(result.ok).toBe(true);
    expect(result.slip).toBeDefined();
    expect(result.slip!.legs).toHaveLength(1);
    expect(result.slip!.legs[0].match.best).not.toBeNull();
    expect(result.slip!.legs[0].match.best!.fixture_id).toBe(999);
    expect(result.slip!.stake_total).toBe(50);
    expect(result.slip!.house_detected).toBe("superbet");
  });

  it("OCR fail: parseBetSlipImage lança OcrParseError → ok false com mensagem amigável", async () => {
    const { OcrParseError: ActualOcrParseError } = await import(
      "@/lib/bet-slip-ocr/gemini-vision"
    );
    mockParseBetSlipImage.mockRejectedValueOnce(
      new ActualOcrParseError("OCR parse failed on fallback model too"),
    );

    const { parseBetSlipPhoto } = await import(
      "@/lib/bet-slip-ocr/parse-photo-action"
    );
    const fd = makeFormData();
    const result = await parseBetSlipPhoto(fd);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Não consegui ler");
  });

  it("MIME inválido (não image/*) → ok false sem chamar OCR", async () => {
    const { parseBetSlipPhoto } = await import(
      "@/lib/bet-slip-ocr/parse-photo-action"
    );
    const fd = makeFormData({ mime: "application/pdf" });
    const result = await parseBetSlipPhoto(fd);

    expect(result.ok).toBe(false);
    expect(mockParseBetSlipImage).not.toHaveBeenCalled();
  });

  it("image > 8MB → ok false sem chamar OCR", async () => {
    const { parseBetSlipPhoto } = await import(
      "@/lib/bet-slip-ocr/parse-photo-action"
    );
    const fd = makeFormData({ size: 9 * 1024 * 1024 }); // 9MB
    const result = await parseBetSlipPhoto(fd);

    expect(result.ok).toBe(false);
    expect(mockParseBetSlipImage).not.toHaveBeenCalled();
  });

  it("match não acha fixture → best === null mas leg presente", async () => {
    mockParseBetSlipImage.mockResolvedValueOnce(PARSED_SLIP_FIXTURE);
    mockMatchFixture.mockResolvedValueOnce(MATCH_RESULT_NOT_FOUND);

    const { parseBetSlipPhoto } = await import(
      "@/lib/bet-slip-ocr/parse-photo-action"
    );
    const fd = makeFormData();
    const result = await parseBetSlipPhoto(fd);

    expect(result.ok).toBe(true);
    expect(result.slip!.legs[0].match.best).toBeNull();
  });

  it("erro inesperado → ok false com mensagem genérica", async () => {
    mockParseBetSlipImage.mockRejectedValueOnce(new Error("timeout"));

    const { parseBetSlipPhoto } = await import(
      "@/lib/bet-slip-ocr/parse-photo-action"
    );
    const fd = makeFormData();
    const result = await parseBetSlipPhoto(fd);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Erro inesperado");
  });
});
