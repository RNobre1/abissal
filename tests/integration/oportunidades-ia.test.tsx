/**
 * OportunidadesIa Server Component — render tests.
 *
 * Mocks `fetchTopOpportunities` directly (the data fetcher) instead of the
 * Supabase chain so the test stays focused on the render contract.
 *
 * Coverage:
 * - empty result -> renders the empty-state copy ("Nenhuma oportunidade...")
 * - populated -> renders one <li> per result, each linking to /fixtures/<id>
 * - the section has the data-section="oportunidades-ia" attribute
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AiRecommendationDTO } from "@/lib/ai-reco/reco-repository";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

const mockFetchTops = vi.fn<
  (...args: unknown[]) => Promise<AiRecommendationDTO[]>
>();

vi.mock("@/lib/ai-reco/reco-repository", () => ({
  fetchTopOpportunities: (...args: unknown[]) => mockFetchTops(...args),
}));

import { OportunidadesIa } from "@/app/(dashboard)/_components/oportunidades-ia";

function reco(over: Partial<AiRecommendationDTO> & { id: number }): AiRecommendationDTO {
  const { id, ...rest } = over;
  return {
    id,
    created_at: "2026-05-24T10:00:00Z",
    fixture_id: 19427226 + id,
    home_team: "Liverpool",
    away_team: "Tottenham",
    league: "Premier League",
    kickoff_utc: "2026-05-25T19:00:00Z",
    reco_version: "reco-v1",
    prompt_version: "prompt-v1.0",
    llm_model: "deepseek/deepseek-r1",
    verdict: "bet",
    market: "btts-sim",
    side: "yes",
    prob_estimated: 0.64,
    prob_calibrated: 0.62,
    edge_pct: 12.0,
    odd_captured: 1.85,
    kelly_pre: 1.8,
    units_final: 1.5,
    reduction_reason: null,
    confidence: "alto",
    summary_line: "BTTS-sim 1.5u 64%",
    reasoning_full: null,
    red_flags: [],
    cost_usd: 0.018,
    league_calibrated: true,
    ...rest,
  };
}

describe("<OportunidadesIa>", () => {
  it("renders the empty-state when there are no opportunities", async () => {
    mockFetchTops.mockResolvedValueOnce([]);
    const node = await OportunidadesIa();
    const { container } = render(node);
    const section = container.querySelector("[data-section='oportunidades-ia']");
    expect(section).not.toBeNull();
    expect(screen.getByText(/Nenhuma oportunidade ativa/i)).toBeInTheDocument();
  });

  it("renders one <li> per recommendation with a link to /fixtures/<id>", async () => {
    mockFetchTops.mockResolvedValueOnce([
      reco({ id: 1, home_team: "Liverpool", away_team: "Tottenham" }),
      reco({
        id: 2,
        home_team: "Chelsea",
        away_team: "Arsenal",
        summary_line: "over 2.5 - 1.0u",
      }),
    ]);
    const node = await OportunidadesIa();
    const { container } = render(node);

    expect(screen.getByText(/Liverpool/)).toBeInTheDocument();
    expect(screen.getByText(/Tottenham/)).toBeInTheDocument();
    expect(screen.getByText(/Chelsea/)).toBeInTheDocument();
    expect(screen.getByText(/Arsenal/)).toBeInTheDocument();
    expect(screen.getByText(/BTTS-sim/)).toBeInTheDocument();
    expect(screen.getByText(/over 2.5/)).toBeInTheDocument();

    const links = container.querySelectorAll(
      "[data-section='oportunidades-ia'] a",
    );
    expect(links.length).toBe(2);
    const hrefs = Array.from(links).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(`/fixtures/${reco({ id: 1 }).fixture_id}`);
    expect(hrefs).toContain(`/fixtures/${reco({ id: 2 }).fixture_id}`);
  });

  it("exposes the top-N count label in the header", async () => {
    mockFetchTops.mockResolvedValueOnce([reco({ id: 1 }), reco({ id: 2 })]);
    const node = await OportunidadesIa();
    render(node);
    expect(screen.getByText(/oportunidades IA/i)).toBeInTheDocument();
    expect(screen.getByText(/top 2/i)).toBeInTheDocument();
  });

  it("requests at most 5 opportunities (default cap)", async () => {
    mockFetchTops.mockResolvedValueOnce([]);
    await OportunidadesIa();
    expect(mockFetchTops).toHaveBeenCalledWith(expect.anything(), 5);
  });
});
