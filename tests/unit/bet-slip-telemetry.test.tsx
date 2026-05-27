/**
 * TDD — Parte B: Telemetria do funil bilhete múltipla (Ação 2)
 *
 * Verifica que os 4 eventos de telemetria são disparados nos momentos certos:
 *   - bilhete_drawer_open    (BetSlipFAB.onClick)
 *   - bilhete_leg_added      (AddToSlipButton.onClick após sucesso)
 *   - bilhete_slip_committed (BetSlipProvider.handleCommit após sucesso)
 *   - bilhete_drawer_abandoned (BetSlipDrawer.onClose com legs >= 1)
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ── Mock useTelemetry ─────────────────────────────────────────────────────────
const mockTrack = vi.fn();
vi.mock("@/lib/telemetry/use-telemetry", () => ({
  useTelemetry: () => mockTrack,
}));

// ── Mock next/navigation ──────────────────────────────────────────────────────
const mockRouterRefresh = vi.fn();
const mockRouterPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRouterRefresh,
    push: mockRouterPush,
  }),
}));

// ── Mock bet-slip server actions ──────────────────────────────────────────────
const mockAddLegToSlip = vi.fn();
const mockCommitSlip = vi.fn();
const mockCancelSlip = vi.fn();
const mockRemoveLegFromSlip = vi.fn();
const mockUpdateSlipStake = vi.fn();

vi.mock("@/lib/bet-slip/actions", () => ({
  addLegToSlip: (...args: unknown[]) => mockAddLegToSlip(...args),
  commitSlip: (...args: unknown[]) => mockCommitSlip(...args),
  cancelSlip: (...args: unknown[]) => mockCancelSlip(...args),
  removeLegFromSlip: (...args: unknown[]) => mockRemoveLegFromSlip(...args),
  updateSlipStake: (...args: unknown[]) => mockUpdateSlipStake(...args),
}));

// ── Mock next/cache ───────────────────────────────────────────────────────────
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ── Shared test data ──────────────────────────────────────────────────────────
import type { SlipLeg, BetSlip } from "@/lib/bet-slip/compute";
import type { AddLegInput } from "@/lib/bet-slip/actions";

function makeLeg(id: number, oddTaken = 2.0): SlipLeg {
  return {
    id,
    slip_id: 1,
    fixture_id: 100 + id,
    home_team: "HomeFC",
    away_team: "AwayFC",
    market: "1x2",
    side: "home",
    odd_taken: oddTaken,
    league: "Premier League",
    kickoff_utc: null,
    created_at: "2026-05-27T10:00:00Z",
    ai_recommendation_id: null,
    sport_id: null,
    market_id: null,
  };
}

function makeSlip(legs: SlipLeg[], stakeTotal: number | null = null): BetSlip {
  return {
    id: 1,
    user_id: "user-uuid-1",
    status: "draft",
    stake_total: stakeTotal,
    odd_combined: null,
    potential_return: null,
    bet_id: null,
    thesis: null,
    created_at: "2026-05-27T10:00:00Z",
    updated_at: "2026-05-27T10:00:00Z",
    bet_slip_legs: legs,
  };
}

// ── BetSlipFAB — bilhete_drawer_open ─────────────────────────────────────────
describe("<BetSlipFAB> bilhete_drawer_open", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tracks bilhete_drawer_open with leg_count and odd_combined on click", async () => {
    const { BetSlipFAB } = await import(
      "@/components/bet-slip/bet-slip-fab"
    );
    const legs = [makeLeg(1, 2.0), makeLeg(2, 1.8)];
    const onOpen = vi.fn();

    render(
      <BetSlipFAB legs={legs} oddCombined={3.6} stakeTotal={null} onOpen={onOpen} />,
    );

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(mockTrack).toHaveBeenCalledWith("bilhete_drawer_open", {
      leg_count: 2,
      odd_combined: 3.6,
    });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("fires onOpen even if track call is present", async () => {
    const { BetSlipFAB } = await import(
      "@/components/bet-slip/bet-slip-fab"
    );
    const legs = [makeLeg(1, 1.5)];
    const onOpen = vi.fn();

    render(
      <BetSlipFAB legs={legs} oddCombined={1.5} stakeTotal={50} onOpen={onOpen} />,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(mockTrack).toHaveBeenCalledWith(
      "bilhete_drawer_open",
      expect.objectContaining({ leg_count: 1 }),
    );
  });
});

// ── AddToSlipButton — bilhete_leg_added ───────────────────────────────────────
describe("<AddToSlipButton> bilhete_leg_added", () => {
  beforeEach(() => vi.clearAllMocks());

  const input: AddLegInput = {
    fixture_id: 42,
    home_team: "Arsenal",
    away_team: "Chelsea",
    market: "btts",
    side: "yes",
    odd_taken: 1.75,
    league: "Premier League",
  };

  it("tracks bilhete_leg_added with fixture_id, market, side after success", async () => {
    mockAddLegToSlip.mockResolvedValue({ slipId: 1, legId: 10 });

    const { AddToSlipButton } = await import(
      "@/components/bet-slip/add-to-slip-button"
    );

    render(<AddToSlipButton input={input} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(mockTrack).toHaveBeenCalledWith("bilhete_leg_added", {
      fixture_id: 42,
      market: "btts",
      side: "yes",
    });
  });

  it("does NOT track when addLegToSlip returns error", async () => {
    mockAddLegToSlip.mockResolvedValue({ error: "disciplina bloqueada" });

    const { AddToSlipButton } = await import(
      "@/components/bet-slip/add-to-slip-button"
    );

    render(<AddToSlipButton input={input} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(mockTrack).not.toHaveBeenCalled();
  });
});

// ── BetSlipDrawer — bilhete_drawer_abandoned ──────────────────────────────────
describe("<BetSlipDrawer> bilhete_drawer_abandoned", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tracks bilhete_drawer_abandoned with leg_count when closing with legs", async () => {
    const { BetSlipDrawer } = await import(
      "@/components/bet-slip/bet-slip-drawer"
    );
    const legs = [makeLeg(1, 2.0), makeLeg(2, 1.5)];
    const onClose = vi.fn();

    render(
      <BetSlipDrawer
        legs={legs}
        oddCombined={3.0}
        stakeTotal={null}
        potentialReturn={null}
        conflicts={[]}
        removing={null}
        committing={false}
        onRemoveLeg={vi.fn()}
        onStakeChange={vi.fn()}
        onClose={onClose}
        houses={[{ id: "h1", name: "Bet365" }]}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /fechar bilhete/i }));

    expect(mockTrack).toHaveBeenCalledWith("bilhete_drawer_abandoned", {
      leg_count: 2,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does NOT track when closing with no legs", async () => {
    const { BetSlipDrawer } = await import(
      "@/components/bet-slip/bet-slip-drawer"
    );
    const onClose = vi.fn();

    render(
      <BetSlipDrawer
        legs={[]}
        oddCombined={1.0}
        stakeTotal={null}
        potentialReturn={null}
        conflicts={[]}
        removing={null}
        committing={false}
        onRemoveLeg={vi.fn()}
        onStakeChange={vi.fn()}
        onClose={onClose}
        houses={[]}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /fechar bilhete/i }));

    expect(mockTrack).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ── BetSlipProvider — bilhete_slip_committed ──────────────────────────────────
describe("<BetSlipProvider> bilhete_slip_committed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tracks bilhete_slip_committed on successful commit", async () => {
    mockCommitSlip.mockResolvedValue({ betId: "bet-uuid-123" });
    mockRemoveLegFromSlip.mockResolvedValue({});

    const { BetSlipProvider } = await import(
      "@/components/bet-slip/bet-slip-provider"
    );

    const legs = [makeLeg(1, 2.0), makeLeg(2, 1.8)];
    const slip = makeSlip(legs, 50);

    render(
      <BetSlipProvider
        initialSlip={slip}
        houses={[{ id: "h1", name: "Bet365" }]}
      />,
    );

    // Open drawer by clicking FAB
    fireEvent.click(screen.getByRole("button", { name: /bilhete/i }));

    // Wait for drawer to appear, then click commit
    const commitBtn = await screen.findByRole("button", { name: /commitar/i });

    await act(async () => {
      fireEvent.click(commitBtn);
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "bilhete_slip_committed",
      expect.objectContaining({
        leg_count: 2,
        has_stake: true,
      }),
    );
  });

  it("does NOT track when commitSlip returns error", async () => {
    mockCommitSlip.mockResolvedValue({ error: "Stop-loss atingido" });
    mockRemoveLegFromSlip.mockResolvedValue({});

    const { BetSlipProvider } = await import(
      "@/components/bet-slip/bet-slip-provider"
    );

    const legs = [makeLeg(1, 2.0), makeLeg(2, 1.8)];
    const slip = makeSlip(legs, 50);

    // Suppress alert for this test
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(
      <BetSlipProvider
        initialSlip={slip}
        houses={[{ id: "h1", name: "Bet365" }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /bilhete/i }));
    const commitBtn = await screen.findByRole("button", { name: /commitar/i });

    await act(async () => {
      fireEvent.click(commitBtn);
    });

    expect(mockTrack).not.toHaveBeenCalledWith(
      "bilhete_slip_committed",
      expect.anything(),
    );

    alertSpy.mockRestore();
  });
});
