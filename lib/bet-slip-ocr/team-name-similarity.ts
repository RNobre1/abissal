/**
 * team-name-similarity.ts — normalização agressiva + similaridade de nomes de
 * times pro fallback TS do fuzzy-match de OCR (Follow-up 1, 31/07).
 *
 * Motivação (produção 31/07): o pg_trgm do banco NÃO tem unaccent — o cupom
 * "Bodo/Glimt" não casava com "Bodø / Glimt" (ø + espaços ao redor da barra),
 * "Lillestrom" não casava com "Lillestrøm", e "Arda Kardzhali" (nome estendido
 * da casa) não casava com "Arda" (nome curto do banco). 3/3 legs sem auto-link.
 *
 * Módulo puro (sem deps de server) — testável isolado.
 */

// NFD decompõe å/é/ã em base + combining mark, mas NÃO decompõe ø/æ/đ/ł/ß —
// esses precisam de mapeamento manual ANTES do strip de diacríticos.
const CHAR_MAP: Record<string, string> = {
  ø: "o",
  Ø: "O",
  æ: "ae",
  Æ: "AE",
  å: "a",
  Å: "A",
  đ: "d",
  Đ: "D",
  ł: "l",
  Ł: "L",
  ß: "ss",
};

/**
 * Normalização agressiva: mapeamento manual (ø→o etc.) → NFD + strip de
 * diacríticos → lowercase → colapso de tudo que não é [a-z0-9] em espaço único.
 */
export function normalizeTeamName(raw: string): string {
  let mapped = "";
  for (const ch of raw) {
    mapped += CHAR_MAP[ch] ?? ch;
  }
  return mapped
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ── Trigram (estilo pg_trgm: cada palavra padded com "  " antes e " " depois) ─

function trigramsOf(normalized: string): Set<string> {
  const grams = new Set<string>();
  for (const word of normalized.split(" ")) {
    if (word.length === 0) continue;
    const padded = `  ${word} `;
    for (let i = 0; i <= padded.length - 3; i++) {
      grams.add(padded.slice(i, i + 3));
    }
  }
  return grams;
}

/**
 * Similaridade de trigramas (Jaccard) sobre strings JÁ normalizadas.
 * Compatível em espírito com `similarity()` do pg_trgm.
 */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigramsOf(a);
  const tb = trigramsOf(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const gram of ta) {
    if (tb.has(gram)) intersection++;
  }
  return intersection / (ta.size + tb.size - intersection);
}

// ── Similaridade de nome de time ──────────────────────────────────────────────

export interface TeamSimilarity {
  /** 1 = igualdade normalizada; 0.9 = token-set contido; senão trigram Jaccard. */
  score: number;
  /** true só nos casamentos inequívocos (igualdade ou token-set contido). */
  strong: boolean;
}

const TOKEN_SET_SCORE = 0.9;

/**
 * Similaridade entre um nome vindo do OCR e um nome canônico do banco.
 * - Igualdade normalizada → { 1, strong } ("Bodo/Glimt" ≡ "Bodø / Glimt")
 * - Token-set de um contido no do outro → { 0.9, strong } ("Arda" ⊂ "Arda Kardzhali")
 * - Senão → { trigram Jaccard, não-strong }
 */
export function teamNameSimilarity(ocrName: string, dbName: string): TeamSimilarity {
  const a = normalizeTeamName(ocrName);
  const b = normalizeTeamName(dbName);
  if (a.length === 0 || b.length === 0) return { score: 0, strong: false };
  if (a === b) return { score: 1, strong: true };

  const tokensA = new Set(a.split(" "));
  const tokensB = new Set(b.split(" "));
  const aInB = [...tokensA].every((t) => tokensB.has(t));
  const bInA = [...tokensB].every((t) => tokensA.has(t));
  if (aInB || bInA) return { score: TOKEN_SET_SCORE, strong: true };

  return { score: trigramSimilarity(a, b), strong: false };
}
