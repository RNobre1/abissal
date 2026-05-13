/**
 * Painel F · streaks-heatmap — testes da camada interativa.
 *
 * Cobertura visada (T6 acceptance):
 *   - chips toggle (multi-select, URL update)
 *   - slider min_perc atualiza filtro
 *   - cmdk abre via botão local "buscar streak" e filtra textualmente
 *     (⌘K global pertence ao CommandPalette do dashboard; não duplicar listener)
 *   - heatmap renderiza 1 cell por streak filtrado
 *   - virtualizer cria container scrollável
 *   - empty state + "limpar filtros" botão
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StreaksHeatmap } from "@/components/fixtures/stats/panels/streaks-heatmap";
import type { Streak, StreakIndex } from "@/lib/fixtures/stats/detail-json-types";

// next/navigation mock — captura calls em `replaceMock`.
const replaceMock = vi.fn();
const searchParamsState = { current: new URLSearchParams("") };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParamsState.current,
  usePathname: () => "/fixtures/123/stats",
}));

function mkStreak(
  desc: string,
  group: string,
  stat_type: string,
  overall_perc: number,
): Streak {
  return {
    desc,
    group,
    stat_type,
    line: 0.5,
    colour: "positive",
    overall_count: 8,
    overall_fixtures: 10,
    overall_perc,
    overall_streak: 4,
    home_count: 4,
    home_fixtures: 5,
    home_perc: overall_perc,
    home_streak: 2,
    away_count: 4,
    away_fixtures: 5,
    away_perc: overall_perc,
    away_streak: 2,
  };
}

function mkIndex(streaks: Streak[]): StreakIndex {
  const by_group: Record<string, Streak[]> = {};
  for (const s of streaks) {
    if (!by_group[s.group]) by_group[s.group] = [];
    by_group[s.group].push(s);
  }
  return { all: streaks, by_group };
}

const ALL_STREAKS: Streak[] = [
  mkStreak("Both teams scored", "BTTS", "btts_yes", 80),
  mkStreak("Over 2.5 goals", "Goals", "over_25", 70),
  mkStreak("Over 9 corners", "Corners", "over_9_corners", 65),
  mkStreak("Over 3.5 cards", "Cards", "over_35_cards", 50), // below default slider
  mkStreak("1st half goal", "Half", "ht_over_05", 75),
  mkStreak("Result home win", "Result", "home_win", 62),
];

const SAMPLE_INDEX = mkIndex(ALL_STREAKS);

beforeEach(() => {
  replaceMock.mockClear();
  searchParamsState.current = new URLSearchParams("");
});

afterEach(() => {
  cleanup();
});

describe("<StreaksHeatmap />", () => {
  it("renderiza header com label do painel", () => {
    render(<StreaksHeatmap data={SAMPLE_INDEX} />);
    expect(screen.getByText(/streaks/i)).toBeDefined();
  });

  it("default min_perc=60 filtra streaks abaixo do limiar", () => {
    render(<StreaksHeatmap data={SAMPLE_INDEX} />);
    expect(screen.getAllByText(/Both teams scored/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Over 3.5 cards/i)).toBeNull();
  });

  it("chip de grupo toggle filtra para apenas o grupo selecionado", async () => {
    render(<StreaksHeatmap data={SAMPLE_INDEX} />);
    const chip = screen.getByRole("button", { name: /^BTTS$/ });
    await act(async () => {
      fireEvent.click(chip);
    });
    expect(screen.getAllByText(/Both teams scored/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Over 2.5 goals/i)).toBeNull();
    expect(replaceMock).toHaveBeenCalled();
    const lastCall = replaceMock.mock.calls.at(-1)![0] as string;
    expect(lastCall).toMatch(/streaks=BTTS/);
  });

  it("slider altera min_perc e atualiza URL", async () => {
    render(<StreaksHeatmap data={SAMPLE_INDEX} />);
    const slider = screen.getByRole("slider", { name: /percent/i });
    expect(slider.getAttribute("aria-valuenow")).toBe("60");
    await act(async () => {
      slider.focus();
      fireEvent.keyDown(slider, { key: "ArrowRight" });
    });
    expect(replaceMock).toHaveBeenCalled();
    const lastCall = replaceMock.mock.calls.at(-1)![0] as string;
    expect(lastCall).toMatch(/min_perc=\d+/);
  });

  it("botão local 'buscar streak' abre cmdk modal", async () => {
    render(<StreaksHeatmap data={SAMPLE_INDEX} />);
    expect(screen.queryByPlaceholderText(/buscar streak/i)).toBeNull();
    const trigger = screen.getByRole("button", { name: /buscar streak/i });
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(screen.getByPlaceholderText(/buscar streak/i)).toBeDefined();
  });

  it("não registra listener global de ⌘K (evita colisão com CommandPalette do dashboard)", async () => {
    render(<StreaksHeatmap data={SAMPLE_INDEX} />);
    expect(screen.queryByPlaceholderText(/buscar streak/i)).toBeNull();
    await act(async () => {
      fireEvent.keyDown(document, { key: "k", metaKey: true });
    });
    // O painel não deve abrir o próprio cmdk via ⌘K — esse atalho é do
    // CommandPalette global montado em `app/(dashboard)/layout.tsx`.
    expect(screen.queryByPlaceholderText(/buscar streak/i)).toBeNull();
  });

  it("cmdk filtra textualmente por desc/stat_type", async () => {
    render(<StreaksHeatmap data={SAMPLE_INDEX} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /buscar streak/i }));
    });
    const input = screen.getByPlaceholderText(/buscar streak/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "btts" } });
    });
    const palette = input.closest("[role='dialog']")!;
    expect(palette.textContent?.toLowerCase()).toContain("both teams scored");
    expect(palette.textContent?.toLowerCase()).not.toContain("over 9 corners");
  });

  it("heatmap usa CSS Grid e gera 1 cell por streak visível", () => {
    const { container } = render(<StreaksHeatmap data={SAMPLE_INDEX} />);
    const grid = container.querySelector("[data-testid='streaks-heatmap-grid']");
    expect(grid).not.toBeNull();
    const cells = grid!.querySelectorAll("[data-testid='streak-cell']");
    expect(cells.length).toBe(5);
  });

  it("renderiza container virtualizado para a lista de streaks", () => {
    const { container } = render(<StreaksHeatmap data={SAMPLE_INDEX} />);
    expect(container.querySelector("[data-testid='streaks-virtual-list']")).not.toBeNull();
  });

  it("empty state quando nenhum streak ≥ min_perc", () => {
    const lowOnly = mkIndex([
      mkStreak("Low one", "BTTS", "btts_yes", 30),
      mkStreak("Low two", "Cards", "over_05_cards", 40),
    ]);
    render(<StreaksHeatmap data={lowOnly} />);
    expect(screen.getByText(/nenhuma streak/i)).toBeDefined();
  });

  it("botão 'limpar filtros' aparece após ativar chip e reseta state", async () => {
    render(<StreaksHeatmap data={SAMPLE_INDEX} />);
    expect(screen.queryByRole("button", { name: /limpar filtros/i })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^BTTS$/ }));
    });
    const clear = screen.getByRole("button", { name: /limpar filtros/i });
    expect(clear).toBeDefined();
    await act(async () => {
      fireEvent.click(clear);
    });
    expect(screen.queryByRole("button", { name: /limpar filtros/i })).toBeNull();
  });

  it("hidrata estado inicial a partir de searchParams (deep-link)", () => {
    searchParamsState.current = new URLSearchParams("streaks=BTTS&min_perc=70");
    render(<StreaksHeatmap data={SAMPLE_INDEX} />);
    expect(screen.getAllByText(/Both teams scored/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Result home win/i)).toBeNull();
  });

  it("data vazio → empty state genérico", () => {
    render(<StreaksHeatmap data={{ all: [], by_group: {} }} />);
    expect(screen.getByText(/nenhuma streak/i)).toBeDefined();
  });
});
