/**
 * TDD — BetSlipFAB component tests
 *
 * Tests:
 *  - 0 legs: FAB is invisible (not rendered)
 *  - N legs: FAB shows leg count + combined odd
 *  - Click: calls onOpen callback
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SlipLeg } from "@/lib/bet-slip/compute";
import { BetSlipFAB } from "@/components/bet-slip/bet-slip-fab";

function makeLeg(overrides: Partial<SlipLeg> = {}): SlipLeg {
  return {
    id: 1,
    slip_id: 1,
    fixture_id: 100,
    home_team: "Liverpool",
    away_team: "Chelsea",
    market: "1x2",
    side: "home",
    odd_taken: 2.0,
    league: "Premier League",
    kickoff_utc: null,
    created_at: "2026-05-26T12:00:00Z",
    ai_recommendation_id: null,
    sport_id: null,
    market_id: null,
    ...overrides,
  };
}

describe("BetSlipFAB", () => {
  it("is not rendered when legs array is empty", () => {
    const { container } = render(
      <BetSlipFAB legs={[]} oddCombined={1} onOpen={() => {}} />,
    );
    expect(container.querySelector("[data-bet-slip-fab]")).toBeNull();
  });

  it("renders when there is 1 leg", () => {
    render(
      <BetSlipFAB legs={[makeLeg()]} oddCombined={2.0} onOpen={() => {}} />,
    );
    const fab = screen.getByRole("button", { name: /bilhete/i });
    expect(fab).toBeInTheDocument();
  });

  it("shows leg count in FAB label", () => {
    const legs = [
      makeLeg({ id: 1 }),
      makeLeg({ id: 2, fixture_id: 200, home_team: "Arsenal" }),
    ];
    render(
      <BetSlipFAB legs={legs} oddCombined={6.0} onOpen={() => {}} />,
    );
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it("shows combined odd in FAB label", () => {
    render(
      <BetSlipFAB legs={[makeLeg()]} oddCombined={3.50} onOpen={() => {}} />,
    );
    expect(screen.getByText(/3[.,]50/)).toBeInTheDocument();
  });

  it("calls onOpen when FAB is clicked", () => {
    const onOpen = vi.fn();
    render(
      <BetSlipFAB legs={[makeLeg()]} oddCombined={2.0} onOpen={onOpen} />,
    );
    const fab = screen.getByRole("button", { name: /bilhete/i });
    fireEvent.click(fab);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("renders with stake total when provided", () => {
    render(
      <BetSlipFAB
        legs={[makeLeg()]}
        oddCombined={2.0}
        stakeTotal={50}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText(/50/)).toBeInTheDocument();
  });
});
