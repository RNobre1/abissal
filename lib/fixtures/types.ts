import type { Badge } from "./badges";

/**
 * Fixture as exposed by the API to the client. Mirrors the columns of the
 * `fixtures` table after serialization (kickoff_utc normalized to ISO-8601 Z,
 * ko_time trimmed to "HH:MM", has_detail derived from a compact presence probe
 * on detail_json — see repository.ts; the list query never pulls the blob).
 */
export interface FixtureDTO {
  id: number;
  match_date: string; // YYYY-MM-DD (UK day, kept for backwards compat)
  ko_time: string | null; // "HH:MM" in UK local
  home_team: string;
  away_team: string;
  league: string | null;
  country: string | null; // slug ("england", "ukraine", "brazil"...)
  source_url: string | null;
  has_detail: boolean;
  kickoff_utc: string | null; // ISO-8601 with Z suffix
  /**
   * High-signal flag (>=2 outlier badges) computed in Postgres by
   * `fixture_badges_view`. A pure scalar — the list query joins it WITHOUT
   * ever pulling badges/detail_json, so the /fixtures realce works without
   * reopening the B12 payload outage. Absent on rows without a view match.
   */
  high_signal?: boolean;
  /**
   * Wave 4: true sse existe um row em `ai_recommendations` com
   * `verdict='bet'` e `kickoff_utc > now()` apontando para esta fixture
   * (via choistats id parseado do source_url — mesmo id-space que o
   * recommender/reconciler escreve). Renderizado como chip ⚡ inline no
   * FixtureCard.
   */
  ai_has_bet?: boolean;
  /**
   * true sse a IA analisou esta fixture e deu `verdict='skip'` (nenhum mercado
   * com valor) e NÃO há um `verdict='bet'` ativo. Distingue "analisado, sem
   * valor" de "ainda não analisado". Renderizado como chip muted "IA · sem
   * valor" no FixtureCard. Escalar — mesma query escalar do `ai_has_bet`.
   */
  ai_no_value?: boolean;
  /**
   * Maior edge (%) entre os mercados `verdict='bet'` da fixture. Presente só
   * quando `ai_has_bet`. Escalar puxado junto do verdict na mesma query da
   * lista (sem detail_json) — alimenta o chip `⚡IA +X%` e o sort por edge.
   */
  ai_edge_pct?: number;
  /**
   * Full badge objects — only populated by the dashboard query
   * (`fixturesWithBadgesForDashboard`), never by the /fixtures list.
   */
  badges?: Badge[];
}

/**
 * Raw row shape as returned by Supabase REST (`select(...)`) — used inside
 * the repository before serialization to FixtureDTO.
 */
export interface FixtureRow {
  id: number;
  match_date: string;
  ko_time: string | null;
  home_team: string;
  away_team: string;
  league: string | null;
  country: string | null;
  source_url: string | null;
  detail_json: unknown;
  kickoff_utc: string | null;
}
