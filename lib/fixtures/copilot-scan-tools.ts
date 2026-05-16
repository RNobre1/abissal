import { computeBadges } from "./badges";
import {
  deriveTeamRecord,
  deriveRecentMatchStats,
  deriveStreakIndex,
  deriveOddsCategories,
} from "@/lib/fixtures/stats/derive";
import type {
  NormalizedRecentMatch,
  Prediction,
  RawRecentMatch,
} from "@/lib/fixtures/stats/detail-json-types";

export interface FixtureRowLite {
  id: number;
  match_date: string;
  ko_time: string | null;
  home_team: string;
  away_team: string;
  league: string | null;
  country: string | null;
  source_url: string | null;
  kickoff_utc: string | null;
  detail_json: unknown;
}

interface FormSide { w: number; d: number; l: number; pts_recent: number }

export interface FixtureSignals {
  cards: { referee_avg_booking: number | null; home_avg_cards: number | null; away_avg_cards: number | null; badge_cartao_alto: boolean };
  goals_over: { home_over25_pct: number | null; away_over25_pct: number | null; avg_total_goals: number | null; badge_over_alto: boolean };
  btts: { home_btts_pct: number | null; away_btts_pct: number | null; badge_btts_alto: boolean };
  first_half: { home_fh_goal_pct: number | null; away_fh_goal_pct: number | null; badge_primeiro_tempo: boolean };
  form: { home: FormSide | null; away: FormSide | null; home_streak: string | null; away_streak: string | null };
  h2h: { games: number; avg_goals: number };
  odds: { categories: string[]; match_favorite: string | null; adamchoi_pred: string | null };
}

function section(detail: unknown, key: string): unknown {
  if (!detail || typeof detail !== "object") return undefined;
  return (detail as Record<string, unknown>)[key];
}

function recent(detail: unknown, side: "home" | "away", team: string): NormalizedRecentMatch[] {
  const rm = section(detail, "recent_matches") as { home?: unknown; away?: unknown } | undefined;
  try {
    return deriveRecentMatchStats(rm?.[side], null, team);
  } catch {
    return [];
  }
}

function pct(matches: NormalizedRecentMatch[], pred: (m: NormalizedRecentMatch) => boolean): number | null {
  if (matches.length === 0) return null;
  return matches.filter(pred).length / matches.length;
}

function avgCards(matches: NormalizedRecentMatch[]): number | null {
  const vals = matches.map((m) => m.cards_for).filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function totalGoals(m: NormalizedRecentMatch): number | null {
  if (m.goals_ft_for === null || m.goals_ft_against === null) return null;
  return m.goals_ft_for + m.goals_ft_against;
}

function formSide(raw: unknown): FormSide | null {
  const d = deriveTeamRecord({ home: raw });
  if (!d) return null;
  const { won: w, draw: d2, lost: l } = d.split;
  return { w, d: d2, l, pts_recent: 3 * w + d2 };
}

function topStreakDesc(raw: unknown): string | null {
  const idx = deriveStreakIndex(raw);
  return idx.all.length > 0 ? (idx.all[0].desc ?? null) : null;
}

function h2hSignal(detail: unknown): { games: number; avg_goals: number } {
  const h2h = section(detail, "h2h");
  if (!Array.isArray(h2h) || h2h.length === 0) return { games: 0, avg_goals: 0 };
  const rows = h2h as RawRecentMatch[];
  const totals = rows.map((r) => (r.homeGoalsFt ?? 0) + (r.awayGoalsFt ?? 0));
  return { games: rows.length, avg_goals: totals.reduce((a, b) => a + b, 0) / rows.length };
}

function oddsSignal(detail: unknown): { categories: string[]; match_favorite: string | null; adamchoi_pred: string | null } {
  const cats = deriveOddsCategories(section(detail, "odds_summary"));
  const categories = Object.keys(cats);
  let match_favorite: string | null = null;
  const summary = section(detail, "odds_summary");
  if (summary && typeof summary === "object") {
    const matchMarket = (summary as Record<string, unknown>)["Match Result"];
    if (matchMarket && typeof matchMarket === "object") {
      let best: { name: string; odds: number } | null = null;
      for (const [name, o] of Object.entries(matchMarket as Record<string, unknown>)) {
        const odds = (o as { decimal_odds?: number })?.decimal_odds;
        if (typeof odds === "number" && (best === null || odds < best.odds)) best = { name, odds };
      }
      match_favorite = best?.name ?? null;
    }
  }
  const preds = section(detail, "predictions");
  let adamchoi_pred: string | null = null;
  if (Array.isArray(preds) && preds.length > 0) {
    const top = [...(preds as Prediction[])].sort((a, b) => (b.chance ?? 0) - (a.chance ?? 0))[0];
    adamchoi_pred = top ? top.stat_type + (top.chance_team ? `: ${top.chance_team}` : "") : null;
  }
  return { categories, match_favorite, adamchoi_pred };
}

export function computeFixtureSignals(row: FixtureRowLite): FixtureSignals {
  const d = row.detail_json;
  const rh = recent(d, "home", row.home_team);
  const ra = recent(d, "away", row.away_team);
  const badges = computeBadges(d);
  const has = (id: string) => badges.some((b) => b.id === id);
  const ref = section(d, "referee_record") as { avg_total_booking_points?: number } | undefined;
  const tr = section(d, "team_record") as { home?: unknown; away?: unknown } | undefined;
  const st = section(d, "streaks") as { home?: unknown; away?: unknown } | undefined;

  return {
    cards: {
      referee_avg_booking: typeof ref?.avg_total_booking_points === "number" ? ref.avg_total_booking_points : null,
      home_avg_cards: avgCards(rh),
      away_avg_cards: avgCards(ra),
      badge_cartao_alto: has("cartao-alto"),
    },
    goals_over: {
      home_over25_pct: pct(rh, (m) => { const t = totalGoals(m); return t !== null && t > 2.5; }),
      away_over25_pct: pct(ra, (m) => { const t = totalGoals(m); return t !== null && t > 2.5; }),
      avg_total_goals: (() => {
        const ts = rh.map(totalGoals).filter((v): v is number => v !== null);
        return ts.length === 0 ? null : ts.reduce((a, b) => a + b, 0) / ts.length;
      })(),
      badge_over_alto: has("over-alto"),
    },
    btts: {
      home_btts_pct: pct(rh, (m) => (m.goals_ft_for ?? 0) > 0 && (m.goals_ft_against ?? 0) > 0),
      away_btts_pct: pct(ra, (m) => (m.goals_ft_for ?? 0) > 0 && (m.goals_ft_against ?? 0) > 0),
      badge_btts_alto: has("btts-alto"),
    },
    first_half: {
      home_fh_goal_pct: pct(rh, (m) => (m.goals_1h_for ?? 0) + (m.goals_1h_against ?? 0) > 0),
      away_fh_goal_pct: pct(ra, (m) => (m.goals_1h_for ?? 0) + (m.goals_1h_against ?? 0) > 0),
      badge_primeiro_tempo: has("primeiro-tempo"),
    },
    form: {
      home: formSide(tr?.home),
      away: formSide(tr?.away),
      home_streak: topStreakDesc(st?.home),
      away_streak: topStreakDesc(st?.away),
    },
    h2h: h2hSignal(d),
    odds: oddsSignal(d),
  };
}
