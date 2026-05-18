import type { SupabaseClient } from "@supabase/supabase-js";
import { brtDayWindowUtc, toIsoUtc, trimKoTime } from "./time";
import type { FixtureDTO } from "./types";
import { badgesFromSlugs } from "./badges";

const FIXTURE_COLUMNS =
  "id, match_date, ko_time, home_team, away_team, league, country, source_url, kickoff_utc, " +
  "hd_probe:detail_json->>team_record";

/**
 * Postgres view that computes badges + high_signal IN the database
 * (migration 0017_fixture_badges.sql). It reads `detail_json->streaks` and
 * `detail_json->referee_record` server-side and emits ONLY scalars:
 * `(fixture_id bigint, badges text[], high_signal boolean)`. The heavy JSON
 * never crosses into the Cloudflare Worker — this is B12 follow-up #1.
 *
 * Earlier (rejected) attempt: `fixturesWithBadgesForDashboard` selected
 * `detail_json->streaks`/`->referee_record` to run computeBadges() in JS.
 * Measured against prod: ~22-26 MB/day at the 285-fixture peak — IDENTICAL
 * payload class to the 1101 outage. The blob MUST stay in Postgres.
 */
const BADGES_VIEW = "fixture_badges_view";

const BADGE_VIEW_FULL = "fixture_id, badges, high_signal";
const BADGE_VIEW_SCALAR = "fixture_id, high_signal";

interface BadgeViewRow {
  fixture_id: number;
  badges?: string[] | null;
  high_signal?: boolean | null;
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any> | any;

function brtOrExpr(date: string): string {
  const { startUtc, endUtc } = brtDayWindowUtc(date);
  // PostgREST OR: (kickoff_utc >= start AND kickoff_utc < end)
  //            OR (kickoff_utc IS NULL AND match_date = date)
  // The gte/lt filters already exclude NULLs, so we don't repeat not.is.null.
  return (
    `and(kickoff_utc.gte.${startUtc},kickoff_utc.lt.${endUtc}),` +
    `and(kickoff_utc.is.null,match_date.eq.${date})`
  );
}

/**
 * Fetches badge rows from the Postgres view for the given fixture ids.
 * Returns a Map keyed by fixture_id. NEVER selects detail_json — only the
 * scalar columns the view materialises. Degrades to an empty map if the
 * view is unavailable (e.g. migration not yet applied) so neither the
 * dashboard nor the list crashes.
 */
async function fetchBadgeView(
  supabase: AnySupabase,
  ids: number[],
  columns: string,
): Promise<Map<number, BadgeViewRow>> {
  const map = new Map<number, BadgeViewRow>();
  if (ids.length === 0) return map;
  try {
    const { data, error } = await supabase
      .from(BADGES_VIEW)
      .select(columns)
      .in("fixture_id", ids);
    if (error) return map;
    for (const r of (data ?? []) as BadgeViewRow[]) {
      map.set(r.fixture_id, r);
    }
  } catch {
    // View missing / transient error → no badges, no realce. Never crash.
  }
  return map;
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
 *
 * The `/fixtures` realce needs to know which fixtures are high-signal. To do
 * that WITHOUT reopening the B12 payload outage, we issue a tiny SECOND query
 * against `fixture_badges_view` selecting ONLY `(fixture_id, high_signal)` —
 * pure scalars, no badges array, no detail_json — and attach the boolean.
 */
export async function fixturesForBrtDay(
  date: string,
  supabase: AnySupabase,
): Promise<FixtureDTO[]> {
  const { data, error } = await supabase
    .from("fixtures")
    .select(FIXTURE_COLUMNS)
    .or(brtOrExpr(date))
    .order("kickoff_utc", { ascending: true, nullsFirst: false })
    .order("ko_time", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  if (error) {
    throw new Error(error.message ?? "supabase query failed");
  }

  const rows = (data ?? []) as CompactFixtureRow[];
  const sorted = [...rows].sort(compareFixtures);

  const signalMap = await fetchBadgeView(
    supabase,
    sorted.map((r) => r.id),
    BADGE_VIEW_SCALAR,
  );

  return sorted.map((row) => {
    const dto = toDto(row);
    dto.high_signal = signalMap.get(row.id)?.high_signal === true;
    return dto;
  });
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

/**
 * Returns fixtures for the given BRT day including computed badges, used by
 * the dashboard's "Destaques do dia" section.
 *
 * Badges are computed IN Postgres by `fixture_badges_view` (migration 0017)
 * and arrive as a scalar `text[]` of slugs, rehydrated client-side via
 * `badgesFromSlugs()`. NO detail_json sub-path is ever selected — this is the
 * structural fix for B12 follow-up #1. Two queries: scalar fixtures + scalar
 * view, joined in JS by fixture_id.
 */
export async function fixturesWithBadgesForDashboard(
  date: string,
  supabase: AnySupabase,
): Promise<FixtureDTO[]> {
  const { data, error } = await supabase
    .from("fixtures")
    .select(FIXTURE_COLUMNS)
    .or(brtOrExpr(date))
    .order("kickoff_utc", { ascending: true, nullsFirst: false })
    .order("ko_time", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  if (error) {
    throw new Error(error.message ?? "supabase query failed");
  }

  const rows = (data ?? []) as CompactFixtureRow[];
  const sorted = [...rows].sort(compareFixtures);

  const badgeMap = await fetchBadgeView(
    supabase,
    sorted.map((r) => r.id),
    BADGE_VIEW_FULL,
  );

  return sorted.map((row) => {
    const dto = toDto(row);
    const view = badgeMap.get(row.id);
    dto.badges = badgesFromSlugs(view?.badges ?? []);
    dto.high_signal = view?.high_signal === true;
    return dto;
  });
}

function toDto(row: CompactFixtureRow): FixtureDTO {
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
