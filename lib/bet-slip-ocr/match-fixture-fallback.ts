/**
 * match-fixture-fallback.ts — fallback TS-side do fuzzy-match de OCR
 * (Follow-up 1, 31/07).
 *
 * Quando a RPC `match_fixture_fuzzy` (pg_trgm no Postgres, SEM unaccent) não
 * atinge auto-link, este fallback busca as fixtures da janela de datas via
 * PostgREST — só colunas escalares, volume ~100-400 linhas — e casa em TS com
 * normalização agressiva dos dois lados (ø→o, strip de diacríticos, colapso
 * de pontuação) + igualdade/token-set/trigram.
 *
 * Confiança (conservadora — auto-link é ≥ 0.85):
 *  - média dos dois lados (home, away);
 *  - ≥ 0.85 SÓ quando os DOIS lados são inequívocos (igualdade normalizada ou
 *    token-set contido) E o kickoff é compatível (±24h) quando disponível;
 *  - senão, cap em 0.84 (fica como candidato pra revisão manual, nunca auto-link).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONFIDENCE_MIN,
  plausibleKickoffIso,
  type MatchInput,
  type MatchResult,
  type MatchedFixture,
} from "./match-fixture-types";
import { teamNameSimilarity } from "./team-name-similarity";

// ── Constantes ────────────────────────────────────────────────────────────────

/** Janela quando o cupom traz kickoff: kickoff ±2 dias. */
const WINDOW_WITH_KICKOFF_DAYS = 2;
/** Janela quando o cupom NÃO traz kickoff: hoje ±3 dias. */
const WINDOW_WITHOUT_KICKOFF_DAYS = 3;
/** Cap de confiança pra casamentos não-inequívocos (abaixo do auto-link 0.85). */
const NON_UNEQUIVOCAL_CAP = 0.84;
/** Tolerância de kickoff pra conceder auto-link quando o cupom traz horário. */
const KICKOFF_COMPAT_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 3;

// ── Row shape (PostgREST, só escalares) ───────────────────────────────────────

interface FixtureRow {
  id: number;
  home_team: string;
  away_team: string;
  league: string | null;
  country: string | null;
  kickoff_utc: string;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function fixtureConfidence(input: MatchInput, row: FixtureRow): number {
  const home = teamNameSimilarity(input.home, row.home_team);
  const away = teamNameSimilarity(input.away, row.away_team);
  let confidence = (home.score + away.score) / 2;

  const kickoffCompatible =
    !input.kickoffIso ||
    Math.abs(Date.parse(row.kickoff_utc) - Date.parse(input.kickoffIso)) <=
      KICKOFF_COMPAT_MS;

  if (!(home.strong && away.strong) || !kickoffCompatible) {
    confidence = Math.min(confidence, NON_UNEQUIVOCAL_CAP);
  }
  return confidence;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Fallback TS: busca fixtures da janela relevante e casa em TS.
 * Devolve o MESMO shape do matchFixture ({ best, candidates }).
 */
export async function matchFixtureFallback(
  rawInput: MatchInput,
  client: SupabaseClient,
): Promise<MatchResult> {
  // Defesa em profundidade: mesmo sanitizado no matchFixture, quem chamar
  // direto não pode ser mordido por kickoff alucinado do OCR (caso 2024).
  const input: MatchInput = {
    ...rawInput,
    kickoffIso: plausibleKickoffIso(rawInput.kickoffIso),
  };
  const center = input.kickoffIso ? new Date(input.kickoffIso) : new Date();
  const windowDays = input.kickoffIso
    ? WINDOW_WITH_KICKOFF_DAYS
    : WINDOW_WITHOUT_KICKOFF_DAYS;
  const start = new Date(center.getTime() - windowDays * DAY_MS).toISOString();
  const end = new Date(center.getTime() + windowDays * DAY_MS).toISOString();

  const { data, error } = await client
    .from("fixtures")
    .select("id, home_team, away_team, league, country, kickoff_utc")
    .gte("kickoff_utc", start)
    .lte("kickoff_utc", end);

  if (error) {
    throw new Error(`match_fixture_fallback: ${error.message}`);
  }

  const rows = (data as FixtureRow[] | null) ?? [];

  const candidates: MatchedFixture[] = rows
    .map((row) => ({
      fixture_id: Number(row.id),
      home_team: row.home_team,
      away_team: row.away_team,
      league: row.league,
      country: row.country,
      kickoff_utc: row.kickoff_utc,
      confidence: fixtureConfidence(input, row),
    }))
    .filter((f) => f.confidence >= CONFIDENCE_MIN)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_CANDIDATES);

  return { best: candidates[0] ?? null, candidates };
}
