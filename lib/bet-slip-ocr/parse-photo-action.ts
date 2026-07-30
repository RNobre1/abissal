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
import { createClient } from "@/lib/supabase/server";
import { isAiEnabled } from "@/lib/settings/ai-toggle";

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
  /** Quando is_bet_builder=true do Gemini, vem populado; client redireciona em vez de abrir modal. */
  redirect_to?: string;
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
    const supabase = await createClient();

    // 0a. Sessão obrigatória. Esta action gasta crédito de LLM (Gemini Vision),
    // e Server Actions são invocáveis por POST com o header `next-action` —
    // sem este gate, qualquer um drena o orçamento que o kill switch de IA
    // existe justamente pra proteger. As rotas irmãs (`/api/ai-reco/compute`,
    // `/feedback`) já checavam; esta não. `getUser()` (round-trip completo) e
    // não `getClaims()`: o caminho gasta dinheiro, então vale a validação
    // server-side forte (B22).
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      return { ok: false, error: "Sessão expirada. Entre novamente para enviar a foto." };
    }

    // 0b. Kill switch global de IA: o OCR usa Gemini via OpenRouter. Quando
    // desligado (créditos zerados / economia), não tenta — instrui o usuário a
    // adicionar as pernas manualmente, em vez de estourar erro de upstream.
    if (!(await isAiEnabled(supabase as never))) {
      return {
        ok: false,
        error: "IA desativada no sistema. Adicione as pernas do bilhete manualmente.",
      };
    }

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

    // 4a. Bet Builder: single-game multi-market — redirect ao /bilhete/builder
    if (parsed.is_bet_builder === true) {
      const firstLeg = parsed.legs[0];
      const match = await matchFixture({
        home: firstLeg.home,
        away: firstLeg.away,
        kickoffIso: firstLeg.kickoff_iso ?? null,
        league: firstLeg.league ?? null,
      });

      const params = new URLSearchParams();

      const CONFIDENCE_AUTO_LINK = 0.85;
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

    // 4b. Fuzzy-match cada leg contra fixtures do DB
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
        error: "Não consegui ler o cupom. Tenta com uma foto mais clara.",
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Erro inesperado: ${msg}` };
  }
}
