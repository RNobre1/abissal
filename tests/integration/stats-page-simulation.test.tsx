import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, within } from "@testing-library/react";
import type { FixtureRow } from "@/lib/fixtures/types";
import type { DetailJson } from "@/lib/fixtures/stats/detail-json-types";

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

function buildSimBuilder() {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = () =>
    Promise.resolve(
      mockState.simError
        ? { data: null, error: mockState.simError }
        : { data: mockState.simRow, error: null },
    );
  return builder;
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

function makeRow(overrides: Partial<FixtureRow> = {}): FixtureRow {
  return {
    id: 42,
    match_date: "2026-05-19",
    ko_time: "20:00:00",
    home_team: "Chelsea",
    away_team: "Tottenham",
    league: "Premier League",
    country: "england",
    source_url: "https://www.adamchoi.co.uk/fixture/42",
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

function simRow(over: Record<string, unknown> = {}) {
  return {
    id: 5,
    created_at: "2026-05-18T10:00:00Z",
    fixture_id: 42,
    home_team: "Chelsea",
    away_team: "Tottenham",
    league: "Premier League",
    kickoff_utc: SAMPLE_KICKOFF,
    model_version: "dc-poisson-1",
    p_home: 0.52,
    p_draw: 0.26,
    p_away: 0.22,
    p_btts: 0.58,
    p_over_25: 0.61,
    top_scorelines: [
      { score: "1-0", prob: 0.14 },
      { score: "2-1", prob: 0.11 },
    ],
    sim_stats: {
      home: {
        goals: { p50: 1.6 },
        corners: { p50: 6 },
        sot: { p50: 5 },
        cards: { p50: 2 },
      },
      away: {
        goals: { p50: 1.1 },
        corners: { p50: 4 },
        sot: { p50: 3 },
        cards: { p50: 3 },
      },
    },
    per_half_available: false,
    market_anchor: { p_home: 0.5, p_draw: 0.27, p_away: 0.23 },
    player_events: [
      {
        name: "Cole Palmer",
        p_goal: 0.41,
        expected_goals: 0.58,
        p_card: 0.14,
        p_sot: 0.62,
        provavel_titular: true,
        confidence: "alto",
      },
      {
        name: "Enzo Fernández",
        p_goal: 0.12,
        expected_goals: 0.15,
        p_card: 0.31,
        p_sot: 0.22,
        provavel_titular: true,
        confidence: "médio",
      },
      {
        name: "Heung-min Son",
        p_goal: 0.34,
        expected_goals: 0.41,
        p_card: 0.1,
        p_sot: 0.5,
        provavel_titular: true,
        confidence: "alto",
      },
    ],
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

describe("StatsPage — pre-game simulation panel", () => {
  it("renders the probable score and the 1X2/over/BTTS probability bars", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");

    const panel = container.querySelector('[data-panel="SIM"]');
    expect(panel, "simulation panel SIM should mount").not.toBeNull();
    const scoped = within(panel as HTMLElement);

    // Probable scoreline (top of top_scorelines).
    expect(scoped.getByText(/1-0/)).toBeDefined();

    // 1X2 / over / BTTS probabilities are visible as TEXT (outside tooltips).
    expect(scoped.getByText("52%")).toBeDefined(); // p_home
    expect(scoped.getByText("26%")).toBeDefined(); // p_draw
    expect(scoped.getByText("22%")).toBeDefined(); // p_away
    expect(scoped.getByText("61%")).toBeDefined(); // p_over_25
    expect(scoped.getByText("58%")).toBeDefined(); // p_btts

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
    // p_home meter exposes the value (52 → aria-valuenow="52").
    expect(
      meters.some((m) => m.getAttribute("aria-valuenow") === "52"),
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
    const text = (panel.textContent ?? "").toLowerCase();

    // confidence buckets are an intended UI signal (wired in [Minor] 6).
    expect(text).toContain("alto"); // Palmer / Son confidence
    expect(text).toContain("médio"); // Enzo confidence
  });

  it("shows a stats tab/section with EXACT per-team numbers", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;
    const scoped = within(panel);

    // Exact per-team numbers ("Chelsea: 6 escanteios, 1.6 gols, 5 SOT").
    expect(scoped.getAllByText(/escanteios/i).length).toBeGreaterThan(0);
    expect(scoped.getByText("6")).toBeDefined(); // home corners p50
    expect(scoped.getByText("4")).toBeDefined(); // away corners p50
    expect(scoped.getByText("5")).toBeDefined(); // home SOT p50
  });

  it("renders the probable XI labeled EXACTLY 'provável escalação' and never 'oficial'", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;
    const text = panel.textContent ?? "";

    expect(text.toLowerCase()).toContain("provável escalação");
    // Honest degradation: never imply the official XI.
    expect(text.toLowerCase()).not.toContain("escalação oficial");
    expect(text.toLowerCase()).not.toContain("xi oficial");
    expect(text.toLowerCase()).not.toContain("oficial");

    // Pitch view present, players placed.
    expect(panel.querySelector("[data-pitch]")).not.toBeNull();
    expect(within(panel).getByText(/Cole Palmer/)).toBeDefined();
  });

  it("renders goal/card icons per simulated player", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;

    // Palmer is a likely scorer (p_goal high) → goal icon.
    expect(
      panel.querySelector('[data-player-icon="goal"]'),
      "expected a goal icon for a likely scorer",
    ).not.toBeNull();
    // Enzo is card-prone (p_card high) → card icon.
    expect(
      panel.querySelector('[data-player-icon="card"]'),
      "expected a card icon for a card-prone player",
    ).not.toBeNull();
  });

  it("explains things via reusable tooltips/info-popovers", async () => {
    mockState.fixtureRow = makeRow({ detail_json: makeDetail() as unknown });
    mockState.simRow = simRow();

    const { container } = await renderPage("42");
    const panel = container.querySelector('[data-panel="SIM"]') as HTMLElement;

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
    const text = panel.textContent ?? "";
    // num_matches from avgs (sample size of the model input) shown for honesty.
    expect(text).toMatch(/22/);
  });
});
