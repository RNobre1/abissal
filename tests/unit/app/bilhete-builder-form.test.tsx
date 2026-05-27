/**
 * TDD — BuilderForm
 *
 * Tests: render form, add/remove leg, parse query params pre-filled.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── stubs ─────────────────────────────────────────────────────────────────────
vi.mock("@/app/(dashboard)/bilhete/builder/actions", () => ({
  createBetBuilderAction: vi.fn().mockResolvedValue({ ok: true, bet_id: "abc" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Stub supabase client — form calls RPC directly (no match-fixture import)
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  }),
}));

import { BuilderForm } from "@/app/(dashboard)/bilhete/builder/_components/builder-form";

const HOUSES = [
  { id: "h1", name: "Betano" },
  { id: "h2", name: "Bet365" },
];

// ── render ────────────────────────────────────────────────────────────────────
describe("BuilderForm — render", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders house select with options", () => {
    render(<BuilderForm houses={HOUSES} />);
    // Find the combobox (select element) — there's one house select
    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("option", { name: "Betano" })).toBeInTheDocument();
  });

  it("renders odd combinada input", () => {
    render(<BuilderForm houses={HOUSES} />);
    expect(screen.getByLabelText(/odd combinada/i)).toBeInTheDocument();
  });

  it("renders stake input", () => {
    render(<BuilderForm houses={HOUSES} />);
    expect(screen.getByLabelText(/stake/i)).toBeInTheDocument();
  });

  it("renders at least one leg row on mount", () => {
    render(<BuilderForm houses={HOUSES} />);
    // There should be a market and side field from the default leg
    const marketInputs = screen.getAllByPlaceholderText(/mercado/i);
    expect(marketInputs.length).toBeGreaterThanOrEqual(1);
  });

  it("renders Salvar como Bet Builder button", () => {
    render(<BuilderForm houses={HOUSES} />);
    expect(
      screen.getByRole("button", { name: /salvar como bet builder/i }),
    ).toBeInTheDocument();
  });

  it("renders cancel link back to /bilhete", () => {
    render(<BuilderForm houses={HOUSES} />);
    const cancelLink = screen.getByRole("link", { name: /cancelar/i });
    expect(cancelLink).toHaveAttribute("href", "/bilhete");
  });
});

// ── add / remove leg ──────────────────────────────────────────────────────────
describe("BuilderForm — add/remove leg", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds a new leg row when '+ adicionar condição' is clicked", () => {
    render(<BuilderForm houses={HOUSES} />);
    const addBtn = screen.getByRole("button", { name: /adicionar condição/i });
    fireEvent.click(addBtn);
    const marketInputs = screen.getAllByPlaceholderText(/mercado/i);
    expect(marketInputs).toHaveLength(2);
  });

  it("removes a leg when × is clicked (only if >1 leg remains)", () => {
    render(<BuilderForm houses={HOUSES} />);
    // Add one leg first so we have 2
    const addBtn = screen.getByRole("button", { name: /adicionar condição/i });
    fireEvent.click(addBtn);
    expect(screen.getAllByPlaceholderText(/mercado/i)).toHaveLength(2);

    // Remove the second leg
    const removeBtns = screen.getAllByRole("button", { name: /remover/i });
    fireEvent.click(removeBtns[1]!);
    expect(screen.getAllByPlaceholderText(/mercado/i)).toHaveLength(1);
  });

  it("does not show remove button when only 1 leg remains", () => {
    render(<BuilderForm houses={HOUSES} />);
    // With 1 leg, the remove button should not be visible
    const removeBtns = screen.queryAllByRole("button", { name: /remover/i });
    expect(removeBtns).toHaveLength(0);
  });
});

// ── query param pre-fill ──────────────────────────────────────────────────────
describe("BuilderForm — query param pre-fill", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pre-fills odd and stake from query params", () => {
    vi.doMock("next/navigation", () => ({
      useRouter: () => ({ push: vi.fn() }),
      useSearchParams: () =>
        new URLSearchParams("odd=5.5&stake=20&house=h1"),
    }));

    // Re-import with mocked params
    const params = new URLSearchParams("odd=5.5&stake=20");
    render(<BuilderForm houses={HOUSES} initialParams={params} />);

    const oddInput = screen.getByLabelText(/odd combinada/i) as HTMLInputElement;
    const stakeInput = screen.getByLabelText(/stake/i) as HTMLInputElement;
    expect(oddInput.value).toBe("5.5");
    expect(stakeInput.value).toBe("20");
  });

  it("pre-fills legs from query param JSON", () => {
    const legs = [
      { market: "Mais 10.5", side: "Chutes no gol" },
      { market: "Ambas Marcam", side: "Sim" },
    ];
    const params = new URLSearchParams(`legs=${encodeURIComponent(JSON.stringify(legs))}`);
    render(<BuilderForm houses={HOUSES} initialParams={params} />);

    const marketInputs = screen.getAllByPlaceholderText(/mercado/i) as HTMLInputElement[];
    expect(marketInputs).toHaveLength(2);
    expect(marketInputs[0]!.value).toBe("Mais 10.5");
    expect(marketInputs[1]!.value).toBe("Ambas Marcam");
  });

  it("pre-fills home and away from query params", () => {
    const params = new URLSearchParams("home=Bolívar&away=Independiente");
    render(<BuilderForm houses={HOUSES} initialParams={params} />);

    const homeInput = screen.getByPlaceholderText(/time da casa/i) as HTMLInputElement;
    const awayInput = screen.getByPlaceholderText(/time visitante/i) as HTMLInputElement;
    expect(homeInput.value).toBe("Bolívar");
    expect(awayInput.value).toBe("Independiente");
  });
});
