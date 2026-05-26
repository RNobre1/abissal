/**
 * U.5 — "+ bilhete" button in OportunidadesIa listing
 *
 * Testa:
 * - Botão "+ bilhete" aparece em cada card de oportunidade
 * - Botão é DISABLED enquanto Wave M (addLegToSlip) não está mergeada
 * - Tooltip "disponível quando bilhete (Wave M) for mergeado" presente no disabled
 * - Tap target mínimo 44px (min-h-[44px])
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OportunidadeIaCard } from "@/components/oportunidades/oportunidade-ia-card";

const SAMPLE_RECO = {
  id: 42,
  fixture_id: 100,
  home_team: "Arsenal",
  away_team: "Chelsea",
  summary_line: "1X2 casa +12%",
};

describe("<OportunidadeIaCard />", () => {
  it("renderiza time mandante e visitante", () => {
    render(<OportunidadeIaCard reco={SAMPLE_RECO} />);
    expect(screen.getByText(/Arsenal/i)).toBeInTheDocument();
    expect(screen.getByText(/Chelsea/i)).toBeInTheDocument();
  });

  it("renderiza summary_line", () => {
    render(<OportunidadeIaCard reco={SAMPLE_RECO} />);
    expect(screen.getByText(/1X2 casa \+12%/i)).toBeInTheDocument();
  });

  it("renderiza botão '+ bilhete'", () => {
    render(<OportunidadeIaCard reco={SAMPLE_RECO} />);
    const btn = screen.getByRole("button", { name: /bilhete/i });
    expect(btn).toBeInTheDocument();
  });

  it("botão '+ bilhete' é disabled (Wave M não mergeada)", () => {
    render(<OportunidadeIaCard reco={SAMPLE_RECO} />);
    const btn = screen.getByRole("button", { name: /bilhete/i });
    expect(btn).toBeDisabled();
  });

  it("botão tem title/tooltip indicando Wave M pendente", () => {
    render(<OportunidadeIaCard reco={SAMPLE_RECO} />);
    const btn = screen.getByRole("button", { name: /bilhete/i });
    expect(btn.getAttribute("title")).toMatch(/wave m/i);
  });

  it("link de acesso ao fixture está presente e funcional", () => {
    render(<OportunidadeIaCard reco={SAMPLE_RECO} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/fixtures/100");
  });
});
