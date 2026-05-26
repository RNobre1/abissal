/**
 * TDD — matchFixture: fuzzy match entre nomes OCR e fixtures DB (Wave N2)
 *
 * Usa pg_trgm via RPC `match_fixture_fuzzy`. Supabase client é mockado —
 * sem DB real necessário nos testes unitários.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Supabase mock ─────────────────────────────────────────────────────────────
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      rpc: mockRpc,
    }),
}));

// ── Import after mock registration ───────────────────────────────────────────
import {
  matchFixture,
  CONFIDENCE_AUTO_LINK,
  CONFIDENCE_MIN,
  type MatchInput,
  type MatchedFixture,
} from "@/lib/bet-slip-ocr/match-fixture";

// ── helpers ───────────────────────────────────────────────────────────────────
function makeRow(overrides: Partial<MatchedFixture & { id: number }> = {}) {
  return {
    id: 1001,
    home_team: "Flamengo",
    away_team: "Palmeiras",
    league: "Brasileirão Série A",
    country: "brazil",
    kickoff_utc: "2026-05-26T22:00:00Z",
    confidence: 0.9,
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe("matchFixture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Cenário 1 — confidence alta → auto-link
  it("candidate com confidence ≥ AUTO_LINK: best.confidence ≥ 0.85", async () => {
    const row = makeRow({ confidence: 0.95 });
    mockRpc.mockResolvedValue({ data: [row], error: null });

    const result = await matchFixture({ home: "Flamengo", away: "Palmeiras" });

    expect(result.best).not.toBeNull();
    expect(result.best!.confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_LINK);
    expect(result.best!.fixture_id).toBe(row.id);
    expect(result.candidates).toHaveLength(1);
  });

  // Cenário 2 — confidence média → best não-null mas < AUTO_LINK
  it("candidate com confidence 0.7: best não-null mas abaixo de AUTO_LINK", async () => {
    const row = makeRow({ confidence: 0.7 });
    mockRpc.mockResolvedValue({ data: [row], error: null });

    const result = await matchFixture({ home: "Fla", away: "Palme" });

    expect(result.best).not.toBeNull();
    expect(result.best!.confidence).toBeLessThan(CONFIDENCE_AUTO_LINK);
    expect(result.best!.confidence).toBeGreaterThanOrEqual(CONFIDENCE_MIN);
  });

  // Cenário 3 — confidence muito baixa → best = null
  it("candidate com confidence < MIN: best = null e candidates vazio", async () => {
    const row = makeRow({ confidence: 0.2 });
    mockRpc.mockResolvedValue({ data: [row], error: null });

    const result = await matchFixture({ home: "XYZ", away: "ABC" });

    expect(result.best).toBeNull();
    expect(result.candidates).toHaveLength(0);
  });

  // Cenário 4 — 3 candidates com confidences variadas
  it("3 candidates: best = maior confidence, candidates ordenados DESC", async () => {
    const rows = [
      makeRow({ id: 1001, confidence: 0.9 }),
      makeRow({ id: 1002, confidence: 0.7 }),
      makeRow({ id: 1003, confidence: 0.5 }),
    ];
    mockRpc.mockResolvedValue({ data: rows, error: null });

    const result = await matchFixture({ home: "Flamengo", away: "Palmeiras" });

    expect(result.best).not.toBeNull();
    expect(result.best!.confidence).toBe(0.9);
    expect(result.best!.fixture_id).toBe(1001);
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]!.confidence).toBe(0.9);
    expect(result.candidates[1]!.confidence).toBe(0.7);
    expect(result.candidates[2]!.confidence).toBe(0.5);
  });

  // Cenário 5 — RPC error → throw com mensagem clara
  it("RPC error: matchFixture lança erro com mensagem clara", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "relation fixtures does not exist" } });

    await expect(
      matchFixture({ home: "Flamengo", away: "Palmeiras" })
    ).rejects.toThrow("match_fixture_fuzzy: relation fixtures does not exist");
  });

  // Cenário 6 — kickoff_iso null → query usa janela now()-2d/+4d (p_kickoff null)
  it("kickoff_iso null: chama RPC com p_kickoff null", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const input: MatchInput = { home: "Flamengo", away: "Palmeiras", kickoffIso: null };
    await matchFixture(input);

    expect(mockRpc).toHaveBeenCalledOnce();
    const [fnName, params] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fnName).toBe("match_fixture_fuzzy");
    expect(params.p_home).toBe("Flamengo");
    expect(params.p_away).toBe("Palmeiras");
    expect(params.p_kickoff).toBeNull();
  });

  // Cenário 7 — kickoff_iso presente → RPC recebe ISO string
  it("kickoff_iso presente: chama RPC com p_kickoff = ISO string", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const kickoff = "2026-05-26T22:00:00Z";
    const input: MatchInput = { home: "Flamengo", away: "Palmeiras", kickoffIso: kickoff };
    await matchFixture(input);

    const [, params] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.p_kickoff).toBe(kickoff);
  });

  // Bônus — MatchInput com league (só logging, não altera query)
  it("league no input: ignorada na query (não afeta p_* passados ao RPC)", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    await matchFixture({ home: "Arsenal", away: "Chelsea", league: "Premier League" });

    const [, params] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(params)).not.toContain("p_league");
  });

  // Cenário — RPC retorna rows mas todos abaixo do MIN
  it("todos os candidates abaixo de MIN: best = null mas candidates = []", async () => {
    const rows = [makeRow({ confidence: 0.1 }), makeRow({ confidence: 0.15 })];
    mockRpc.mockResolvedValue({ data: rows, error: null });

    const result = await matchFixture({ home: "XYZ", away: "ABC" });

    expect(result.best).toBeNull();
    expect(result.candidates).toHaveLength(0);
  });

  // Opção de passar client externo (para uso server-side direto)
  it("opts.client injeta cliente customizado sem chamar createClient", async () => {
    const customRpc = vi.fn().mockResolvedValue({ data: [makeRow({ confidence: 0.88 })], error: null });
    const customClient = { rpc: customRpc } as unknown as SupabaseClient;

    const result = await matchFixture(
      { home: "Flamengo", away: "Palmeiras" },
      { client: customClient }
    );

    expect(customRpc).toHaveBeenCalledOnce();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.best).not.toBeNull();
    expect(result.best!.confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_LINK);
  });
});
