/**
 * lib/bet-slip-ocr/parse-text.ts
 *
 * F6 — modo TEXTO LIVRE do parser de bilhete: o usuário descreve o bilhete
 * em linguagem natural ("Flamengo x Palmeiras, casa vence, odd 2.10, R$ 50")
 * e o LLM estrutura no MESMO `ParsedSlip` do modo foto.
 *
 * Decisão de modelo: os MESMOS modelos do OCR de foto (gemini-2.5-flash com
 * retry no flash-lite), via `runSlipParsePipeline` do gemini-vision — e não
 * `OPENROUTER_MODEL` (deepseek). É o caminho mais simples: zero env novo,
 * mesma tabela de pricing (custo em llm_request_logs continua calculável),
 * mesmo retry tolerante e mesma taxonomia OcrParseError já testados.
 */

import {
  runSlipParsePipeline,
  SLIP_JSON_SCHEMA_BLOCK,
  TOLERANT_MODE_ADDENDUM,
  type ParseBetSlipOptions,
} from "./gemini-vision";
import type { ParsedSlip } from "./schema";

/**
 * Variante de sistema pra ENTRADA TEXTUAL: descrição livre digitada pelo
 * usuário, não imagem. Mesmo schema de saída do modo foto.
 */
// Função (não const) porque injeta a data ATUAL: sem ela o LLM não sabe que
// dia é hoje e converte "amanhã 16h" pra uma data chutada — que contamina o
// sinal de kickoff do fuzzy-match.
function buildTextSystemPrompt(nowIso: string): string {
  return `Você é um extrator de dados estruturados de bilhetes de apostas esportivas. Receba uma descrição LIVRE, em linguagem natural, digitada pelo usuário sobre o bilhete que ele fez (times, mercado, odd, valor, casa de apostas — em qualquer ordem e formato) e devolva APENAS JSON válido (sem markdown, sem texto antes/depois) seguindo este schema:

${SLIP_JSON_SCHEMA_BLOCK}

Regras:
- Para bilhete único (não-múltipla), legs tem 1 elemento e odd_combined = legs[0].odd_taken
- Qualquer campo que o usuário NÃO mencionou: use null (NUNCA invente valores).
- Se a descrição não for de uma aposta esportiva, retorne {"legs": [], "stake_total": null, "odd_combined": null, "house_detected": null, "is_bet_builder": false}.
- Nomes de times: normalize abreviações óbvias ("Fla" → "Flamengo", "Meng o" → "Flamengo"), mas NUNCA invente um time que o usuário não citou.
- Valores em reais ("50 reais", "R$ 50", "cinquenta"): converta pra number em stake_total.
- Datas relativas ("hoje 22h", "amanhã 16:00"): converta pra ISO sabendo que AGORA é ${nowIso} (UTC). O usuário está no Brasil (BRT = UTC-3).

Bet Builder / Criar Aposta:
- Se o usuário descrever vários mercados DO MESMO jogo com uma única odd combinada (ex.: "criar aposta", "bet builder"), marque is_bet_builder: true na raiz, deixe odd_taken: null em cada leg e ponha a odd combinada em odd_combined.`;
}

/**
 * Estrutura a descrição textual de um bilhete no ParsedSlip validado.
 *
 * @param text - descrição livre digitada pelo usuário
 * @param opts - Optional model override, AbortSignal and onAttempt logger
 * @throws OcrParseError se ambas as tentativas falharem (mesma taxonomia do modo foto)
 */
export async function parseBetSlipFromText(
  text: string,
  opts?: ParseBetSlipOptions,
): Promise<ParsedSlip> {
  const systemPrompt = buildTextSystemPrompt(new Date().toISOString());
  return runSlipParsePipeline({
    userContent: `Estruture os dados deste bilhete descrito pelo usuário:\n\n${text}`,
    systemPrompt,
    tolerantSystemPrompt: `${systemPrompt}\n\n${TOLERANT_MODE_ADDENDUM}`,
    opts,
  });
}
