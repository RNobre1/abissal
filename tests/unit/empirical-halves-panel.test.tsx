/**
 * B17: painel novo precisa de teste de componente. Cobre o painel de
 * frequência empírica por tempo (gols 100% / escanteios ~53%, "X/Y").
 */
import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import { EmpiricalHalves } from "@/components/fixtures/stats/panels/empirical-halves";
import type { NormalizedRecentMatch } from "@/lib/fixtures/stats/detail-json-types";

function m(over: Partial<NormalizedRecentMatch>): NormalizedRecentMatch {
  return {
    id: 0,
    date_iso: "2026-05-01",
    opponent: "X",
    is_home: true,
    result: null,
    goals_1h_for: null,
    goals_2h_for: null,
    goals_1h_against: null,
    goals_2h_against: null,
    goals_ft_for: null,
    goals_ft_against: null,
    corners_1h_for: null,
    corners_2h_for: null,
    corners_1h_against: null,
    corners_2h_against: null,
    corners_for: null,
    corners_against: null,
    cards_1h_for: null,
    cards_2h_for: null,
    cards_1h_against: null,
    cards_2h_against: null,
    cards_for: null,
    cards_against: null,
    sot_for: null,
    sot_against: null,
    shots_for: null,
    shots_against: null,
    booking_points_for: null,
    booking_points_against: null,
    fouls_for: null,
    fouls_against: null,
    offsides_for: null,
    offsides_against: null,
    ...over,
  };
}

function rowCell(container: HTMLElement, metric: string, side: "home" | "away") {
  const tr = container.querySelector(`tr[data-metric="${metric}"]`);
  if (!tr) throw new Error(`linha ${metric} não encontrada`);
  const td = tr.querySelector(`td[data-side="${side}"]`);
  return td?.textContent?.trim();
}

describe("EmpiricalHalves", () => {
  const home = [
    m({ goals_1h_for: 2, goals_2h_for: 1, corners_1h_for: 3, corners_2h_for: 2 }),
    m({ goals_1h_for: 0, goals_2h_for: 2, corners_1h_for: 1, corners_2h_for: 4 }),
    m({ goals_1h_for: 2, goals_2h_for: 0 }), // sem escanteios por tempo
  ];
  const away = [m({ goals_1h_for: 1, goals_2h_for: 1 })];

  it("renderiza nomes dos times no cabeçalho", () => {
    const { getByText } = render(
      <EmpiricalHalves homeTeam="Arsenal" awayTeam="Chelsea" home={home} away={away} />,
    );
    expect(getByText("Arsenal")).toBeTruthy();
    expect(getByText("Chelsea")).toBeTruthy();
  });

  it("gols 2+ 1ºT usa 100% dos jogos (3 elegíveis, 2 feitos)", () => {
    const { container } = render(
      <EmpiricalHalves homeTeam="A" awayTeam="B" home={home} away={away} />,
    );
    expect(rowCell(container, "Gol 2+ 1ºT", "home")).toContain("2/3");
  });

  it("escanteio 2+ 1ºT conta só os jogos com split (2 elegíveis, 1 feito)", () => {
    const { container } = render(
      <EmpiricalHalves homeTeam="A" awayTeam="B" home={home} away={away} />,
    );
    expect(rowCell(container, "Escanteio 2+ 1ºT", "home")).toContain("1/2");
  });

  it("sem dados → célula '—' (honesto, não 0%)", () => {
    const { container } = render(
      <EmpiricalHalves homeTeam="A" awayTeam="B" home={home} away={away} />,
    );
    // away não tem escanteios por tempo em nenhum jogo
    expect(rowCell(container, "Cantos 2+/2+", "away")).toBe("—");
  });
});
