/**
 * lib/bet-slip/compute.ts
 *
 * Pure computation helpers for the bet slip feature (Wave M).
 * No side-effects, no I/O — 100% unit-testable.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SlipLeg {
  id: number;
  slip_id: number;
  fixture_id: number | null;
  home_team: string | null;
  away_team: string | null;
  market: string;
  side: string;
  odd_taken: number;
  league: string | null;
  kickoff_utc: string | null;
  created_at: string;
  ai_recommendation_id: number | null;
  sport_id: string | null;
  market_id: string | null;
}

export interface BetSlip {
  id: number;
  user_id: string;
  status: "draft" | "committed" | "cancelled";
  stake_total: number | null;
  odd_combined: number | null;
  potential_return: number | null;
  bet_id: string | null;
  thesis: string | null;
  created_at: string;
  updated_at: string;
  bet_slip_legs: SlipLeg[];
}

export type ConflictType = "duplicate" | "conflicting_sides" | "past_kickoff";

export interface Conflict {
  type: ConflictType;
  legIds: number[];
  message: string;
}

// ── computeOddCombined ───────────────────────────────────────────────────────

/**
 * Returns the combined (product) odd of all legs.
 * Returns 1 for empty arrays (neutral element of multiplication).
 */
export function computeOddCombined(legs: SlipLeg[]): number {
  if (legs.length === 0) return 1;
  const product = legs.reduce((acc, leg) => acc * leg.odd_taken, 1);
  return Math.round(product * 10000) / 10000;
}

// ── computePotentialReturn ───────────────────────────────────────────────────

/**
 * Returns stake * oddCombined rounded to 2 decimal places.
 * Returns 0 when either argument is 0.
 */
export function computePotentialReturn(
  stake: number,
  oddCombined: number,
): number {
  if (stake <= 0 || oddCombined <= 0) return 0;
  return Math.round(stake * oddCombined * 100) / 100;
}

// ── detectConflicts ──────────────────────────────────────────────────────────

/**
 * Detects logical conflicts in a slip's legs:
 *  - duplicate: same fixture_id + market + side
 *  - conflicting_sides: same fixture_id + market with different sides (e.g. home + draw in 1x2)
 *  - past_kickoff: kickoff_utc is in the past
 */
export function detectConflicts(legs: SlipLeg[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const now = Date.now();

  // Group by fixture_id + market
  const groups = new Map<string, SlipLeg[]>();

  for (const leg of legs) {
    const key = `${leg.fixture_id ?? "null"}::${leg.market}`;
    const group = groups.get(key);
    if (group) {
      group.push(leg);
    } else {
      groups.set(key, [leg]);
    }

    // Past kickoff check
    if (leg.kickoff_utc) {
      const kickoffMs = new Date(leg.kickoff_utc).getTime();
      if (kickoffMs < now) {
        conflicts.push({
          type: "past_kickoff",
          legIds: [leg.id],
          message: `Kickoff já passou: ${leg.home_team ?? "?"} × ${leg.away_team ?? "?"}`,
        });
      }
    }
  }

  // Check groups for duplicates and conflicting sides
  for (const group of groups.values()) {
    if (group.length < 2) continue;

    // Check for exact duplicates (same side)
    const sideMap = new Map<string, SlipLeg[]>();
    for (const leg of group) {
      const existing = sideMap.get(leg.side);
      if (existing) {
        existing.push(leg);
      } else {
        sideMap.set(leg.side, [leg]);
      }
    }

    for (const sameLegs of sideMap.values()) {
      if (sameLegs.length > 1) {
        conflicts.push({
          type: "duplicate",
          legIds: sameLegs.map((l) => l.id),
          message: `Seleção duplicada: ${sameLegs[0]?.market} / ${sameLegs[0]?.side}`,
        });
      }
    }

    // Check for conflicting sides within same fixture+market
    // Multiple different sides in same fixture+market = conflict (e.g. home + draw in 1x2)
    const distinctSides = new Set(group.map((l) => l.side));
    if (distinctSides.size > 1) {
      conflicts.push({
        type: "conflicting_sides",
        legIds: group.map((l) => l.id),
        message: `Mercados conflitantes no mesmo jogo: ${group[0]?.home_team} × ${group[0]?.away_team} (${group[0]?.market})`,
      });
    }
  }

  return conflicts;
}
