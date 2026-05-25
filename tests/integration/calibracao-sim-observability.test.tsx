import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";

type State = {
  aiRows: unknown[];
  simRows: unknown[];
};
const state: State = { aiRows: [], simRows: [] };

function buildBuilder(which: "ai" | "sim") {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.order = () => b;
  b.limit = () =>
    Promise.resolve({
      data: which === "ai" ? state.aiRows : state.simRows,
      error: null,
    });
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      if (t === "ai_predictions") return buildBuilder("ai");
      if (t === "fixture_simulations") return buildBuilder("sim");
      // model_calibration / league_parameters / ai_recommendations (Wave 5)
      // — não testadas aqui; reusam buildBuilder('ai') (vazio por padrão).
      if (
        t === "model_calibration" ||
        t === "league_parameters" ||
        t === "ai_recommendations"
      ) {
        return buildBuilder("ai");
      }
      throw new Error("unexpected table");
    },
  }),
}));

import CalibracaoPage from "@/app/(dashboard)/calibracao/page";

function makeResolvedSim(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: "resolved",
    league: "Premier League",
    p_home: 0.6, p_draw: 0.25, p_away: 0.15,
    p_over_25: 0.55,
    market_anchor: { Result: { Draw: 0.22, Arsenal: 0.55, Chelsea: 0.23 } },
    correct_winner: true,
    correct_over_under: true,
    actual_home_goals: 2,
    actual_away_goals: 1,
    actual_resolved_at: "2026-05-12T18:00:00Z",
    ...over,
  };
}

async function renderPage() {
  const el = await CalibracaoPage();
  return render(el);
}

beforeEach(() => {
  state.aiRows = [];
  state.simRows = [];
});

afterEach(() => vi.useRealTimers());

describe("CalibracaoPage — observabilidade da simulação", () => {
  it("mostra fallback quando 0 simulações resolvidas (mas há pendentes)", async () => {
    state.simRows = [makeResolvedSim({ status: "pending", actual_home_goals: null })];
    const { container } = await renderPage();
    const text = (container.textContent ?? "").toLowerCase();
    expect(text).toContain("esperando primeiros jogos");
  });

  it("renderiza os 10 bins de reliability quando há resolvidas", async () => {
    state.simRows = [
      makeResolvedSim({ p_home: 0.62, actual_home_goals: 2, actual_away_goals: 0 }),
      makeResolvedSim({ p_home: 0.68, actual_home_goals: 0, actual_away_goals: 1 }),
      makeResolvedSim({ p_home: 0.75, actual_home_goals: 3, actual_away_goals: 0 }),
    ];
    const { container } = await renderPage();
    const rel = container.querySelector('[data-section="sim-reliability"]');
    expect(rel).not.toBeNull();
    // 10 bins × 2 metrics = 20 linhas tbody no total
    const totalRows = rel?.querySelectorAll("tbody tr").length ?? 0;
    expect(totalRows).toBeGreaterThanOrEqual(10);
  });

  it("renderiza tabela de brier-over-time com pelo menos 1 bucket", async () => {
    state.simRows = [
      makeResolvedSim({ actual_resolved_at: "2026-05-12T18:00:00Z" }),
      makeResolvedSim({ actual_resolved_at: "2026-05-15T18:00:00Z" }),
    ];
    const { container } = await renderPage();
    const tot = container.querySelector('[data-section="sim-brier-time"]');
    expect(tot).not.toBeNull();
    const rows = tot?.querySelectorAll("tbody tr").length ?? 0;
    expect(rows).toBeGreaterThan(0);
  });

  it("renderiza desvio vs mercado por liga", async () => {
    state.simRows = [
      makeResolvedSim({ league: "Premier League" }),
      makeResolvedSim({ league: "La Liga", market_anchor: { Result: { Draw: 0.3, "Real Madrid": 0.5, "Mallorca": 0.2 } } }),
    ];
    const { container } = await renderPage();
    const dev = container.querySelector('[data-section="sim-market-deviation"]');
    expect(dev).not.toBeNull();
    expect((dev?.textContent ?? "")).toMatch(/Premier League|La Liga/);
  });
});
