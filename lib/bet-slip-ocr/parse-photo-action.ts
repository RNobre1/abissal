"use server";

/**
 * lib/bet-slip-ocr/parse-photo-action.ts
 *
 * Server Action: recebe FormData com um campo "image" (File),
 * parseia via Gemini Vision e faz fuzzy-match de cada leg contra fixtures do DB.
 *
 * Validações:
 *  - MIME deve começar com "image/"
 *  - Tamanho máximo: 8 MB
 *
 * Erros são normalizados em ParsePhotoResult.ok=false para exibição amigável.
 */

import { parseBetSlipImage, OcrParseError } from "./gemini-vision";
import { matchFixture, type MatchResult } from "./match-fixture";
import type { ParsedLeg } from "./schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedLegWithMatch {
  parsed: ParsedLeg;
  match: MatchResult;
}

export interface ParsePhotoResult {
  ok: boolean;
  error?: string;
  slip?: {
    legs: ParsedLegWithMatch[];
    stake_total: number | null;
    odd_combined: number | null;
    house_detected: string | null;
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

// ── Action ────────────────────────────────────────────────────────────────────

/**
 * Parseia uma foto de cupom de aposta e faz match de cada leg com fixtures do DB.
 *
 * @param formData - FormData com campo "image" (File)
 */
export async function parseBetSlipPhoto(
  formData: FormData,
): Promise<ParsePhotoResult> {
  try {
    // 1. Extrair e validar arquivo
    const file = formData.get("image");
    if (!(file instanceof File)) {
      return { ok: false, error: "Nenhuma imagem enviada." };
    }

    if (!file.type.startsWith("image/")) {
      return { ok: false, error: "Formato inválido. Envie uma imagem (JPEG, PNG, WEBP, etc)." };
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return { ok: false, error: "Imagem muito grande. Tamanho máximo: 8 MB." };
    }

    // 2. Converter File → Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Parsear via Gemini Vision
    const parsed = await parseBetSlipImage(buffer);

    // 4. Fuzzy-match cada leg contra fixtures do DB
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
  } catch (err) {
    if (err instanceof OcrParseError) {
      return {
        ok: false,
        error:
          "Não consegui ler o cupom. Tenta com uma foto mais clara, OU registra manual em /bets/nova se for 'Criar Aposta' (Bet Builder) — esse tipo ainda não é suportado.",
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Erro inesperado: ${msg}` };
  }
}
