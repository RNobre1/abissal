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
 *
 * A resolução do slip (Bet Builder redirect + fuzzy match) e o logger de
 * tentativas vivem em módulos compartilhados com a action irmã de TEXTO
 * (`parse-text-action.ts`): `parse-result.ts` e `ocr-attempt-logger.ts`.
 */

import { parseBetSlipImage, OcrParseError } from "./gemini-vision";
import { resolveParsedSlip, type ParsePhotoErrorKind, type ParsePhotoResult } from "./parse-result";
import { buildOcrAttemptLogger } from "./ocr-attempt-logger";
import { createClient } from "@/lib/supabase/server";
import { isAiEnabled } from "@/lib/settings/ai-toggle";

// ── Types (re-export pra compat — a UI e os testes importam daqui) ────────────

export type {
  ParsePhotoErrorKind,
  ParsePhotoResult,
  ParsedLegWithMatch,
} from "./parse-result";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Mensagens acionáveis por categoria (item 4d): "foto ruim — muda a foto"
 * é um conserto diferente de "serviço fora — só tenta de novo".
 */
const OCR_ERROR_MESSAGES: Record<
  Extract<ParsePhotoErrorKind, "gemini-error" | "invalid-json" | "no-legs-found" | "unreadable">,
  string
> = {
  "gemini-error":
    "Erro no serviço de leitura — não é culpa da foto. Tenta de novo em instantes.",
  "invalid-json":
    "O serviço de leitura retornou dados inválidos — tenta de novo; se persistir, adiciona as pernas manualmente.",
  "no-legs-found":
    "Não encontrei seleções no cupom — enquadra só o bilhete, mais de perto, com as seleções visíveis.",
  unreadable:
    "Não consegui ler o cupom — tenta uma foto mais de perto, sem reflexo e com o bilhete inteiro no quadro.",
};

// ── Action ────────────────────────────────────────────────────────────────────

/**
 * Parseia uma foto de cupom de aposta e faz match de cada leg com fixtures do DB.
 *
 * @param formData - FormData com campo "image" (File)
 */
export async function parseBetSlipPhoto(
  formData: FormData,
): Promise<ParsePhotoResult> {
  const ocrLogger = buildOcrAttemptLogger();
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
      return {
        ok: false,
        error_kind: "no-session",
        error: "Sessão expirada. Entre novamente para enviar a foto.",
      };
    }

    // 0b. Kill switch global de IA: o OCR usa Gemini via OpenRouter. Quando
    // desligado (créditos zerados / economia), não tenta — instrui o usuário a
    // adicionar as pernas manualmente, em vez de estourar erro de upstream.
    if (!(await isAiEnabled(supabase as never))) {
      return {
        ok: false,
        error_kind: "ai-disabled",
        error: "IA desativada no sistema. Adicione as pernas do bilhete manualmente.",
      };
    }

    // 1. Extrair e validar arquivo
    const file = formData.get("image");
    if (!(file instanceof File)) {
      return { ok: false, error_kind: "no-image", error: "Nenhuma imagem enviada." };
    }

    if (!file.type.startsWith("image/")) {
      return {
        ok: false,
        error_kind: "invalid-mime",
        error: "Formato inválido. Envie uma imagem (JPEG, PNG, WEBP, etc).",
      };
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return {
        ok: false,
        error_kind: "too-large",
        error: "Imagem muito grande. Tamanho máximo: 8 MB.",
      };
    }

    // 2. Converter File → Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Parsear via Gemini Vision, logando CADA tentativa em
    // `llm_request_logs` (route='ocr' — item 4a): sem isso o custo/erro do
    // OCR era invisível em /llm-observability. Best-effort: admin client
    // indisponível ou insert falhando jamais quebram o OCR.
    const parsed = await parseBetSlipImage(buffer, {
      onAttempt: ocrLogger?.onAttempt,
    });

    // 4. Bet Builder redirect OU fuzzy-match das legs (compartilhado com o
    // fluxo de texto — parse-result.ts).
    return await resolveParsedSlip(parsed);
  } catch (err) {
    if (err instanceof OcrParseError) {
      // Item 4c/4d: categoria estruturada + mensagem acionável por categoria.
      // Instância legada sem `kind` (ou kind desconhecido) cai em "unreadable".
      const kind =
        err.kind && err.kind in OCR_ERROR_MESSAGES
          ? (err.kind as keyof typeof OCR_ERROR_MESSAGES)
          : "unreadable";
      return { ok: false, error_kind: kind, error: OCR_ERROR_MESSAGES[kind] };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error_kind: "unexpected", error: `Erro inesperado: ${msg}` };
  } finally {
    // Aguarda os inserts de log pendentes ANTES do request encerrar —
    // inclusive nos caminhos de erro (as tentativas com erro são justamente
    // as mais importantes de registrar).
    await ocrLogger?.flush();
  }
}
