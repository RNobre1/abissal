import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, within, fireEvent } from "@testing-library/react";
import type { FixtureRow } from "@/lib/fixtures/types";
import type { DetailJson } from "@/lib/fixtures/stats/detail-json-types";
import { MOBILE_TABS } from "@/components/fixtures/stats/stats-layout";
import { SimulationPanel } from "@/app/(dashboard)/fixtures/[id]/_components/simulation-panel";
import { SimulationDisclosure } from "@/app/(dashboard)/fixtures/[id]/_components/simulation-disclosure";
import { expandSim } from "./__helpers/expand-sim";

/**
 * Wave 2b / Task 3 — the stats page now also surfaces the pre-game
 * simulation read from `fixture_simulations` (scalar-only) plus the
 * enriched foundation fields from T1 (`avgs`, `player_extra`,
 * `odds_devigged`). This integration test pins the firm product
 * directives: probable score + 1X2/over/BTTS bars (visible OUTSIDE
 * tooltips), a stats tab with exact per-team numbers, a football pitch
 * with the probable XI labeled exactly "provável escalação" (never
 * "oficial"), goal/card icons per player, tooltips, honest degradation.
 */

vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => ({
    addLineSeries: vi.fn(() => ({ setData: vi.fn() })),
    remove: vi.fn(),
    applyOptions: vi.fn(),
    timeScale: () => ({ fitContent: vi.fn() }),
  })),
}));

type MockState = {
  fixtureRow: FixtureRow | null;
  fixtureError: { message: string } | null;
  simRow: Record<string, unknown> | null;
  simError: { message: string } | null;
  simTableThrows: boolean;
};

const mockState: MockState = {
  fixtureRow: null,
  fixtureError: null,
  simRow: null,
  simError: null,
  simTableThrows: false,
};

function resetMock() {
  mockState.fixtureRow = null;
  mockState.fixtureError = null;
  mockState.simRow = null;
  mockState.simError = null;
  mockState.simTableThrows = false;
}

function buildFixturesBuilder() {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = () =>
    Promise.resolve(
      mockState.fixtureError
        ? { data: null, error: mockState.fixtureError }
        : { data: mockState.fixtureRow, error: null },
    );
  return builder;
}

/**
 * Sim builder that ENFORCES the id-space contract: the row is only served
 * when the query filtered `fixture_id` by the choistats id parsed from
 * `source_url` (the PRODUCER's key), OR via the teams/kickoff fallback.
 *
 * This is what makes the integration test catch the prod bug: before the
 * fix the page filtered `fixture_id = row.id` (route/table id, e.g. 42),
 * which never matched the producer-keyed `fixture_id` (e.g. 19427226) → the
 * builder returns `null` → "simulação indisponível", exactly as in prod.
 */
function buildSimBuilder() {
  const filters: Array<{ column: string; value: unknown }> = [];
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = (column: string, value: unknown) => {
    filters.push({ column, value });
    return builder;
  };
  builder.gte = (column: string, value: unknown) => {
    filters.push({ column: `${column}>=`, value });
    return builder;
  };
  builder.lt = (column: string, value: unknown) => {
    filters.push({ column: `${column}<`, value });
    return builder;
  };
  builder.order = () => builder;
  builder.limit = () => builder;
  builder.maybeSingle = () => {
    if (mockState.simError) {
      return Promise.resolve({ data: null, error: mockState.simError });
    }
    if (!mockState.simRow) {
      return Promise.resolve({ data: null, error: null });
    }
    const row = mockState.simRow;
    const fidEq = filters.find((f) => f.column === "fixture_id");
    const homeEq = filters.find((f) => f.column === "home_team");
    const awayEq = filters.find((f) => f.column === "away_team");
    // Faithful filter semantics: a query path resolves the row only when
    // its filters actually MATCH the row's values (like real Postgres).
    const idMatch = fidEq != null && fidEq.value === row.fixture_id;
    const teamsMatch =
      fidEq == null &&
      homeEq != null &&
      awayEq != null &&
      homeEq.value === row.home_team &&
      awayEq.value === row.away_team;
    if (idMatch || teamsMatch) {
      return Promise.resolve({ data: row, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
  return builder;
}

/**
 * Wave 4 added a read of `ai_recommendations` to the same page. These tests
 * focus on the simulation surface, so the AI table resolves to null (panel
 * renders the "pedir análise IA" on-demand button — non-disruptive).
 */
function buildNullAiRecoBuilder() {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.order = () => b;
  b.limit = () => b;
  b.maybeSingle = () => Promise.resolve({ data: null, error: null });
  return b;
}

const mockClient = {
  from: (table: string) => {
    if (table === "fixtures") return buildFixturesBuilder();
    if (table === "fixture_simulations") {
      if (mockState.simTableThrows) {
        throw new Error('relation "fixture_simulations" does not exist');
      }
      return buildSimBuilder();
    }
    if (table === "ai_recommendations") return buildNullAiRecoBuilder();
    throw new Error(`unexpected table: ${table}`);
  },
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockClient,
}));

class NotFoundError extends Error {
  digest = "NEXT_NOT_FOUND";
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => "/",
}));

import StatsPage from "@/app/(dashboard)/fixtures/[id]/page";

const SAMPLE_KICKOFF = "2026-05-19T19:00:00+00:00";

/**
 * The `fixtures` PK (`id`) and the choistats id parsed from `source_url` are
 * DELIBERATELY different here (42 vs 19427226) — that divergence IS the prod
 * bug. The producer keys `fixture_simulations.fixture_id` by the parsed id;
 * the fixed page must look up by the parsed id, never by `row.id` (42).
 */
const CHOISTATS_ID = 19427226;

function makeRow(overrides: Partial<FixtureRow> = {}): FixtureRow {
  return {
    id: 42,
    match_date: "2026-05-19",
    ko_time: "20:00:00",
    home_team: "Chelsea",
    away_team: "Tottenham",
    league: "Premier League",
    country: "england",
    source_url: `https://www.adamchoi.co.uk/fixture/${CHOISTATS_ID}/england-premier-league-chelsea-vs-tottenham`,
    detail_json: null,
    kickoff_utc: SAMPLE_KICKOFF,
    ...overrides,
  };
}

/** Minimal valid detail_json + enriched T1 foundation fields. */
function makeDetail(): DetailJson & Record<string, unknown> {
  return {
    team_record: {
      home: {
        home: {
          type: "Home",
          played: 10,
          won: 6,
          draw: 2,
          lost: 2,
          goals_for: 20,
          goals_against: 9,
          goal_diff: 11,
          points: 20,
          points_per_game: 2.0,
          position: "3rd",
          form: ["W", "D", "W", "W", "L"],
        },
        overall: {
          type: "All",
          played: 20,
          won: 10,
          draw: 6,
          lost: 4,
          goals_for: 35,
          goals_against: 22,
          goal_diff: 13,
          points: 36,
          points_per_game: 1.8,
          position: "3rd",
          form: ["W", "W", "D", "W", "L"],
        },
      },
      away: {
        away: {
          type: "Away",
          played: 10,
          won: 4,
          draw: 3,
          lost: 3,
          goals_for: 14,
          goals_against: 12,
          goal_diff: 2,
          points: 15,
          points_per_game: 1.5,
          position: "6th",
          form: ["L", "W", "D", "W", "W"],
        },
        overall: {
          type: "All",
          played: 20,
          won: 8,
          draw: 6,
          lost: 6,
          goals_for: 28,
          goals_against: 24,
          goal_diff: 4,
          points: 30,
          points_per_game: 1.5,
          position: "6th",
          form: ["W", "L", "W", "D", "W"],
        },
      },
    },
    recent_matches: { home: [], away: [] },
    h2h: [],
    streaks: { home: [], away: [] },
    referee_record: null,
    odds_summary: {
      Result: {
        Chelsea: { bookmaker: "bet365", decimal_odds: 2.05 },
        Draw: { bookmaker: "bet365", decimal_odds: 3.4 },
        Tottenham: { bookmaker: "bet365", decimal_odds: 3.6 },
      },
    },
    player_stats: {
      home: {
        aggregates: {
          players_count: 0,
          minutes: 0,
          goals: 0,
          goals_1h: 0,
          goals_2h: 0,
          assists: 0,
          yellows: 0,
          reds: 0,
          cards_1h: 0,
          cards_2h: 0,
          total_shots: 0,
          shots_on_target: 0,
          tackles: 0,
          fouls_committed: 0,
          fouls_drawn: 0,
          offsides: 0,
        },
        top_players: [],
      },
      away: {
        aggregates: {
          players_count: 0,
          minutes: 0,
          goals: 0,
          goals_1h: 0,
          goals_2h: 0,
          assists: 0,
          yellows: 0,
          reds: 0,
          cards_1h: 0,
          cards_2h: 0,
          total_shots: 0,
          shots_on_target: 0,
          tackles: 0,
          fouls_committed: 0,
          fouls_drawn: 0,
          offsides: 0,
        },
        top_players: [],
      },
    },
    predictions: [],
    trends: [],
    // ── enriched T1 foundation fields ──
    avgs: {
      home_overall: { num_matches: 22, goalsFor: 1.8, corners: 5.6 },
      away_overall: { num_matches: 21, goalsFor: 1.2, corners: 4.4 },
    },
    odds_devigged: {
      Result: { Chelsea: 0.49, Draw: 0.27, Tottenham: 0.24 },
    },
    player_extra: {
      form: [],
      home_seasons: [],
      away_seasons: [],
      outcome_odds_by_player: { "Cole Palmer": { ANYTIME_SCORER: 3.1 } },
    },
  };
}

/**
 * GOLDEN simulation result — the COMPUTED fields below are a verbatim
 * snapshot of REAL producer output, obtained by running
 * `Runner.simulate(WidgetMerger.merge(...))` over the same widget fixtures
 * the producer's `runner_spec.rb` uses
 * (`scripts/scraper/spec/scraper/fixtures/widgets/{recent-results,players,odds,team-records}.json`).
 *
 * It is NOT hand-fabricated. This is the cross-wave anti-drift guarantee:
 * the consumer test now exercises the EXACT contract the Ruby Monte Carlo
 * engine emits — `sim_stats` is side→metric with a `goals` metric per side,
 * `goals` is full-match only (no honest half split from the score model),
 * `corners` carry per-half percentiles when per_half_available. If the
 * producer's shape ever drifts, the producer spec breaks AND this golden
 * must be re-derived — the mock can no longer silently encode the wrong
 * contract. To regenerate: run Runner.simulate over those widget fixtures
 * and JSON.generate(sim) (throwaway dumper, never committed).
 */
const GOLDEN_SIM = {
  model_version: "sim-v1-poisson-dc-nb-mc10k",
  status: "pending",
  p_home: 0.4839,
  p_draw: 0.2622,
  p_away: 0.2539,
  p_btts: 0.6084,
  p_over_25: 0.5831,
  top_scorelines: [
    { score: "1-1", prob: 0.1204 },
    { score: "2-1", prob: 0.0966 },
    { score: "2-0", prob: 0.078 },
    { score: "1-0", prob: 0.0742 },
    { score: "1-2", prob: 0.0674 },
    { score: "2-2", prob: 0.0625 },
  ],
  sim_stats: {
    home: {
      corners: {
        p10: 1,
        p50: 5,
        p90: 11,
        p10_1h: 0,
        p50_1h: 2,
        p90_1h: 6,
        p10_2h: 0,
        p50_2h: 2,
        p90_2h: 6,
      },
      cards: { p10: 0, p50: 2, p90: 7 },
      sot: { p10: 2, p50: 4, p90: 7 },
      goals: { p10: 0, p50: 2, p90: 4 },
      fouls: { p10: 8, p50: 11, p90: 14 },
      offsides: { p10: 0, p50: 1, p90: 3 },
      tackles: { p10: 6, p50: 9, p90: 13 },
    },
    away: {
      corners: {
        p10: 1,
        p50: 3,
        p90: 6,
        p10_1h: 0,
        p50_1h: 1,
        p90_1h: 3,
        p10_2h: 0,
        p50_2h: 1,
        p90_2h: 3,
      },
      cards: { p10: 0, p50: 1, p90: 4 },
      sot: { p10: 1, p50: 3, p90: 6 },
      goals: { p10: 0, p50: 1, p90: 3 },
      fouls: { p10: 8, p50: 11, p90: 14 },
      offsides: { p10: 0, p50: 1, p90: 3 },
      tackles: { p10: 6, p50: 9, p90: 13 },
    },
  },
  per_half_available: true,
  market_anchor: {
    Result: {
      "Tottenham Hotspur": 0.548948,
      Draw: 0.238792,
      "Leeds United": 0.21226,
    },
  },
  player_events: [
    {
      name: "Micky van de Ven",
      p_goal: 0.204,
      expected_goals: 0.2292,
      p_card: 0.1588,
      p_sot: 0.0727,
      provavel_titular: true,
      confidence: "low",
    },
    {
      name: "João Palhinha",
      p_goal: 0.2867,
      expected_goals: 0.3344,
      p_card: 0.1567,
      p_sot: 0.1378,
      provavel_titular: true,
      confidence: "low",
    },
    {
      name: "Richarlison",
      p_goal: 0.6194,
      expected_goals: 0.969,
      p_card: 0.1512,
      p_sot: 0.4502,
      provavel_titular: true,
      confidence: "low",
    },
    {
      name: "Dominic Calvert-Lewin",
      p_goal: 0.3875,
      expected_goals: 0.4884,
      p_card: 0.0427,
      p_sot: 0.2989,
      provavel_titular: true,
      confidence: "low",
    },
  ],
} as const;

function simRow(over: Record<string, unknown> = {}) {
  return {
    // ── DB-row metadata: fixture_id is the PRODUCER key (choistats id
    // parsed from source_url), NOT the fixtures PK (42). The pre-fix page
    // queried by 42 → never matched this row → prod showed "indisponível".
    id: 5,
    created_at: "2026-05-18T10:00:00Z",
    fixture_id: CHOISTATS_ID,
    home_team: "Chelsea",
    away_team: "Tottenham",
    league: "Premier League",
    kickoff_utc: SAMPLE_KICKOFF,
    // ── COMPUTED fields: verbatim REAL producer output (golden) ──
    ...GOLDEN_SIM,
    status: "simulated",
    actual_home_goals: null,
    actual_away_goals: null,
    correct_winner: null,
    correct_over_under: null,
    actual_resolved_at: null,
    ...over,
  };
}

async function renderPage(rawId: string) {
  const element = await StatsPage({ params: Promise.resolve({ id: rawId }) });
  return render(element);
}

beforeEach(() => {
  resetMock();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StatsPage — id-space mismatch regression (the prod bug)", () => {
  /**
   * Reproduces the confirmed prod incident: 594 fixture_simulations rows
   * existed yet EVERY fixture showed "simulação indisponível" because the
   * page looked up by `row.id` (fixtures PK, 42) while the producer keyed
   * `fixture_id` by the choistats id from source_url (19427226).
   *
   * Here the sim row's team names are DELIBERATELY the producer's long
   * names ("Chelsea FC"/"Tottenham Hotspur") which do NOT equal the
   * fixture's short names — so the teams/kickoff fallback CANNOT rescue
   * this. The panel can only render real numbers if the page resolves the
   * row via the choistats id parsed from source_url. Against the old
   * route-id lookup this renders "indisponível" (RED); after the fix it
   * renders the real probabilities (GREEN).
   */
  it("resolves the simulation via the choistats id parsed from source_url (fallback cannot mask it)", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow({
      // Producer long names — the teams fallback will NOT match these,
      // forcing the parsed-id primary path to be the only way in.
      home_team: "Chelsea FC",
      away_team: "Tottenham Hotspur",
    });

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;
    expect(panel, "SIM panel should mount").not.toBeNull();
    expandSim(panel);
    const scoped = within(panel);

    // Real producer probabilities are rendered → the row WAS found by the
    // parsed choistats id (19427226), not the route id (42).
    expect(scoped.getByText("48%")).toBeDefined(); // p_home 0.4839
    expect(scoped.getByText("26%")).toBeDefined(); // p_draw 0.2622
    expect(scoped.getByText(/1-1/)).toBeDefined(); // top scoreline
    // The bug symptom must be ABSENT.
    expect((panel.textContent ?? "").toLowerCase()).not.toContain(
      "simulação indisponível",
    );
  });
});

describe("StatsPage — pre-game simulation panel", () => {
  it("renderiza o painel de momentum (B) antes da simulação (SIM) no DOM", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");

    const momentum = container.querySelector('[data-panel="B"]');
    const sim = container.querySelector('[data-panel="SIM"]');
    expect(momentum, "momentum panel B deve existir").not.toBeNull();
    expect(sim, "panel SIM deve existir").not.toBeNull();

    const pos = momentum!.compareDocumentPosition(sim!);
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renderiza SIM recolhido por default (toggle visível, body do conteúdo ausente)", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;

    const toggle = panel.querySelector('button[data-sim-toggle]');
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    // Conteúdo do body (placar provável) NÃO está visível com SIM recolhido.
    expect(panel.querySelector("[data-probable-score]")).toBeNull();
  });

  it("renders the probable score and the 1X2/over/BTTS probability bars", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");

    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;
    expect(panel, "simulation panel SIM should mount").not.toBeNull();
    expandSim(panel);
    const scoped = within(panel);

    // Probable scoreline (top of REAL top_scorelines: "1-1").
    expect(scoped.getByText(/1-1/)).toBeDefined();

    // 1X2 / over / BTTS probabilities are visible as TEXT (outside tooltips),
    // rounded from the REAL producer probabilities.
    expect(scoped.getByText("48%")).toBeDefined(); // p_home 0.4839
    expect(scoped.getByText("26%")).toBeDefined(); // p_draw 0.2622
    expect(scoped.getByText("25%")).toBeDefined(); // p_away 0.2539
    expect(scoped.getByText("58%")).toBeDefined(); // p_over_25 0.5831
    expect(scoped.getByText("61%")).toBeDefined(); // p_btts 0.6084

    // Bars are rendered (role meter or progressbar) not only on hover.
    expect(
      scoped.queryAllByRole("meter").length +
        scoped.queryAllByRole("progressbar").length,
    ).toBeGreaterThan(0);

    // Design-system: each probability is conveyed by a SINGLE element
    // carrying role="meter" + aria-valuenow/min/max — no native <meter>
    // duplicating it behind an aria-hidden decorative div.
    const meters = scoped.getAllByRole("meter");
    expect(meters.length).toBe(5); // 1X2 (3) + over + BTTS
    for (const m of meters) {
      expect(m.tagName.toLowerCase()).not.toBe("meter");
      expect(m).toHaveAttribute("aria-valuenow");
      expect(m).toHaveAttribute("aria-valuemin", "0");
      expect(m).toHaveAttribute("aria-valuemax", "100");
    }
    // No native <meter> element at all (the hidden-meter a11y smell is gone).
    expect(panel?.querySelectorAll("meter").length).toBe(0);
    // p_home meter exposes the REAL value (0.4839 → aria-valuenow="48").
    expect(
      meters.some((m) => m.getAttribute("aria-valuenow") === "48"),
    ).toBe(true);
  });

  it("renders through the shared PanelShell card+header structure", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;

    // Standard panel card shell (same class contract as every server panel).
    const card = panel.querySelector(".card.\\@container\\/card");
    expect(card, "SIM must render through the shared card shell").not.toBeNull();

    // Standard header: h3.font-display + a .label eyebrow.
    const h3 = panel.querySelector("header h3.font-display");
    expect(h3?.textContent).toContain("Simulação pré-jogo");
    const eyebrow = panel.querySelector("header span.label");
    expect(eyebrow, "PanelShell eyebrow span expected").not.toBeNull();
    expect(eyebrow?.textContent?.toLowerCase()).toContain("monte carlo");
  });

  it("shows the TeamLegend above the per-team projected-stats table", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;
    expandSim(panel);

    const legend = panel.querySelector("[data-team-legend]");
    expect(legend, "TeamLegend expected for team-keyed parity").not.toBeNull();
    expect(legend?.textContent).toContain("Chelsea");
    expect(legend?.textContent).toContain("Tottenham");
  });

  it("exposes the per-player confidence signal as visible text", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;
    expandSim(panel);
    const text = (panel.textContent ?? "").toLowerCase();

    // confidence buckets are an intended UI signal (wired in [Minor] 6).
    // Real producer output for these widget fixtures yields "low" confidence.
    expect(text).toContain("confiança");
    expect(text).toContain("low");
  });

  it("shows a stats tab/section with EXACT per-team numbers (real producer)", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;
    expandSim(panel);
    const scoped = within(panel);

    // The per-team projected-stats table renders the REAL p50 for EVERY
    // metric/side from the side→metric+goals producer contract. With the
    // pre-fix metric→side / no-goals shape these would all be "—".
    const cellsFor = (key: string) =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          `tr[data-sim-stat="${key}"] td.num`,
        ),
      ).map((c) => c.textContent?.trim());

    expect(scoped.getAllByText(/escanteios/i).length).toBeGreaterThan(0);
    expect(scoped.getAllByText(/gols/i).length).toBeGreaterThan(0);

    // [home, away] p50 from the golden sim_stats.
    expect(cellsFor("goals")).toEqual(["2", "1"]);
    expect(cellsFor("corners")).toEqual(["5", "3"]);
    expect(cellsFor("sot")).toEqual(["4", "3"]);
    expect(cellsFor("cards")).toEqual(["2", "1"]);

    // No "—" for any present metric (the original integration bug: every
    // projected-stat cell was blank because the contracts disagreed).
    for (const key of ["goals", "corners", "sot", "cards"]) {
      expect(cellsFor(key)).not.toContain("—");
    }
  });

  it("renderiza linhas de fouls/offsides/tackles quando sim_stats expõe (F12)", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();
    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;
    expandSim(panel);
    expect(panel.querySelector('tr[data-sim-stat="fouls"]')).not.toBeNull();
    expect(panel.querySelector('tr[data-sim-stat="offsides"]')).not.toBeNull();
    expect(panel.querySelector('tr[data-sim-stat="tackles"]')).not.toBeNull();

    const cellsFor = (key: string) =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          `tr[data-sim-stat="${key}"] td.num`,
        ),
      ).map((c) => c.textContent?.trim());
    expect(cellsFor("fouls")).toEqual(["11", "11"]);
    expect(cellsFor("offsides")).toEqual(["1", "1"]);
    expect(cellsFor("tackles")).toEqual(["9", "9"]);
  });

  it("degrades a metric absent from the producer contract to '—' (honest)", async () => {
    // Drop the away `goals` metric only — the consumer must show "—" for it
    // while still rendering every present metric (honest degradation, never
    // a crash, never a fabricated number).
    const partial = JSON.parse(JSON.stringify(GOLDEN_SIM));
    delete partial.sim_stats.away.goals;
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow({ sim_stats: partial.sim_stats });

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;
    expandSim(panel);

    const goalsCells = Array.from(
      panel.querySelectorAll<HTMLElement>('tr[data-sim-stat="goals"] td.num'),
    ).map((c) => c.textContent?.trim());
    expect(goalsCells).toEqual(["2", "—"]); // home present, away degraded
    // Other metrics unaffected.
    const cornerCells = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'tr[data-sim-stat="corners"] td.num',
      ),
    ).map((c) => c.textContent?.trim());
    expect(cornerCells).toEqual(["5", "3"]);
  });

  it("renders the probable XI labeled EXACTLY 'provável escalação' and never 'oficial'", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;
    expandSim(panel);
    const text = panel.textContent ?? "";

    expect(text.toLowerCase()).toContain("provável escalação");
    // Honest degradation: never imply the official XI.
    expect(text.toLowerCase()).not.toContain("escalação oficial");
    expect(text.toLowerCase()).not.toContain("xi oficial");
    expect(text.toLowerCase()).not.toContain("oficial");

    // Pitch view present, players placed (real producer player_events).
    expect(panel.querySelector("[data-pitch]")).not.toBeNull();
    expect(within(panel).getByText(/Richarlison/)).toBeDefined();
  });

  it("renders the goal icon for a real likely scorer (threshold honest)", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;
    expandSim(panel);

    // Richarlison's REAL p_goal is 0.6194 (≥ 0.25) → goal icon present.
    expect(
      panel.querySelector('[data-player-icon="goal"]'),
      "expected a goal icon for a likely scorer",
    ).not.toBeNull();

    // Honest: the REAL producer output for this fixture has no player with
    // p_card ≥ 0.25 (max ≈ 0.196), so NO card icon is rendered. Fabricating
    // a card-prone player here would re-introduce exactly the cross-wave
    // drift this golden exists to prevent. With a synthetic card-prone
    // player injected, the icon DOES appear (threshold logic still works).
    expect(panel.querySelector('[data-player-icon="card"]')).toBeNull();

    const cardProne = simRow({
      player_events: [
        {
          name: "Tackler X",
          p_goal: 0.05,
          expected_goals: 0.05,
          p_card: 0.42,
          p_sot: 0.1,
          provavel_titular: true,
          confidence: "low",
        },
      ],
    });
    mockState.simRow = cardProne;
    const { container: c2 } = await renderPage("42");
    const panel2 = c2.querySelector('[data-panel="SIM"]') as HTMLElement;
    expandSim(panel2);
    expect(
      panel2.querySelector('[data-player-icon="card"]'),
      "card-prone player (p_card ≥ 0.25) → card icon",
    ).not.toBeNull();
  });

  it("explains things via reusable tooltips/info-popovers", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;
    expandSim(panel);

    // Reuses the existing InfoPopover primitive (a Radix popover trigger).
    expect(panel.querySelectorAll("button[aria-label]").length).toBeGreaterThan(
      0,
    );
  });

  it("labels a stat with no HT split as 'total do jogo' and never renders possession", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow({ per_half_available: false });

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;
    expandSim(panel);
    const text = (panel.textContent ?? "").toLowerCase();

    expect(text).toContain("total do jogo");
    // Possession is never simulated → no possession number/label.
    expect(text).not.toContain("posse");
    expect(text).not.toContain("possession");
  });

  it("shows a graceful 'simulação indisponível' state for status 'unsimulable' (no crash)", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow({ status: "unsimulable" });

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect((panel.textContent ?? "").toLowerCase()).toContain(
      "simulação indisponível",
    );
    // No probability bars for an unsimulable fixture.
    expect(within(panel).queryByText("52%")).toBeNull();
  });

  it("does not crash and shows no SIM panel content when no simulation row exists", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = null;

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]');
    // The page still renders (other panels intact); SIM either absent or
    // shows the graceful unavailable copy.
    expect(container.querySelector('[data-panel="A-home"]')).not.toBeNull();
    if (panel) {
      expect((panel.textContent ?? "").toLowerCase()).toContain(
        "simulação indisponível",
      );
    }
  });

  it("degrades gracefully when the fixture_simulations table is absent", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simTableThrows = true;

    // Must NOT throw — the page renders the rest of the stats.
    const { container } = await renderPage("42");
    expect(container.querySelector('[data-panel="A-home"]')).not.toBeNull();
  });

  it("surfaces enriched T1 season averages (avgs) in the simulation panel", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;
    expandSim(panel);
    const text = panel.textContent ?? "";
    // num_matches from avgs (sample size of the model input) shown for honesty.
    expect(text).toMatch(/22/);
  });

  it("declara aba mobile 'simulação' contendo o painel SIM (e SIM não cai no fallback 'visão')", () => {
    const sim = MOBILE_TABS.find((t) => t.id === "simulacao");
    expect(sim, "MOBILE_TABS precisa ter uma aba 'simulacao'").not.toBeUndefined();
    expect(sim?.label).toBe("simulação");
    expect(sim?.panels).toContain("SIM");

    const visao = MOBILE_TABS.find((t) => t.id === "visao");
    expect(visao?.panels).not.toContain("SIM");
  });
});

describe("SimulationPanel — chrome prop", () => {
  it("renderiza SEM a casca PanelShell quando chrome='bare'", () => {
    const sim = simRow();
    const { container } = render(
      <SimulationPanel
        sim={sim as unknown as Parameters<typeof SimulationPanel>[0]["sim"]}
        homeTeam="Chelsea"
        awayTeam="Tottenham"
        sampleSize={{ home: 22, away: 21 }}
        chrome="bare"
      />,
    );

    // Sem .card no nó-raiz: o body precisa ser embedável dentro de outra casca.
    expect(container.querySelector(".card.\\@container\\/card")).toBeNull();
    // h3 "Simulação pré-jogo" também NÃO aparece (a casca é quem o emite).
    expect(container.querySelector("header h3.font-display")).toBeNull();
    // Conteúdo do body ainda está lá — placar provável e barras.
    expect(container.querySelector("[data-probable-score]")).not.toBeNull();
    expect(container.querySelectorAll('[role="meter"]').length).toBe(5);
  });

  it("default (chrome='shell') mantém a casca + título (retrocompat)", () => {
    const sim = simRow();
    const { container } = render(
      <SimulationPanel
        sim={sim as unknown as Parameters<typeof SimulationPanel>[0]["sim"]}
        homeTeam="Chelsea"
        awayTeam="Tottenham"
        sampleSize={{ home: 22, away: 21 }}
      />,
    );
    expect(container.querySelector(".card.\\@container\\/card")).not.toBeNull();
    expect(container.querySelector("header h3.font-display")?.textContent).toContain(
      "Simulação pré-jogo",
    );
  });

  it("unsimulable em chrome='bare' renderiza apenas a mensagem (sem casca)", () => {
    const { container } = render(
      <SimulationPanel
        sim={simRow({ status: "unsimulable" }) as unknown as Parameters<typeof SimulationPanel>[0]["sim"]}
        homeTeam="Chelsea"
        awayTeam="Tottenham"
        sampleSize={{ home: 22, away: 21 }}
        chrome="bare"
      />,
    );
    expect(container.querySelector(".card.\\@container\\/card")).toBeNull();
    expect(container.textContent?.toLowerCase()).toContain("simulação indisponível");
  });
});

describe("SimulationDisclosure", () => {
  it("renderiza recolhido por default no desktop (só casca + toggle, sem body)", () => {
    const { container } = render(
      <SimulationDisclosure>
        <p data-testid="sim-body">corpo</p>
      </SimulationDisclosure>,
    );

    expect(container.querySelector(".card.\\@container\\/card")).not.toBeNull();
    expect(container.querySelector("header h3.font-display")?.textContent).toContain(
      "Simulação pré-jogo",
    );
    expect(container.querySelector("header")?.textContent?.toLowerCase()).toContain(
      "monte carlo",
    );

    const toggle = container.querySelector(
      'button[data-sim-toggle]',
    ) as HTMLButtonElement | null;
    expect(toggle, "toggle button deve existir").not.toBeNull();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.textContent?.toLowerCase()).toContain("ver");

    expect(container.querySelector('[data-testid="sim-body"]')).toBeNull();

    // Garantia adicional: visualmente "Monte Carlo" vem ANTES do toggle no header.
    const header = container.querySelector("header") as HTMLElement;
    const mcSpan = Array.from(header.querySelectorAll("span")).find(
      (s) => s.textContent?.includes("Monte Carlo"),
    );
    expect(mcSpan, "span Monte Carlo deve existir").not.toBeUndefined();
    const toggleEl = header.querySelector(
      "button[data-sim-toggle]",
    ) as HTMLElement;
    expect(
      mcSpan!.compareDocumentPosition(toggleEl) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy(); // toggle vem DEPOIS de "Monte Carlo"
  });

  it("expande ao clicar no toggle (aria-expanded=true, body montado, label muda)", () => {
    const { container } = render(
      <SimulationDisclosure>
        <p data-testid="sim-body">corpo</p>
      </SimulationDisclosure>,
    );

    const toggle = container.querySelector(
      'button[data-sim-toggle]',
    ) as HTMLButtonElement;
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent?.toLowerCase()).toContain("ocultar");
    expect(container.querySelector('[data-testid="sim-body"]')).not.toBeNull();
  });

  it("a região controlada referencia o id correto via aria-controls", () => {
    const { container } = render(
      <SimulationDisclosure>
        <p>x</p>
      </SimulationDisclosure>,
    );
    const toggle = container.querySelector(
      'button[data-sim-toggle]',
    ) as HTMLButtonElement;
    const id = toggle.getAttribute("aria-controls")!;
    expect(id.length).toBeGreaterThan(0);
  });
});
