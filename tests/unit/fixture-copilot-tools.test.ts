import { describe, it, expect } from "vitest";
import {
  FIXTURE_TOOLS,
  executeFixtureTool,
  summarizeFixtureToolResult,
  type FixtureToolCtx,
} from "@/lib/fixtures/fixture-copilot-tools";

/**
 * Unit dos 12 wrappers de tool do copilot do jogo.
 * Contrato: nunca lançam; seção ausente → { error: string }.
 */

const RECENT_MATCH = {
  id: 1,
  date: 1747699200000,
  date_iso: "2026-05-20",
  status: "FT",
  league: "Premier League",
  home_team: "Aston Villa",
  away_team: "Everton",
  result: "W",
  htResult: "D",
  homeGoalsFt: 2,
  awayGoalsFt: 0,
  homeGoalsHt: 0,
  awayGoalsHt: 0,
  homeCorners: 6,
  awayCorners: 3,
  homeYellows: 1,
  awayYellows: 2,
  homeReds: 0,
  awayReds: 0,
  homeShotsOnTarget: 5,
  awayShotsOnTarget: 2,
};

const DETAIL = {
  team_record: {
    home: {
      home: {
        type: "Home",
        played: 10,
        won: 5,
        draw: 2,
        lost: 3,
        goals_for: 15,
        goals_against: 11,
        goal_diff: 4,
        points: 17,
        points_per_game: 1.7,
        position: "9th",
        form: ["W", "L", "W", "D", "W"],
      },
      overall: {
        type: "All",
        played: 20,
        won: 9,
        draw: 4,
        lost: 7,
        goals_for: 28,
        goals_against: 24,
        goal_diff: 4,
        points: 31,
        points_per_game: 1.55,
        position: "10th",
        form: ["W", "W", "L", "D", "W"],
      },
    },
    away: {},
  },
  recent_matches: { home: [RECENT_MATCH], away: [] },
  h2h: [RECENT_MATCH, { ...RECENT_MATCH, id: 2 }, { ...RECENT_MATCH, id: 3 }],
  streaks: {
    home: [
      {
        desc: "Over 2.5 goals",
        group: "Goals",
        stat_type: "over",
        line: 2.5,
        colour: "positive",
        overall_count: 7,
        overall_fixtures: 10,
        overall_perc: 70,
        overall_streak: 3,
        home_count: 4,
        home_fixtures: 5,
        home_perc: 80,
        home_streak: 2,
        away_count: 3,
        away_fixtures: 5,
        away_perc: 60,
        away_streak: 1,
      },
    ],
    away: [],
  },
  referee_record: {
    name: "Mike Dean",
    completed: 20,
    fixtures_count: 22,
    avg_total_booking_points: 42,
    avg_home_booking_points: 20,
    avg_away_booking_points: 22,
    total_yellow_reds: 3,
  },
  odds_summary: {
    Result: {
      "Aston Villa": { bookmaker: "bet365", decimal_odds: 2.1 },
      Draw: { bookmaker: "bet365", decimal_odds: 3.4 },
      Liverpool: { bookmaker: "bet365", decimal_odds: 3.2 },
    },
  },
  player_stats: {
    home: {
      aggregates: {},
      top_players: [
        {
          name: "Ollie Watkins",
          injured: false,
          played: 20,
          started: 19,
          subs: 1,
          minutes: 1700,
          goals: 11,
          goals_1h: 5,
          goals_2h: 6,
          first_goals: 4,
          assists: 3,
          yellows: 2,
          reds: 0,
          cards_1h: 1,
          cards_2h: 1,
          first_cards: 0,
          total_shots: 55,
          shots_on_target: 28,
          tackles: 12,
          fouls_committed: 18,
          fouls_drawn: 22,
          offsides: 9,
        },
      ],
    },
    away: { aggregates: {}, top_players: [] },
  },
  predictions: [
    {
      stat_type: "over25",
      chance: 62,
      chance_team: null,
      best_odds: 1.8,
      best_odds_bookmaker: "bet365",
      home_stats: [],
      away_stats: [],
    },
  ],
} as unknown;

const ctx: FixtureToolCtx = {
  detail: DETAIL,
  homeTeam: "Aston Villa",
  awayTeam: "Liverpool",
};

const bare: FixtureToolCtx = {
  detail: {} as unknown,
  homeTeam: "A",
  awayTeam: "B",
};

describe("FIXTURE_TOOLS", () => {
  it("expõe 12 tools com nomes únicos e schema function", () => {
    const names = FIXTURE_TOOLS.map((t) => t.function.name);
    expect(names).toHaveLength(12);
    expect(new Set(names).size).toBe(12);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_insights",
        "get_team_record",
        "get_recent_matches",
        "get_h2h",
        "get_splits",
        "get_distributions",
        "get_radar",
        "get_player_stats",
        "get_streaks",
        "get_referee",
        "get_odds",
        "get_predictions",
      ]),
    );
    for (const t of FIXTURE_TOOLS) {
      expect(t.type).toBe("function");
      expect(typeof t.function.description).toBe("string");
      expect(t.function.parameters).toBeTruthy();
    }
  });
});

describe("executeFixtureTool", () => {
  it("cada uma das 12 tools executa sobre o detail completo sem lançar", async () => {
    for (const t of FIXTURE_TOOLS) {
      const r = await executeFixtureTool(t.function.name, { side: "home" }, ctx);
      expect(r).toBeTypeOf("object");
    }
  });

  it("get_referee retorna a média de booking points do árbitro", async () => {
    const r = (await executeFixtureTool("get_referee", {}, ctx)) as Record<
      string,
      unknown
    >;
    expect(r.name).toBe("Mike Dean");
    expect(r.avg_total_booking_points).toBe(42);
  });

  it("get_team_record aceita side=home e devolve split+overall derivados", async () => {
    const r = (await executeFixtureTool(
      "get_team_record",
      { side: "home" },
      ctx,
    )) as Record<string, unknown>;
    expect(r).not.toHaveProperty("error");
    expect(r.side).toBe("home");
    const split = r.split as Record<string, unknown>;
    expect(split.played).toBe(10);
    expect(split.position).toBe(9); // "9th" parseado pelo deriveTeamRecord
  });

  it("get_recent_matches devolve array normalizado por lado", async () => {
    const r = (await executeFixtureTool(
      "get_recent_matches",
      { side: "home" },
      ctx,
    )) as Record<string, unknown>;
    expect(Array.isArray(r.matches)).toBe(true);
    expect((r.matches as unknown[]).length).toBe(1);
  });

  it("get_h2h devolve os confrontos diretos", async () => {
    const r = (await executeFixtureTool("get_h2h", {}, ctx)) as Record<
      string,
      unknown
    >;
    expect(Array.isArray(r.matches)).toBe(true);
    expect((r.matches as unknown[]).length).toBe(3);
  });

  it("get_odds agrupa mercados por categoria", async () => {
    const r = (await executeFixtureTool("get_odds", {}, ctx)) as Record<
      string,
      unknown
    >;
    expect(r).toHaveProperty("categories");
    const cats = r.categories as Record<string, unknown>;
    expect(cats.match).toBeTruthy();
  });

  it("get_streaks agrupa por grupo", async () => {
    const r = (await executeFixtureTool("get_streaks", {}, ctx)) as Record<
      string,
      unknown
    >;
    const streaks = r.streaks as { all: unknown[]; by_group: Record<string, unknown> };
    expect(streaks.all.length).toBe(1);
    expect(streaks.by_group.Goals).toBeTruthy();
  });

  it("get_player_stats devolve top players compactos do lado", async () => {
    const r = (await executeFixtureTool(
      "get_player_stats",
      { side: "home" },
      ctx,
    )) as Record<string, unknown>;
    const players = r.top_players as Array<Record<string, unknown>>;
    expect(players.length).toBe(1);
    expect(players[0].name).toBe("Ollie Watkins");
    expect(players[0].goals).toBe(11);
  });

  it("get_predictions devolve as predições do provedor", async () => {
    const r = (await executeFixtureTool("get_predictions", {}, ctx)) as Record<
      string,
      unknown
    >;
    expect(Array.isArray(r.predictions)).toBe(true);
  });

  it("tool desconhecida retorna {error}, não lança", async () => {
    const r = (await executeFixtureTool("get_nope", {}, ctx)) as Record<
      string,
      unknown
    >;
    expect(typeof r.error).toBe("string");
  });

  it("seção ausente degrada para {error} em vez de lançar", async () => {
    for (const name of [
      "get_referee",
      "get_team_record",
      "get_recent_matches",
      "get_h2h",
      "get_splits",
      "get_distributions",
      "get_radar",
      "get_player_stats",
      "get_streaks",
      "get_odds",
      "get_predictions",
      "get_insights",
    ]) {
      const r = (await executeFixtureTool(name, {}, bare)) as Record<
        string,
        unknown
      >;
      expect(typeof r.error, `${name} deveria degradar com {error}`).toBe(
        "string",
      );
    }
  });

  it("get_insights computa e ranqueia sobre os jogos recentes do mandante", async () => {
    const r = (await executeFixtureTool("get_insights", {}, ctx)) as Record<
      string,
      unknown
    >;
    // 1 jogo só não gera correlação/trend, mas o contrato é {insights: []}, não erro.
    expect(Array.isArray(r.insights)).toBe(true);
  });
});

describe("summarizeFixtureToolResult", () => {
  it("resume erro como 'error: ...'", () => {
    expect(
      summarizeFixtureToolResult("get_referee", { error: "sem árbitro" }),
    ).toBe("error: sem árbitro");
  });

  it("resume array por contagem", () => {
    expect(summarizeFixtureToolResult("get_h2h", { matches: [1, 2, 3] })).toContain(
      "3",
    );
  });

  it("resume objeto escalar como ok", () => {
    expect(summarizeFixtureToolResult("get_referee", { name: "X" })).toContain(
      "ok",
    );
  });
});
