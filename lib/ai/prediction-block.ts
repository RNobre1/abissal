/**
 * Extrai e valida o bloco de predição estruturada emitido pelo modelo ao final
 * da resposta. O modelo é instruído a encerrar com um fenced block JSON no
 * formato: ```json {"prediction":{"winner":"home|draw|away","confidence":0..1,
 * "over_under_2_5":"over|under"}} ```
 *
 * Defensivo por design: qualquer formato inesperado retorna null sem lançar.
 */

export interface Prediction {
  winner: "home" | "draw" | "away";
  confidence: number; // [0, 1]
  over_under_2_5: "over" | "under";
}

const FENCED_JSON_RE = /```json\s*([\s\S]*?)```/g;
const VALID_WINNERS = new Set(["home", "draw", "away"]);
const VALID_OU = new Set(["over", "under"]);

/**
 * Extrai o ÚLTIMO fenced ```json ... ``` do texto e tenta parsear a predição.
 * Retorna null se o bloco não existir, o JSON for malformado, ou o conteúdo
 * não respeitar o schema esperado. Nunca lança exceção.
 */
export function extractPrediction(text: string): Prediction | null {
  try {
    // Encontra todos os blocos; pega o último.
    const matches = [...text.matchAll(FENCED_JSON_RE)];
    if (matches.length === 0) return null;

    const lastMatch = matches[matches.length - 1];
    const raw = lastMatch[1].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    // Deve ser objeto não-array
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

    const obj = parsed as Record<string, unknown>;
    const pred = obj.prediction;

    // prediction deve ser objeto não-array
    if (typeof pred !== "object" || pred === null || Array.isArray(pred)) return null;

    const p = pred as Record<string, unknown>;

    // winner
    if (!VALID_WINNERS.has(p.winner as string)) return null;

    // over_under_2_5
    if (!VALID_OU.has(p.over_under_2_5 as string)) return null;

    // confidence: deve ser número; clamp para [0,1]
    if (typeof p.confidence !== "number" || !Number.isFinite(p.confidence)) return null;
    const confidence = Math.min(1, Math.max(0, p.confidence));

    return {
      winner: p.winner as "home" | "draw" | "away",
      confidence,
      over_under_2_5: p.over_under_2_5 as "over" | "under",
    };
  } catch {
    return null;
  }
}
