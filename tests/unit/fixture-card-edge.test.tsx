/**
 * FixtureCard — edge da IA no chip + prop showLeague (modo cronológico plano).
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FixtureCard } from "@/components/fixtures/fixture-card";
import type { FixtureDTO } from "@/lib/fixtures/types";

function fx({ id, ...over }: Partial<FixtureDTO> & { id: number }): FixtureDTO {
  return {
    id,
    match_date: "2026-05-30",
    ko_time: "16:00",
    home_team: "Flamengo",
    away_team: "Palmeiras",
    league: "Serie A",
    country: "brazil",
    source_url: null,
    has_detail: true,
    kickoff_utc: "2026-05-30T19:00:00Z",
    ...over,
  };
}

describe("<FixtureCard> edge da IA", () => {
  it("mostra +edge no chip quando aiHasBet + aiEdgePct", () => {
    const { container } = render(
      <FixtureCard fixture={fx({ id: 1 })} aiHasBet aiEdgePct={18.4} />,
    );
    const chip = container.querySelector('[data-ai-bet="true"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("18");
    expect(chip!.textContent).toContain("%");
  });

  it("sem aiEdgePct mostra só 'IA' (sem %)", () => {
    const { container } = render(
      <FixtureCard fixture={fx({ id: 1 })} aiHasBet />,
    );
    const chip = container.querySelector('[data-ai-bet="true"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).not.toContain("%");
  });
});

describe("<FixtureCard> showLeague (modo plano)", () => {
  it("showLeague mostra a bandeira do país (com title da liga)", () => {
    const { container } = render(
      <FixtureCard fixture={fx({ id: 1, country: "brazil", league: "Serie A" })} showLeague />,
    );
    const flag = container.querySelector('[data-league-flag="true"]');
    expect(flag).not.toBeNull();
    expect(flag!.getAttribute("title")).toContain("Serie A");
  });

  it("sem showLeague não renderiza a bandeira inline", () => {
    const { container } = render(<FixtureCard fixture={fx({ id: 1 })} />);
    expect(container.querySelector('[data-league-flag="true"]')).toBeNull();
  });

  it("não quebra o realce/badges existentes (sem regressão)", () => {
    render(
      <FixtureCard
        fixture={fx({ id: 1, badges: [{ id: "over-alto", label: "over alto", tone: "over" }] })}
        highSignal
        showLeague
      />,
    );
    expect(screen.getByText("over alto")).toBeDefined();
  });
});
