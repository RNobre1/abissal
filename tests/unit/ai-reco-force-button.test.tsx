/**
 * Tests: ForceAnalysisButton renders in skip state and fires POST with force=true.
 *
 * B17 lesson: test all visible states of the panel.
 * Spec: when verdict==='skip', button appears; click → POST /api/ai-reco/compute
 *   with { fixtureId, force: true }.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AiRecommendationDTO } from "@/lib/ai-reco/reco-repository";

// Stub AiRecoActions (has router hooks internally)
vi.mock(
  "@/app/(dashboard)/fixtures/[id]/_components/ai-reco-actions",
  () => ({
    AiRecoActions: () => <div data-testid="ai-reco-actions-stub" />,
  }),
);

// Stub OnDemandButton
vi.mock(
  "@/app/(dashboard)/fixtures/[id]/_components/on-demand-button",
  () => ({
    OnDemandButton: ({ fixtureId }: { fixtureId: number }) => (
      <button type="button" data-testid="on-demand-stub">
        pedir análise #{fixtureId}
      </button>
    ),
  }),
);

// next/navigation stub
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/disciplina/thesis-gate", () => ({
  shouldRequireThesis: () => false,
  thesisGateCopy: () => "",
}));

import { AiRecoPanel } from "@/app/(dashboard)/fixtures/[id]/_components/ai-reco-panel";

function skipReco(over: Partial<AiRecommendationDTO> = {}): AiRecommendationDTO {
  return {
    id: 8,
    created_at: "2026-06-01T10:00:00Z",
    fixture_id: 99999,
    home_team: "Flamengo",
    away_team: "Fluminense",
    league: "Brasileirao",
    kickoff_utc: "2026-06-01T20:00:00Z",
    reco_version: "reco-v1",
    prompt_version: "prompt-v1.1",
    llm_model: "(no-llm-call)",
    verdict: "skip",
    market: null,
    side: null,
    prob_estimated: null,
    prob_calibrated: null,
    edge_pct: null,
    odd_captured: null,
    kelly_pre: null,
    units_final: null,
    reduction_reason: null,
    confidence: "baixo",
    summary_line: null,
    reasoning_full: "Nenhum mercado com edge >= 10%.",
    red_flags: [],
    cost_usd: 0,
    league_calibrated: false,
    ...over,
  };
}

describe("<AiRecoPanel> — force analysis button in skip state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the force-analysis button when verdict=skip", () => {
    render(
      <AiRecoPanel
        reco={skipReco()}
        fixtureId={99999}
        homeTeam="Flamengo"
        awayTeam="Fluminense"
      />,
    );
    expect(screen.getByTestId("force-analysis-btn")).toBeInTheDocument();
  });

  it("does NOT render the force-analysis button when verdict=bet", () => {
    const betReco: AiRecommendationDTO = {
      ...skipReco(),
      verdict: "bet",
      market: "1x2",
      side: "home",
      prob_estimated: 0.65,
      edge_pct: 15,
      units_final: 1.0,
      summary_line: "1x2/home 1.0u",
      confidence: "medio",
    };
    render(
      <AiRecoPanel
        reco={betReco}
        fixtureId={99999}
        homeTeam="Flamengo"
        awayTeam="Fluminense"
      />,
    );
    expect(screen.queryByTestId("force-analysis-btn")).toBeNull();
  });

  it("does NOT render the force-analysis button when reco=null (state C)", () => {
    render(
      <AiRecoPanel
        reco={null}
        fixtureId={99999}
        homeTeam="Flamengo"
        awayTeam="Fluminense"
      />,
    );
    expect(screen.queryByTestId("force-analysis-btn")).toBeNull();
  });

  it("button posts to /api/ai-reco/compute with force=true", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            decision: { verdict: "bet", summary_line: "forçado" },
            reco_id: 888,
            logId: 999,
            costUsd: 0.001,
            latencyMs: 5000,
          }),
          { status: 200 },
        ),
      );

    render(
      <AiRecoPanel
        reco={skipReco()}
        fixtureId={99999}
        homeTeam="Flamengo"
        awayTeam="Fluminense"
      />,
    );

    fireEvent.click(screen.getByTestId("force-analysis-btn"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/ai-reco/compute");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.fixtureId).toBe(99999);
    expect(body.force).toBe(true);
  });

  it("shows forced disclaimer text when forced result is displayed", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          decision: { verdict: "bet", summary_line: "1x2/home forçado" },
          reco_id: 888,
          logId: 999,
          costUsd: 0.001,
          latencyMs: 5000,
        }),
        { status: 200 },
      ),
    );

    render(
      <AiRecoPanel
        reco={skipReco()}
        fixtureId={99999}
        homeTeam="Flamengo"
        awayTeam="Fluminense"
      />,
    );

    fireEvent.click(screen.getByTestId("force-analysis-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("forced-disclaimer")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("forced-disclaimer").textContent).toMatch(
      /não conta.*calibração|calibração|forçad/i,
    );
  });

  it("shows error message when force request fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "sim missing" }), { status: 400 }),
    );

    render(
      <AiRecoPanel
        reco={skipReco()}
        fixtureId={99999}
        homeTeam="Flamengo"
        awayTeam="Fluminense"
      />,
    );

    fireEvent.click(screen.getByTestId("force-analysis-btn"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
  });
});
