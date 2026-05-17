import type { SupabaseClient } from "@supabase/supabase-js";
import { brtDayWindowUtc, toIsoUtc, trimKoTime } from "./time";
import type { FixtureDTO } from "./types";

const FIXTURE_COLUMNS =
  "id, match_date, ko_time, home_team, away_team, league, country, source_url, kickoff_utc, " +
  "hd_probe:detail_json->>team_record";

/**
 * Compact raw row for the LIST query. We deliberately do NOT select the full
 * `detail_json` jsonb blob nor any heavy sub-paths (`streaks`,
 * `referee_record`) — those pulled ~34MB/day and killed the Cloudflare Worker
 * (Error 1101). We pull ONLY scalar columns plus a presence probe
 * (`detail_json->>team_record`, the team_record subtree as text) to derive
 * has_detail. team_record is written by the scraper whenever detail_json
 * exists, so the probe is non-null iff detail is present (validated against
 * prod: 0 false-negatives over the full day window; a deep leaf such as
 * `->home->overall->>type` had a real 1-row false-negative — rejected). The
 * full window stays well under 300KB vs 34MB. This is local to the repository;
 * the shared FixtureRow stays as the table-mirror contract.
 */
interface CompactFixtureRow {
  id: number;
  match_date: string;
  ko_time: string | null;
  home_team: string;
  away_team: string;
  league: string | null;
  country: string | null;
  source_url: string | null;
  kickoff_utc: string | null;
  hd_probe: string | null;
}

/**
 * Returns the fixtures whose kickoff falls inside the BRT calendar day `date`,
 * matching the port of the Ruby `AdamStats::API::DBRepository.fixtures_for`.
 *
 * The Supabase client is taken as a dependency so unit tests can substitute a
 * mock and so the route handler controls when the admin client is constructed.
 *
 * Rows are sorted in JS (kickoff_utc asc nulls last, ko_time asc nulls last,
 * id asc) so the result is deterministic regardless of how the underlying
 * Postgres NULLS LAST surfaces through PostgREST.
 */
export async function fixturesForBrtDay(
  date: string,
  // Loose type so test mocks don't need to satisfy the full SupabaseClient API.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any> | any,
): Promise<FixtureDTO[]> {
  const { startUtc, endUtc } = brtDayWindowUtc(date);

  // PostgREST OR: (kickoff_utc >= start AND kickoff_utc < end) OR (kickoff_utc IS NULL AND match_date = date)
  // The `gte`/`lt` filters already exclude NULLs, so we don't repeat `not.is.null`.
  const orExpr =
    `and(kickoff_utc.gte.${startUtc},kickoff_utc.lt.${endUtc}),` +
    `and(kickoff_utc.is.null,match_date.eq.${date})`;

  const { data, error } = await supabase
    .from("fixtures")
    .select(FIXTURE_COLUMNS)
    .or(orExpr)
    .order("kickoff_utc", { ascending: true, nullsFirst: false })
    .order("ko_time", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  if (error) {
    throw new Error(error.message ?? "supabase query failed");
  }

  const rows = (data ?? []) as CompactFixtureRow[];
  const sorted = [...rows].sort(compareFixtures);
  return sorted.map(toDto);
}

function compareFixtures(a: CompactFixtureRow, b: CompactFixtureRow): number {
  // 1) kickoff_utc ascending, nulls last
  const kAuOrder = compareNullableString(a.kickoff_utc, b.kickoff_utc);
  if (kAuOrder !== 0) return kAuOrder;

  // 2) ko_time ascending, nulls last
  const koOrder = compareNullableString(a.ko_time, b.ko_time);
  if (koOrder !== 0) return koOrder;

  // 3) id ascending
  return a.id - b.id;
}

function compareNullableString(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls last
  if (b === null) return -1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function toDto(row: CompactFixtureRow): FixtureDTO {
  // Lista sem badges (payload mínimo p/ não estourar o Worker — ~40MB→KBs). has_detail é proxy via team_record; badges/has_detail exatos voltam via view/RPC (follow-up).
  const has_detail = row.hd_probe != null;
  return {
    id: row.id,
    match_date: row.match_date,
    ko_time: trimKoTime(row.ko_time),
    home_team: row.home_team,
    away_team: row.away_team,
    league: row.league,
    country: row.country,
    source_url: row.source_url,
    has_detail,
    kickoff_utc: toIsoUtc(row.kickoff_utc),
  };
}
