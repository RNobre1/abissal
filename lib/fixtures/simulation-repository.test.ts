import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getFixtureSimulation } from "./simulation-repository";

/**
 * `fixture_simulations` reader — scalar-only contract (B12/B14/outage 1101).
 *
 * The Cloudflare Worker crashes (Error 1101) whenever a query pulls the heavy
 * `fixtures.detail_json` blob. `simulation-repository.ts` reads a SEPARATE
 * table whose jsonb fields (`top_scorelines`, `sim_stats`, `market_anchor`,
 * `player_events`) ARE the small simulation result itself — selecting them is
 * fine. What is forbidden is any reference to the heavy `detail_json` blob.
 *
 * Two layers of assertion mirror `repository-payload-guard.test.ts`:
 *   1. A static source scan: no bare `detail_json` token anywhere in any
 *      `.select(...)` literal (the T5 guard will later scan this file too).
 *   2. A behavioural mock asserting the captured select string + DTO mapping
 *      + graceful degradation.
 */

const SOURCE = readFileSync(
  join(__dirname, "simulation-repository.ts"),
  "utf8",
);

/** Paren-matched extraction of every `.select(...)` string literal. */
function extractSelectArguments(src: string): string[] {
  const out: string[] = [];
  const re = /\.select\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src)) !== null) {
    void match;
    let depth = 1;
    let i = re.lastIndex;
    let buf = "";
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        const quote = ch;
        i++;
        while (i < src.length && src[i] !== quote) {
          if (src[i] === "\\") i++;
          buf += src[i];
          i++;
        }
      }
      i++;
    }
    out.push(buf);
  }
  return out;
}

const EXPECTED_SCALAR_COLUMNS = [
  "id",
  "created_at",
  "fixture_id",
  "home_team",
  "away_team",
  "league",
  "kickoff_utc",
  "model_version",
  "p_home",
  "p_draw",
  "p_away",
  "p_btts",
  "p_over_25",
  "top_scorelines",
  "sim_stats",
  "per_half_available",
  "market_anchor",
  "player_events",
  "status",
  "actual_home_goals",
  "actual_away_goals",
  "correct_winner",
  "correct_over_under",
  "actual_resolved_at",
];

/**
 * Minimal thenable chain: from(table).select(arg).eq(col,val).maybeSingle().
 * Captures the table + select string so the regression test can assert no
 * detail_json crosses the wire.
 */
function buildMock(opts: {
  row?: Record<string, unknown> | null;
  error?: { message: string } | null;
  throwOnFrom?: boolean;
}) {
  const captured: {
    table?: string;
    select?: string;
    eq?: { column: string; value: unknown };
  } = {};
  const chain = {
    select(arg: string) {
      captured.select = arg;
      return this;
    },
    eq(column: string, value: unknown) {
      captured.eq = { column, value };
      return this;
    },
    maybeSingle() {
      return Promise.resolve(
        opts.error
          ? { data: null, error: opts.error }
          : { data: opts.row ?? null, error: null },
      );
    },
  };
  const client = {
    from(table: string) {
      if (opts.throwOnFrom) {
        throw new Error("relation \"fixture_simulations\" does not exist");
      }
      captured.table = table;
      return chain;
    },
  };
  return { client, captured };
}

function fullSimRow(over: Record<string, unknown> = {}) {
  return {
    id: 5,
    created_at: "2026-05-18T10:00:00Z",
    fixture_id: 42,
    home_team: "Chelsea",
    away_team: "Tottenham",
    league: "Premier League",
    kickoff_utc: "2026-05-19T19:00:00Z",
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
      home: { corners: { p50: 6 }, goals: { p50: 1.6 } },
      away: { corners: { p50: 4 }, goals: { p50: 1.1 } },
    },
    per_half_available: true,
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

describe("simulation-repository — static payload guard (no detail_json)", () => {
  const selects = extractSelectArguments(SOURCE);

  it("has at least one .select(...) to scan", () => {
    expect(selects.length).toBeGreaterThan(0);
  });

  it("no .select() references detail_json at all (bare or path)", () => {
    for (const sel of selects) {
      expect(
        sel,
        `forbidden detail_json reference in select: "${sel}"`,
      ).not.toContain("detail_json");
    }
  });

  it("the select lists ONLY the agreed scalar/jsonb-result columns", () => {
    // Empty matches come from `.select(...)` mentioned in doc comments; the
    // real query is the single non-empty literal.
    const real = selects.filter((s) => s.trim().length > 0);
    expect(real.length).toBe(1);
    for (const sel of real) {
      const cols = sel
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      for (const col of cols) {
        expect(
          EXPECTED_SCALAR_COLUMNS,
          `unexpected column "${col}" selected`,
        ).toContain(col);
      }
      // and every expected scalar must be present
      for (const want of EXPECTED_SCALAR_COLUMNS) {
        expect(cols, `missing column "${want}"`).toContain(want);
      }
    }
  });
});

describe("getFixtureSimulation — query + DTO mapping", () => {
  it("queries fixture_simulations by fixture_id, scalar select only", async () => {
    const { client, captured } = buildMock({ row: fullSimRow() });
    await getFixtureSimulation(42, client);

    expect(captured.table).toBe("fixture_simulations");
    expect(captured.eq).toEqual({ column: "fixture_id", value: 42 });
    expect(captured.select).toBeDefined();
    expect(captured.select).not.toContain("detail_json");
  });

  it("maps the row into a typed DTO", async () => {
    const { client } = buildMock({ row: fullSimRow() });
    const dto = await getFixtureSimulation(42, client);

    expect(dto).not.toBeNull();
    expect(dto!.fixture_id).toBe(42);
    expect(dto!.p_home).toBeCloseTo(0.52);
    expect(dto!.p_draw).toBeCloseTo(0.26);
    expect(dto!.p_away).toBeCloseTo(0.22);
    expect(dto!.p_btts).toBeCloseTo(0.58);
    expect(dto!.p_over_25).toBeCloseTo(0.61);
    expect(dto!.per_half_available).toBe(true);
    expect(dto!.top_scorelines[0]).toEqual({ score: "1-0", prob: 0.14 });
    expect(dto!.player_events[0].name).toBe("Cole Palmer");
    expect(dto!.player_events[0].provavel_titular).toBe(true);
    expect(dto!.status).toBe("simulated");
  });

  it("returns null when no row exists (graceful)", async () => {
    const { client } = buildMock({ row: null });
    expect(await getFixtureSimulation(99, client)).toBeNull();
  });

  it("degrades to null on query error (never throws)", async () => {
    const { client } = buildMock({
      error: { message: "relation does not exist" },
    });
    expect(await getFixtureSimulation(1, client)).toBeNull();
  });

  it("degrades to null when the table/relation is absent (from throws)", async () => {
    const { client } = buildMock({ throwOnFrom: true });
    expect(await getFixtureSimulation(1, client)).toBeNull();
  });

  it("normalizes missing jsonb fields to safe empties", async () => {
    const { client } = buildMock({
      row: fullSimRow({
        top_scorelines: null,
        sim_stats: null,
        player_events: null,
        market_anchor: null,
      }),
    });
    const dto = await getFixtureSimulation(42, client);
    expect(dto!.top_scorelines).toEqual([]);
    expect(dto!.player_events).toEqual([]);
    expect(dto!.sim_stats).toBeNull();
    expect(dto!.market_anchor).toBeNull();
  });

  it("maps status 'unsimulable' through unchanged", async () => {
    const { client } = buildMock({
      row: fullSimRow({ status: "unsimulable" }),
    });
    const dto = await getFixtureSimulation(42, client);
    expect(dto!.status).toBe("unsimulable");
  });
});
