/**
 * B17: UI nova precisa de teste de componente. Cobre o "caça-valor" de jogador
 * no SimulationPanel — prob do sim vs odd da casa (não é recomendação da IA,
 * não calibrado, sem histórico). Ver lib/fixtures/stats/player-market-value.ts.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SimulationPanel } from "@/app/(dashboard)/fixtures/[id]/_components/simulation-panel";
import type { FixtureSimulationDTO } from "@/lib/fixtures/simulation-repository";

function simWith(playerEvents: unknown[]): FixtureSimulationDTO {
  return {
    id: 1,
    created_at: null,
    fixture_id: 1,
    home_team: "Casa",
    away_team: "Fora",
    league: "L",
    kickoff_utc: null,
    model_version: "sim-v7",
    p_home: 0.5,
    p_draw: 0.25,
    p_away: 0.25,
    p_btts: 0.5,
    p_over_25: 0.5,
    top_scorelines: [],
    sim_stats: null,
    per_half_available: false,
    market_anchor: null,
    player_events: playerEvents,
    status: "simulated",
    actual_home_goals: null,
    actual_away_goals: null,
    correct_winner: null,
  } as unknown as FixtureSimulationDTO;
}

const player = {
  name: "Saka",
  p_goal: 0.35,
  expected_goals: 0.4,
  p_card: 0.1,
  p_sot: 0.6,
  provavel_titular: true,
  confidence: "alto",
};

describe("SimulationPanel — caça-valor de jogador", () => {
  it("mostra SOT (chute) do jogador na linha de stats", () => {
    render(
      <SimulationPanel
        sim={simWith([player])}
        homeTeam="Casa"
        awayTeam="Fora"
        sampleSize={{ home: 20, away: 20 }}
        chrome="bare"
      />,
    );
    // "chute 60%" do p_sot=0.6
    expect(screen.getByText(/chute 60%/)).toBeTruthy();
  });

  it("com odd, mostra hint sim×implícita e marca ▲ quando há valor", () => {
    render(
      <SimulationPanel
        sim={simWith([player])}
        homeTeam="Casa"
        awayTeam="Fora"
        sampleSize={{ home: 20, away: 20 }}
        playerOdds={{ Saka: { ANYTIME_SCORER: 4.0 } }} // implícito 25% < sim 35% → valor
        chrome="bare"
      />,
    );
    const hint = document.querySelector('[data-player-value] [data-market="gol"]');
    expect(hint).toBeTruthy();
    expect(hint!.getAttribute("data-value")).toBe("true");
    expect(within(hint as HTMLElement).getByText("▲")).toBeTruthy();
  });

  it("sem odds do jogador, não renderiza o bloco de valor", () => {
    render(
      <SimulationPanel
        sim={simWith([player])}
        homeTeam="Casa"
        awayTeam="Fora"
        sampleSize={{ home: 20, away: 20 }}
        chrome="bare"
      />,
    );
    expect(document.querySelector("[data-player-value]")).toBeNull();
  });

  it("odd sem valor (implícita ≥ sim) não marca ▲", () => {
    render(
      <SimulationPanel
        sim={simWith([player])}
        homeTeam="Casa"
        awayTeam="Fora"
        sampleSize={{ home: 20, away: 20 }}
        playerOdds={{ Saka: { ANYTIME_SCORER: 2.5 } }} // implícito 40% > sim 35% → sem valor
        chrome="bare"
      />,
    );
    const hint = document.querySelector('[data-player-value] [data-market="gol"]');
    expect(hint).toBeTruthy();
    expect(hint!.getAttribute("data-value")).toBe("false");
  });
});
