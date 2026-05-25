/**
 * Pure helpers for /bets URL-param → query filter mapping.
 * Extracted for testability (no Supabase imports here).
 */
import type { Database } from "@/lib/supabase/types";

type BetStatus = Database["public"]["Enums"]["bet_status"];

export const STATUS_FILTERS: Array<{
  key: string;
  label: string;
  values: BetStatus[];
}> = [
  { key: "all", label: "todas", values: [] },
  { key: "pending", label: "pendentes", values: ["pending"] },
  { key: "won", label: "ganhas", values: ["won", "half_won"] },
  { key: "lost", label: "perdidas", values: ["lost", "half_lost"] },
  {
    key: "other",
    label: "outras",
    values: ["void", "cashed_out", "partially_void"],
  },
];

export type BetsFilter = {
  statusValues: BetStatus[];
  statusKey: string;
  houseSlug?: string;
  league?: string;
  marketId?: string;
};

export function buildBetsFilter(
  sp: Record<string, string | undefined>,
): BetsFilter {
  const statusKey = sp.status ?? "all";
  const filter =
    STATUS_FILTERS.find((f) => f.key === statusKey) ?? STATUS_FILTERS[0]!;

  return {
    statusValues: filter.values,
    statusKey: filter.key,
    houseSlug: sp.house || undefined,
    league: sp.league || undefined,
    marketId: sp.market || undefined,
  };
}
