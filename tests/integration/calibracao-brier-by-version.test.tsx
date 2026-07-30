import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";

/**
 * F5 — Brier por model_version (migration 0021).
 *
 * Verifica que /calibracao renderiza a seção `sim-brier-by-version` com 1
 * linha por versão presente em `fixture_simulations.model_version`. Quando
 * existem múltiplas versões (histórico preservado), o ranking exibe lado a
 * lado o Brier 1X2 e o Brier over 2.5 — permitindo comparar a qualidade
 * probabilística entre bumps do motor.
 *
 * O teste foca SOMENTE no novo display; demais seções existentes ficam com
 * dados vazios e são cobertas por outros testes (`calibracao-page.test.tsx`,
 * `calibracao-sim-observability.test.tsx`).
 */

type SimRow = {
  id: number;
  status: "pending" | "resolved" | "unsimulable" | "unresolvable";
  league: string | null;
  model_version: string | null;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  p_over_25: number | null;
  market_anchor: unknown;
  correct_winner: boolean | null;
  correct_over_under: boolean | null;
  actual_home_goals: number | null;
  actual_away_goals: number | null;
  actual_resolved_at: string | null;
};

type State = {
  simRows: SimRow[];
};

const state: State = { simRows: [] };

function buildAiOrSimBuilder(which: "ai" | "sim") {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.order = () => b;
  b.limit = () =>
    Promise.resolve({
      data: which === "ai" ? [] : state.simRows,
      error: null,
    });
  return b;
}

function buildCalBuilder() {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.is = () => b;
  b.order = () => b;
  b.limit = () => Promise.resolve({ data: [], error: null });
  return b;
}

function buildLeagueBuilder() {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.is = () => b;
  b.order = () => Promise.resolve({ data: [], error: null });
  return b;
}

// A página escopa o ROI realizado pelo usuário da sessão (as apostas são
// pessoais, as recomendações são compartilhadas). Sem este mock o
// `createClient` real chama `cookies()` fora do escopo de request.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "user-de-teste" } }, error: null }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      if (t === "ai_predictions") return buildAiOrSimBuilder("ai");
      if (t === "fixture_simulations") return buildAiOrSimBuilder("sim");
      if (t === "model_calibration") return buildCalBuilder();
      if (t === "league_parameters") return buildLeagueBuilder();
      // ai_recommendations (Wave 5) — não testado aqui; vazio.
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
  state.simRows = [];
});

afterEach(() => vi.useRealTimers());

function row(over: Partial<SimRow> = {}): SimRow {
  return {
    id: Math.floor(Math.random() * 1e9),
    status: "resolved",
    league: "Premier League",
    model_version: "sim-v5",
    p_home: 0.5,
    p_draw: 0.27,
    p_away: 0.23,
    p_over_25: 0.55,
    market_anchor: null,
    correct_winner: true,
    correct_over_under: true,
    actual_home_goals: 2,
    actual_away_goals: 1,
    actual_resolved_at: "2026-05-18T22:00:00Z",
    ...over,
  };
}

describe("CalibracaoPage — Brier por model_version (F5)", () => {
  it("renderiza seção sim-brier-by-version com 2 linhas quando há 2 versões", async () => {
    state.simRows = [
      // v4 — 1 row, palpite ok (winner & over corretos)
      row({ model_version: "sim-v4", p_home: 0.6, p_over_25: 0.7 }),
      // v5 — 2 rows
      row({ model_version: "sim-v5", p_home: 0.55, p_over_25: 0.62 }),
      row({
        model_version: "sim-v5",
        p_home: 0.4,
        p_over_25: 0.45,
        actual_home_goals: 0,
        actual_away_goals: 2,
      }),
    ];

    const { container } = await renderPage();
    const section = container.querySelector(
      '[data-section="sim-brier-by-version"]',
    );
    expect(section).not.toBeNull();
    // Header de tabela específico do display por versão
    const text = section?.textContent ?? "";
    expect(text).toContain("model_version");
    expect(text).toContain("sim-v4");
    expect(text).toContain("sim-v5");
    // 2 linhas no tbody (uma por versão)
    const dataRows = section?.querySelectorAll("tbody tr") ?? [];
    expect(dataRows.length).toBe(2);
  });

  it("ainda renderiza a seção quando há apenas uma versão (mostra a corrente)", async () => {
    state.simRows = [
      row({ model_version: "sim-v5" }),
      row({ model_version: "sim-v5" }),
    ];

    const { container } = await renderPage();
    const section = container.querySelector(
      '[data-section="sim-brier-by-version"]',
    );
    expect(section).not.toBeNull();
    const dataRows = section?.querySelectorAll("tbody tr") ?? [];
    expect(dataRows.length).toBe(1);
    expect(section?.textContent ?? "").toContain("sim-v5");
  });

  it("não renderiza a seção quando não há linhas de simulação", async () => {
    state.simRows = [];
    const { container } = await renderPage();
    const section = container.querySelector(
      '[data-section="sim-brier-by-version"]',
    );
    expect(section).toBeNull();
  });
});
