/**
 * FixturesBrowser — filtro/ordenação/busca/view client-side da tela de jogos.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FixturesBrowser } from "@/components/fixtures/fixtures-browser";
import type { FixtureDTO } from "@/lib/fixtures/types";

function fx({ id, ...over }: Partial<FixtureDTO> & { id: number }): FixtureDTO {
  return {
    id,
    match_date: "2026-05-30",
    ko_time: "16:00",
    home_team: "Home",
    away_team: "Away",
    league: "Premier League",
    country: "england",
    source_url: null,
    has_detail: true,
    kickoff_utc: "2026-05-30T19:00:00Z",
    ...over,
  };
}

const FIXTURES: FixtureDTO[] = [
  fx({ id: 1, home_team: "Arsenal", away_team: "Chelsea", league: "Premier League", country: "england", kickoff_utc: "2026-05-30T16:00:00Z", ai_has_bet: true, ai_edge_pct: 18 }),
  fx({ id: 2, home_team: "Flamengo", away_team: "Palmeiras", league: "Serie A", country: "brazil", kickoff_utc: "2026-05-30T21:00:00Z", ai_no_value: true }),
  fx({ id: 3, home_team: "Spurs", away_team: "Everton", league: "Premier League", country: "england", kickoff_utc: "2026-05-30T18:00:00Z" }),
];

function cards(): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll('a[href^="/fixtures/"]')) as HTMLAnchorElement[];
}

beforeEach(() => {
  window.history.replaceState(null, "", "/fixtures?date=today");
  window.localStorage.clear();
});

describe("<FixturesBrowser>", () => {
  it("renderiza todos os jogos por padrão (agrupado) + contador", () => {
    render(<FixturesBrowser fixtures={FIXTURES} />);
    expect(cards()).toHaveLength(3);
    expect(document.querySelectorAll("[data-league-group]").length).toBeGreaterThan(0);
    expect(screen.getByText(/3 de 3/)).toBeTruthy();
  });

  it("busca por time filtra a lista", () => {
    render(<FixturesBrowser fixtures={FIXTURES} />);
    fireEvent.change(screen.getByLabelText(/buscar time/i), { target: { value: "flamen" } });
    const links = cards();
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/fixtures/2");
  });

  it("filtro de IA 'aposta' mostra só fixtures com bet", () => {
    render(<FixturesBrowser fixtures={FIXTURES} />);
    fireEvent.click(screen.getByRole("button", { name: /aposta/i }));
    const links = cards();
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/fixtures/1");
  });

  it("toggle de view muda grouped -> flat (some o header de liga)", () => {
    const { container } = render(<FixturesBrowser fixtures={FIXTURES} />);
    expect(container.querySelector("[data-fixtures-view]")?.getAttribute("data-fixtures-view")).toBe("grouped");
    fireEvent.click(screen.getByRole("button", { name: /^tempo$/i }));
    expect(container.querySelector("[data-fixtures-view]")?.getAttribute("data-fixtures-view")).toBe("flat");
    expect(document.querySelectorAll("[data-league-group]").length).toBe(0);
    expect(cards()).toHaveLength(3); // ainda todos, só sem agrupar
  });

  it("empty-state quando os filtros excluem tudo", () => {
    render(<FixturesBrowser fixtures={FIXTURES} />);
    fireEvent.change(screen.getByLabelText(/buscar time/i), { target: { value: "zzzznada" } });
    expect(cards()).toHaveLength(0);
    expect(screen.getByText(/nenhum jogo/i)).toBeTruthy();
  });

  it("limpar reseta os filtros", () => {
    render(<FixturesBrowser fixtures={FIXTURES} />);
    fireEvent.change(screen.getByLabelText(/buscar time/i), { target: { value: "flamen" } });
    expect(cards()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /limpar/i }));
    expect(cards()).toHaveLength(3);
  });

  it("repassa high_signal e edge da IA pro card (migrado de FixturesList)", () => {
    render(<FixturesBrowser fixtures={FIXTURES} />);
    const arsenal = cards().find((a) => a.textContent?.includes("Arsenal"))!;
    expect(arsenal.getAttribute("data-high-signal")).toBeNull(); // id 1 não é high_signal
    // o chip de IA do Arsenal (bet, edge 18) mostra o edge
    expect(arsenal.textContent).toContain("18");
  });

  it("desambigua mesma liga em países diferentes (2 grupos)", () => {
    render(
      <FixturesBrowser
        fixtures={[
          fx({ id: 10, league: "Premier League", country: "england" }),
          fx({ id: 11, league: "Premier League", country: "ukraine" }),
        ]}
      />,
    );
    expect(document.querySelectorAll("[data-league-group]").length).toBe(2);
  });
});
