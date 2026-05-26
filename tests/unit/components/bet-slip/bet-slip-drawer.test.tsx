/**
 * TDD — BetSlipDrawer component tests
 *
 * Tests:
 *  - renders list of legs
 *  - remove leg button calls onRemoveLeg
 *  - stake input triggers onStakeChange
 *  - shows combined odd + potential return
 *  - shows conflict warnings
 *  - "revisar bilhete" button navigates to /bilhete
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SlipLeg } from "@/lib/bet-slip/compute";
import { BetSlipDrawer } from "@/components/bet-slip/bet-slip-drawer";
import type { Conflict } from "@/lib/bet-slip/compute";

// next/navigation stub
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

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

const defaultProps = {
  legs: [makeLeg()],
  oddCombined: 2.0,
  stakeTotal: null,
  potentialReturn: null,
  conflicts: [] as Conflict[],
  removing: null,
  committing: false,
  onRemoveLeg: vi.fn(),
  onStakeChange: vi.fn(),
  onClose: vi.fn(),
  houses: [{ id: "house-1", name: "Bet365" }],
  onCommit: vi.fn(),
  onCancel: vi.fn(),
};

describe("BetSlipDrawer", () => {
  it("renders each leg with home vs away label", () => {
    render(<BetSlipDrawer {...defaultProps} />);
    expect(screen.getByText(/Liverpool/i)).toBeInTheDocument();
    expect(screen.getByText(/Chelsea/i)).toBeInTheDocument();
  });

  it("renders market and side for each leg", () => {
    render(<BetSlipDrawer {...defaultProps} />);
    expect(screen.getByText(/1x2/i)).toBeInTheDocument();
    expect(screen.getByText(/home/i)).toBeInTheDocument();
  });

  it("calls onRemoveLeg with legId when remove button clicked", () => {
    const onRemoveLeg = vi.fn();
    render(<BetSlipDrawer {...defaultProps} onRemoveLeg={onRemoveLeg} />);
    const removeBtn = screen.getByRole("button", { name: /remover/i });
    fireEvent.click(removeBtn);
    expect(onRemoveLeg).toHaveBeenCalledWith(1);
  });

  it("shows combined odd", () => {
    render(<BetSlipDrawer {...defaultProps} oddCombined={4.5} />);
    expect(screen.getByText(/4[.,]50/)).toBeInTheDocument();
  });

  it("renders stake input", () => {
    render(<BetSlipDrawer {...defaultProps} />);
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
  });

  it("calls onStakeChange when stake input changes", () => {
    const onStakeChange = vi.fn();
    render(<BetSlipDrawer {...defaultProps} onStakeChange={onStakeChange} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "50" } });
    expect(onStakeChange).toHaveBeenCalled();
  });

  it("shows potential return when stake and oddCombined set", () => {
    render(
      <BetSlipDrawer {...defaultProps} stakeTotal={50} potentialReturn={200} />,
    );
    expect(screen.getByText(/200/)).toBeInTheDocument();
  });

  it("shows conflict warning when conflicts exist", () => {
    const conflicts: Conflict[] = [
      {
        type: "conflicting_sides",
        legIds: [1, 2],
        message: "Mercados conflitantes no mesmo jogo",
      },
    ];
    render(<BetSlipDrawer {...defaultProps} conflicts={conflicts} />);
    expect(
      screen.getByText(/conflitante/i),
    ).toBeInTheDocument();
  });

  it("renders 'revisar bilhete' link to /bilhete", () => {
    render(<BetSlipDrawer {...defaultProps} />);
    expect(screen.getByRole("link", { name: /revisar bilhete/i })).toHaveAttribute(
      "href",
      "/bilhete",
    );
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(<BetSlipDrawer {...defaultProps} onClose={onClose} />);
    const closeBtn = screen.getByRole("button", { name: /fechar/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
