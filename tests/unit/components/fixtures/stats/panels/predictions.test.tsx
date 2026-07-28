import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Predictions } from "@/components/fixtures/stats/panels/predictions";
import type { Prediction } from "@/lib/fixtures/stats/detail-json-types";

function p(over: Partial<Prediction> = {}): Prediction {
  return {
    stat_type: "over 8.5 corners",
    chance: 75,
    chance_team: null,
    best_odds: 1.85,
    best_odds_bookmaker: "Bet365",
    home_stats: ["média 5.2 cantos por jogo"],
    away_stats: ["média 4.8 cantos por jogo"],
    ...over,
  };
}

describe("<Predictions />", () => {
  it("renders null when array is empty", () => {
    const { container } = render(
      <Predictions data={[]} homeTeam="Tottenham" awayTeam="Leeds" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders entries ordered by chance DESC", () => {
    const data = [
      p({ stat_type: "btts yes", chance: 60 }),
      p({ stat_type: "over 2.5 goals", chance: 80 }),
      p({ stat_type: "over 8.5 corners", chance: 75 }),
    ];
    const { container } = render(
      <Predictions data={data} homeTeam="Tottenham" awayTeam="Leeds" />,
    );
    const cards = Array.from(container.querySelectorAll("[data-prediction]")) as HTMLElement[];
    expect(cards.length).toBe(3);
    expect(cards[0].textContent).toMatch(/over 2.5 goals/i);
    expect(cards[1].textContent).toMatch(/over 8.5 corners/i);
    expect(cards[2].textContent).toMatch(/btts yes/i);
  });

  it("renders the chip with chance % + stat_type", () => {
    render(<Predictions data={[p()]} homeTeam="Tottenham" awayTeam="Leeds" />);
    expect(screen.getByText(/75/)).toBeDefined();
    expect(screen.getByText(/over 8.5 corners/i)).toBeDefined();
  });

  it("renders best_odds and bookmaker", () => {
    render(<Predictions data={[p()]} homeTeam="Tottenham" awayTeam="Leeds" />);
    expect(screen.getByText("1.85")).toBeDefined();
    expect(screen.getByText(/Bet365/)).toBeDefined();
  });

  it("renders home_stats and away_stats bullets", () => {
    render(<Predictions data={[p()]} homeTeam="Tottenham" awayTeam="Leeds" />);
    expect(screen.getByText(/5\.2 cantos/i)).toBeDefined();
    expect(screen.getByText(/4\.8 cantos/i)).toBeDefined();
  });

  it("buckets chip color by strength via data-strength", () => {
    const { container } = render(
      <Predictions
        data={[
          p({ stat_type: "a", chance: 92 }),
          p({ stat_type: "b", chance: 78 }),
          p({ stat_type: "c", chance: 55 }),
        ]}
        homeTeam="Tottenham"
        awayTeam="Leeds"
      />,
    );
    const chips = Array.from(
      container.querySelectorAll("[data-strength]"),
    ) as HTMLElement[];
    expect(chips.map((c) => c.getAttribute("data-strength"))).toEqual([
      "high",
      "mid",
      "low",
    ]);
  });

  it("labels evidence columns with team name + swatch", () => {
    const { container } = render(
      <Predictions data={[p()]} homeTeam="Tottenham" awayTeam="Leeds" />,
    );
    const heads = container.querySelectorAll("[data-evidence-head]");
    const texts = Array.from(heads).map((h) => h.textContent);
    expect(texts.some((t) => t?.includes("Tottenham"))).toBe(true);
    expect(texts.some((t) => t?.includes("Leeds"))).toBe(true);
    const swatch = container.querySelector(
      "[data-evidence-head] [data-swatch]",
    ) as HTMLElement;
    expect(swatch.style.background).toContain("--color-vermelho");
  });

  it("renders an InfoPopover trigger for reading help", () => {
    render(<Predictions data={[p()]} homeTeam="Tottenham" awayTeam="Leeds" />);
    expect(
      screen.getByRole("button", { name: /como ler predições/i }),
    ).toBeDefined();
  });
});
