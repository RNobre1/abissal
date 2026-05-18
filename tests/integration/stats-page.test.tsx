import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
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

/**
 * The page also reads the pre-game simulation from `fixture_simulations`
 * (Wave 2b / Task 3). These tests focus on the fixtures/hero/panels
 * contract, so the simulation table resolves to `null` (the SIM panel
 * degrades gracefully) and we DON'T let it clobber `lastTable`/`lastEq`.
 */
function buildNullSimBuilder() {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
  return builder;
}

const mockClient = {
  from: (table: string) => {
    if (table === "fixture_simulations") return buildNullSimBuilder();
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
  // Stub the Client Component hooks consumed by wave-4 panels
  // (StreaksHeatmap, Players, MarketsBrowser). The Server Component itself
  // doesn't call them; they execute when React renders the panel subtrees.
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => "/",
}));

// Import AFTER mocks so the Server Component binds to them.
import StatsPage from "@/app/(dashboard)/fixtures/[id]/page";

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

    // 1X2 odds from odds_summary.Match Result. These odd values also surface
    // in the MarketsBrowser headline cards (wave 4), so we use getAllByText
    // and assert at least one occurrence.
    expect(screen.getAllByText("2.05").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3.40").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3.60").length).toBeGreaterThan(0);
    // Over 2.5 implied probability — surfaced as the decimal odd "1.85"
    // so the hero tile is unambiguous on first read.
    expect(screen.getAllByText("1.85").length).toBeGreaterThan(0);
    // BTTS odd
    expect(screen.getAllByText("1.70").length).toBeGreaterThan(0);
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

  it("mounts all panel slots (A..H) when detail_json is populated", async () => {
    setRow(makeRow({ detail_json: makeDetail() as unknown }));

    const { container } = await renderPage("42");

    // 12-column grid IDs declared by page.tsx. Optional ones (I, J, N) only
    // mount when their source data is non-empty — the makeDetail() fixture
    // populates referee_record but not predictions/insights, so we assert
    // only the always-present panels here. F (streaks), G+ (players) and H
    // (markets-browser) are wave-4 plugins; they always mount, panels handle
    // empty data themselves.
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
      "F",          // streaks heatmap (wave 4)
      "G+",         // players (wave 4)
      "H",          // markets browser (wave 4)
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

// ─── T9: opt-out / optional panel scenarios ─────────────────────────────
//
// The slot wrapper (`renderPanelSlot`) always mounts `<div data-panel="…">`,
// but the panel component itself may return `null` when its data is empty.
// These tests pin that contract — DOM stays stable (no surprise unmounts),
// content disappears.
describe("StatsPage optional panel handling", () => {
  beforeEach(() => {
    resetMock();
  });

  it("omits referee panel content when referee_record is null", async () => {
    const detail = makeDetail();
    detail.referee_record = null;
    setRow(makeRow({ detail_json: detail as unknown }));

    const { container } = await renderPage("42");

    // Slot wrapper must still mount (layout stability).
    const slot = container.querySelector('[data-panel="I"]');
    expect(slot).not.toBeNull();
    // Inner Referee panel returns null when record is null, so the slot
    // div has no rendered content for the panel headline.
    expect(slot?.querySelector("[data-bp-headline]")).toBeNull();
    // Hero KPI Ref BP should also fall through to the em-dash.
    // 47.5 was the referee headline value in the fully-populated fixture;
    // when ref_avg_bp is null the tile renders "—".
    expect(screen.queryByText("47.5")).toBeNull();
  });

  it("omits predictions panel content when predictions is an empty array", async () => {
    const detail = makeDetail();
    detail.predictions = [];
    setRow(makeRow({ detail_json: detail as unknown }));

    const { container } = await renderPage("42");

    // Slot J may or may not be present (page.tsx omits it from the list
    // when predictions is empty? — actually we always mount it). Either
    // way, no <li data-prediction> should render.
    expect(container.querySelector("[data-prediction]")).toBeNull();
  });

  it("omits markets-browser content when odds_summary is an empty object", async () => {
    const detail = makeDetail();
    detail.odds_summary = {};
    setRow(makeRow({ detail_json: detail as unknown }));

    const { container } = await renderPage("42");

    // Wave-4 slot H still mounts; the MarketsBrowser internally returns
    // null when there are zero markets (total === 0).
    const slot = container.querySelector('[data-panel="H"]');
    expect(slot).not.toBeNull();
    // No category buttons / market cards inside.
    expect(slot?.querySelectorAll("button").length).toBe(0);
  });
});

// ─── T8: explanatory layer integration + float regression guard ──────────
//
// Wave 3 added the explanatory primitives (TeamLegend, RichTooltipCard,
// InfoPopover) and changed two panel signatures. Task 8 re-plugs page.tsx
// so the legend names + tooltips reach the slots. These tests pin the
// integrated contract:
//   1. `[data-team-legend]` renders on ≥1 panel.
//   2. No raw float (≥6 fraction digits) leaks into the DOM — Wave 3 routed
//      every numeric through `fmtNum`/`fmtInt`; a regression would re-expose
//      e.g. "0.452631…". Guards the whole rendered subtree.
//   3. `[data-rich-tooltip]` is mountable somewhere in the tree.
//   4. The page mounts without crashing on a payload that exercises the
//      changed slots (recent_matches + predictions populated).

function makeRawMatch(
  overrides: Partial<import("@/lib/fixtures/stats/detail-json-types").RawRecentMatch> = {},
): import("@/lib/fixtures/stats/detail-json-types").RawRecentMatch {
  return {
    id: 1,
    date: 1_715_000_000_000,
    date_iso: "2026-05-06T18:00:00+00:00",
    status: "FT",
    league: "Premier League",
    home_team: "Chelsea",
    away_team: "Arsenal",
    result: "W",
    htResult: "D",
    homeGoalsFt: 2,
    awayGoalsFt: 1,
    homeGoalsHt: 0,
    awayGoalsHt: 0,
    homeYellows: 1,
    awayYellows: 2,
    homeReds: 0,
    awayReds: 0,
    homeYellowReds: 0,
    awayYellowReds: 0,
    homeBookingPoints: 10,
    awayBookingPoints: 20,
    homeTotalShots: 14,
    awayTotalShots: 9,
    homeShotsOnTarget: 6,
    awayShotsOnTarget: 3,
    homeCorners: 7,
    awayCorners: 4,
    homeCorners1h: 3,
    awayCorners1h: 2,
    homeCorners2h: 4,
    awayCorners2h: 2,
    homeFouls: 11,
    awayFouls: 13,
    homeOffsides: 2,
    awayOffsides: 1,
    homeTackles: 18,
    awayTackles: 21,
    ...overrides,
  };
}

function makeRichDetail(): DetailJson {
  const detail = makeDetail();
  detail.recent_matches = {
    home: [
      makeRawMatch({ id: 1, date_iso: "2026-05-06T18:00:00+00:00" }),
      makeRawMatch({
        id: 2,
        date_iso: "2026-04-28T18:00:00+00:00",
        result: "L",
        homeGoalsFt: 0,
        awayGoalsFt: 3,
      }),
      makeRawMatch({
        id: 3,
        date_iso: "2026-04-20T18:00:00+00:00",
        result: "D",
        homeGoalsFt: 1,
        awayGoalsFt: 1,
      }),
    ],
    away: [
      makeRawMatch({
        id: 4,
        date_iso: "2026-05-05T18:00:00+00:00",
        home_team: "Tottenham",
        away_team: "Everton",
      }),
      makeRawMatch({
        id: 5,
        date_iso: "2026-04-27T18:00:00+00:00",
        home_team: "Tottenham",
        away_team: "Brighton",
        result: "L",
        homeGoalsFt: 1,
        awayGoalsFt: 2,
      }),
    ],
  };
  detail.predictions = [
    {
      stat_type: "Over 2.5 Goals",
      chance: 91,
      chance_team: null,
      best_odds: 1.85,
      best_odds_bookmaker: "bet365",
      home_stats: ["Marcou em 8 dos últimos 10"],
      away_stats: ["Sofreu gol em 7 dos últimos 10"],
    },
  ];
  return detail;
}

describe("StatsPage explanatory-layer integration (T8)", () => {
  beforeEach(() => {
    resetMock();
  });

  it("renders a team legend on at least one panel", async () => {
    setRow(makeRow({ detail_json: makeRichDetail() as unknown }));

    const { container } = await renderPage("42");

    expect(container.querySelectorAll("[data-team-legend]").length).toBeGreaterThan(0);
  });

  it("never leaks a raw float (≥6 fraction digits) into the DOM", async () => {
    setRow(makeRow({ detail_json: makeRichDetail() as unknown }));

    const { container } = await renderPage("42");

    const text = container.textContent ?? "";
    const rawFloat = text.match(/\d\.\d{6,}/);
    expect(
      rawFloat,
      `unformatted float leaked into DOM: "${rawFloat?.[0]}"`,
    ).toBeNull();
  });

  it("mounts the tooltip-bearing panels without crashing (rich tooltip wired)", async () => {
    setRow(makeRow({ detail_json: makeRichDetail() as unknown }));

    const { container } = await renderPage("42");

    // `[data-rich-tooltip]` is interaction-gated (recharts only renders the
    // tooltip `content` on hover; distributions uses local hover state), so
    // a static SSR render never paints it — the actual hover-visibility is
    // pinned by the Playwright e2e. Here we assert the panels that *carry*
    // a RichTooltip mount and survive a render with populated data.
    for (const id of ["C-home", "C-away", "K", "M", "G+"]) {
      expect(
        container.querySelector(`[data-panel="${id}"]`),
        `panel ${id} (carries a RichTooltip) should mount`,
      ).not.toBeNull();
    }
  });

  it("plugs the away team name into the recent-matches legend (slot C-away)", async () => {
    setRow(makeRow({ detail_json: makeRichDetail() as unknown }));

    const { container } = await renderPage("42");

    const cAway = container.querySelector('[data-panel="C-away"]');
    expect(cAway).not.toBeNull();
    const legend = cAway?.querySelector("[data-team-legend]");
    expect(legend).not.toBeNull();
    // teamName re-plugged in Task 8 → legend reads "Tottenham", not "time".
    expect(legend?.textContent).toContain("Tottenham");
  });

  it("mounts predictions slot J without crashing when predictions populated", async () => {
    setRow(makeRow({ detail_json: makeRichDetail() as unknown }));

    const { container } = await renderPage("42");

    const slotJ = container.querySelector('[data-panel="J"]');
    expect(slotJ).not.toBeNull();
    expect(slotJ?.querySelector("[data-prediction]")).not.toBeNull();
  });
});
