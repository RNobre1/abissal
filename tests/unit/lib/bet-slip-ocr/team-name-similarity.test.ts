/**
 * TDD — team-name-similarity: normalização agressiva + similaridade de nomes
 * de times pro fallback TS do fuzzy-match de OCR (Follow-up 1, 31/07).
 *
 * Casos REAIS de produção (cupom Superbet 31/07, legs_auto_linked: 0):
 *  - "Bodo/Glimt"      vs "Bodø / Glimt"   (ø + espaços ao redor da barra)
 *  - "Lillestrom"      vs "Lillestrøm"     (ø — NFD NÃO decompõe ø!)
 *  - "Valerenga"       vs "Vålerenga"      (å)
 *  - "Arda Kardzhali"  vs "Arda"           (nome estendido vs curto)
 *  - "CSKA 1948 Sofia" vs "CSKA 1948 Sofia" (exato — não pode regredir)
 */
import { describe, it, expect } from "vitest";
import {
  normalizeTeamName,
  trigramSimilarity,
  teamNameSimilarity,
} from "@/lib/bet-slip-ocr/team-name-similarity";

describe("normalizeTeamName", () => {
  it("mapeia ø→o (NFD não decompõe ø)", () => {
    expect(normalizeTeamName("Lillestrøm")).toBe("lillestrom");
    expect(normalizeTeamName("Bodø")).toBe("bodo");
  });

  it("strip de diacríticos via NFD (å, é, ã)", () => {
    expect(normalizeTeamName("Vålerenga")).toBe("valerenga");
    expect(normalizeTeamName("São Paulo")).toBe("sao paulo");
    expect(normalizeTeamName("Sporting Gijón")).toBe("sporting gijon");
  });

  it("mapeia æ→ae e Ø→O antes do lowercase", () => {
    expect(normalizeTeamName("Næstved")).toBe("naestved");
    expect(normalizeTeamName("ØSTER")).toBe("oster");
  });

  it("colapsa pontuação (/, -, .) e espaços múltiplos em espaço único", () => {
    expect(normalizeTeamName("Bodø / Glimt")).toBe("bodo glimt");
    expect(normalizeTeamName("Bodo/Glimt")).toBe("bodo glimt");
    expect(normalizeTeamName("St.  Pauli")).toBe("st pauli");
    expect(normalizeTeamName("Hamburger-SV")).toBe("hamburger sv");
  });

  it("preserva dígitos (CSKA 1948 Sofia)", () => {
    expect(normalizeTeamName("CSKA 1948 Sofia")).toBe("cska 1948 sofia");
  });

  it("string vazia / só pontuação → vazio", () => {
    expect(normalizeTeamName("")).toBe("");
    expect(normalizeTeamName(" /- .")).toBe("");
  });
});

describe("trigramSimilarity", () => {
  it("strings idênticas → 1", () => {
    expect(trigramSimilarity("bodo glimt", "bodo glimt")).toBe(1);
  });

  it("strings sem relação → similaridade baixa (< 0.3)", () => {
    expect(trigramSimilarity("botafogo", "lillestrom")).toBeLessThan(0.3);
  });

  it("string vazia → 0", () => {
    expect(trigramSimilarity("", "bodo")).toBe(0);
    expect(trigramSimilarity("bodo", "")).toBe(0);
  });
});

describe("teamNameSimilarity", () => {
  // ── Os 5 casos reais de produção ────────────────────────────────────────────
  it("caso real: 'Bodo/Glimt' vs 'Bodø / Glimt' → igualdade normalizada (score 1, strong)", () => {
    const r = teamNameSimilarity("Bodo/Glimt", "Bodø / Glimt");
    expect(r.score).toBe(1);
    expect(r.strong).toBe(true);
  });

  it("caso real: 'Lillestrom' vs 'Lillestrøm' → igualdade normalizada (score 1, strong)", () => {
    const r = teamNameSimilarity("Lillestrom", "Lillestrøm");
    expect(r.score).toBe(1);
    expect(r.strong).toBe(true);
  });

  it("caso real: 'Valerenga' vs 'Vålerenga' → igualdade normalizada (score 1, strong)", () => {
    const r = teamNameSimilarity("Valerenga", "Vålerenga");
    expect(r.score).toBe(1);
    expect(r.strong).toBe(true);
  });

  it("caso real: 'Arda Kardzhali' vs 'Arda' → token-set contido (score 0.9, strong)", () => {
    const r = teamNameSimilarity("Arda Kardzhali", "Arda");
    expect(r.score).toBe(0.9);
    expect(r.strong).toBe(true);
    // simétrico
    const r2 = teamNameSimilarity("Arda", "Arda Kardzhali");
    expect(r2.score).toBe(0.9);
    expect(r2.strong).toBe(true);
  });

  it("caso real: 'CSKA 1948 Sofia' vs 'CSKA 1948 Sofia' → exato (score 1, strong)", () => {
    const r = teamNameSimilarity("CSKA 1948 Sofia", "CSKA 1948 Sofia");
    expect(r.score).toBe(1);
    expect(r.strong).toBe(true);
  });

  // ── Guardas contra falso positivo ───────────────────────────────────────────
  it("times sem relação → score baixo e NÃO strong", () => {
    const r = teamNameSimilarity("Botafogo", "Lillestrøm");
    expect(r.score).toBeLessThan(0.4);
    expect(r.strong).toBe(false);
  });

  it("token-set parcialmente sobreposto mas não contido → NÃO strong", () => {
    // "FC Porto" vs "FC Copenhagen": compartilham só "fc"
    const r = teamNameSimilarity("FC Porto", "FC Copenhagen");
    expect(r.strong).toBe(false);
  });

  it("nome vazio → score 0, não strong", () => {
    const r = teamNameSimilarity("", "Arda");
    expect(r.score).toBe(0);
    expect(r.strong).toBe(false);
  });
});
