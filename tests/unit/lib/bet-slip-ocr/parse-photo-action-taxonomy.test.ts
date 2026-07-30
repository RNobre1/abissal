/**
 * Pacote B, itens 4c/4d (lado action): `ParsePhotoResult` ganha `error_kind`
 * estruturado (funil diagnosticável na telemetria) e as mensagens de erro
 * viram acionáveis — "foto ilegível: tenta mais perto/sem reflexo" ≠
 * "erro do serviço: tenta de novo".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedSlip } from "@/lib/bet-slip-ocr/schema";

// ── mocks ─────────────────────────────────────────────────────────────────────

class MockOcrParseError extends Error {
  cause: unknown;
  kind?: string;
  constructor(message: string, cause?: unknown, kind?: string) {
    super(message);
    this.name = "OcrParseError";
    this.cause = cause;
    this.kind = kind;
  }
}

const mockParseBetSlipImage = vi.fn<() => Promise<ParsedSlip>>();

vi.mock("@/lib/bet-slip-ocr/gemini-vision", () => ({
  parseBetSlipImage: () => mockParseBetSlipImage(),
  OcrParseError: MockOcrParseError,
}));

vi.mock("@/lib/bet-slip-ocr/match-fixture", () => ({
  matchFixture: vi.fn(async () => ({ best: null, candidates: [] })),
  CONFIDENCE_AUTO_LINK: 0.85,
  CONFIDENCE_MIN: 0.4,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockIsAiEnabled = vi.fn(async () => true);
vi.mock("@/lib/settings/ai-toggle", () => ({
  isAiEnabled: () => mockIsAiEnabled(),
}));

const mockGetUser = vi.fn(async () => ({
  data: { user: { id: "user-1" } as { id: string } | null },
  error: null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: () => mockGetUser() } })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  }),
}));

function makeFormData(opts: { size?: number; mime?: string } = {}): FormData {
  const { size = 1024, mime = "image/jpeg" } = opts;
  const file = new File([new Uint8Array(size)], "cupom.jpg", { type: mime });
  const fd = new FormData();
  fd.append("image", file);
  return fd;
}

async function run(fd = makeFormData()) {
  const { parseBetSlipPhoto } = await import("@/lib/bet-slip-ocr/parse-photo-action");
  return parseBetSlipPhoto(fd);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAiEnabled.mockResolvedValue(true);
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("parseBetSlipPhoto — error_kind estruturado", () => {
  it("MIME inválido → error_kind='invalid-mime'", async () => {
    const out = await run(makeFormData({ mime: "application/pdf" }));
    expect(out.ok).toBe(false);
    expect(out.error_kind).toBe("invalid-mime");
  });

  it("imagem > 8MB → error_kind='too-large'", async () => {
    const out = await run(makeFormData({ size: 9 * 1024 * 1024 }));
    expect(out.ok).toBe(false);
    expect(out.error_kind).toBe("too-large");
  });

  it("sem sessão → error_kind='no-session'", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    } as never);
    const out = await run();
    expect(out.ok).toBe(false);
    expect(out.error_kind).toBe("no-session");
  });

  it("kill switch → error_kind='ai-disabled'", async () => {
    mockIsAiEnabled.mockResolvedValue(false);
    const out = await run();
    expect(out.ok).toBe(false);
    expect(out.error_kind).toBe("ai-disabled");
  });

  it("erro não-OCR inesperado → error_kind='unexpected'", async () => {
    mockParseBetSlipImage.mockRejectedValueOnce(new Error("timeout"));
    const out = await run();
    expect(out.ok).toBe(false);
    expect(out.error_kind).toBe("unexpected");
  });
});

describe("parseBetSlipPhoto — mensagens acionáveis por categoria", () => {
  it("kind='unreadable' → foto ilegível: instrui mais perto / sem reflexo", async () => {
    mockParseBetSlipImage.mockRejectedValueOnce(
      new MockOcrParseError("OCR parse failed on fallback model too", undefined, "unreadable"),
    );
    const out = await run();
    expect(out.ok).toBe(false);
    expect(out.error_kind).toBe("unreadable");
    expect(out.error).toContain("Não consegui ler");
    expect(out.error).toMatch(/perto|reflexo/i);
  });

  it("kind='no-legs-found' → não achou seleções: instrui enquadrar o bilhete", async () => {
    mockParseBetSlipImage.mockRejectedValueOnce(
      new MockOcrParseError("no legs", undefined, "no-legs-found"),
    );
    const out = await run();
    expect(out.error_kind).toBe("no-legs-found");
    expect(out.error).toMatch(/seleç|bilhete/i);
  });

  it("kind='gemini-error' → erro do serviço: instrui tentar de novo (≠ foto ruim)", async () => {
    mockParseBetSlipImage.mockRejectedValueOnce(
      new MockOcrParseError("OpenRouter error 500", undefined, "gemini-error"),
    );
    const out = await run();
    expect(out.error_kind).toBe("gemini-error");
    expect(out.error).toMatch(/serviço/i);
    expect(out.error).toMatch(/de novo/i);
    expect(out.error).not.toMatch(/foto mais clara|reflexo/i);
  });

  it("OcrParseError SEM kind (legado) → cai em 'unreadable' com a mensagem de foto", async () => {
    mockParseBetSlipImage.mockRejectedValueOnce(
      new MockOcrParseError("OCR parse failed on fallback model too"),
    );
    const out = await run();
    expect(out.error_kind).toBe("unreadable");
    expect(out.error).toContain("Não consegui ler");
  });
});
