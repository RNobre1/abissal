import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { OddsCategoryMap } from "@/lib/fixtures/stats/detail-json-types";

/**
 * `next/navigation` mocks — replicated per-test via `vi.mock` factory.
 * `useSearchParams` returns a stub URLSearchParams; `useRouter` returns a
 * spy `replace` we assert in tests. We re-set the spy in beforeEach so
 * each case has a fresh call-list.
 */
const replaceMock = vi.fn();
let currentSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

import { MarketsBrowser } from "@/components/fixtures/stats/panels/markets-browser";

function makeData(): OddsCategoryMap {
  return {
    match: [
      {
        market: "Result",
        outcomes: [
          { name: "Home", decimal_odds: 1.7, bookmaker: "Bet365" },
          { name: "Draw", decimal_odds: 3.5, bookmaker: "Bet365" },
          { name: "Away", decimal_odds: 4.2, bookmaker: "Bet365" },
        ],
      },
      {
        market: "BTTS",
        outcomes: [
          { name: "Yes", decimal_odds: 1.85, bookmaker: "Pinnacle" },
          { name: "No", decimal_odds: 1.95, bookmaker: "Pinnacle" },
        ],
      },
      {
        market: "Match Goals Overs/Unders",
        outcomes: [
          { name: "Over 2.5", decimal_odds: 1.9, bookmaker: "Bet365" },
          { name: "Under 2.5", decimal_odds: 1.9, bookmaker: "Bet365" },
        ],
      },
    ],
    cards: [
      {
        market: "Total Cards Over/Under",
        outcomes: [
          { name: "Over 5.5", decimal_odds: 2.1, bookmaker: "Bet365" },
          { name: "Under 5.5", decimal_odds: 1.8, bookmaker: "Bet365" },
        ],
      },
    ],
    corners: [
      {
        market: "Total Corners Over/Under",
        outcomes: [
          { name: "Over 9.5", decimal_odds: 1.95, bookmaker: "Bet365" },
        ],
      },
    ],
    "player-props": [
      {
        market: "Player Goals",
        outcomes: [{ name: "Haaland 1+", decimal_odds: 1.5, bookmaker: "Bet365" }],
      },
    ],
  };
}

describe("<MarketsBrowser />", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    currentSearch = "";
  });

  it("returns null when odds_summary is empty", () => {
    const { container } = render(<MarketsBrowser data={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a button with the total number of markets when populated", () => {
    render(<MarketsBrowser data={makeData()} />);
    // 6 markets across 4 categories in fixture
    const btn = screen.getByRole("button", { name: /ver todos.*6/i });
    expect(btn).toBeDefined();
  });

  it("renders headline market cards inline (Result, BTTS, Match Goals O/U 2.5, Total Cards Over 5.5)", () => {
    render(<MarketsBrowser data={makeData()} />);
    // Inline headline cards: each should render in the panel (not in dialog).
    const headlines = screen.getAllByTestId("markets-headline-card");
    expect(headlines.length).toBeGreaterThanOrEqual(3);
    expect(headlines.length).toBeLessThanOrEqual(6);
    const text = headlines.map((h) => h.textContent ?? "").join("\n");
    expect(text).toMatch(/Result/i);
    expect(text).toMatch(/BTTS/i);
    expect(text).toMatch(/Match Goals/i);
    expect(text).toMatch(/Total Cards/i);
  });

  it("does not open the dialog by default", () => {
    render(<MarketsBrowser data={makeData()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the dialog on click and shows the 6 category chips", () => {
    render(<MarketsBrowser data={makeData()} />);
    fireEvent.click(screen.getByRole("button", { name: /ver todos/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute("aria-label")).toMatch(/mercados/i);
    // 6 chips for the 6 fixed categories
    const chips = screen.getAllByTestId("markets-cat-chip");
    expect(chips.length).toBe(6);
    const labels = chips.map((c) => c.textContent ?? "");
    expect(labels.some((l) => /match/i.test(l))).toBe(true);
    expect(labels.some((l) => /halves/i.test(l))).toBe(true);
    expect(labels.some((l) => /teams/i.test(l))).toBe(true);
    expect(labels.some((l) => /corners/i.test(l))).toBe(true);
    expect(labels.some((l) => /cards/i.test(l))).toBe(true);
    expect(labels.some((l) => /player[- ]props/i.test(l))).toBe(true);
  });

  it("shows market list of the active category in the drawer", () => {
    render(<MarketsBrowser data={makeData()} />);
    fireEvent.click(screen.getByRole("button", { name: /ver todos/i }));
    // Default active = first available cat (match) → list shows match markets.
    const items = screen.getAllByTestId("markets-list-item");
    expect(items.length).toBe(3); // match has 3 markets
    expect(items[0].textContent).toMatch(/Result|BTTS|Match Goals/);
  });

  it("clicking a category chip updates the URL via router.replace", () => {
    render(<MarketsBrowser data={makeData()} />);
    fireEvent.click(screen.getByRole("button", { name: /ver todos/i }));
    const chips = screen.getAllByTestId("markets-cat-chip");
    const playerPropsChip = chips.find((c) =>
      /player[- ]props/i.test(c.textContent ?? "")
    )!;
    fireEvent.click(playerPropsChip);
    expect(replaceMock).toHaveBeenCalled();
    const arg = replaceMock.mock.calls[0][0] as string;
    expect(arg).toMatch(/markets_cat=player-props/);
    // scroll:false option preserved
    const opts = replaceMock.mock.calls[0][1] as { scroll: boolean } | undefined;
    expect(opts?.scroll).toBe(false);
  });

  it("filters the list to the category from the URL param", () => {
    currentSearch = "markets_cat=corners";
    render(<MarketsBrowser data={makeData()} />);
    fireEvent.click(screen.getByRole("button", { name: /ver todos/i }));
    const items = screen.getAllByTestId("markets-list-item");
    expect(items.length).toBe(1); // corners has 1 market
    expect(items[0].textContent).toMatch(/Total Corners/i);
  });

  it("renders bookmaker + decimal_odds for each outcome inside the dialog", () => {
    render(<MarketsBrowser data={makeData()} />);
    fireEvent.click(screen.getByRole("button", { name: /ver todos/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/Bet365/);
    expect(dialog.textContent).toMatch(/1\.7/);
  });
});
