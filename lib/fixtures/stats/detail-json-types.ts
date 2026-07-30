/**
 * TypeScript types reflecting the 9 sections of fixtures.detail_json.
 *
 * Authoritative source: docs/pesquisas/detail-json-inventario.md.
 * All optional fields are explicitly marked — we have fixtures in production
 * missing referee_record, odds_summary, predictions, etc.
 */

// ─── 1. team_record ─────────────────────────────────────────────────────

/** One leg of a team's seasonal record (Home / Away / All split). */
export interface TeamSplit {
  type: "Home" | "Away" | "All" | string;
  played: number;
  won: number;
  draw: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
  points_per_game: number;
  /** English ordinal as a string ("9th", "22nd"). Parse via deriveTeamRecord. */
  position: string;
  /** Last 5 results in order oldest → newest (adamchoi convention). */
  form: string[];
}

/** Per-side payload: home has {home, overall}, away has {away, overall}. */
export interface TeamRecordSide {
  home?: TeamSplit;
  away?: TeamSplit;
  overall?: TeamSplit;
}

export interface TeamRecord {
  home: TeamRecordSide;
  away: TeamRecordSide;
}

// ─── 2. recent_matches & h2h ────────────────────────────────────────────

export interface RawRecentMatch {
  id: number;
  date: number;
  date_iso: string;
  status: string;
  league: string;
  home_team: string;
  away_team: string;
  result: "W" | "L" | "D" | null;
  htResult: "W" | "L" | "D" | null;
  homeGoalsFt: number;
  awayGoalsFt: number;
  homeGoalsHt: number;
  awayGoalsHt: number;
  homeYellows: number;
  awayYellows: number;
  homeReds: number;
  awayReds: number;
  homeYellowReds: number;
  awayYellowReds: number;
  homeBookingPoints: number;
  awayBookingPoints: number;
  homeTotalShots: number;
  awayTotalShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homeCorners: number;
  awayCorners: number;
  homeCorners1h: number | null;
  awayCorners1h: number | null;
  homeCorners2h: number | null;
  awayCorners2h: number | null;
  homeFouls: number;
  awayFouls: number;
  homeOffsides: number;
  awayOffsides: number;
  homeTackles: number;
  awayTackles: number;
}

export interface RecentMatches {
  home: RawRecentMatch[];
  away: RawRecentMatch[];
}

// ─── 3. streaks ─────────────────────────────────────────────────────────

export type StreakGroup =
  | "Result"
  | "BTTS"
  | "Goals"
  | "Half"
  | "Cards"
  | "Booking Points"
  | "Corners"
  | "Shots"
  | "Fouls"
  | "Offsides"
  | string;

export interface Streak {
  desc: string;
  group: StreakGroup;
  stat_type: string;
  line: number;
  colour: "positive" | "negative" | "neutral" | string;
  overall_count: number;
  overall_fixtures: number;
  overall_perc: number;
  overall_streak: number;
  home_count: number;
  home_fixtures: number;
  home_perc: number;
  home_streak: number;
  away_count: number;
  away_fixtures: number;
  away_perc: number;
  away_streak: number;
}

export interface Streaks {
  home: Streak[];
  away: Streak[];
}

// ─── 4. referee_record ──────────────────────────────────────────────────

export interface RefereeRecord {
  name: string;
  completed: number;
  fixtures_count: number;
  avg_total_booking_points: number;
  avg_home_booking_points: number;
  avg_away_booking_points: number;
  total_yellow_reds: number;

  // Perfil de cartões/faltas (28/07). Todos OPCIONAIS: registros gravados
  // antes dessa data — e payloads do choistats sem os campos por jogo — não
  // os têm. `null` significa "não sabemos", nunca "zero": um árbitro com
  // avg_total_cards = 0 seria um árbitro que não apita cartão.
  avg_home_cards?: number | null;
  avg_away_cards?: number | null;
  avg_total_cards?: number | null;
  /** % dos jogos em que o lado levou 2+ cartões. */
  pct_home_2plus_cards?: number | null;
  pct_away_2plus_cards?: number | null;
  /** % dos jogos em que AMBOS os lados levaram 2+. */
  pct_both_2plus_cards?: number | null;
  /** Faltas por jogo — driver causal do cartão. */
  avg_home_fouls?: number | null;
  avg_away_fouls?: number | null;
  avg_total_fouls?: number | null;
  /** var/média do total de cartões: >1 over-disperso, <1 sub-disperso. */
  cards_dispersion?: number | null;
  /** P(total de cartões > linha), empírico. Chave = linha ("4.5"). */
  cards_over_pct?: Record<string, number> | null;
}

// ─── 5. odds_summary ────────────────────────────────────────────────────

export interface OddsOutcome {
  bookmaker: string;
  decimal_odds: number;
}

export type OddsMarket = Record<string, OddsOutcome>;
export type OddsSummary = Record<string, OddsMarket>;

// ─── 6. player_stats ────────────────────────────────────────────────────

export interface PlayerAggregates {
  players_count: number;
  minutes: number;
  goals: number;
  goals_1h: number;
  goals_2h: number;
  assists: number;
  yellows: number;
  reds: number;
  cards_1h: number;
  cards_2h: number;
  total_shots: number;
  shots_on_target: number;
  tackles: number;
  fouls_committed: number;
  fouls_drawn: number;
  offsides: number;
}

export interface Player {
  name: string;
  injured: boolean;
  played: number;
  started: number;
  subs: number;
  minutes: number;
  goals: number;
  goals_1h: number;
  goals_2h: number;
  first_goals: number;
  assists: number;
  yellows: number;
  reds: number;
  cards_1h: number;
  cards_2h: number;
  first_cards: number;
  total_shots: number;
  shots_on_target: number;
  tackles: number;
  fouls_committed: number;
  fouls_drawn: number;
  offsides: number;
}

export interface PlayerStatsSide {
  aggregates: PlayerAggregates;
  top_players: Player[];
}

export interface PlayerStats {
  home: PlayerStatsSide;
  away: PlayerStatsSide;
}

// ─── 7. predictions ─────────────────────────────────────────────────────

export interface Prediction {
  stat_type: string;
  chance: number;
  chance_team: string | null;
  best_odds: number | null;
  best_odds_bookmaker: string | null;
  home_stats: string[];
  away_stats: string[];
}

// ─── 8. trends (always empty in current sample) ─────────────────────────

export type Trend = unknown;

// ─── 9. top-level ───────────────────────────────────────────────────────

export interface DetailJson {
  team_record: TeamRecord;
  recent_matches: RecentMatches;
  h2h: RawRecentMatch[];
  streaks: Streaks;
  referee_record: RefereeRecord | null;
  odds_summary: OddsSummary;
  player_stats: PlayerStats;
  predictions: Prediction[];
  trends: Trend[];
}

// ─── Derived shapes (output of derive.ts) ───────────────────────────────

export interface TeamSplitDerived {
  type: string;
  played: number;
  won: number;
  draw: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
  points_per_game: number;
  /** Parsed ordinal as number (e.g. "9th" → 9). `null` when raw absent/malformed. */
  position: number | null;
  /** Reverted form — newest → oldest. */
  form: string[];
}

export interface TeamRecordDerived {
  /** The side-specific split (Home if processing home side, Away if away). */
  split: TeamSplitDerived;
  overall: TeamSplitDerived;
}

export interface NormalizedRecentMatch {
  id: number;
  date_iso: string;
  opponent: string;
  /** true when the perspective team played at home. */
  is_home: boolean;
  result: "W" | "L" | "D" | null;
  goals_1h_for: number | null;
  goals_2h_for: number | null;
  goals_1h_against: number | null;
  goals_2h_against: number | null;
  goals_ft_for: number | null;
  goals_ft_against: number | null;
  corners_1h_for: number | null;
  corners_2h_for: number | null;
  corners_1h_against: number | null;
  corners_2h_against: number | null;
  corners_for: number | null;
  corners_against: number | null;
  cards_1h_for: number | null;
  cards_2h_for: number | null;
  cards_1h_against: number | null;
  cards_2h_against: number | null;
  cards_for: number | null;
  cards_against: number | null;
  sot_for: number | null;
  sot_against: number | null;
  shots_for: number | null;
  shots_against: number | null;
  booking_points_for: number | null;
  booking_points_against: number | null;
  fouls_for: number | null;
  fouls_against: number | null;
  offsides_for: number | null;
  offsides_against: number | null;
}

/**
 * `null` = o choistats não forneceu o dado (o caso mais comum em
 * `corners1h`/`corners2h`), NÃO que o valor observado foi zero. A UI mostra
 * "—" nesses casos em vez de "0.00", que lia como medição.
 */
export interface Splits1h2h {
  goals_1h_avg: number | null;
  goals_2h_avg: number | null;
  corners_1h_avg: number | null;
  corners_2h_avg: number | null;
  cards_1h_avg: number | null;
  cards_2h_avg: number | null;
  sot_for_avg: number | null;
}

export interface StreakIndex {
  all: Streak[];
  by_group: Record<string, Streak[]>;
}

export interface PlayerRanked extends Player {
  /** yellows + reds * 2. Present only when criterion === "cards". */
  card_score?: number;
}

export interface OddsCategoryEntry {
  market: string;
  outcomes: Array<{ name: string } & OddsOutcome>;
}

export type OddsCategory =
  | "match"
  | "halves"
  | "teams"
  | "corners"
  | "cards"
  | "player-props"
  | "other";

export type OddsCategoryMap = Partial<Record<OddsCategory, OddsCategoryEntry[]>>;

export interface BoxStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /**
   * Quantos valores REAIS entraram na distribuição. `0` significa "não há dado",
   * que é diferente de "os valores são zero" — sem isso, uma série inteiramente
   * ausente lê como "este time faz zero escanteios" (a classe de bug do B52).
   */
  count?: number;
}

export type StatKey =
  | "goals_ft_for"
  | "goals_ft_against"
  | "corners_for"
  | "corners_against"
  | "cards_for"
  | "sot_for"
  | "booking_points_for";

export type Distributions = Record<StatKey, BoxStats>;

export interface RadarAxis {
  key:
    | "goals_per_game"
    | "goals_conceded"
    | "sot"
    | "booking_points"
    | "corners"
    | "fouls";
  label: string;
  home: number;
  away: number;
  home_norm: number;
  away_norm: number;
}

export interface RadarData {
  axes: RadarAxis[];
}

export type PlayerRankingCriterion =
  | "goals"
  | "cards"
  | "first_cards"
  | "sot"
  | "assists";
