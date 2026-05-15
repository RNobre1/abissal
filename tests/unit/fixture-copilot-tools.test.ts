import { describe, it, expect } from "vitest";
import {
  FIXTURE_TOOLS,
  executeFixtureTool,
  summarizeFixtureToolResult,
  type FixtureToolCtx,
} from "@/lib/fixtures/fixture-copilot-tools";

const DETAIL = {
  team_record: { home: { type: "Home", played: 10, won: 5, draw: 2, lost: 3 }, away: {} },
  recent_matches: { home: [], away: [] },
  h2h: [],
  streaks: { home: [], away: [] },
  referee_record: { name: "Mike Dean", avg_booking_points: 42 },
  odds_summary: {},
  player_stats: { home: { top_players: [] }, away: { top_players: [] } },
  predictions: [],
} as unknown;

const ctx: FixtureToolCtx = { detail: DETAIL, homeTeam: "Aston Villa", awayTeam: "Liverpool" };

describe("FIXTURE_TOOLS", () => {
  it("expõe 12 tools com nomes únicos e schema function", () => {
    const names = FIXTURE_TOOLS.map((t) => t.function.name);
    expect(new Set(names).size).toBe(12);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_insights", "get_team_record", "get_recent_matches", "get_h2h",
        "get_splits", "get_distributions", "get_radar", "get_player_stats",
        "get_streaks", "get_referee", "get_odds", "get_predictions",
      ]),
    );
    for (const t of FIXTURE_TOOLS) expect(t.type).toBe("function");
  });
});

describe("executeFixtureTool", () => {
  it("get_referee retorna a média de cartões do árbitro", async () => {
    const r = (await executeFixtureTool("get_referee", {}, ctx)) as Record<string, unknown>;
    expect(r.name).toBe("Mike Dean");
    expect(r.avg_booking_points).toBe(42);
  });

  it("get_team_record aceita side=home", async () => {
    const r = (await executeFixtureTool("get_team_record", { side: "home" }, ctx)) as Record<string, unknown>;
    expect(r).not.toHaveProperty("error");
  });

  it("tool desconhecida retorna {error}", async () => {
    const r = (await executeFixtureTool("get_nope", {}, ctx)) as Record<string, unknown>;
    expect(typeof r.error).toBe("string");
  });

  it("seção ausente degrada para {error}, não lança", async () => {
    const bare: FixtureToolCtx = { detail: {} as unknown, homeTeam: "A", awayTeam: "B" };
    const r = (await executeFixtureTool("get_referee", {}, bare)) as Record<string, unknown>;
    expect(typeof r.error).toBe("string");
  });

  it("get_recent_matches exige side e devolve array por lado", async () => {
    const r = (await executeFixtureTool("get_recent_matches", { side: "home" }, ctx)) as Record<string, unknown>;
    expect(Array.isArray(r.matches)).toBe(true);
  });

  it("get_team_record(side=away) reflete o split AWAY, não o HOME mislabeled", async () => {
    const distinctDetail = {
      team_record: {
        home: { type: "Home", played: 10, won: 7, draw: 2, lost: 1, points: 23, position: "3rd" },
        away: { type: "Away", played: 10, won: 2, draw: 3, lost: 5, points: 9, position: "14th" },
      },
    } as unknown;
    const c: FixtureToolCtx = { detail: distinctDetail, homeTeam: "A", awayTeam: "B" };
    const r = (await executeFixtureTool("get_team_record", { side: "away" }, c)) as Record<string, unknown>;
    expect(r).not.toHaveProperty("error");
    expect(r.side).toBe("away");
    const split = (r.split as Record<string, unknown>);
    // AWAY data (won 2 / 9 pts), NOT the HOME split (won 7 / 23 pts).
    expect(split.won).toBe(2);
    expect(split.points).toBe(9);
  });
});

describe("summarizeFixtureToolResult", () => {
  it("resume erro como 'error: ...'", () => {
    expect(summarizeFixtureToolResult("get_referee", { error: "sem árbitro" })).toBe("error: sem árbitro");
  });
  it("resume array por contagem", () => {
    expect(summarizeFixtureToolResult("get_h2h", { matches: [1, 2, 3] })).toContain("3");
  });
});
