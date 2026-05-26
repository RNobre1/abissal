/**
 * U.2 — Vocabulary translation tests
 *
 * Garante que:
 * - "Edge X%" não aparece mais em ai-reco-panel → "Vantagem estimada X%"
 * - "skip" badge → "sem oportunidade"
 * - "Kelly Yu → IA Zu" → "Aposta sugerida: R$ XX (Z unidades)"
 * - Custo USD está em detalhes técnicos (não visível diretamente)
 * - "confiança" em vez de "confidence"
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { AiRecommendationDTO } from "@/lib/ai-reco/reco-repository";

vi.mock(
  "@/app/(dashboard)/fixtures/[id]/_components/on-demand-button",
  () => ({
    OnDemandButton: () => <button type="button">pedir análise</button>,
  }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import { AiRecoPanel } from "@/app/(dashboard)/fixtures/[id]/_components/ai-reco-panel";

function betReco(over: Partial<AiRecommendationDTO> = {}): AiRecommendationDTO {
  return {
    id: 7,
    created_at: "2026-05-24T10:00:00Z",
    fixture_id: 19427226,
    home_team: "Liverpool",
    away_team: "Tottenham",
    league: "Premier League",
    kickoff_utc: "2026-05-25T19:00:00Z",
    reco_version: "reco-v1",
    prompt_version: "prompt-v1.0",
    llm_model: "deepseek/deepseek-r1",
    verdict: "bet",
    market: "1x2",
    side: "home",
    prob_estimated: 0.64,
    prob_calibrated: 0.62,
    edge_pct: 12.5,
    odd_captured: 1.85,
    kelly_pre: 1.8,
    units_final: 1.5,
    reduction_reason: null,
    confidence: "alto",
    summary_line: "1x2/home 1.5u 64%",
    reasoning_full: "Liverpool tem vantagem em casa.",
    red_flags: [],
    cost_usd: 0.0018,
    league_calibrated: true,
    ...over,
  };
}

describe("U.2 — Vocabulário traduzido (AiRecoPanel)", () => {
  it("'Edge X%' não aparece — deve mostrar 'Vantagem estimada'", () => {
    const { container } = render(
      <AiRecoPanel
        reco={betReco({ edge_pct: 12.5 })}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    // "Edge" raw não deve aparecer (case sensitive check)
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\bEdge\b/);
    // "Vantagem estimada" deve aparecer
    expect(text).toMatch(/Vantagem estimada/i);
    expect(text).toContain("12.5");
  });

  it("'Kelly X → IA Z' substituído por 'Aposta sugerida: R$'", () => {
    const { container } = render(
      <AiRecoPanel
        reco={betReco({ kelly_pre: 1.8, units_final: 1.5 })}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    const text = container.textContent ?? "";
    // Não deve mostrar "Kelly" como label de linha (fora de detalhes técnicos)
    // A linha principal deve ter "Aposta sugerida"
    expect(text).toMatch(/Aposta sugerida/i);
    // R$ como âncora comportamental
    expect(text).toMatch(/R\$/);
    // Unidades ainda visíveis para power user
    expect(text).toMatch(/1\.5\s*u(nidades)?/i);
  });

  it("verdict='skip' mostra 'sem oportunidade' em vez de badge 'skip'", () => {
    const { container } = render(
      <AiRecoPanel
        reco={{
          ...betReco(),
          verdict: "skip",
          market: null,
          side: null,
          summary_line: null,
          units_final: null,
          kelly_pre: null,
          edge_pct: 3.0,
          reduction_reason: null,
          confidence: null,
        }}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    const text = container.textContent ?? "";
    // "skip" raw não aparece como label/badge visível
    expect(text).not.toMatch(/\bskip\b/i);
    // Mensagem traduzida
    expect(text).toMatch(/sem oportunidade/i);
  });

  it("custo USD está em elemento <details> (metadados técnicos)", () => {
    const { container } = render(
      <AiRecoPanel
        reco={betReco({ cost_usd: 0.0018 })}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    // O custo deve estar dentro de um <details> element
    const detailsEl = container.querySelector("details");
    expect(detailsEl).not.toBeNull();
    expect(detailsEl!.textContent).toContain("0.0018");
  });

  it("'confiança' aparece em vez de 'confidence'", () => {
    const { container } = render(
      <AiRecoPanel
        reco={betReco({ confidence: "alto" })}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    const text = container.textContent ?? "";
    // "confidence" como palavra não deve aparecer
    expect(text).not.toMatch(/\bconfidence\b/i);
    // "confiança" deve aparecer
    expect(text).toMatch(/confiança/i);
  });

  it("label do painel é 'sugestões da IA' em vez de 'recomendação IA'", () => {
    const { container } = render(
      <AiRecoPanel
        reco={betReco()}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    // Painel deve ter label visível como "sugestões da IA"
    expect(container.textContent).toMatch(/sugestões da IA/i);
  });
});
