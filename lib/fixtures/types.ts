import type { Badge } from "./badges";

/**
 * Fixture as exposed by the API to the client. Mirrors the columns of the
 * `fixtures` table after serialization (kickoff_utc normalized to ISO-8601 Z,
 * ko_time trimmed to "HH:MM", has_detail derived from a compact presence probe
 * on detail_json — see repository.ts; the list query never pulls the blob).
 */
export interface FixtureDTO {
  id: number;
  match_date: string; // YYYY-MM-DD (UK day, kept for backwards compat)
  ko_time: string | null; // "HH:MM" in UK local
  home_team: string;
  away_team: string;
  league: string | null;
  country: string | null; // slug ("england", "ukraine", "brazil"...)
  source_url: string | null;
  has_detail: boolean;
  kickoff_utc: string | null; // ISO-8601 with Z suffix
  badges?: Badge[];
}

/**
 * Raw row shape as returned by Supabase REST (`select(...)`) — used inside
 * the repository before serialization to FixtureDTO.
 */
export interface FixtureRow {
  id: number;
  match_date: string;
  ko_time: string | null;
  home_team: string;
  away_team: string;
  league: string | null;
  country: string | null;
  source_url: string | null;
  detail_json: unknown;
  kickoff_utc: string | null;
}
