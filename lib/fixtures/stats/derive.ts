/**
 * Pure derivation functions over fixtures.detail_json.
 *
 * Tolerant by design: each function accepts `unknown` and returns either
 * a typed value or null/[] for malformed input. The UI calls these from
 * Server Components; broken sub-panels render nothing instead of crashing.
 */

import { mean, quantileSorted } from "simple-statistics";

import type {
  BoxStats,
  Distributions,
  NormalizedRecentMatch,
  OddsCategory,
  OddsCategoryEntry,
  OddsCategoryMap,
  OddsOutcome,
  Player,
  PlayerRanked,
  PlayerRankingCriterion,
  RadarAxis,
  RadarData,
  Splits1h2h,
  StatKey,
  Streak,
  StreakIndex,
  TeamRecordDerived,
  TeamSplit,
  TeamSplitDerived,
} from "./detail-json-types";

// ─── Helpers ────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function safeNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function safeString(value: unknown, fallback: string = ""): string {
  if (typeof value === "string") return value;
  return fallback;
}

const ORDINAL_RE = /^(\d+)(?:st|nd|rd|th)$/i;

/** Parses an English ordinal ("9th" → 9, "22nd" → 22). Returns null otherwise. */
export function parseOrdinal(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(ORDINAL_RE);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function normalizeSplit(raw: unknown): TeamSplitDerived | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const rawForm = safeArray(rec.form).filter(
    (x): x is string => typeof x === "string",
  );
  return {
    type: safeString(rec.type, "All"),
    played: safeNumber(rec.played),
    won: safeNumber(rec.won),
    draw: safeNumber(rec.draw),
    lost: safeNumber(rec.lost),
    goals_for: safeNumber(rec.goals_for),
    goals_against: safeNumber(rec.goals_against),
    goal_diff: safeNumber(rec.goal_diff),
    points: safeNumber(rec.points),
    points_per_game: safeNumber(rec.points_per_game),
    position: parseOrdinal(rec.position),
    form: [...rawForm].reverse(), // adamchoi: oldest → newest; we want newest → oldest
  };
}

// ─── 1. deriveTeamRecord ────────────────────────────────────────────────

export function deriveTeamRecord(raw: unknown): TeamRecordDerived | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  // The side-specific split: prefer the matching key (home or away), fallback
  // to whichever is present (some malformed inputs may have only one).
  const split =
    normalizeSplit(rec.home) ??
    normalizeSplit(rec.away) ??
    normalizeSplit(rec.split);
  const overall = normalizeSplit(rec.overall);

  if (!split && !overall) return null;

  // Fill missing leg with the other (defensive — keeps consumers happy).
  return {
    split: split ?? overall!,
    overall: overall ?? split!,
  };
}

// ─── 2. deriveRecentMatchStats ──────────────────────────────────────────

function normalizeMatch(
  raw: unknown,
  perspective: string,
): NormalizedRecentMatch | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  const status = safeString(rec.status);
  if (status !== "FT") return null;

  const homeTeam = safeString(rec.home_team);
  const awayTeam = safeString(rec.away_team);
  const isHome = homeTeam === perspective;

  // "for" = perspective team; "against" = opponent
  const goals_1h_for = isHome
    ? safeNumberOrNull(rec.homeGoalsHt)
    : safeNumberOrNull(rec.awayGoalsHt);
  const goals_1h_against = isHome
    ? safeNumberOrNull(rec.awayGoalsHt)
    : safeNumberOrNull(rec.homeGoalsHt);
  const goals_ft_for = isHome
    ? safeNumberOrNull(rec.homeGoalsFt)
    : safeNumberOrNull(rec.awayGoalsFt);
  const goals_ft_against = isHome
    ? safeNumberOrNull(rec.awayGoalsFt)
    : safeNumberOrNull(rec.homeGoalsFt);
  const goals_2h_for =
    goals_ft_for != null && goals_1h_for != null
      ? goals_ft_for - goals_1h_for
      : null;
  const goals_2h_against =
    goals_ft_against != null && goals_1h_against != null
      ? goals_ft_against - goals_1h_against
      : null;

  const corners_1h_for = isHome
    ? safeNumberOrNull(rec.homeCorners1h)
    : safeNumberOrNull(rec.awayCorners1h);
  const corners_2h_for = isHome
    ? safeNumberOrNull(rec.homeCorners2h)
    : safeNumberOrNull(rec.awayCorners2h);
  const corners_1h_against = isHome
    ? safeNumberOrNull(rec.awayCorners1h)
    : safeNumberOrNull(rec.homeCorners1h);
  const corners_2h_against = isHome
    ? safeNumberOrNull(rec.awayCorners2h)
    : safeNumberOrNull(rec.homeCorners2h);
  const corners_for = isHome
    ? safeNumberOrNull(rec.homeCorners)
    : safeNumberOrNull(rec.awayCorners);
  const corners_against = isHome
    ? safeNumberOrNull(rec.awayCorners)
    : safeNumberOrNull(rec.homeCorners);

  const cards_1h_for = isHome
    ? safeNumberOrNull(rec.homeYellowsHt ?? rec.homeCards1h)
    : safeNumberOrNull(rec.awayYellowsHt ?? rec.awayCards1h);
  const cards_2h_for = isHome
    ? safeNumberOrNull(rec.homeYellowsFt ?? rec.homeCards2h)
    : safeNumberOrNull(rec.awayYellowsFt ?? rec.awayCards2h);
  const cards_1h_against = isHome
    ? safeNumberOrNull(rec.awayYellowsHt ?? rec.awayCards1h)
    : safeNumberOrNull(rec.homeYellowsHt ?? rec.homeCards1h);
  const cards_2h_against = isHome
    ? safeNumberOrNull(rec.awayYellowsFt ?? rec.awayCards2h)
    : safeNumberOrNull(rec.homeYellowsFt ?? rec.homeCards2h);
  const cards_for = isHome
    ? safeNumberOrNull(rec.homeYellows)
    : safeNumberOrNull(rec.awayYellows);
  const cards_against = isHome
    ? safeNumberOrNull(rec.awayYellows)
    : safeNumberOrNull(rec.homeYellows);

  return {
    id: safeNumber(rec.id),
    date_iso: safeString(rec.date_iso),
    opponent: isHome ? awayTeam : homeTeam,
    is_home: isHome,
    result: (rec.result as "W" | "L" | "D" | null) ?? null,
    goals_1h_for,
    goals_2h_for,
    goals_1h_against,
    goals_2h_against,
    goals_ft_for,
    goals_ft_against,
    corners_1h_for,
    corners_2h_for,
    corners_1h_against,
    corners_2h_against,
    corners_for,
    corners_against,
    cards_1h_for,
    cards_2h_for,
    cards_1h_against,
    cards_2h_against,
    cards_for,
    cards_against,
    sot_for: isHome
      ? safeNumberOrNull(rec.homeShotsOnTarget)
      : safeNumberOrNull(rec.awayShotsOnTarget),
    sot_against: isHome
      ? safeNumberOrNull(rec.awayShotsOnTarget)
      : safeNumberOrNull(rec.homeShotsOnTarget),
    shots_for: isHome
      ? safeNumberOrNull(rec.homeTotalShots)
      : safeNumberOrNull(rec.awayTotalShots),
    shots_against: isHome
      ? safeNumberOrNull(rec.awayTotalShots)
      : safeNumberOrNull(rec.homeTotalShots),
    booking_points_for: isHome
      ? safeNumberOrNull(rec.homeBookingPoints)
      : safeNumberOrNull(rec.awayBookingPoints),
    booking_points_against: isHome
      ? safeNumberOrNull(rec.awayBookingPoints)
      : safeNumberOrNull(rec.homeBookingPoints),
    fouls_for: isHome
      ? safeNumberOrNull(rec.homeFouls)
      : safeNumberOrNull(rec.awayFouls),
    fouls_against: isHome
      ? safeNumberOrNull(rec.awayFouls)
      : safeNumberOrNull(rec.homeFouls),
    offsides_for: isHome
      ? safeNumberOrNull(rec.homeOffsides)
      : safeNumberOrNull(rec.awayOffsides),
    offsides_against: isHome
      ? safeNumberOrNull(rec.awayOffsides)
      : safeNumberOrNull(rec.homeOffsides),
  };
}

export function deriveRecentMatchStats(
  raw: unknown,
  _allMatches: unknown,
  perspectiveTeam: string,
): NormalizedRecentMatch[] {
  const arr = safeArray(raw);
  const out: NormalizedRecentMatch[] = [];
  for (const m of arr) {
    const norm = normalizeMatch(m, perspectiveTeam);
    if (norm) out.push(norm);
  }
  return out;
}

// ─── 3. deriveSplits1h2h ────────────────────────────────────────────────

function avg(values: Array<number | null>): number {
  if (values.length === 0) return 0;
  const sum = values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  return sum / values.length;
}

export function deriveSplits1h2h(matches: NormalizedRecentMatch[]): Splits1h2h {
  if (!Array.isArray(matches) || matches.length === 0) {
    return {
      goals_1h_avg: 0,
      goals_2h_avg: 0,
      corners_1h_avg: 0,
      corners_2h_avg: 0,
      cards_1h_avg: 0,
      cards_2h_avg: 0,
      sot_for_avg: 0,
    };
  }
  return {
    goals_1h_avg: avg(matches.map((m) => m.goals_1h_for)),
    goals_2h_avg: avg(matches.map((m) => m.goals_2h_for)),
    corners_1h_avg: avg(matches.map((m) => m.corners_1h_for)),
    corners_2h_avg: avg(matches.map((m) => m.corners_2h_for)),
    cards_1h_avg: avg(matches.map((m) => m.cards_1h_for)),
    cards_2h_avg: avg(matches.map((m) => m.cards_2h_for)),
    sot_for_avg: avg(matches.map((m) => m.sot_for)),
  };
}

// ─── 4. deriveStreakIndex ───────────────────────────────────────────────

function isStreak(value: unknown): value is Streak {
  return asRecord(value) !== null;
}

export function deriveStreakIndex(raw: unknown): StreakIndex {
  const arr = safeArray(raw).filter(isStreak);
  if (arr.length === 0) return { all: [], by_group: {} };

  const sorted = [...arr].sort(
    (a, b) => safeNumber(b.overall_perc) - safeNumber(a.overall_perc),
  );

  const by_group: Record<string, Streak[]> = {};
  for (const s of sorted) {
    const g = safeString(s.group, "Other") || "Other";
    if (!by_group[g]) by_group[g] = [];
    by_group[g].push(s);
  }

  return { all: sorted, by_group };
}

// ─── 5. derivePlayerRankings ────────────────────────────────────────────

function isPlayer(value: unknown): value is Player {
  return asRecord(value) !== null;
}

export function derivePlayerRankings(
  raw: unknown,
  criterion: PlayerRankingCriterion,
): PlayerRanked[] {
  const arr = safeArray(raw).filter(isPlayer);
  if (arr.length === 0) return [];

  const scored: Array<PlayerRanked & { __sort: number }> = arr.map((p) => {
    let key: number;
    let card_score: number | undefined;
    switch (criterion) {
      case "cards":
        card_score = safeNumber(p.yellows) + safeNumber(p.reds) * 2;
        key = card_score;
        break;
      case "first_cards":
        key = safeNumber(p.first_cards);
        break;
      case "sot":
        key = safeNumber(p.shots_on_target);
        break;
      case "assists":
        key = safeNumber(p.assists);
        break;
      case "goals":
      default:
        key = safeNumber(p.goals);
        break;
    }
    return { ...p, ...(card_score !== undefined ? { card_score } : {}), __sort: key };
  });

  scored.sort((a, b) => b.__sort - a.__sort);

  return scored.map((entry) => {
    const rest: PlayerRanked & { __sort?: number } = { ...entry };
    delete rest.__sort;
    return rest as PlayerRanked;
  });
}

// ─── 6. deriveOddsCategories ────────────────────────────────────────────

/**
 * Classifier — maps a market name to one of 7 buckets.
 * Rules (first match wins):
 *  - explicit "Player ..." or "To assist" / "To score or assist" → player-props
 *  - contains "Corner" → corners
 *  - contains "Card" / "Booking" → cards
 *  - contains "Team " → teams
 *  - contains "Half" → halves
 *  - otherwise: match (Result/BTTS/Match Goals/...) or other
 */
function classifyMarket(name: string): OddsCategory {
  const n = name.toLowerCase();
  if (n.startsWith("player ") || n.startsWith("to assist") || n.startsWith("to score")) {
    return "player-props";
  }
  if (n.includes("corner")) return "corners";
  if (n.includes("card") || n.includes("booking")) return "cards";
  if (n.startsWith("team ")) return "teams";
  if (n.includes("half")) return "halves";
  // Known match-level markets
  const MATCH = new Set([
    "result",
    "btts",
    "double chance",
    "match goals overs/unders",
    "result & btts",
    "win to nil",
    "handicap result",
    "clean sheet",
  ]);
  if (MATCH.has(n)) return "match";
  return "other";
}

export function deriveOddsCategories(raw: unknown): OddsCategoryMap {
  const rec = asRecord(raw);
  if (!rec) return {};
  const out: OddsCategoryMap = {};
  for (const [market, outcomesRaw] of Object.entries(rec)) {
    const outcomesRec = asRecord(outcomesRaw);
    if (!outcomesRec) continue;
    const outcomes: Array<{ name: string } & OddsOutcome> = [];
    for (const [name, oRaw] of Object.entries(outcomesRec)) {
      const o = asRecord(oRaw);
      if (!o) continue;
      const decimal_odds = safeNumberOrNull(o.decimal_odds);
      if (decimal_odds === null) continue;
      outcomes.push({
        name,
        decimal_odds,
        bookmaker: safeString(o.bookmaker),
      });
    }
    if (outcomes.length === 0) continue;
    const cat = classifyMarket(market);
    const entry: OddsCategoryEntry = { market, outcomes };
    if (!out[cat]) out[cat] = [];
    out[cat]!.push(entry);
  }
  return out;
}

// ─── 7. deriveDistributions ─────────────────────────────────────────────

const DIST_KEYS: StatKey[] = [
  "goals_ft_for",
  "goals_ft_against",
  "corners_for",
  "corners_against",
  "cards_for",
  "sot_for",
  "booking_points_for",
];

function zeroBox(): BoxStats {
  return { min: 0, q1: 0, median: 0, q3: 0, max: 0 };
}

function boxFromSeries(series: number[]): BoxStats {
  if (series.length === 0) return zeroBox();
  const sorted = [...series].sort((a, b) => a - b);
  return {
    min: sorted[0],
    q1: quantileSorted(sorted, 0.25),
    median: quantileSorted(sorted, 0.5),
    q3: quantileSorted(sorted, 0.75),
    max: sorted[sorted.length - 1],
  };
}

export function deriveDistributions(
  matches: NormalizedRecentMatch[],
): Distributions {
  const out = {} as Distributions;
  if (!Array.isArray(matches) || matches.length === 0) {
    for (const k of DIST_KEYS) out[k] = zeroBox();
    return out;
  }
  for (const k of DIST_KEYS) {
    const series = matches.map((m) => safeNumber(m[k], 0));
    out[k] = boxFromSeries(series);
  }
  return out;
}

// ─── 8. deriveRadarAxes ─────────────────────────────────────────────────

const RADAR_AXES: Array<{ key: RadarAxis["key"]; label: string }> = [
  { key: "goals_per_game", label: "Gols/jogo" },
  { key: "goals_conceded", label: "Gols sofridos" },
  { key: "sot", label: "Chutes no gol" },
  { key: "booking_points", label: "Booking points" },
  { key: "corners", label: "Cantos" },
  { key: "fouls", label: "Faltas" },
];

function radarValue(
  matches: NormalizedRecentMatch[],
  key: RadarAxis["key"],
): number {
  if (matches.length === 0) return 0;
  let values: number[];
  switch (key) {
    case "goals_per_game":
      values = matches.map((m) => safeNumber(m.goals_ft_for));
      break;
    case "goals_conceded":
      values = matches.map((m) => safeNumber(m.goals_ft_against));
      break;
    case "sot":
      values = matches.map((m) => safeNumber(m.sot_for));
      break;
    case "booking_points":
      values = matches.map((m) => safeNumber(m.booking_points_for));
      break;
    case "corners":
      values = matches.map((m) => safeNumber(m.corners_for));
      break;
    case "fouls":
      values = matches.map((m) => safeNumber(m.fouls_for));
      break;
  }
  return mean(values);
}

export function deriveRadarAxes(
  home: NormalizedRecentMatch[],
  away: NormalizedRecentMatch[],
): RadarData {
  const axes: RadarAxis[] = RADAR_AXES.map(({ key, label }) => {
    const homeVal = radarValue(home, key);
    const awayVal = radarValue(away, key);
    const max = Math.max(homeVal, awayVal);
    return {
      key,
      label,
      home: homeVal,
      away: awayVal,
      home_norm: max > 0 ? homeVal / max : 0,
      away_norm: max > 0 ? awayVal / max : 0,
    };
  });
  return { axes };
}

// ─── Scatter presets + recent series ────────────────────────────────────

/** A curated pair of metric keys for the scatter playground. */
export interface ScatterPreset {
  x: string;
  y: string;
  label: string;
}

/** Hand-picked metric pairs likely to expose a betting-relevant signal. */
export const SCATTER_PRESETS: ScatterPreset[] = [
  { x: "sot_for", y: "goals_ft_for", label: "Finalizações × Gols" },
  { x: "corners_for", y: "goals_2h_for", label: "Escanteios × Gols 2T" },
  { x: "fouls_for", y: "cards_for", label: "Faltas × Cartões" },
  { x: "shots_for", y: "sot_for", label: "Chutes × No gol" },
];

/** A per-match series for one metric, plus its mean reference line. */
export interface RecentSeries {
  values: (number | null)[];
  xLabels: string[];
  referenceValue: number;
}

/**
 * Project a single metric across recent matches, preserving nulls (gaps in
 * the line) and computing the mean of the finite values as a reference line.
 * xLabels use the first 3 chars of the opponent name, uppercased.
 */
export function deriveRecentSeries(
  matches: NormalizedRecentMatch[],
  metric: keyof NormalizedRecentMatch,
): RecentSeries {
  const values = matches.map((m) => {
    const v = m[metric];
    return typeof v === "number" ? v : null;
  });
  const finite = values.filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  const referenceValue = finite.length
    ? finite.reduce((a, b) => a + b, 0) / finite.length
    : 0;
  const xLabels = matches.map((m) =>
    (m.opponent ?? "?").slice(0, 3).toUpperCase(),
  );
  return { values, xLabels, referenceValue };
}

// Keep helpers exposed for unit tests / reuse in T2.
export const __internal = {
  asRecord,
  safeArray,
  safeNumber,
  safeNumberOrNull,
  safeString,
  parseOrdinal,
  classifyMarket,
};

// Silence unused-warning for TeamSplit import.
export type _TeamSplit = TeamSplit;
