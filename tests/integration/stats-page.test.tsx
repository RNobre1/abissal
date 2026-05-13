import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { FixtureRow } from "@/lib/fixtures/types";
import type { DetailJson } from "@/lib/fixtures/stats/detail-json-types";

// lightweight-charts (used by MomentumChart panel B) hits canvas/WebGL,
// neither of which happy-dom implements. Same mock used by the unit panel
// test.
vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => ({
    addLineSeries: vi.fn(() => ({ setData: vi.fn() })),
    remove: vi.fn(),
    applyOptions: vi.fn(),
    timeScale: () => ({ fitContent: vi.fn() }),
  })),
}));

/**
 * Minimal in-memory Supabase mock for the stats Server Component page.
 *
 * Chain emulated:
 *   client.from("fixtures").select("...").eq("id", id).maybeSingle()
 *
 * `maybeSingle()` resolves to { data, error }.
 */
type MockState = {
  row: FixtureRow | null;
  error: { message: string } | null;
  lastTable: string | null;
  lastSelect: string | null;
  lastEq: { column: string; value: unknown } | null;
};

const mockState: MockState = {
  row: null,
  error: null,
  lastTable: null,
  lastSelect: null,
  lastEq: null,
};

function setRow(row: FixtureRow | null) {
  mockState.row = row;
  mockState.error = null;
}

function resetMock() {
  mockState.row = null;
  mockState.error = null;
  mockState.lastTable = null;
  mockState.lastSelect = null;
  mockState.lastEq = null;
}

function buildQueryBuilder() {
  const builder: Record<string, unknown> = {};
  builder.select = (cols: string) => {
    mockState.lastSelect = cols;
    return builder;
  };
  builder.eq = (column: string, value: unknown) => {
    mockState.lastEq = { column, value };
    return builder;
  };
  builder.maybeSingle = () =>
    Promise.resolve(
      mockState.error
        ? { data: null, error: mockState.error }
        : { data: mockState.row, error: null },
    );
  return builder;
}

const mockClient = {
  from: (table: string) => {
    mockState.lastTable = table;
    return buildQueryBuilder();
  },
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockClient,
}));

/**
 * `notFound()` from next/navigation throws a special error inside the App
 * Router runtime. In a vitest unit we substitute a plain `NotFoundError`
 * so we can assert the page bails out without rendering.
 */
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
}));

// Import AFTER mocks so the Server Component binds to them.
import StatsPage from "@/app/(dashboard)/fixtures/[id]/stats/page";

const SAMPLE_KICKOFF = "2026-05-12T19:00:00+00:00"; // 16:00 BRT

function makeRow(overrides: Partial<FixtureRow> = {}): FixtureRow {
  return {
    id: 42,
    match_date: "2026-05-12",
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

function makeDetail(): DetailJson {
  // Minimal but structurally valid payload — covers the data points the hero
  // needs to compute (over_pct, btts_pct, ref_avg_bp). Other panels accept
  // partial data, so we only populate what hero consumes plus filler.
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
    referee_record: {
      name: "Michael Oliver",
      completed: 12,
      fixtures_count: 12,
      avg_total_booking_points: 47.5,
      avg_home_booking_points: 22.5,
      avg_away_booking_points: 25.0,
      total_yellow_reds: 1,
    },
    odds_summary: {
      // Real choistats shape: "Result" keys are team names (long form) +
      // "Draw"; "Match Goals Overs/Unders" keys are "Over 2.5" / "Under 2.5".
      Result: {
        Chelsea: { bookmaker: "bet365", decimal_odds: 2.05 },
        Draw: { bookmaker: "bet365", decimal_odds: 3.4 },
        Tottenham: { bookmaker: "bet365", decimal_odds: 3.6 },
      },
      "Match Goals Overs/Unders": {
        "Over 2.5": { bookmaker: "bet365", decimal_odds: 1.85 },
        "Under 2.5": { bookmaker: "bet365", decimal_odds: 1.95 },
      },
      BTTS: {
        Yes: { bookmaker: "bet365", decimal_odds: 1.7 },
        No: { bookmaker: "bet365", decimal_odds: 2.1 },
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

describe("StatsPage server component", () => {
  it("renders the hero with teams and BRT-formatted kickoff for a valid fixture", async () => {
    setRow(makeRow());

    await renderPage("42");

    expect(mockState.lastTable).toBe("fixtures");
    expect(mockState.lastEq).toEqual({ column: "id", value: 42 });
    // The H1 splits the team names with a <span>vs</span> in between, so
    // textContent is the right thing to look at instead of getByText.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toContain("Chelsea");
    expect(heading.textContent).toContain("Tottenham");
    // 19:00 UTC → 16:00 BRT (no DST in São Paulo since 2019).
    expect(screen.getByText(/16:00/)).toBeDefined();
  });

  it("404s when the id is not a positive integer", async () => {
    await expect(renderPage("abc")).rejects.toMatchObject({
      digest: "NEXT_NOT_FOUND",
    });
    // We never even called Supabase.
    expect(mockState.lastTable).toBeNull();
  });

  it("404s when the fixture does not exist", async () => {
    setRow(null);

    await expect(renderPage("999")).rejects.toMatchObject({
      digest: "NEXT_NOT_FOUND",
    });
    expect(mockState.lastEq).toEqual({ column: "id", value: 999 });
  });

  it("renders the 'stats em breve' fallback when detail_json is null", async () => {
    setRow(makeRow({ detail_json: null }));

    await renderPage("42");

    expect(screen.getByText(/stats em breve/i)).toBeDefined();
  });

  it("renders KPI tiles with computed values when detail_json is populated", async () => {
    setRow(makeRow({ detail_json: makeDetail() as unknown }));

    await renderPage("42");

    // 1X2 odds from odds_summary.Match Result
    expect(screen.getByText("2.05")).toBeDefined();
    expect(screen.getByText("3.40")).toBeDefined();
    expect(screen.getByText("3.60")).toBeDefined();
    // Over 2.5 implied probability — surfaced as the decimal odd "1.85"
    // so the hero tile is unambiguous on first read.
    expect(screen.getByText("1.85")).toBeDefined();
    // BTTS odd
    expect(screen.getByText("1.70")).toBeDefined();
    // Referee average booking points — surfaced both in the Hero KPI tile
    // and the Referee panel below; assert at least one exists.
    expect(screen.getAllByText("47.5").length).toBeGreaterThan(0);
  });

  it("exposes the back link to the AI analyze page", async () => {
    setRow(makeRow());

    await renderPage("42");

    const back = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === "/fixtures/42");
    expect(back).toBeDefined();
  });

  it("mounts all 11 panel slots (A..N) when detail_json is populated", async () => {
    setRow(makeRow({ detail_json: makeDetail() as unknown }));

    const { container } = await renderPage("42");

    // 12-column grid IDs declared by page.tsx. Optional ones (I, J, N) only
    // mount when their source data is non-empty — the makeDetail() fixture
    // populates referee_record but not predictions/insights, so we assert
    // only the always-present panels here.
    const expected = [
      "B",          // momentum chart
      "A-home",     // team record home
      "A-away",     // team record away
      "D",          // h2h
      "E",          // splits 1h/2h
      "M",          // distributions
      "K",          // radar
      "L",          // scatter
      "I",          // referee — present in this fixture
      "C-home",     // recent matches home
      "C-away",     // recent matches away
    ];
    for (const id of expected) {
      const slot = container.querySelector(`[data-panel="${id}"]`);
      expect(slot, `panel ${id} should be mounted`).not.toBeNull();
    }

    // "painéis em construção" placeholder must NOT show.
    expect(screen.queryByText(/painéis em construção/i)).toBeNull();
  });
});
