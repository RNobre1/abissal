/**
 * TDD — SelectionsList
 *
 * Tests: bet_builder display — single event_label header, legs without
 * individual odd column; multiple (regular) display — original behaviour.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { SelectionsList } from "@/app/(dashboard)/bets/[id]/selections-list";

// ── helpers ───────────────────────────────────────────────────────────────────

type SelectionRow = Parameters<typeof SelectionsList>[0]["selections"][number];

function makeSelection(overrides: Partial<SelectionRow> = {}): SelectionRow {
  return {
    id: "sel-1",
    bet_id: "bet-1",
    user_id: "user-1",
    event_label: "Flamengo × Palmeiras",
    selection_label: "Mais 10.5 / Chutes no gol",
    odds: 5.5,
    odd_taken: null,
    status: "pending",
    position_index: 0,
    created_at: null,
    event_date: null,
    league: null,
    market_id: null,
    sport_id: null,
    ...overrides,
  };
}

// ── bet_builder display ───────────────────────────────────────────────────────

describe("SelectionsList — bet_builder kind", () => {
  it("renders a single event_label header when all selections share the same event_label", () => {
    const selections: SelectionRow[] = [
      makeSelection({ id: "s1", position_index: 0, selection_label: "Mais 10.5 / Chutes no gol" }),
      makeSelection({ id: "s2", position_index: 1, selection_label: "Mais 7.5 / Escanteios" }),
      makeSelection({ id: "s3", position_index: 2, selection_label: "Mais 1.5 / Cartões Bolívar" }),
    ];
    render(<SelectionsList selections={selections} kind="bet_builder" />);

    // Event label appears exactly once as a heading
    const headings = screen.getAllByText("Flamengo × Palmeiras");
    expect(headings).toHaveLength(1);
  });

  it("renders all 3 selection_labels as list items", () => {
    const selections: SelectionRow[] = [
      makeSelection({ id: "s1", position_index: 0, selection_label: "Mais 10.5 / Chutes no gol" }),
      makeSelection({ id: "s2", position_index: 1, selection_label: "Mais 7.5 / Escanteios" }),
      makeSelection({ id: "s3", position_index: 2, selection_label: "Mais 1.5 / Cartões" }),
    ];
    render(<SelectionsList selections={selections} kind="bet_builder" />);

    expect(screen.getByText("Mais 10.5 / Chutes no gol")).toBeInTheDocument();
    expect(screen.getByText("Mais 7.5 / Escanteios")).toBeInTheDocument();
    expect(screen.getByText("Mais 1.5 / Cartões")).toBeInTheDocument();
  });

  it("does NOT render individual odds for bet_builder selections", () => {
    const selections: SelectionRow[] = [
      makeSelection({ id: "s1", odds: 5.5, selection_label: "Ambas Marcam / Sim" }),
    ];
    render(<SelectionsList selections={selections} kind="bet_builder" />);

    // The individual odd value must not appear (e.g. "@ 5.50")
    expect(screen.queryByText(/@ 5/)).not.toBeInTheDocument();
  });
});

// ── multiple (regular) display ────────────────────────────────────────────────

describe("SelectionsList — multiple kind", () => {
  it("shows event_label per row (not a shared header)", () => {
    const selections: SelectionRow[] = [
      makeSelection({ id: "s1", event_label: "Flamengo × Palmeiras", selection_label: "1X2 Casa", odds: 2.1 }),
      makeSelection({ id: "s2", event_label: "Botafogo × Vasco", selection_label: "Ambas Marcam", odds: 1.8 }),
    ];
    render(<SelectionsList selections={selections} kind="multiple" />);

    expect(screen.getByText("Flamengo × Palmeiras")).toBeInTheDocument();
    expect(screen.getByText("Botafogo × Vasco")).toBeInTheDocument();
  });

  it("shows individual odds for regular selections", () => {
    const selections: SelectionRow[] = [
      makeSelection({ id: "s1", odds: 2.1, selection_label: "1X2 Casa" }),
    ];
    render(<SelectionsList selections={selections} kind="multiple" />);

    expect(screen.getByText(/@ 2/)).toBeInTheDocument();
  });
});
