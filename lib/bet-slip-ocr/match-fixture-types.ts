/**
 * match-fixture-types.ts — tipos e constantes do fuzzy match (Wave N2/N5).
 *
 * Isolado de match-fixture.ts pra evitar que Client Components arrastem
 * dependências server-side (next/headers via lib/supabase/server) pro
 * bundle do browser.
 */

export interface MatchInput {
  home: string;
  away: string;
  kickoffIso?: string | null;
  league?: string | null;
}

export interface MatchedFixture {
  fixture_id: number;
  home_team: string;
  away_team: string;
  league: string | null;
  country: string | null;
  kickoff_utc: string;
  confidence: number;
}

export interface MatchResult {
  best: MatchedFixture | null;
  candidates: MatchedFixture[];
}

export const CONFIDENCE_AUTO_LINK = 0.85;
export const CONFIDENCE_MIN = 0.4;
