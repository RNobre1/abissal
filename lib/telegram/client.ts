/**
 * lib/telegram/client.ts
 *
 * Wrapper mínimo da Bot API do Telegram (sendMessage). Reusado pelo resumo de
 * fechamento (send-closure) e pelos alertas de reco (send-reco-alerts).
 *
 * Bot API ≠ MTProto: usamos só `api.telegram.org/bot<token>/METHOD` (ver
 * CLAUDE.md). NUNCA lança — retorna `{ ok, error? }` pra que o caller (script de
 * cron) trate falha como não-fatal (igual ao ethos do send-closure).
 */

export interface SendMessageInput {
  token: string;
  chatId: string;
  text: string;
  /** "Markdown" | "MarkdownV2" | "HTML" — opcional (texto puro por padrão). */
  parseMode?: string;
  /** Desabilita o preview de links (default true — evita cards indesejados). */
  disableWebPagePreview?: boolean;
}

export interface SendMessageResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

export async function sendTelegramMessage({
  token,
  chatId,
  text,
  parseMode,
  disableWebPagePreview = true,
}: SendMessageInput): Promise<SendMessageResult> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: disableWebPagePreview,
  };
  if (parseMode) payload.parse_mode = parseMode;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    type TgResponse = { ok?: boolean; description?: string; result?: { message_id?: number } };
    let body: TgResponse | null = null;
    try {
      body = (await res.json()) as TgResponse;
    } catch {
      body = null;
    }

    if (!res.ok || !body?.ok) {
      const desc = body?.description ?? res.statusText;
      return { ok: false, error: `Telegram HTTP ${res.status}: ${desc}` };
    }
    return { ok: true, messageId: body.result?.message_id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
