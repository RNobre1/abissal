/**
 * Painel G+ · players — testes do ranking interativo + scatter.
 *
 * Cobertura visada (T6 acceptance):
 *   - chips de critério mudam ranking (URL update)
 *   - top 5 home + top 5 away
 *   - injured: true → ícone red
 *   - scatter ScatterChart com dots por lado
 *   - empty state quando ausente
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  Players,
  PlayerScatterTooltip,
} from "@/components/fixtures/stats/panels/players";
import type { Player } from "@/lib/fixtures/stats/detail-json-types";

const replaceMock = vi.fn();
const searchParamsState = { current: new URLSearchParams("") };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParamsState.current,
  usePathname: () => "/fixtures/123/stats",
}));

function mkPlayer(
  name: string,
  goals: number,
  yellows: number,
  reds: number = 0,
  minutes: number = 900,
  assists: number = 0,
  injured: boolean = false,
  sot: number = 0,
  first_cards: number = 0,
): Player {
  return {
    name,
    injured,
    played: 10,
    started: 9,
    subs: 1,
    minutes,
    goals,
    goals_1h: 0,
    goals_2h: goals,
    first_goals: 0,
    assists,
    yellows,
    reds,
    cards_1h: 0,
    cards_2h: yellows,
    first_cards,
    total_shots: sot * 2,
    shots_on_target: sot,
    tackles: 5,
    fouls_committed: 8,
    fouls_drawn: 6,
    offsides: 1,
  };
}

const HOME_PLAYERS: Player[] = [
  mkPlayer("H1 Striker", 9, 2, 0, 1100, 3),
  mkPlayer("H2 Winger", 7, 4, 0, 950, 5, true /* injured */),
  mkPlayer("H3 Mid", 4, 1, 0, 1200, 6),
  mkPlayer("H4 Mid", 3, 3, 0, 800, 4),
  mkPlayer("H5 Def", 2, 5, 1, 1300, 1),
  mkPlayer("H6 GK", 0, 0, 0, 900, 0),
];

const AWAY_PLAYERS: Player[] = [
  mkPlayer("A1 Striker", 11, 1, 0, 1000, 4),
  mkPlayer("A2 Winger", 6, 3, 0, 950, 7),
  mkPlayer("A3 Mid", 3, 2, 0, 1100, 5),
  mkPlayer("A4 Def", 1, 6, 1, 1200, 1),
  mkPlayer("A5 Def", 0, 4, 0, 950, 0),
];

beforeEach(() => {
  replaceMock.mockClear();
  searchParamsState.current = new URLSearchParams("");
});

afterEach(() => {
  cleanup();
});

describe("<Players />", () => {
  it("default rank=goals ordena top 5 por gols", () => {
    render(
      <Players homeTeam="Tot" awayTeam="Lee" home={HOME_PLAYERS} away={AWAY_PLAYERS} width={400} height={240} />,
    );
    // Top 5 home começa por H1 (9 gols) e termina antes de H6 (0 gols).
    const homeCol = screen.getByTestId("players-home");
    expect(homeCol.textContent).toContain("H1 Striker");
    expect(homeCol.textContent).not.toContain("H6 GK");
  });

  it("chip 'cards' muda ranking e atualiza URL", async () => {
    render(
      <Players homeTeam="Tot" awayTeam="Lee" home={HOME_PLAYERS} away={AWAY_PLAYERS} width={400} height={240} />,
    );
    const chip = screen.getByRole("button", { name: /^cards$/i });
    await act(async () => {
      fireEvent.click(chip);
    });
    // After cards selected → H5 (5y+1r*2 = 7) should top home column.
    const homeCol = screen.getByTestId("players-home");
    // Garante que H5 ficou no topo (primeiro <li>).
    const rows = homeCol.querySelectorAll("[data-testid='player-row']");
    expect(rows[0]?.textContent).toContain("H5 Def");
    expect(replaceMock).toHaveBeenCalled();
    const lastCall = replaceMock.mock.calls.at(-1)![0] as string;
    expect(lastCall).toMatch(/player_rank=cards/);
  });

  it("jogador injured: true renderiza ícone de injury", () => {
    render(
      <Players homeTeam="Tot" awayTeam="Lee" home={HOME_PLAYERS} away={AWAY_PLAYERS} width={400} height={240} />,
    );
    // H2 Winger é injured.
    const homeCol = screen.getByTestId("players-home");
    const h2Row = Array.from(homeCol.querySelectorAll("[data-testid='player-row']")).find(
      (r) => r.textContent?.includes("H2 Winger"),
    );
    expect(h2Row).toBeDefined();
    expect(h2Row!.querySelector("[data-testid='injury-icon']")).not.toBeNull();
  });

  it("renderiza scatter min × eficiência abaixo dos rankings", () => {
    const { container } = render(
      <Players homeTeam="Tot" awayTeam="Lee" home={HOME_PLAYERS} away={AWAY_PLAYERS} width={400} height={240} />,
    );
    // recharts <Scatter> → <g class="recharts-scatter"> (1 por side).
    const groups = container.querySelectorAll("g.recharts-scatter");
    expect(groups.length).toBeGreaterThanOrEqual(2);
  });

  it("hidrata player_rank a partir do searchParams", () => {
    searchParamsState.current = new URLSearchParams("player_rank=assists");
    render(
      <Players homeTeam="Tot" awayTeam="Lee" home={HOME_PLAYERS} away={AWAY_PLAYERS} width={400} height={240} />,
    );
    const homeCol = screen.getByTestId("players-home");
    const rows = homeCol.querySelectorAll("[data-testid='player-row']");
    expect(rows[0]?.textContent).toContain("H3 Mid");
  });

  it("empty state quando ambos os times sem jogadores", () => {
    render(<Players homeTeam="Tot" awayTeam="Lee" home={[]} away={[]} width={400} height={240} />);
    expect(screen.getByText(/sem dados/i)).toBeDefined();
  });

  it("apenas home populado: away renderiza fallback inline", () => {
    render(
      <Players homeTeam="Tot" awayTeam="Lee" home={HOME_PLAYERS} away={[]} width={400} height={240} />,
    );
    expect(screen.getByTestId("players-home")).toBeDefined();
    expect(screen.getByTestId("players-away")).toBeDefined();
    expect(screen.getByTestId("players-away").textContent?.toLowerCase()).toContain("sem dados");
  });

  it("renderiza TeamLegend com os dois times no scatter", () => {
    const { container } = render(
      <Players homeTeam="Tottenham" awayTeam="Leeds" home={HOME_PLAYERS} away={AWAY_PLAYERS} width={400} height={240} />,
    );
    const legend = container.querySelector("[data-team-legend]");
    expect(legend).not.toBeNull();
    expect(legend!.textContent).toContain("Tottenham");
    expect(legend!.textContent).toContain("Leeds");
  });

  it("scatter tem eixos rotulados e InfoPopover de leitura", () => {
    const { container } = render(
      <Players homeTeam="Tot" awayTeam="Lee" home={HOME_PLAYERS} away={AWAY_PLAYERS} width={400} height={240} />,
    );
    expect(container.textContent).toContain("Minutos jogados");
    expect(container.textContent).toContain("Decisivo /90min");
    expect(screen.getByRole("button", { name: /como ler/i })).toBeInTheDocument();
  });

  it("scatter desenha linhas de mediana (quadrantes) + rótulo titular decisivo", () => {
    const { container } = render(
      <Players homeTeam="Tot" awayTeam="Lee" home={HOME_PLAYERS} away={AWAY_PLAYERS} width={400} height={240} />,
    );
    // recharts <ReferenceLine> renderiza <line class="recharts-reference-line-line">
    const refs = container.querySelectorAll("line.recharts-reference-line-line");
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain("titular decisivo");
  });
});

describe("<PlayerScatterTooltip />", () => {
  it("formata minutos com fmtInt e eff com fmtNum (nunca float cru)", () => {
    render(
      <PlayerScatterTooltip
        active
        payload={[
          {
            payload: {
              x: 2480,
              y: 0.4525455688246386,
              name: "M. Salah",
              sideName: "Leeds",
            },
          },
        ]}
      />,
    );
    expect(screen.getByText("M. Salah · Leeds")).toBeInTheDocument();
    expect(screen.getByText("2.480")).toBeInTheDocument();
    expect(screen.getByText("0.45")).toBeInTheDocument();
    expect(screen.queryByText("0.4525455688246386")).not.toBeInTheDocument();
  });

  it("inativo → não renderiza nada", () => {
    const { container } = render(<PlayerScatterTooltip active={false} />);
    expect(container.querySelector("[data-rich-tooltip]")).toBeNull();
  });
});
