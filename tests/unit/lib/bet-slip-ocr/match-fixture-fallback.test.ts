/**
 * TDD — matchFixtureFallback: fallback TS-side quando o pg_trgm do banco
 * não acha (acentos nórdicos, pontuação, nome estendido vs curto).
 *
 * Busca fixtures da janela de datas via PostgREST (só colunas escalares) e
 * casa em TS com normalização agressiva. Auto-link ≥ 0.85 SÓ quando os dois
 * lados são inequívocos (igualdade normalizada ou token-set contido) e o
 * kickoff é compatível quando disponível.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchFixtureFallback } from "@/lib/bet-slip-ocr/match-fixture-fallback";
import {
  CONFIDENCE_AUTO_LINK,
  CONFIDENCE_MIN,
} from "@/lib/bet-slip-ocr/match-fixture-types";

// ── PostgREST chain mock ──────────────────────────────────────────────────────
interface DbRow {
  id: number;
  home_team: string;
  away_team: string;
  league: string | null;
  country: string | null;
  kickoff_utc: string;
}

function makeClient(rows: DbRow[], error: { message: string } | null = null) {
  const lte = vi.fn().mockResolvedValue({ data: error ? null : rows, error });
  const gte = vi.fn().mockReturnValue({ lte });
  const select = vi.fn().mockReturnValue({ gte });
  const from = vi.fn().mockReturnValue({ select });
  return {
    client: { from } as unknown as SupabaseClient,
    from,
    select,
    gte,
    lte,
  };
}

const NORWAY_ROWS: DbRow[] = [
  {
    id: 501,
    home_team: "Bodø / Glimt",
    away_team: "Lillestrøm",
    league: "Eliteserien",
    country: "norway",
    kickoff_utc: "2026-07-31T17:00:00Z",
  },
  {
    id: 502,
    home_team: "Vålerenga",
    away_team: "Rosenborg",
    league: "Eliteserien",
    country: "norway",
    kickoff_utc: "2026-07-31T19:00:00Z",
  },
  {
    id: 503,
    home_team: "Arda",
    away_team: "CSKA 1948 Sofia",
    league: "Parva Liga",
    country: "bulgaria",
    kickoff_utc: "2026-07-31T16:00:00Z",
  },
];

describe("matchFixtureFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Os casos reais que o pg_trgm de prod NÃO auto-linkou ────────────────────
  it("caso real: 'Bodo/Glimt' × 'Lillestrom' casa com auto-link (≥ 0.85)", async () => {
    const { client } = makeClient(NORWAY_ROWS);
    const result = await matchFixtureFallback(
      { home: "Bodo/Glimt", away: "Lillestrom", kickoffIso: "2026-07-31T17:00:00Z" },
      client,
    );

    expect(result.best).not.toBeNull();
    expect(result.best!.fixture_id).toBe(501);
    expect(result.best!.confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_LINK);
  });

  it("caso real: 'Valerenga' (sem acento) casa com auto-link", async () => {
    const { client } = makeClient(NORWAY_ROWS);
    const result = await matchFixtureFallback(
      { home: "Vålerenga", away: "Rosenborg", kickoffIso: "2026-07-31T19:00:00Z" },
      client,
    );

    expect(result.best!.fixture_id).toBe(502);
    expect(result.best!.confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_LINK);

    // Variante OCR sem acento também casa
    const result2 = await matchFixtureFallback(
      { home: "Valerenga", away: "Rosenborg", kickoffIso: "2026-07-31T19:00:00Z" },
      client,
    );
    expect(result2.best!.fixture_id).toBe(502);
    expect(result2.best!.confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_LINK);
  });

  it("caso real: 'Arda Kardzhali' (estendido) × 'CSKA 1948 Sofia' (exato) casa com auto-link", async () => {
    const { client } = makeClient(NORWAY_ROWS);
    const result = await matchFixtureFallback(
      {
        home: "Arda Kardzhali",
        away: "CSKA 1948 Sofia",
        kickoffIso: "2026-07-31T16:00:00Z",
      },
      client,
    );

    expect(result.best!.fixture_id).toBe(503);
    // (0.9 token-set + 1.0 igualdade) / 2 = 0.95
    expect(result.best!.confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_LINK);
  });

  // ── Sem falso positivo ──────────────────────────────────────────────────────
  it("times aleatórios não casam com nada (best = null, candidates vazio)", async () => {
    const { client } = makeClient(NORWAY_ROWS);
    const result = await matchFixtureFallback(
      { home: "Botafogo", away: "Vasco da Gama", kickoffIso: "2026-07-31T17:00:00Z" },
      client,
    );

    expect(result.best).toBeNull();
    expect(result.candidates).toHaveLength(0);
  });

  it("match ambíguo (só um lado forte) nunca ganha ≥ AUTO_LINK", async () => {
    const { client } = makeClient([
      {
        id: 601,
        home_team: "Bodø / Glimt",
        away_team: "Rosenborg",
        league: "Eliteserien",
        country: "norway",
        kickoff_utc: "2026-07-31T17:00:00Z",
      },
    ]);
    // home bate exato, away é outro time (trigram fraco)
    const result = await matchFixtureFallback(
      { home: "Bodo/Glimt", away: "Lillestrom", kickoffIso: "2026-07-31T17:00:00Z" },
      client,
    );

    if (result.best !== null) {
      expect(result.best.confidence).toBeLessThan(CONFIDENCE_AUTO_LINK);
    }
  });

  it("kickoff incompatível (> 24h de distância) não ganha auto-link mesmo com nomes exatos", async () => {
    const { client } = makeClient([
      {
        ...NORWAY_ROWS[0]!,
        kickoff_utc: "2026-08-02T17:00:00Z", // 2 dias depois do cupom
      },
    ]);
    const result = await matchFixtureFallback(
      { home: "Bodo/Glimt", away: "Lillestrom", kickoffIso: "2026-07-31T17:00:00Z" },
      client,
    );

    if (result.best !== null) {
      expect(result.best.confidence).toBeLessThan(CONFIDENCE_AUTO_LINK);
    }
  });

  // ── Janela de datas ─────────────────────────────────────────────────────────
  it("com kickoffIso: janela = kickoff ±2 dias", async () => {
    const { client, from, select, gte, lte } = makeClient([]);
    await matchFixtureFallback(
      { home: "A", away: "B", kickoffIso: "2026-07-31T17:00:00.000Z" },
      client,
    );

    expect(from).toHaveBeenCalledWith("fixtures");
    expect(select).toHaveBeenCalledWith(
      "id, home_team, away_team, league, country, kickoff_utc",
    );
    expect(gte).toHaveBeenCalledWith("kickoff_utc", "2026-07-29T17:00:00.000Z");
    expect(lte).toHaveBeenCalledWith("kickoff_utc", "2026-08-02T17:00:00.000Z");
  });

  it("sem kickoffIso: janela = hoje ±3 dias", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00.000Z"));
    try {
      const { client, gte, lte } = makeClient([]);
      await matchFixtureFallback({ home: "A", away: "B", kickoffIso: null }, client);

      expect(gte).toHaveBeenCalledWith("kickoff_utc", "2026-07-28T12:00:00.000Z");
      expect(lte).toHaveBeenCalledWith("kickoff_utc", "2026-08-03T12:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Contrato de shape / erro ────────────────────────────────────────────────
  it("candidates respeitam CONFIDENCE_MIN e vêm ordenados DESC (máx 3)", async () => {
    const rows: DbRow[] = [
      NORWAY_ROWS[0]!,
      { ...NORWAY_ROWS[0]!, id: 511, home_team: "Bodo Glimt II", away_team: "Lillestrom II" },
      { ...NORWAY_ROWS[0]!, id: 512, home_team: "Sandefjord", away_team: "Brann" },
    ];
    const { client } = makeClient(rows);
    const result = await matchFixtureFallback(
      { home: "Bodo/Glimt", away: "Lillestrom", kickoffIso: "2026-07-31T17:00:00Z" },
      client,
    );

    expect(result.candidates.length).toBeLessThanOrEqual(3);
    for (const c of result.candidates) {
      expect(c.confidence).toBeGreaterThanOrEqual(CONFIDENCE_MIN);
    }
    const confidences = result.candidates.map((c) => c.confidence);
    expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
    expect(result.best!.fixture_id).toBe(501);
  });

  it("erro do PostgREST → lança erro com mensagem clara", async () => {
    const { client } = makeClient([], { message: "permission denied" });
    await expect(
      matchFixtureFallback({ home: "A", away: "B" }, client),
    ).rejects.toThrow("match_fixture_fallback: permission denied");
  });
});
