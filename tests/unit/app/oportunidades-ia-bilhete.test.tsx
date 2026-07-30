/**
 * U.5 — "+ bilhete" no card de oportunidades IA
 *
 * A Wave M (addLegToSlip + AddToSlipButton) FOI mergeada — o botão não pode
 * mais nascer disabled com tooltip "aguardando Wave M" (bloqueio fantasma).
 *
 * Testa:
 * - Botão "+ bilhete" HABILITADO quando a reco tem market/side/odd
 * - Clique dispara addLegToSlip com a seleção da reco (id, market, side, odd)
 * - Card enriquecido: edge %, odd e units sugeridas visíveis
 * - Sem odd capturada → botão desabilitado com motivo real (não Wave M)
 * - Link para o fixture segue funcional
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OportunidadeIaCard } from "@/components/oportunidades/oportunidade-ia-card";

const addLegToSlipMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/bet-slip/actions", () => ({
  addLegToSlip: addLegToSlipMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/telemetry/use-telemetry", () => ({
  useTelemetry: () => vi.fn(),
}));

const SAMPLE_RECO = {
  id: 42,
  fixture_id: 100,
  home_team: "Arsenal",
  away_team: "Chelsea",
  summary_line: "1X2 casa +12%",
  market: "1x2",
  side: "home",
  odd_captured: 1.85,
  edge_pct: 12.3,
  units_final: 0.5,
  league: "Premier League",
  kickoff_utc: "2026-07-30T19:00:00Z",
};

beforeEach(() => {
  addLegToSlipMock.mockReset();
  addLegToSlipMock.mockResolvedValue({ slipId: 1, legId: 2 });
});

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

  it("enriquece o card com edge %, odd e units sugeridas", () => {
    render(<OportunidadeIaCard reco={SAMPLE_RECO} />);
    expect(screen.getByText(/\+12\.3%/)).toBeInTheDocument();
    expect(screen.getByText(/@1\.85/)).toBeInTheDocument();
    expect(screen.getByText(/0\.5u/)).toBeInTheDocument();
  });

  it("edge negativo (reco forced) não renderiza '+-'", () => {
    render(<OportunidadeIaCard reco={{ ...SAMPLE_RECO, edge_pct: -3.2 }} />);
    expect(screen.getByText(/-3\.2%/)).toBeInTheDocument();
    expect(screen.queryByText(/\+-3\.2%/)).not.toBeInTheDocument();
  });

  it("botão '+ bilhete' está HABILITADO (Wave M mergeada — sem bloqueio fantasma)", () => {
    render(<OportunidadeIaCard reco={SAMPLE_RECO} />);
    const btn = screen.getByRole("button", { name: /bilhete/i });
    expect(btn).toBeEnabled();
    expect(btn.getAttribute("title") ?? "").not.toMatch(/wave m/i);
  });

  it("clique chama addLegToSlip com a seleção da reco", async () => {
    render(<OportunidadeIaCard reco={SAMPLE_RECO} />);
    fireEvent.click(screen.getByRole("button", { name: /bilhete/i }));

    await waitFor(() => expect(addLegToSlipMock).toHaveBeenCalledTimes(1));
    expect(addLegToSlipMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ai_recommendation_id: 42,
        fixture_id: 100,
        home_team: "Arsenal",
        away_team: "Chelsea",
        market: "1x2",
        side: "home",
        odd_taken: 1.85,
      }),
    );
  });

  it("sem odd capturada → botão desabilitado com o motivo real", () => {
    render(
      <OportunidadeIaCard
        reco={{ ...SAMPLE_RECO, odd_captured: null }}
      />,
    );
    const btn = screen.getByRole("button", { name: /bilhete/i });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title") ?? "").toMatch(/odd/i);
    expect(btn.getAttribute("title") ?? "").not.toMatch(/wave m/i);
  });

  it("link de acesso ao fixture está presente e funcional", () => {
    render(<OportunidadeIaCard reco={SAMPLE_RECO} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/fixtures/100");
  });
});
