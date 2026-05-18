/**
 * Testes de realce do FixtureCard quando highSignal={true}.
 *
 * Garante:
 * - highSignal=true adiciona data-high-signal="true" e classe de acento
 * - highSignal=false ou ausente não aplica o realce
 * - badges continuam renderizando igual em ambos os casos (sem regressão)
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FixtureCard } from "@/components/fixtures/fixture-card";
import type { FixtureDTO } from "@/lib/fixtures/types";

function fx(over: Partial<FixtureDTO> & { id: number }): FixtureDTO {
  const defaults: FixtureDTO = {
    id: over.id,
    match_date: "2026-05-18",
    ko_time: "20:00",
    home_team: "Flamengo",
    away_team: "Palmeiras",
    league: "Serie A",
    country: "brazil",
    source_url: null,
    has_detail: true,
    kickoff_utc: "2026-05-18T23:00:00Z",
  };
  return { ...defaults, ...over };
}

describe("<FixtureCard highSignal>", () => {
  it("highSignal=true adiciona data-high-signal='true' no link", () => {
    const { container } = render(<FixtureCard fixture={fx({ id: 1 })} highSignal={true} />);
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("data-high-signal")).toBe("true");
  });

  it("highSignal=false não adiciona data-high-signal no link", () => {
    const { container } = render(<FixtureCard fixture={fx({ id: 1 })} highSignal={false} />);
    const link = container.querySelector("a");
    expect(link!.getAttribute("data-high-signal")).toBeNull();
  });

  it("prop ausente (undefined) não adiciona data-high-signal no link", () => {
    const { container } = render(<FixtureCard fixture={fx({ id: 1 })} />);
    const link = container.querySelector("a");
    expect(link!.getAttribute("data-high-signal")).toBeNull();
  });

  it("badges continuam renderizando com highSignal=true (sem regressão)", () => {
    render(
      <FixtureCard
        fixture={fx({
          id: 1,
          badges: [
            { id: "cartao-alto", label: "cartão alto", tone: "cards" },
            { id: "over-alto", label: "over alto", tone: "over" },
          ],
        })}
        highSignal={true}
      />,
    );
    expect(screen.getByText("cartão alto")).toBeDefined();
    expect(screen.getByText("over alto")).toBeDefined();
  });

  it("badges continuam renderizando com highSignal=false (sem regressão)", () => {
    render(
      <FixtureCard
        fixture={fx({
          id: 1,
          badges: [
            { id: "cartao-alto", label: "cartão alto", tone: "cards" },
            { id: "btts-alto", label: "btts alto", tone: "btts" },
          ],
        })}
        highSignal={false}
      />,
    );
    expect(screen.getByText("cartão alto")).toBeDefined();
    expect(screen.getByText("btts alto")).toBeDefined();
  });
});
