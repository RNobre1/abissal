/**
 * TDD — Free bet UI: checkbox renders in all 3 forms and submits the flag
 *
 * RED: tests written before implementation.
 * Verifies:
 *  1. PlaceBetForm renders the free bet checkbox
 *  2. BetSlipPageClient renders the free bet checkbox (bilhete)
 *  3. BuilderForm renders the free bet checkbox (builder)
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Mock server actions ─────────────────────────────────────────────────────
vi.mock("@/app/(dashboard)/bets/actions", () => ({
  placeBetAction: vi.fn(),
}));

vi.mock("@/lib/bet-slip/actions", () => ({
  removeLegFromSlip: vi.fn(),
  updateSlipStake: vi.fn(),
  commitSlip: vi.fn(),
  cancelSlip: vi.fn(),
}));

vi.mock("@/app/(dashboard)/bilhete/builder/actions", () => ({
  createBetBuilderAction: vi.fn(),
}));

// Supabase client mock (for BuilderForm fixture search)
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: vi.fn().mockResolvedValue({ data: [] }),
  }),
}));

// next/navigation mock
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// useActionState stub — returns [state, action, false]
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useActionState: (action: unknown, init: unknown) => [init, action, false],
  };
});

// BetSlipPhotoImport mock
vi.mock("@/components/bet-slip/bet-slip-photo-import", () => ({
  BetSlipPhotoImport: () => null,
}));

import { PlaceBetForm } from "@/app/(dashboard)/bets/new/form";
import { BetSlipPageClient } from "@/app/(dashboard)/bilhete/_components/bet-slip-page-client";
import { BuilderForm } from "@/app/(dashboard)/bilhete/builder/_components/builder-form";

// ── fixtures ─────────────────────────────────────────────────────────────────
const HOUSES = [{ id: "h1", name: "Bet365" }];

const SLIP_WITH_LEGS = {
  id: 1,
  user_id: "user-1",
  status: "draft" as const,
  stake_total: 50,
  odd_combined: 3.0,
  potential_return: 150,
  bet_id: null,
  created_at: "2026-05-27T10:00:00Z",
  updated_at: "2026-05-27T10:00:00Z",
  bet_slip_legs: [
    {
      id: 1,
      slip_id: 1,
      home_team: "Flamengo",
      away_team: "Palmeiras",
      market: "Resultado Final",
      side: "Mandante",
      odd_taken: 3.0,
      league: "Brasileirão",
      kickoff_utc: "2026-05-27T20:00:00Z",
      fixture_id: null,
      ai_recommendation_id: null,
      sport_id: null,
      market_id: null,
      created_at: "2026-05-27T10:00:00Z",
    },
    {
      id: 2,
      slip_id: 1,
      home_team: "Real Madrid",
      away_team: "Barcelona",
      market: "Ambas Marcam",
      side: "Sim",
      odd_taken: 1.8,
      league: "La Liga",
      kickoff_utc: "2026-05-27T20:00:00Z",
      fixture_id: null,
      ai_recommendation_id: null,
      sport_id: null,
      market_id: null,
      created_at: "2026-05-27T10:00:00Z",
    },
  ],
};

// ── PlaceBetForm ──────────────────────────────────────────────────────────────
describe("PlaceBetForm — free bet checkbox", () => {
  it("renders the free bet checkbox", () => {
    render(
      <PlaceBetForm
        houses={HOUSES}
        defaultPlacedAt="2026-05-27T10:00"
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: /aposta grátis/i }),
    ).toBeInTheDocument();
  });

  it("free bet checkbox has name=is_free_bet", () => {
    render(
      <PlaceBetForm
        houses={HOUSES}
        defaultPlacedAt="2026-05-27T10:00"
      />,
    );
    const checkbox = screen.getByRole("checkbox", { name: /aposta grátis/i });
    expect(checkbox).toHaveAttribute("name", "is_free_bet");
  });

  it("free bet checkbox is unchecked by default", () => {
    render(
      <PlaceBetForm
        houses={HOUSES}
        defaultPlacedAt="2026-05-27T10:00"
      />,
    );
    const checkbox = screen.getByRole("checkbox", { name: /aposta grátis/i });
    expect(checkbox).not.toBeChecked();
  });
});

// ── BetSlipPageClient (bilhete) ───────────────────────────────────────────────
describe("BetSlipPageClient — free bet checkbox", () => {
  it("renders the free bet checkbox when slip has legs", () => {
    render(
      <BetSlipPageClient
        initialSlip={SLIP_WITH_LEGS}
        houses={HOUSES}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: /aposta grátis/i }),
    ).toBeInTheDocument();
  });

  it("free bet checkbox is unchecked by default", () => {
    render(
      <BetSlipPageClient
        initialSlip={SLIP_WITH_LEGS}
        houses={HOUSES}
      />,
    );
    const checkbox = screen.getByRole("checkbox", { name: /aposta grátis/i });
    expect(checkbox).not.toBeChecked();
  });
});

// ── BuilderForm ───────────────────────────────────────────────────────────────
describe("BuilderForm — free bet checkbox", () => {
  it("renders the free bet checkbox", () => {
    render(<BuilderForm houses={HOUSES} />);
    expect(
      screen.getByRole("checkbox", { name: /aposta grátis/i }),
    ).toBeInTheDocument();
  });

  it("free bet checkbox is unchecked by default", () => {
    render(<BuilderForm houses={HOUSES} />);
    const checkbox = screen.getByRole("checkbox", { name: /aposta grátis/i });
    expect(checkbox).not.toBeChecked();
  });
});
