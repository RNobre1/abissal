import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getRecommendationForFixture,
  fetchTopOpportunities,
} from "./reco-repository";

/**
 * `ai_recommendations` reader — scalar-only contract.
 *
 * Same payload guard rationale as `simulation-repository.test.ts` /
 * `repository-payload-guard.test.ts`: NO `.select()` literal in this file may
 * reference `detail_json` (the Cloudflare Worker 1101 outage class). The
 * `ai_recommendations` table does not have `detail_json` to begin with, but
 * the static guard (`repository-payload-guard.test.ts`) globs every
 * `lib/**\/*repository*.ts` and the convention is enforced uniformly.
 *
 * Behavioural assertions:
 *  - `getRecommendationForFixture` -> row|null (defensive on error)
 *  - `fetchTopOpportunities` -> ordered by edge_pct * confidence_weight desc
 *  - `fetchTopOpportunities` -> limit honoured, kickoff_utc>now filter applied
 *  - jsonb `red_flags` parsed defensively to array
 *  - errors from the client degrade to safe defaults (null / [])
 */

const SOURCE = readFileSync(join(__dirname, "reco-repository.ts"), "utf8");

/** Paren-matched extraction of every `.select(...)` string literal. */
function extractSelectArguments(src: string): string[] {
  const out: string[] = [];
  const indices: number[] = [];
  for (let p = 0; p < src.length; p++) {
    if (src.slice(p, p + 7) === ".select") {
      // skip whitespace then '('
      let q = p + 7;
      while (q < src.length && /\s/.test(src[q])) q++;
      if (src[q] === "(") indices.push(q + 1);
    }
  }
  for (const start of indices) {
    let depth = 1;
    let i = start;
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

interface CapturedQuery {
  table?: string;
  select?: string;
  eqs: Array<{ column: string; value: unknown }>;
  gts: Array<{ column: string; value: unknown }>;
  orders: Array<{ column: string; opts?: unknown }>;
  limit?: number;
}

function buildLookupMock(opts: {
  row?: Record<string, unknown> | null;
  error?: { message: string } | null;
  throwOnFrom?: boolean;
}) {
  const queries: CapturedQuery[] = [];
  const client = {
    from(table: string) {
      if (opts.throwOnFrom) {
        throw new Error('relation "ai_recommendations" does not exist');
      }
      const cap: CapturedQuery = {
        table,
        eqs: [],
        gts: [],
        orders: [],
      };
      queries.push(cap);
      const chain = {
        select(arg: string) {
          cap.select = arg;
          return this;
        },
        eq(column: string, value: unknown) {
          cap.eqs.push({ column, value });
          return this;
        },
        order(column: string, o?: unknown) {
          cap.orders.push({ column, opts: o });
          return this;
        },
        limit(n: number) {
          cap.limit = n;
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
      return chain;
    },
  };
  return { client, queries };
}

function buildListMock(opts: {
  rows?: Array<Record<string, unknown>>;
  error?: { message: string } | null;
  throwOnFrom?: boolean;
}) {
  const queries: CapturedQuery[] = [];
  const client = {
    from(table: string) {
      if (opts.throwOnFrom) {
        throw new Error('relation "ai_recommendations" does not exist');
      }
      const cap: CapturedQuery = {
        table,
        eqs: [],
        gts: [],
        orders: [],
      };
      queries.push(cap);
      const chain = {
        select(arg: string) {
          cap.select = arg;
          return this;
        },
        eq(column: string, value: unknown) {
          cap.eqs.push({ column, value });
          return this;
        },
        gt(column: string, value: unknown) {
          cap.gts.push({ column, value });
          return this;
        },
        order(column: string, o?: unknown) {
          cap.orders.push({ column, opts: o });
          return this;
        },
        limit(n: number) {
          cap.limit = n;
          // Terminal in list flow -> resolve to a thenable shape.
          return {
            then(resolve: (v: unknown) => void) {
              resolve(
                opts.error
                  ? { data: null, error: opts.error }
                  : { data: opts.rows ?? [], error: null },
              );
            },
          };
        },
      };
      return chain;
    },
  };
  return { client, queries };
}

function fullRecoRow(over: Record<string, unknown> = {}) {
  return {
    id: 42,
    created_at: "2026-05-24T10:00:00Z",
    fixture_id: 19427226,
    home_team: "Liverpool",
    away_team: "Tottenham",
    league: "Premier League",
    kickoff_utc: "2026-05-25T19:00:00Z",
    reco_version: "reco-v1",
    prompt_version: "prompt-v1.0",
    llm_model: "deepseek/deepseek-r1",
    verdict: "bet",
    market: "btts-sim",
    side: "yes",
    prob_estimated: 0.64,
    prob_calibrated: 0.62,
    edge_pct: 12.0,
    odd_captured: 1.85,
    kelly_pre: 1.8,
    units_final: 1.5,
    reduction_reason: "lineup incerta",
    confidence: "alto",
    summary_line: "BTTS-sim - 1.5u - 64%",
    reasoning_full: "Liverpool teve 5 BTTS consecutivos em casa contra defesas top-6...",
    red_flags: ["3 desfalques no ataque do TOT", "Forma recente do LIV irregular"],
    cost_usd: 0.018,
    league_calibrated: true,
    ...over,
  };
}

describe("reco-repository - static payload guard (no detail_json)", () => {
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
});

describe("getRecommendationForFixture", () => {
  it("returns the row mapped to AiRecommendationDTO when present", async () => {
    const { client, queries } = buildLookupMock({
      row: fullRecoRow(),
    });

    const dto = await getRecommendationForFixture(19427226, client);

    expect(dto).not.toBeNull();
    expect(dto!.id).toBe(42);
    expect(dto!.fixture_id).toBe(19427226);
    expect(dto!.verdict).toBe("bet");
    expect(dto!.market).toBe("btts-sim");
    expect(dto!.confidence).toBe("alto");
    expect(dto!.edge_pct).toBe(12.0);
    expect(dto!.red_flags).toEqual([
      "3 desfalques no ataque do TOT",
      "Forma recente do LIV irregular",
    ]);
    expect(dto!.league_calibrated).toBe(true);

    expect(queries[0].table).toBe("ai_recommendations");
    const fidEq = queries[0].eqs.find((e) => e.column === "fixture_id");
    expect(fidEq?.value).toBe(19427226);
  });

  it("returns null when there is no row", async () => {
    const { client } = buildLookupMock({ row: null });
    const dto = await getRecommendationForFixture(42, client);
    expect(dto).toBeNull();
  });

  it("returns null when the supabase client errors", async () => {
    const { client } = buildLookupMock({
      error: { message: "boom" },
    });
    const dto = await getRecommendationForFixture(42, client);
    expect(dto).toBeNull();
  });

  it("returns null gracefully when from() throws (table missing)", async () => {
    const { client } = buildLookupMock({ throwOnFrom: true });
    const dto = await getRecommendationForFixture(42, client);
    expect(dto).toBeNull();
  });

  it("parses jsonb red_flags defensively to an array (non-array -> [])", async () => {
    const { client } = buildLookupMock({
      row: fullRecoRow({ red_flags: null }),
    });
    const dto = await getRecommendationForFixture(19427226, client);
    expect(dto!.red_flags).toEqual([]);
  });

  it("scalar select only - never references detail_json on the wire", async () => {
    const { client, queries } = buildLookupMock({
      row: fullRecoRow(),
    });
    await getRecommendationForFixture(19427226, client);
    expect(queries[0].select).toBeDefined();
    expect(queries[0].select).not.toContain("detail_json");
  });
});

describe("fetchTopOpportunities", () => {
  it("returns an empty array when there are no rows", async () => {
    const { client } = buildListMock({ rows: [] });
    const tops = await fetchTopOpportunities(client, 5);
    expect(tops).toEqual([]);
  });

  it("returns an empty array gracefully when the client errors", async () => {
    const { client } = buildListMock({
      error: { message: "boom" },
    });
    const tops = await fetchTopOpportunities(client, 5);
    expect(tops).toEqual([]);
  });

  it("returns an empty array gracefully when from() throws", async () => {
    const { client } = buildListMock({ throwOnFrom: true });
    const tops = await fetchTopOpportunities(client, 5);
    expect(tops).toEqual([]);
  });

  it("filters verdict='bet' and kickoff_utc>now via the supabase query", async () => {
    const { client, queries } = buildListMock({
      rows: [fullRecoRow()],
    });
    await fetchTopOpportunities(client, 5);
    const q = queries[0];
    expect(q.eqs.some((e) => e.column === "verdict" && e.value === "bet")).toBe(
      true,
    );
    // kickoff_utc > now() filter is required (a `.gt("kickoff_utc", ...)` call)
    expect(q.gts.some((g) => g.column === "kickoff_utc")).toBe(true);
  });

  it("orders in memory by edge_pct * confidence_weight desc", async () => {
    // 3 rows, all verdict='bet'. Compute weighted scores:
    //   r1: edge 5  * 1.0 (alto)  = 5.0
    //   r2: edge 8  * 0.7 (medio) = 5.6
    //   r3: edge 20 * 0.4 (baixo) = 8.0
    // Expected order: r3, r2, r1.
    const { client } = buildListMock({
      rows: [
        fullRecoRow({ id: 1, edge_pct: 5, confidence: "alto" }),
        fullRecoRow({ id: 2, edge_pct: 8, confidence: "medio" }),
        fullRecoRow({ id: 3, edge_pct: 20, confidence: "baixo" }),
      ],
    });
    const tops = await fetchTopOpportunities(client, 5);
    expect(tops.map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it("slices to the requested limit AFTER sorting in memory", async () => {
    const { client } = buildListMock({
      rows: [
        fullRecoRow({ id: 1, edge_pct: 5, confidence: "alto" }),
        fullRecoRow({ id: 2, edge_pct: 8, confidence: "medio" }),
        fullRecoRow({ id: 3, edge_pct: 20, confidence: "baixo" }),
      ],
    });
    const tops = await fetchTopOpportunities(client, 2);
    expect(tops.map((r) => r.id)).toEqual([3, 2]);
  });

  it("defaults missing edge_pct to 0 and missing confidence to 'baixo' weight when sorting", async () => {
    // r1: edge=null     -> 0 * 0.4 = 0
    // r2: edge=10, conf=null -> 10 * 0.4 = 4
    // r3: edge=3, conf='alto' -> 3 * 1.0 = 3
    // Expected: r2, r3, r1
    const { client } = buildListMock({
      rows: [
        fullRecoRow({ id: 1, edge_pct: null, confidence: null }),
        fullRecoRow({ id: 2, edge_pct: 10, confidence: null }),
        fullRecoRow({ id: 3, edge_pct: 3, confidence: "alto" }),
      ],
    });
    const tops = await fetchTopOpportunities(client, 5);
    expect(tops.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it("scalar select only - never references detail_json on the wire", async () => {
    const { client, queries } = buildListMock({
      rows: [fullRecoRow()],
    });
    await fetchTopOpportunities(client, 5);
    expect(queries[0].select).toBeDefined();
    expect(queries[0].select).not.toContain("detail_json");
  });
});
