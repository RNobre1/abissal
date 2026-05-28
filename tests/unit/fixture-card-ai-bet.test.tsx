/**
 * Wave 4: FixtureCard renders the ⚡ IA chip when aiHasBet={true}.
 *
 * Asserts:
 * - aiHasBet=true → data-ai-bet="true" chip rendered, with the ⚡ IA label
 *   and the descriptive title for hover.
 * - aiHasBet=false / undefined → chip absent.
 * - chip coexists with the OFF badge (has_detail=false) and with badges.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FixtureCard } from "@/components/fixtures/fixture-card";
import type { FixtureDTO } from "@/lib/fixtures/types";

function fx(over: Partial<FixtureDTO> & { id: number }): FixtureDTO {
  const defaults: FixtureDTO = {
    id: over.id,
    match_date: "2026-05-25",
    ko_time: "20:00",
    home_team: "Liverpool",
    away_team: "Tottenham",
    league: "Premier League",
    country: "england",
    source_url: null,
    has_detail: true,
    kickoff_utc: "2026-05-25T19:00:00Z",
  };
  return { ...defaults, ...over };
}

describe("<FixtureCard aiHasBet>", () => {
  it("aiHasBet=true → renders ⚡ IA chip with data-ai-bet='true'", () => {
    const { container } = render(
      <FixtureCard fixture={fx({ id: 1 })} aiHasBet={true} />,
    );
    const chip = container.querySelector("[data-ai-bet='true']");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("IA");
  });

  it("aiHasBet=true exposes a descriptive title for hover affordance", () => {
    const { container } = render(
      <FixtureCard fixture={fx({ id: 1 })} aiHasBet={true} />,
    );
    const chip = container.querySelector("[data-ai-bet='true']");
    expect(chip!.getAttribute("title")).toMatch(/IA recomenda/i);
  });

  it("aiHasBet=false → chip absent", () => {
    const { container } = render(
      <FixtureCard fixture={fx({ id: 1 })} aiHasBet={false} />,
    );
    expect(container.querySelector("[data-ai-bet='true']")).toBeNull();
  });

  it("aiHasBet undefined → chip absent (default safe)", () => {
    const { container } = render(<FixtureCard fixture={fx({ id: 1 })} />);
    expect(container.querySelector("[data-ai-bet='true']")).toBeNull();
  });

  it("chip coexists with the OFF badge when has_detail=false", () => {
    const { container } = render(
      <FixtureCard
        fixture={fx({ id: 1, has_detail: false })}
        aiHasBet={true}
      />,
    );
    expect(container.querySelector("[data-ai-bet='true']")).not.toBeNull();
    expect(screen.getByText("OFF")).toBeInTheDocument();
  });

  it("chip coexists with badges (no regression on the badges row)", () => {
    render(
      <FixtureCard
        fixture={fx({
          id: 1,
          badges: [{ id: "over-alto", label: "over alto", tone: "over" }],
        })}
        aiHasBet={true}
      />,
    );
    expect(screen.getByText("over alto")).toBeInTheDocument();
    expect(screen.getByText(/IA/)).toBeInTheDocument();
  });
});

describe("<FixtureCard aiNoValue>", () => {
  it("aiNoValue=true → renders 'IA · sem valor' chip with data-ai-no-value='true'", () => {
    const { container } = render(
      <FixtureCard fixture={fx({ id: 1 })} aiNoValue={true} />,
    );
    const chip = container.querySelector("[data-ai-no-value='true']");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toMatch(/sem valor/i);
    expect(chip!.getAttribute("title")).toMatch(/não viu valor/i);
  });

  it("aiNoValue=false / undefined → chip absent", () => {
    const { container: c1 } = render(
      <FixtureCard fixture={fx({ id: 1 })} aiNoValue={false} />,
    );
    expect(c1.querySelector("[data-ai-no-value='true']")).toBeNull();
    const { container: c2 } = render(<FixtureCard fixture={fx({ id: 2 })} />);
    expect(c2.querySelector("[data-ai-no-value='true']")).toBeNull();
  });

  it("aiHasBet tem precedência: bet mostra ⚡IA e esconde 'sem valor'", () => {
    const { container } = render(
      <FixtureCard fixture={fx({ id: 1 })} aiHasBet={true} aiNoValue={true} />,
    );
    expect(container.querySelector("[data-ai-bet='true']")).not.toBeNull();
    expect(container.querySelector("[data-ai-no-value='true']")).toBeNull();
  });
});
