"use server";

/**
 * lib/bet-slip-ocr/parse-text-action.ts
 *
 * F6 — Server Action irmã da `parseBetSlipPhoto`: recebe a DESCRIÇÃO LIVRE
 * do bilhete (fallback quando o parse da foto falha, ou entrada direta via
 * "prefiro digitar"), estrutura via LLM (`parseBetSlipFromText` — mesmos
 * modelos do OCR) e devolve o MESMO `ParsePhotoResult`, pra UI de revisão
 * ser reusada sem mudança.
 *
 * Gates idênticos aos da foto: sessão obrigatória + kill switch de IA.
 * Validação própria: texto 10-2000 chars. Logging de tentativas em
 * `llm_request_logs` route='ocr' com flush AGUARDADO (fire-and-forget morre
 * no Worker CF).
 */

import { OcrParseError } from "./gemini-vision";
import { parseBetSlipFromText } from "./parse-text";
import { resolveParsedSlip, type ParsePhotoErrorKind, type ParsePhotoResult } from "./parse-result";
import { buildOcrAttemptLogger } from "./ocr-attempt-logger";
import { createClient } from "@/lib/supabase/server";
import { isAiEnabled } from "@/lib/settings/ai-toggle";

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_TEXT_CHARS = 10;
const MAX_TEXT_CHARS = 2000;

/**
 * Mensagens acionáveis por categoria — versão TEXTO (item 4d): o conserto de
 * "descrição vaga" é escrever mais detalhe, não trocar de foto.
 */
const TEXT_ERROR_MESSAGES: Record<
  Extract<ParsePhotoErrorKind, "gemini-error" | "invalid-json" | "no-legs-found" | "unreadable">,
  string
> = {
  "gemini-error":
    "Erro no serviço de leitura — não é culpa da descrição. Tenta de novo em instantes.",
  "invalid-json":
    "O serviço retornou dados inválidos — tenta de novo; se persistir, adiciona as pernas manualmente.",
  "no-legs-found":
    "Não identifiquei nenhuma seleção na descrição — inclui os times, o mercado e a odd (ex.: 'Flamengo x Palmeiras, casa vence, odd 2.10, R$ 50').",
  unreadable:
    "Não consegui estruturar o bilhete a partir da descrição — detalha os times, o mercado, a odd e o valor, e tenta de novo.",
};

// ── Action ────────────────────────────────────────────────────────────────────

/**
 * Estrutura a descrição textual de um bilhete e faz match das legs com
 * fixtures do DB. Aceita FormData (campo "text") ou objeto `{ text }`.
 */
export async function parseBetSlipText(
  input: FormData | { text: string },
): Promise<ParsePhotoResult> {
  const ocrLogger = buildOcrAttemptLogger();
  try {
    const supabase = await createClient();

    // 0a. Sessão obrigatória — mesma justificativa da irmã de foto: a action
    // gasta crédito de LLM e Server Actions são invocáveis por POST direto.
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      return {
        ok: false,
        error_kind: "no-session",
        error: "Sessão expirada. Entre novamente para enviar o bilhete.",
      };
    }

    // 0b. Kill switch global de IA.
    if (!(await isAiEnabled(supabase as never))) {
      return {
        ok: false,
        error_kind: "ai-disabled",
        error: "IA desativada no sistema. Adicione as pernas do bilhete manualmente.",
      };
    }

    // 1. Extrair e validar o texto (10-2000 chars).
    const raw =
      input instanceof FormData ? input.get("text") : input.text;
    const text = typeof raw === "string" ? raw.trim() : "";

    if (text.length === 0) {
      return {
        ok: false,
        error_kind: "no-text",
        error: "Nenhuma descrição enviada. Descreve o bilhete: times, mercado, odd e valor.",
      };
    }
    if (text.length < MIN_TEXT_CHARS) {
      return {
        ok: false,
        error_kind: "text-too-short",
        error: "Descrição curta demais — inclui pelo menos os times, o mercado e a odd.",
      };
    }
    if (text.length > MAX_TEXT_CHARS) {
      return {
        ok: false,
        error_kind: "text-too-long",
        error: `Descrição longa demais (máximo ${MAX_TEXT_CHARS} caracteres) — resume o bilhete.`,
      };
    }

    // 2. Estruturar via LLM, logando cada tentativa em llm_request_logs
    // (route='ocr' — a union já cobre; best-effort, nunca quebra o parse).
    const parsed = await parseBetSlipFromText(text, {
      onAttempt: ocrLogger?.onAttempt,
    });

    // 3. Bet Builder redirect OU fuzzy-match das legs (compartilhado com o
    // fluxo de foto — parse-result.ts).
    return await resolveParsedSlip(parsed);
  } catch (err) {
    if (err instanceof OcrParseError) {
      const kind =
        err.kind && err.kind in TEXT_ERROR_MESSAGES
          ? (err.kind as keyof typeof TEXT_ERROR_MESSAGES)
          : "unreadable";
      return { ok: false, error_kind: kind, error: TEXT_ERROR_MESSAGES[kind] };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error_kind: "unexpected", error: `Erro inesperado: ${msg}` };
  } finally {
    // Aguarda os inserts de log pendentes ANTES do request encerrar —
    // inclusive nos caminhos de erro.
    await ocrLogger?.flush();
  }
}
