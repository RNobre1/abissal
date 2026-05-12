import type { FixtureDTO } from "./types";

/**
 * Maps the country slug stored in `fixtures.country` (extracted from the
 * adamchoi/choistats source_url, e.g. "england", "ukraine", "brazil") to a
 * flag emoji. Falls back to a white flag for empty / unknown slugs so the
 * UI never has to guard against `null`.
 */
const FLAG_MAP: Record<string, string> = {
  england: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  wales: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  ukraine: "🇺🇦",
  spain: "🇪🇸",
  italy: "🇮🇹",
  germany: "🇩🇪",
  france: "🇫🇷",
  portugal: "🇵🇹",
  russia: "🇷🇺",
  brazil: "🇧🇷",
  netherlands: "🇳🇱",
  belgium: "🇧🇪",
  turkey: "🇹🇷",
  greece: "🇬🇷",
  switzerland: "🇨🇭",
  austria: "🇦🇹",
  denmark: "🇩🇰",
  sweden: "🇸🇪",
  norway: "🇳🇴",
  finland: "🇫🇮",
  poland: "🇵🇱",
  czech: "🇨🇿",
  slovakia: "🇸🇰",
  hungary: "🇭🇺",
  romania: "🇷🇴",
  bulgaria: "🇧🇬",
  croatia: "🇭🇷",
  serbia: "🇷🇸",
  slovenia: "🇸🇮",
  argentina: "🇦🇷",
  mexico: "🇲🇽",
  colombia: "🇨🇴",
  chile: "🇨🇱",
  usa: "🇺🇸",
  japan: "🇯🇵",
  southkorea: "🇰🇷",
  china: "🇨🇳",
  australia: "🇦🇺",
};

const FALLBACK_FLAG = "🏳️";

export function countryToFlag(slug: string | null | undefined): string {
  if (!slug) return FALLBACK_FLAG;
  return FLAG_MAP[slug.toLowerCase()] ?? FALLBACK_FLAG;
}

/**
 * Top-of-the-list leagues, in the exact order we want them rendered. The
 * key matches `LeagueGroup.key` (`${league}|${country}`), so the comparator
 * can distinguish "Premier League" England vs Ukraine, "Serie A" Italy vs
 * Brazil, etc. Anything not listed falls through to the earliest-kickoff
 * sort below.
 */
const PRIORITY_KEYS: ReadonlyArray<string> = [
  "Premier League|england",
  "La Liga|spain",
  "Serie A|italy",
  "Bundesliga|germany",
  "Ligue 1|france",
  "Portugese Liga NOS|portugal",
  "Serie A|brazil",
  "Serie B|brazil",
  "Champions League|europe",
  "Europa League|europe",
];

const PRIORITY_RANK = new Map<string, number>(
  PRIORITY_KEYS.map((k, i) => [k, i]),
);

export interface LeagueGroup {
  /** composite key "league|country" (country defaults to "—" when null) */
  key: string;
  /** league name (or "—" when null on the source row) */
  league: string;
  /** raw country slug from the DB — null when unknown */
  country: string | null;
  /** resolved flag emoji (fallback white flag for null/unknown) */
  flag: string;
  fixtures: FixtureDTO[];
}

/**
 * Groups fixtures by composite key `${league}|${country ?? "—"}`. Two-pass
 * stable order:
 *  1. Priority leagues first, in `PRIORITY_KEYS` order (Premier, La Liga, …).
 *  2. Everything else by earliest `kickoff_utc` in the group (nulls last).
 *
 * Within a group, fixtures retain their incoming order — the repository
 * already sorts by kickoff_utc/ko_time/id, so feeding repository output in
 * produces the expected ascending order without re-sorting here.
 */
export function groupFixturesByLeague(fixtures: FixtureDTO[]): LeagueGroup[] {
  const buckets = new Map<string, LeagueGroup>();

  for (const f of fixtures) {
    const league = f.league && f.league.trim().length > 0 ? f.league : "—";
    const country = f.country ?? null;
    const key = `${league}|${country ?? "—"}`;

    const existing = buckets.get(key);
    if (existing) {
      existing.fixtures.push(f);
    } else {
      buckets.set(key, {
        key,
        league,
        country,
        flag: countryToFlag(country),
        fixtures: [f],
      });
    }
  }

  const groups = Array.from(buckets.values());

  // Stable order: earliest kickoff_utc per group, nulls last. Use a sort key
  // computed once so the comparator is O(1) per call.
  const earliest = new Map<string, string | null>();
  for (const g of groups) {
    let min: string | null = null;
    for (const f of g.fixtures) {
      if (f.kickoff_utc !== null) {
        if (min === null || f.kickoff_utc < min) {
          min = f.kickoff_utc;
        }
      }
    }
    earliest.set(g.key, min);
  }

  groups.sort((a, b) => {
    const pa = PRIORITY_RANK.get(a.key);
    const pb = PRIORITY_RANK.get(b.key);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1; // priority always before non-priority
    if (pb !== undefined) return 1;

    // Both non-priority: earliest kickoff_utc, nulls last, then key.
    const ea = earliest.get(a.key) ?? null;
    const eb = earliest.get(b.key) ?? null;
    if (ea === null && eb === null) return a.key.localeCompare(b.key);
    if (ea === null) return 1;
    if (eb === null) return -1;
    if (ea < eb) return -1;
    if (ea > eb) return 1;
    return a.key.localeCompare(b.key);
  });

  return groups;
}
