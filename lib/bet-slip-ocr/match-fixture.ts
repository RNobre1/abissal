/**
 * matchFixture — Wave N2: fuzzy match entre nomes de times extraídos por OCR
 * e fixtures existentes na tabela `fixtures` via pg_trgm similarity.
 *
 * Usa RPC `match_fixture_fuzzy` (definida em migration 0037_pg_trgm_fixtures.sql).
 * Sem UI, sem LLM — só query de similaridade trigrama.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONFIDENCE_MIN,
  type MatchInput,
  type MatchResult,
  type MatchedFixture,
} from "./match-fixture-types";

export {
  CONFIDENCE_AUTO_LINK,
  CONFIDENCE_MIN,
  type MatchInput,
  type MatchResult,
  type MatchedFixture,
} from "./match-fixture-types";

// ── RPC row shape (retorno do Postgres) ───────────────────────────────────────

interface RpcRow {
  id: number;
  home_team: string;
  away_team: string;
  league: string | null;
  country: string | null;
  kickoff_utc: string;
  confidence: number | string; // Postgres numeric pode vir como string em alguns drivers
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Faz fuzzy match de um par home/away (extraído por OCR) contra fixtures do DB.
 *
 * @param input  - Nomes dos times + kickoff ISO opcional
 * @param opts   - `client`: injeta SupabaseClient pré-construído (server actions)
 * @returns MatchResult com best (null se abaixo do MIN) e candidates (top 3)
 */
export async function matchFixture(
  input: MatchInput,
  opts?: { client?: SupabaseClient },
): Promise<MatchResult> {
  const supabase =
    opts?.client ??
    (await (await import("@/lib/supabase/server")).createClient());

  const { data, error } = await supabase.rpc("match_fixture_fuzzy", {
    p_home: input.home,
    p_away: input.away,
    p_kickoff: input.kickoffIso ?? null,
  });

  if (error) {
    throw new Error(`match_fixture_fuzzy: ${error.message}`);
  }

  const rows: RpcRow[] = (data as RpcRow[]) ?? [];

  // Mapeia row DB → MatchedFixture (normaliza confidence para number)
  const fixtures: MatchedFixture[] = rows.map((row) => ({
    fixture_id: Number(row.id),
    home_team: row.home_team,
    away_team: row.away_team,
    league: row.league,
    country: row.country,
    kickoff_utc: row.kickoff_utc,
    confidence: Number(row.confidence),
  }));

  // Filtra candidatos abaixo do MIN; mantém ordenação DESC (DB já ordena)
  const candidates = fixtures.filter((f) => f.confidence >= CONFIDENCE_MIN);

  const best = candidates.length > 0 ? (candidates[0] ?? null) : null;

  return { best, candidates };
}
