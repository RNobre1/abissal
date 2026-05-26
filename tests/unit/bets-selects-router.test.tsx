/**
 * TDD — /bets selects onChange → router.push (Wave B fix #5)
 *
 * O bug pré-existente: os selects de liga/mercado em /bets têm `onChange`
 * com `{}` vazio — mudança não navega. Fix: extrair componente client
 * `BetsSelectFilters` que usa `useRouter` + `router.push`.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({
    get: (key: string) => {
      const params: Record<string, string> = {};
      return params[key] ?? null;
    },
    toString: () => "",
  }),
}));

import { BetsSelectFilters } from "@/app/(dashboard)/bets/bets-select-filters";

describe("BetsSelectFilters", () => {
  const leagues = ["Premier League", "La Liga", "Serie A"];
  const markets = [
    { id: "m1", name: "Resultado Final" },
    { id: "m2", name: "Over/Under 2.5" },
  ];

  beforeEach(() => {
    mockPush.mockClear();
  });

  it("renderiza select de liga quando há ligas disponíveis", () => {
    render(
      <BetsSelectFilters
        availableLeagues={leagues}
        availableMarkets={[]}
        currentLeague={undefined}
        currentMarketId={undefined}
        baseHref="/bets"
      />,
    );
    expect(screen.getByLabelText(/liga/i)).toBeInTheDocument();
  });

  it("renderiza select de mercado quando há mercados disponíveis", () => {
    render(
      <BetsSelectFilters
        availableLeagues={[]}
        availableMarkets={markets}
        currentLeague={undefined}
        currentMarketId={undefined}
        baseHref="/bets"
      />,
    );
    expect(screen.getByLabelText(/mercado/i)).toBeInTheDocument();
  });

  it("onChange no select de liga chama router.push com a liga selecionada", () => {
    render(
      <BetsSelectFilters
        availableLeagues={leagues}
        availableMarkets={[]}
        currentLeague={undefined}
        currentMarketId={undefined}
        baseHref="/bets"
      />,
    );
    const select = screen.getByLabelText(/liga/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Premier League" } });
    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockPush.mock.calls[0][0]).toContain("league=Premier+League");
  });

  it("onChange no select de liga com valor vazio navega para URL sem liga", () => {
    render(
      <BetsSelectFilters
        availableLeagues={leagues}
        availableMarkets={[]}
        currentLeague="La Liga"
        currentMarketId={undefined}
        baseHref="/bets"
      />,
    );
    const select = screen.getByLabelText(/liga/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "" } });
    expect(mockPush).toHaveBeenCalledOnce();
    const url = mockPush.mock.calls[0][0] as string;
    expect(url).not.toContain("league=");
  });

  it("onChange no select de mercado chama router.push com market id", () => {
    render(
      <BetsSelectFilters
        availableLeagues={[]}
        availableMarkets={markets}
        currentLeague={undefined}
        currentMarketId={undefined}
        baseHref="/bets"
      />,
    );
    const select = screen.getByLabelText(/mercado/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "m1" } });
    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockPush.mock.calls[0][0]).toContain("market=m1");
  });

  it("preserva outros filtros ativos na URL ao trocar liga", () => {
    render(
      <BetsSelectFilters
        availableLeagues={leagues}
        availableMarkets={markets}
        currentLeague={undefined}
        currentMarketId="m2"
        baseHref="/bets?status=pending"
      />,
    );
    const select = screen.getByLabelText(/liga/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Serie A" } });
    expect(mockPush).toHaveBeenCalledOnce();
    const url = mockPush.mock.calls[0][0] as string;
    expect(url).toContain("league=");
    expect(url).toContain("market=m2");
  });

  it("não renderiza nada quando não há ligas nem mercados", () => {
    const { container } = render(
      <BetsSelectFilters
        availableLeagues={[]}
        availableMarkets={[]}
        currentLeague={undefined}
        currentMarketId={undefined}
        baseHref="/bets"
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
