/**
 * Pure helpers for secondary-market isotonic fit (corners / cards / SOT).
 *
 * These are the pure functions extracted from fit-isotonic.ts to keep the
 * script testable. No I/O, no DB access.
 *
 * Terminology:
 *   stat  — "corners" | "cards" | "sot"
 *   side  — "over" | "under"
 *   label — numeric string encoding line×10 (8.5 → "85", 9.5 → "95", etc.)
 *   line  — actual numeric threshold (e.g. 8.5, 9.5, 10.5)
 *
 * Metric key format (must match edge-calculator exactly):
 *   `${stat}-${side}-${label}`
 *   e.g. "corners-over-85", "sot-under-95", "cards-over-45"
 */

import { poissonProbOver, poissonProbUnder } from "@/lib/ai-reco/dist-helpers";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SecondaryStat = "corners" | "cards" | "sot";
export type SecondarySide = "over" | "under";

/** Label string: line × 10 as integer, e.g. 8.5 → "85". */
export type SecondaryLabel = string;

export interface SecondaryMarket {
  stat: SecondaryStat;
  line: number;
  label: SecondaryLabel;
}

/** Columns from fixture_simulations used for secondary actuals. */
export interface SecondaryActuals {
  actual_corners_home: number | null;
  actual_corners_away: number | null;
  actual_cards_home: number | null;
  actual_cards_away: number | null;
  actual_sot_home: number | null;
  actual_sot_away: number | null;
}

// ── Market catalogue ──────────────────────────────────────────────────────────

/**
 * All secondary markets to fit. Both over + under share the same entry
 * (sides are iterated per market in the fit loop).
 */
export const SECONDARY_MARKETS: SecondaryMarket[] = [
  // corners
  { stat: "corners", line: 8.5, label: "85" },
  { stat: "corners", line: 9.5, label: "95" },
  { stat: "corners", line: 10.5, label: "105" },
  // cards
  { stat: "cards", line: 3.5, label: "35" },
  { stat: "cards", line: 4.5, label: "45" },
  { stat: "cards", line: 5.5, label: "55" },
  // shots on target
  { stat: "sot", line: 7.5, label: "75" },
  { stat: "sot", line: 9.5, label: "95" },
  { stat: "sot", line: 10.5, label: "105" },
];

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Build the metric key that the edge-calculator uses for isotonic lookup.
 * Format: `${stat}-${side}-${label}` — e.g. "corners-over-85".
 */
export function secondaryMetricKey(
  stat: SecondaryStat,
  side: SecondarySide,
  label: SecondaryLabel,
): string {
  return `${stat}-${side}-${label}`;
}

/**
 * Poisson-based predicted probability for a secondary market.
 *
 * @param mean  Expected total (home p50 + away p50 from sim_stats).
 * @param line  Numeric threshold (e.g. 8.5).
 * @param side  "over" → P(X > line); "under" → P(X <= line).
 * @returns Probability in [0,1]; 0 for non-finite mean.
 */
export function secondaryPred(
  mean: number,
  line: number,
  side: SecondarySide,
): number {
  if (!Number.isFinite(mean)) return 0;
  return side === "over"
    ? poissonProbOver(mean, line)
    : poissonProbUnder(mean, line);
}

/**
 * Binary observed outcome for a secondary market given actual totals.
 *
 * Returns null (skip this row) if either actual column is null.
 * Returns 1 if the outcome matches the side, 0 otherwise.
 */
export function secondaryObserved(
  stat: SecondaryStat,
  line: number,
  side: SecondarySide,
  actuals: SecondaryActuals,
): 0 | 1 | null {
  const h = actuals[`actual_${stat}_home` as keyof SecondaryActuals];
  const a = actuals[`actual_${stat}_away` as keyof SecondaryActuals];

  if (h == null || a == null) return null;

  const total = (h as number) + (a as number);
  if (side === "over") return total > line ? 1 : 0;
  return total <= line ? 1 : 0;
}

/**
 * Extract p50 mean for a stat from sim_stats jsonb shape.
 *
 * sim_stats shape (from sim engine Ruby):
 *   { home: { corners: { p50: N, ... }, cards: ..., sot: ... },
 *     away: { corners: { p50: N }, ... } }
 *
 * Returns null if any path is missing.
 */
export function secondaryMeanFromSimStats(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  simStats: any,
  stat: SecondaryStat,
): number | null {
  const homeP50 = simStats?.home?.[stat]?.p50;
  const awayP50 = simStats?.away?.[stat]?.p50;
  if (
    typeof homeP50 !== "number" ||
    !Number.isFinite(homeP50) ||
    typeof awayP50 !== "number" ||
    !Number.isFinite(awayP50)
  ) {
    return null;
  }
  return homeP50 + awayP50;
}
