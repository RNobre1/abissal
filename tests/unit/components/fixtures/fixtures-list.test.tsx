import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FixturesList } from "@/components/fixtures/fixtures-list";
import type { FixtureDTO } from "@/lib/fixtures/types";

function fx(over: Partial<FixtureDTO> & { id: number }): FixtureDTO {
  return {
    match_date: "2026-05-12",
    ko_time: "20:00",
    home_team: "Home",
    away_team: "Away",
    league: null,
    country: null,
    source_url: null,
    has_detail: true,
    kickoff_utc: null,
    ...over,
  };
}

describe("<FixturesList />", () => {
  it("renders one section per league|country with the count and items", () => {
    render(
      <FixturesList
        fixtures={[
          fx({
            id: 1,
            league: "Premier League",
            country: "england",
            home_team: "Arsenal",
            away_team: "Tottenham",
          }),
          fx({
            id: 2,
            league: "Premier League",
            country: "ukraine",
            home_team: "Shakhtar",
            away_team: "Dynamo",
          }),
        ]}
      />,
    );

    // Two distinct headers — same league name, disambiguated by country.
    const headers = screen.getAllByRole("heading", { level: 3 });
    expect(headers).toHaveLength(2);
    // Both teams are visible somewhere
    expect(screen.getByText("Arsenal")).toBeDefined();
    expect(screen.getByText("Shakhtar")).toBeDefined();
  });

  it("renders the empty state when there are no fixtures", () => {
    render(<FixturesList fixtures={[]} />);
    expect(screen.getByText(/sem jogos/i)).toBeDefined();
  });

  it("realça o card quando high_signal=true (vem da view Postgres, escalar)", () => {
    const { container } = render(
      <FixturesList
        fixtures={[
          fx({ id: 1, home_team: "Flamengo", high_signal: true }),
          fx({ id: 2, home_team: "Vasco", high_signal: false }),
          fx({ id: 3, home_team: "Fluminense" }), // sem high_signal → off
        ]}
      />,
    );
    const links = Array.from(container.querySelectorAll("a"));
    const flamengo = links.find((a) => a.textContent?.includes("Flamengo"))!;
    const vasco = links.find((a) => a.textContent?.includes("Vasco"))!;
    const flu = links.find((a) => a.textContent?.includes("Fluminense"))!;

    expect(flamengo.getAttribute("data-high-signal")).toBe("true");
    expect(vasco.getAttribute("data-high-signal")).toBeNull();
    expect(flu.getAttribute("data-high-signal")).toBeNull();
  });
});
