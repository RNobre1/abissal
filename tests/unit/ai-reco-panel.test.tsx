/**
 * AiRecoPanel render tests - 3 states (bet / skip / none).
 *
 * Server Component renderable directly under @testing-library/react.
 * OnDemandButton (client) is mocked at the module level to a simple stub
 * so we test the wrapper rendering without coupling to next/navigation.
 *
 * E2E happy-path submit (click "pedir analise IA" -> POST -> refresh) is
 * covered separately in tests/e2e once the Wave 3 endpoint is live. Here
 * we just assert the button is present and accessible in the "none" state.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AiRecommendationDTO } from "@/lib/ai-reco/reco-repository";
import type { AiRecoFeedbackDTO } from "@/lib/ai-reco/feedback-repository";

// Stub the client OnDemandButton so the test stays a unit render and does
// not pull next/navigation's router hooks during SSR-style render.
vi.mock(
  "@/app/(dashboard)/fixtures/[id]/_components/on-demand-button",
  () => ({
    OnDemandButton: ({ fixtureId }: { fixtureId: number }) => (
      <button type="button" data-testid="on-demand-stub">
        pedir analise IA (#{fixtureId})
      </button>
    ),
  }),
);

// next/navigation router stub for FeedbackButtons (which calls router.refresh()).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import { AiRecoPanel } from "@/app/(dashboard)/fixtures/[id]/_components/ai-reco-panel";

function betReco(
  over: Partial<AiRecommendationDTO> = {},
): AiRecommendationDTO {
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
    market: "btts-sim",
    side: "yes",
    prob_estimated: 0.64,
    prob_calibrated: 0.62,
    edge_pct: 12.0,
    odd_captured: 1.85,
    kelly_pre: 1.8,
    units_final: 1.5,
    reduction_reason: "lineup incerta",
    confidence: "alto",
    summary_line: "BTTS-sim 1.5u 64%",
    reasoning_full:
      "Liverpool teve 5 BTTS consecutivos em casa contra defesas top-6.",
    red_flags: [
      "3 desfalques no ataque do TOT",
      "Forma recente do LIV irregular",
    ],
    cost_usd: 0.018,
    league_calibrated: true,
    ...over,
  };
}

function skipReco(): AiRecommendationDTO {
  return {
    ...betReco(),
    id: 8,
    verdict: "skip",
    market: null,
    side: null,
    summary_line: null,
    reasoning_full: "Nenhum mercado com edge >= 5% no momento.",
    red_flags: [],
    units_final: null,
    kelly_pre: null,
    edge_pct: 3.0,
    reduction_reason: null,
    confidence: null,
  };
}

describe("<AiRecoPanel> - state A (verdict=bet)", () => {
  it("renders the section with data-ai-reco-verdict='bet' attribute", () => {
    const { container } = render(
      <AiRecoPanel
        reco={betReco()}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    const section = container.querySelector("[data-section='ai-reco']");
    expect(section).not.toBeNull();
    expect(section!.getAttribute("data-ai-reco-verdict")).toBe("bet");
  });

  it("shows the summary line, edge and units", () => {
    render(
      <AiRecoPanel
        reco={betReco()}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    expect(screen.getByText(/BTTS-sim/)).toBeInTheDocument();
    expect(screen.getByText(/Edge 12/)).toBeInTheDocument();
    expect(screen.getByText(/Kelly 1.8u/)).toBeInTheDocument();
    expect(screen.getByText(/IA 1.5u/)).toBeInTheDocument();
  });

  it("shows the reduction reason when present", () => {
    render(
      <AiRecoPanel
        reco={betReco()}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    expect(screen.getByText(/Motivo redução/)).toBeInTheDocument();
    expect(screen.getByText(/lineup incerta/)).toBeInTheDocument();
  });

  it("omits the reduction reason block when null", () => {
    render(
      <AiRecoPanel
        reco={betReco({ reduction_reason: null })}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    expect(screen.queryByText(/Motivo redução/)).toBeNull();
  });

  it("renders the reasoning_full body", () => {
    render(
      <AiRecoPanel
        reco={betReco()}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    expect(
      screen.getByText(/Liverpool teve 5 BTTS consecutivos/),
    ).toBeInTheDocument();
  });

  it("renders every red flag", () => {
    render(
      <AiRecoPanel
        reco={betReco()}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    expect(
      screen.getByText(/3 desfalques no ataque do TOT/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Forma recente do LIV irregular/),
    ).toBeInTheDocument();
  });

  it("omits the red flags list when empty", () => {
    render(
      <AiRecoPanel
        reco={betReco({ red_flags: [] })}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    expect(screen.queryByText(/Red flags/i)).toBeNull();
  });

  it("renders the model footer with cost and calibration label", () => {
    render(
      <AiRecoPanel
        reco={betReco()}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    expect(screen.getByText(/deepseek\/deepseek-r1/)).toBeInTheDocument();
    expect(screen.getByText(/prompt-v1\.0/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.0180/)).toBeInTheDocument();
    expect(screen.getByText(/liga calibrada/)).toBeInTheDocument();
  });

  it("exposes the llm_model on a [data-ai-reco-model] element (R1 batch)", () => {
    const { container } = render(
      <AiRecoPanel
        reco={betReco({ llm_model: "deepseek/deepseek-r1" })}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    const modelEl = container.querySelector("[data-ai-reco-model]");
    expect(modelEl).not.toBeNull();
    expect(modelEl!.getAttribute("data-ai-reco-model")).toBe(
      "deepseek/deepseek-r1",
    );
  });

  it("exposes the llm_model on a [data-ai-reco-model] element (sonnet on-demand)", () => {
    const { container } = render(
      <AiRecoPanel
        reco={betReco({ llm_model: "anthropic/claude-sonnet-4.5" })}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    const modelEl = container.querySelector("[data-ai-reco-model]");
    expect(modelEl).not.toBeNull();
    expect(modelEl!.getAttribute("data-ai-reco-model")).toBe(
      "anthropic/claude-sonnet-4.5",
    );
  });

  it("shows 'liga não-calibrada' when league_calibrated is false", () => {
    render(
      <AiRecoPanel
        reco={betReco({ league_calibrated: false })}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    expect(screen.getByText(/liga não-calibrada/)).toBeInTheDocument();
  });
});

describe("<AiRecoPanel> - state B (verdict=skip)", () => {
  it("renders the section with data-ai-reco-verdict='skip' attribute", () => {
    const { container } = render(
      <AiRecoPanel
        reco={skipReco()}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    const section = container.querySelector("[data-section='ai-reco']");
    expect(section).not.toBeNull();
    expect(section!.getAttribute("data-ai-reco-verdict")).toBe("skip");
  });

  it("shows the 'IA não vê valor' label and reasoning", () => {
    render(
      <AiRecoPanel
        reco={skipReco()}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    expect(screen.getByText(/IA não vê valor/)).toBeInTheDocument();
    expect(
      screen.getByText(/Nenhum mercado com edge >= 5%/),
    ).toBeInTheDocument();
  });

  it("falls back to the default message when reasoning_full is null", () => {
    const reco = skipReco();
    reco.reasoning_full = null;
    render(
      <AiRecoPanel
        reco={reco}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    expect(screen.getByText(/Nenhum mercado com edge/)).toBeInTheDocument();
  });

  it("does NOT render the bet card chrome (summary line / red flags / footer)", () => {
    render(
      <AiRecoPanel
        reco={skipReco()}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    expect(screen.queryByText(/Edge/)).toBeNull();
    expect(screen.queryByText(/Kelly/)).toBeNull();
    expect(screen.queryByText(/Red flags/i)).toBeNull();
    expect(screen.queryByText(/Modelo:/)).toBeNull();
  });
});

describe("<AiRecoPanel> - state C (no reco)", () => {
  it("renders the section with data-ai-reco-verdict='none' attribute", () => {
    const { container } = render(
      <AiRecoPanel
        reco={null}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    const section = container.querySelector("[data-section='ai-reco']");
    expect(section).not.toBeNull();
    expect(section!.getAttribute("data-ai-reco-verdict")).toBe("none");
  });

  it("renders the OnDemandButton stub with the fixtureId", () => {
    render(
      <AiRecoPanel
        reco={null}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    expect(screen.getByTestId("on-demand-stub")).toBeInTheDocument();
    expect(screen.getByText(/pedir analise IA \(#19427226\)/)).toBeInTheDocument();
  });

  it("does NOT render feedback buttons in state C (no reco yet)", () => {
    const { container } = render(
      <AiRecoPanel
        reco={null}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
      />,
    );
    expect(
      container.querySelector("[data-feedback-button='agree']"),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Feedback loop (states A + B): 4 buttons + textarea
// ---------------------------------------------------------------------------

function feedbackRow(over: Partial<AiRecoFeedbackDTO> = {}): AiRecoFeedbackDTO {
  return {
    id: 1,
    ai_recommendation_id: 7,
    user_decision: "agree",
    comment: null,
    created_at: "2026-05-25T10:00:00Z",
    updated_at: "2026-05-25T10:00:00Z",
    ...over,
  };
}

describe("<AiRecoPanel> feedback loop — bet card", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders all 4 feedback buttons when reco is a bet and no feedback yet", () => {
    const { container } = render(
      <AiRecoPanel
        reco={betReco()}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
        feedback={[]}
      />,
    );
    expect(
      container.querySelector("[data-feedback-button='agree']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-feedback-button='disagree']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-feedback-button='bet']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-feedback-button='no_bet']"),
    ).not.toBeNull();
  });

  it("renders the optional comment textarea", () => {
    const { container } = render(
      <AiRecoPanel
        reco={betReco()}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
        feedback={[]}
      />,
    );
    expect(container.querySelector("[data-feedback-comment]")).not.toBeNull();
  });

  it("clicking 'Apostei' POSTs to /api/ai-reco/feedback with the right payload", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 99 }), { status: 200 }),
      );

    const { container } = render(
      <AiRecoPanel
        reco={betReco({ id: 7 })}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
        feedback={[]}
      />,
    );
    const betBtn = container.querySelector(
      "[data-feedback-button='bet']",
    ) as HTMLButtonElement;
    expect(betBtn).not.toBeNull();
    fireEvent.click(betBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/ai-reco/feedback");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.aiRecommendationId).toBe(7);
    expect(body.userDecision).toBe("bet");
  });

  it("after a successful POST the clicked button is marked as saved (aria-pressed)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 99 }), { status: 200 }),
    );

    const { container } = render(
      <AiRecoPanel
        reco={betReco({ id: 7 })}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
        feedback={[]}
      />,
    );
    const agreeBtn = container.querySelector(
      "[data-feedback-button='agree']",
    ) as HTMLButtonElement;
    fireEvent.click(agreeBtn);

    await waitFor(() => {
      expect(agreeBtn.getAttribute("data-feedback-saved")).toBe("true");
    });
    expect(agreeBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders an active state for pre-existing feedback (passed via SSR prop)", () => {
    const { container } = render(
      <AiRecoPanel
        reco={betReco({ id: 7 })}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
        feedback={[feedbackRow({ user_decision: "bet" })]}
      />,
    );
    const betBtn = container.querySelector(
      "[data-feedback-button='bet']",
    ) as HTMLButtonElement;
    expect(betBtn.getAttribute("data-feedback-saved")).toBe("true");
  });

  it("renders the feedback summary block when feedback exists", () => {
    const { container } = render(
      <AiRecoPanel
        reco={betReco({ id: 7 })}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
        feedback={[feedbackRow({ user_decision: "bet", comment: "valeu" })]}
      />,
    );
    expect(screen.getByText(/Feedback humano registrado/)).toBeInTheDocument();
    const summaryRow = container.querySelector(
      "[data-feedback-saved-row='bet']",
    );
    expect(summaryRow).not.toBeNull();
    expect(summaryRow!.textContent).toMatch(/Apostei/);
    expect(summaryRow!.textContent).toMatch(/valeu/);
  });
});

describe("<AiRecoPanel> feedback loop — skip card", () => {
  it("renders feedback buttons in the skip state too", () => {
    const { container } = render(
      <AiRecoPanel
        reco={skipReco()}
        fixtureId={19427226}
        homeTeam="Liverpool"
        awayTeam="Tottenham"
        feedback={[]}
      />,
    );
    expect(
      container.querySelector("[data-feedback-button='agree']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-feedback-button='no_bet']"),
    ).not.toBeNull();
  });
});
