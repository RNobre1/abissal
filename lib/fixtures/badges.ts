/**
 * Outlier badges computed deterministically from a fixture's `detail_json`.
 *
 * Used by the fixtures list to surface high-signal opportunities at a glance
 * (e.g. "cartão alto" when the referee averages a lot of bookings, "over alto"
 * when both squads have an Over 2.5 streak above 70%). Zero LLM, server-side.
 *
 * Conservative on purpose:
 *   - Streak-based badges require BOTH teams to qualify — single-sided streaks
 *     are noisy and don't earn a place on a tiny card.
 *   - Sample-size gate on the referee (`completed >= 5`) — otherwise a debutant
 *     ref with 1 booking-heavy game would mint a badge that means nothing.
 *   - Cap the output at 3 to keep the card from turning into a Christmas tree.
 *
 * THRESHOLDS — fonte única: `lib/fixtures/badge-thresholds.ts`.
 * Ao mudar qualquer threshold ou substring, edite TAMBÉM:
 *   `supabase/migrations/0017_fixture_badges.sql`
 *   CTEs: `strong_streaks` (STREAK_PERC_MIN, substrings de streak),
 *         `referee_flag`   (REFEREE_BOOKING_THRESHOLD, REFEREE_2YA_THRESHOLD,
 *                           REFEREE_MIN_COMPLETED),
 *         `badge_arrays`   (MAX_BADGES via array slice [1:3]).
 * O teste `lib/fixtures/badge-thresholds.parity.test.ts` detecta divergência.
 */

import {
  MAX_BADGES,
  STREAK_PERC_MIN,
  REFEREE_BOOKING_THRESHOLD,
  REFEREE_2YA_THRESHOLD,
  REFEREE_MIN_COMPLETED,
  STREAK_OVER25_SUBSTR,
  STREAK_BTTS_SUBSTRS,
  STREAK_FH_SUBSTRS,
} from "./badge-thresholds";

export type BadgeTone = "cards" | "over" | "btts" | "first-half";

export interface Badge {
  id: string;
  label: string;
  tone: BadgeTone;
}

/**
 * Single source of truth for badge slug -> presentation metadata. The
 * Postgres `fixture_badges_view` (migration 0017) emits only the slugs in
 * a `text[]`; `badgesFromSlugs()` rehydrates them into Badge objects so the
 * heavy detail_json never crosses into the Worker. Slugs and order MUST stay
 * in lockstep with the SQL view and with computeBadges() below.
 */
export const BADGE_BY_SLUG: Record<string, Badge> = {
  "cartao-alto": { id: "cartao-alto", label: "cartão alto", tone: "cards" },
  "over-alto": { id: "over-alto", label: "over alto", tone: "over" },
  "btts-alto": { id: "btts-alto", label: "btts alto", tone: "btts" },
  "primeiro-tempo": {
    id: "primeiro-tempo",
    label: "1T quente",
    tone: "first-half",
  },
};

/**
 * Rehydrates a slug array (as produced by `fixture_badges_view`) into Badge
 * objects, preserving order and dropping unknown slugs defensively.
 */
export function badgesFromSlugs(slugs: unknown): Badge[] {
  if (!Array.isArray(slugs)) return [];
  const out: Badge[] = [];
  for (const s of slugs) {
    const b = typeof s === "string" ? BADGE_BY_SLUG[s] : undefined;
    if (b) out.push(b);
  }
  return out;
}

interface Streak {
  desc?: string;
  stat_type?: string;
  overall_perc?: number;
}

interface RefereeRecord {
  name?: string;
  completed?: number;
  fixtures_count?: number;
  avg_total_booking_points?: number;
  total_yellow_reds?: number;
}

export function computeBadges(detail: unknown): Badge[] {
  if (!isRecord(detail)) return [];

  const out: Badge[] = [];
  const ref = asRecord(detail.referee_record) as RefereeRecord | null;
  const streaks = asRecord(detail.streaks);
  const homeStreaks = (asArray(streaks?.home) as unknown[]) as Streak[];
  const awayStreaks = (asArray(streaks?.away) as unknown[]) as Streak[];

  if (refereeIsHighCards(ref)) {
    out.push({ id: "cartao-alto", label: "cartão alto", tone: "cards" });
  }

  if (bothSidesMatch(homeStreaks, awayStreaks, isOver25Streak)) {
    out.push({ id: "over-alto", label: "over alto", tone: "over" });
  }

  if (bothSidesMatch(homeStreaks, awayStreaks, isBttsStreak)) {
    out.push({ id: "btts-alto", label: "btts alto", tone: "btts" });
  }

  if (bothSidesMatch(homeStreaks, awayStreaks, isFirstHalfStreak)) {
    out.push({
      id: "primeiro-tempo",
      label: "1T quente",
      tone: "first-half",
    });
  }

  return out.slice(0, MAX_BADGES);
}

function refereeIsHighCards(ref: RefereeRecord | null): boolean {
  if (!ref) return false;
  const completed = ref.completed ?? ref.fixtures_count ?? 0;
  if (completed < REFEREE_MIN_COMPLETED) return false;
  if (
    typeof ref.avg_total_booking_points === "number" &&
    ref.avg_total_booking_points > REFEREE_BOOKING_THRESHOLD
  ) {
    return true;
  }
  if (
    typeof ref.total_yellow_reds === "number" &&
    ref.total_yellow_reds >= REFEREE_2YA_THRESHOLD
  ) {
    return true;
  }
  return false;
}

function bothSidesMatch(
  home: Streak[],
  away: Streak[],
  predicate: (s: Streak) => boolean,
): boolean {
  return home.some(predicate) && away.some(predicate);
}

function streakText(s: Streak): string {
  return `${s.stat_type ?? ""} ${s.desc ?? ""}`.toLowerCase();
}

function streakStrong(s: Streak): boolean {
  return typeof s.overall_perc === "number" && s.overall_perc >= STREAK_PERC_MIN;
}

function isOver25Streak(s: Streak): boolean {
  if (!streakStrong(s)) return false;
  const t = streakText(s);
  return t.includes(STREAK_OVER25_SUBSTR);
}

function isBttsStreak(s: Streak): boolean {
  if (!streakStrong(s)) return false;
  const t = streakText(s);
  return STREAK_BTTS_SUBSTRS.some((sub) => t.includes(sub));
}

function isFirstHalfStreak(s: Streak): boolean {
  if (!streakStrong(s)) return false;
  const t = streakText(s);
  return STREAK_FH_SUBSTRS.some((sub) => t.includes(sub));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return isRecord(v) ? v : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
