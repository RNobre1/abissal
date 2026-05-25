/**
 * TDD — PlaceBetForm: sport/market/league dropdowns render + required validation
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Stub server action
vi.mock("@/app/(dashboard)/bets/actions", () => ({
  placeBetAction: vi.fn(),
}));

// useActionState stub — returns [state, action, false]
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useActionState: (action: unknown, init: unknown) => [init, action, false],
  };
});

import { PlaceBetForm } from "@/app/(dashboard)/bets/new/form";

const HOUSES = [{ id: "h1", name: "Bet365" }];
const SPORTS = [
  { id: "s1", name: "Futebol" },
  { id: "s2", name: "Tênis" },
];
const MARKETS = [
  { id: "m1", name: "Resultado Final", sport_id: "s1" },
  { id: "m2", name: "Ambas Marcam", sport_id: "s1" },
  { id: "m3", name: "Vencedor Set 1", sport_id: "s2" },
];
const LEAGUES = ["Premier League", "Brasileirão Série A", "La Liga"];

describe("PlaceBetForm — selects upgrade", () => {
  it("renders sport select with provided options", () => {
    render(
      <PlaceBetForm
        houses={HOUSES}
        defaultPlacedAt="2026-05-25T10:00"
        sports={SPORTS}
        markets={MARKETS}
        leagues={LEAGUES}
      />,
    );
    expect(screen.getByLabelText(/esporte/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Futebol" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Tênis" })).toBeInTheDocument();
  });

  it("renders market select", () => {
    render(
      <PlaceBetForm
        houses={HOUSES}
        defaultPlacedAt="2026-05-25T10:00"
        sports={SPORTS}
        markets={MARKETS}
        leagues={LEAGUES}
      />,
    );
    expect(screen.getByLabelText(/mercado/i)).toBeInTheDocument();
  });

  it("renders league datalist/select", () => {
    render(
      <PlaceBetForm
        houses={HOUSES}
        defaultPlacedAt="2026-05-25T10:00"
        sports={SPORTS}
        markets={MARKETS}
        leagues={LEAGUES}
      />,
    );
    expect(screen.getByLabelText(/liga/i)).toBeInTheDocument();
  });

  it("renders per-leg sport/market/league fields", () => {
    render(
      <PlaceBetForm
        houses={HOUSES}
        defaultPlacedAt="2026-05-25T10:00"
        sports={SPORTS}
        markets={MARKETS}
        leagues={LEAGUES}
      />,
    );
    // At least one sport hidden input or select inside leg container
    const sportFields = document.querySelectorAll("[name='sport_id']");
    expect(sportFields.length).toBeGreaterThanOrEqual(1);
    const marketFields = document.querySelectorAll("[name='market_id']");
    expect(marketFields.length).toBeGreaterThanOrEqual(1);
    const leagueFields = document.querySelectorAll("[name='league']");
    expect(leagueFields.length).toBeGreaterThanOrEqual(1);
  });
});
