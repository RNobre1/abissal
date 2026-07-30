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

import {
  parseBetSlipImage,
  OcrParseError,
  type GeminiAttemptLog,
} from "./gemini-vision";
import { matchFixture, type MatchResult } from "./match-fixture";
import type { ParsedLeg } from "./schema";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAiEnabled } from "@/lib/settings/ai-toggle";
import { recordLlmRequest } from "@/lib/llm-logs";
import { computeCostUsd } from "@/lib/ai-reco/pricing";

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

// ── OCR observability (item 4a) ───────────────────────────────────────────────

/**
 * Constrói o logger de tentativas do Gemini. O insert em `llm_request_logs`
 * exige service_role (não há policy de INSERT pra authenticated); se o admin
 * client não puder ser criado (env ausente em dev/test), retorna undefined e
 * o OCR segue sem logging.
 */
function buildOcrAttemptLogger(): ((a: GeminiAttemptLog) => void) | undefined {
  let sink: Parameters<typeof recordLlmRequest>[0] | null = null;
  try {
    sink = createAdminClient() as unknown as Parameters<typeof recordLlmRequest>[0];
  } catch {
    return undefined;
  }
  const admin = sink;
  return (a: GeminiAttemptLog) => {
    const hasTokens = a.promptTokens !== null || a.completionTokens !== null;
    void recordLlmRequest(admin, {
      route: "ocr",
      fixture_id: null,
      model: a.model,
      latency_ms: a.latencyMs,
      prompt_tokens: a.promptTokens,
      completion_tokens: a.completionTokens,
      total_tokens: a.totalTokens,
      cost_usd: hasTokens
        ? computeCostUsd(a.model, a.promptTokens ?? 0, a.completionTokens ?? 0)
        : null,
      error: a.error,
    });
  };
}

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

    // 3. Parsear via Gemini Vision, logando CADA tentativa em
    // `llm_request_logs` (route='ocr' — item 4a): sem isso o custo/erro do
    // OCR era invisível em /llm-observability. Best-effort: admin client
    // indisponível ou insert falhando jamais quebram o OCR.
    const parsed = await parseBetSlipImage(buffer, {
      onAttempt: buildOcrAttemptLogger(),
    });

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
