/**
 * match-fixture-types.ts — tipos e constantes do fuzzy match (Wave N2/N5).
 *
 * Isolado de match-fixture.ts pra evitar que Client Components arrastem
 * dependências server-side (next/headers via lib/supabase/server) pro
 * bundle do browser.
 */

export interface MatchInput {
  home: string;
  away: string;
  kickoffIso?: string | null;
  league?: string | null;
}

export interface MatchedFixture {
  fixture_id: number;
  home_team: string;
  away_team: string;
  league: string | null;
  country: string | null;
  kickoff_utc: string;
  confidence: number;
}

export interface MatchResult {
  best: MatchedFixture | null;
  candidates: MatchedFixture[];
}

export const CONFIDENCE_AUTO_LINK = 0.85;
export const CONFIDENCE_MIN = 0.4;

/** Kickoff a mais de 30 dias do presente não é informação, é alucinação. */
const KICKOFF_PLAUSIBLE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Sanitiza o kickoff vindo do OCR: o LLM converte datas relativas ("Hoje,
 * 16:00") e pode alucinar o "hoje" (caso real 31/07: cupom do dia saiu com
 * kickoff de 2024 — a janela de match buscava fixtures de 2 anos atrás e o
 * gate de compatibilidade capava tudo). Implausível ⇒ trata como ausente.
 */
export function plausibleKickoffIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.abs(t - Date.now()) <= KICKOFF_PLAUSIBLE_MS ? iso : null;
}
