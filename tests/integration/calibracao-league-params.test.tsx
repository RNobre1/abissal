import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";

type LeagueRow = {
  league: string;
  param: string;
  value: number;
  n: number;
  created_at: string;
  model_version: string;
};

type State = {
  aiRows: unknown[];
  simRows: unknown[];
  calRows: unknown[];
  leagueRows: LeagueRow[];
  leagueError: { message: string } | null;
};

const state: State = {
  aiRows: [],
  simRows: [],
  calRows: [],
  leagueRows: [],
  leagueError: null,
};

function buildAiOrSimBuilder(which: "ai" | "sim") {
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

function buildCalBuilder() {
  // .select(...).is("effective_until", null).order(...).limit(...)
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.is = () => b;
  b.order = () => b;
  b.limit = () => Promise.resolve({ data: state.calRows, error: null });
  return b;
}

function buildLeagueBuilder() {
  // .select(...).is("effective_until", null).order(...) — sem .limit
  // (final da cadeia: .order é awaitable via thenable).
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.is = () => b;
  b.order = () =>
    Promise.resolve({ data: state.leagueRows, error: state.leagueError });
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      if (t === "ai_predictions") return buildAiOrSimBuilder("ai");
      if (t === "fixture_simulations") return buildAiOrSimBuilder("sim");
      if (t === "model_calibration") return buildCalBuilder();
      if (t === "league_parameters") return buildLeagueBuilder();
      // ai_recommendations (Wave 5) — não testado aqui; vazio (reusa builder vazio).
      if (t === "ai_recommendations") return buildLeagueBuilder();
      throw new Error("unexpected table " + t);
    },
  }),
}));

import CalibracaoPage from "@/app/(dashboard)/calibracao/page";

async function renderPage() {
  const el = await CalibracaoPage();
  return render(el);
}

beforeEach(() => {
  state.aiRows = [];
  state.simRows = [];
  state.calRows = [];
  state.leagueRows = [];
  state.leagueError = null;
});

afterEach(() => vi.useRealTimers());

describe("CalibracaoPage — league params", () => {
  it("mostra fallback quando 0 ligas calibradas", async () => {
    const { container } = await renderPage();
    const section = container.querySelector(
      '[data-section="sim-league-calibration"]',
    );
    expect(section).not.toBeNull();
    expect((section?.textContent ?? "").toLowerCase()).toContain(
      "nenhuma liga calibrada",
    );
  });

  it("renderiza tabela com ligas presentes", async () => {
    state.leagueRows = [
      {
        league: "Premier League",
        param: "rho",
        value: -0.08,
        n: 50,
        created_at: "2026-05-15T10:00:00Z",
        model_version: "fit-mom-v1",
      },
      {
        league: "Premier League",
        param: "avg_goals_home",
        value: 1.65,
        n: 50,
        created_at: "2026-05-15T10:00:00Z",
        model_version: "fit-mom-v1",
      },
      {
        league: "Premier League",
        param: "avg_goals_away",
        value: 1.2,
        n: 50,
        created_at: "2026-05-15T10:00:00Z",
        model_version: "fit-mom-v1",
      },
      {
        league: "La Liga",
        param: "rho",
        value: -0.12,
        n: 35,
        created_at: "2026-05-14T10:00:00Z",
        model_version: "fit-mom-v1",
      },
    ];
    const { container } = await renderPage();
    const section = container.querySelector(
      '[data-section="sim-league-calibration"]',
    );
    expect(section).not.toBeNull();
    const text = section?.textContent ?? "";
    expect(text).toContain("Premier League");
    expect(text).toContain("La Liga");
    // ρ formatado visivelmente (3 casas decimais)
    expect(text).toMatch(/-0\.080/);
    expect(text).toMatch(/-0\.120/);
  });

  it("não quebra a página quando a query falha", async () => {
    state.leagueError = { message: "boom" };
    const { container } = await renderPage();
    const section = container.querySelector(
      '[data-section="sim-league-calibration"]',
    );
    expect(section).not.toBeNull();
    expect(section?.textContent ?? "").toContain("boom");
  });
});
