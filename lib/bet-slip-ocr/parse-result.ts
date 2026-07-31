/**
 * lib/bet-slip-ocr/parse-result.ts
 *
 * Tipos de resultado + resolução compartilhada de um `ParsedSlip` (vindo de
 * FOTO via `parse-photo-action` OU de TEXTO LIVRE via `parse-text-action`)
 * para o `ParsePhotoResult` que a UI de revisão consome:
 *  - Bet Builder (single-game multi-market) → `redirect_to` /bilhete/builder;
 *  - caso normal → fuzzy-match de cada leg contra fixtures (`matchFixture`).
 *
 * Server-only (matchFixture puxa o client Supabase de servidor). A UI importa
 * apenas os TIPOS daqui (via re-export das actions), nunca o runtime.
 */

import { matchFixture, type MatchResult } from "./match-fixture";
import type { ParsedLeg, ParsedSlip } from "./schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedLegWithMatch {
  parsed: ParsedLeg;
  match: MatchResult;
}

/**
 * Taxonomia estruturada de falha (item 4c) — vai no telemetry payload
 * (`bilhete_foto_failed.error_kind` / `bilhete_texto_failed.error_kind`) pra
 * tornar o funil diagnosticável. As 4 de conteúdo vêm do OcrErrorKind; o
 * resto cobre os gates das actions (foto: no-image/invalid-mime/too-large;
 * texto: no-text/text-too-short/text-too-long).
 */
export type ParsePhotoErrorKind =
  | "no-session"
  | "ai-disabled"
  | "no-image"
  | "invalid-mime"
  | "too-large"
  | "no-text"
  | "text-too-short"
  | "text-too-long"
  | "gemini-error"
  | "invalid-json"
  | "no-legs-found"
  | "unreadable"
  | "unexpected";

export interface ParsePhotoResult {
  ok: boolean;
  error?: string;
  /** Categoria estruturada quando ok=false (item 4c). */
  error_kind?: ParsePhotoErrorKind;
  slip?: {
    legs: ParsedLegWithMatch[];
    stake_total: number | null;
    odd_combined: number | null;
    house_detected: string | null;
  };
  /** Quando is_bet_builder=true do Gemini, vem populado; client redireciona em vez de abrir modal. */
  redirect_to?: string;
}

// ── Resolution ────────────────────────────────────────────────────────────────

const CONFIDENCE_AUTO_LINK = 0.85;

/**
 * Resolve um `ParsedSlip` validado no `ParsePhotoResult` final (redirect de
 * Bet Builder OU legs com fuzzy-match), idêntico pros fluxos de foto e texto.
 */
export async function resolveParsedSlip(
  parsed: ParsedSlip,
): Promise<ParsePhotoResult> {
  // Bet Builder: single-game multi-market — redirect ao /bilhete/builder.
  // Guarda defensiva: se o modelo marcou is_bet_builder mas as legs cobrem
  // MAIS de um jogo, é uma múltipla mista mal-rotulada — o /bilhete/builder
  // é single-game e o redirect descartaria os outros jogos. Trata como
  // múltipla normal (fluxo de revisão).
  const distinctGames = new Set(
    parsed.legs.map((l) => `${l.home.toLowerCase()}|${l.away.toLowerCase()}`),
  ).size;
  if (parsed.is_bet_builder === true && distinctGames <= 1) {
    const firstLeg = parsed.legs[0];
    const match = await matchFixture({
      home: firstLeg.home,
      away: firstLeg.away,
      kickoffIso: firstLeg.kickoff_iso ?? null,
      league: firstLeg.league ?? null,
    });

    const params = new URLSearchParams();

    if (match.best !== null && match.best.confidence >= CONFIDENCE_AUTO_LINK) {
      params.set("fixture_id", String(match.best.fixture_id));
    } else {
      params.set("home", firstLeg.home);
      params.set("away", firstLeg.away);
    }

    if (parsed.odd_combined !== null) {
      params.set("odd", String(parsed.odd_combined));
    }
    if (parsed.stake_total !== null) {
      params.set("stake", String(parsed.stake_total));
    }
    if (parsed.house_detected !== null) {
      params.set("house", parsed.house_detected);
    }

    const legs = parsed.legs.map((leg) => ({
      market: leg.market,
      side: leg.side,
    }));
    params.set("legs", encodeURIComponent(JSON.stringify(legs)));

    return {
      ok: true,
      redirect_to: `/bilhete/builder?${params.toString()}`,
    };
  }

  // Caso normal: fuzzy-match cada leg contra fixtures do DB
  const legsWithMatch: ParsedLegWithMatch[] = await Promise.all(
    parsed.legs.map(async (leg) => {
      const match = await matchFixture({
        home: leg.home,
        away: leg.away,
        kickoffIso: leg.kickoff_iso,
        league: leg.league,
      });
      return { parsed: leg, match };
    }),
  );

  return {
    ok: true,
    slip: {
      legs: legsWithMatch,
      stake_total: parsed.stake_total,
      odd_combined: parsed.odd_combined,
      house_detected: parsed.house_detected,
    },
  };
}
