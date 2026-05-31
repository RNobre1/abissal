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
  "p_duplo_green",
  "p_duplo_green_home",
  "p_duplo_green_away",
  "p_both_2corners_both_halves",
];

/**
 * Captured state of one query path: every `.eq(col,val)` filter applied, the
 * select string, plus optional `.order(...)`/`.limit(...)` for the fallback.
 */
interface CapturedQuery {
  /** F3-prod: distingue queries de fixture_simulations das de model_calibration. */
  table?: string;
  select?: string;
  eqs: Array<{ column: string; value: unknown }>;
  orders: Array<{ column: string; opts?: unknown }>;
  limit?: number;
}

/**
 * Two-path Supabase mock. The new `getFixtureSimulation` issues a PRIMARY
 * query (`.eq("fixture_id", apiId).maybeSingle()`) and, on miss/no-apiId, a
 * FALLBACK query (teams + `kickoff_utc::date`, ordered `created_at desc`,
 * `.limit(1)`). Each path resolves from its own configured row so a test can
 * prove which path served the result.
 *
 * `primaryRow`/`fallbackRow` undefined ⇒ that path returns no row. The mock
 * captures the filters of every path so the regression test can assert the
 * PARSED choistats id (not the route/table id) was used.
 */
function buildMock(opts: {
  primaryRow?: Record<string, unknown> | null;
  fallbackRow?: Record<string, unknown> | null;
  error?: { message: string } | null;
  fallbackError?: { message: string } | null;
  throwOnFrom?: boolean;
  /**
   * Curvas isotônicas devolvidas pelo segundo `.from("model_calibration")`.
   * Default: array vazio → "sem calibração ativa", probs originais.
   */
  calibrationRows?: Array<Record<string, unknown>> | null;
  /** Erro na query de model_calibration → degrada pra sem calibração. */
  calibrationError?: { message: string } | null;
}) {
  const queries: CapturedQuery[] = [];

  function makeFixtureSimChain() {
    const cap: CapturedQuery = { table: "fixture_simulations", eqs: [], orders: [] };
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
      gte(column: string, value: unknown) {
        cap.eqs.push({ column: `${column}>=`, value });
        return this;
      },
      lt(column: string, value: unknown) {
        cap.eqs.push({ column: `${column}<`, value });
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
        // A query is the PRIMARY (id) path iff it filtered fixture_id.
        const isPrimary = cap.eqs.some((e) => e.column === "fixture_id");
        if (isPrimary) {
          return Promise.resolve(
            opts.error
              ? { data: null, error: opts.error }
              : { data: opts.primaryRow ?? null, error: null },
          );
        }
        return Promise.resolve(
          opts.fallbackError
            ? { data: null, error: opts.fallbackError }
            : { data: opts.fallbackRow ?? null, error: null },
        );
      },
    };
    return chain;
  }

  /**
   * Chain de model_calibration — diferente: o terminal é `.is("effective_until", null)`
   * que devolve `{data, error}` direto (não há `.maybeSingle()`, a query
   * devolve uma LISTA de até 4 rows).
   */
  function makeCalibrationChain() {
    const cap: CapturedQuery = { table: "model_calibration", eqs: [], orders: [] };
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
      is(column: string, value: unknown) {
        cap.eqs.push({ column: `${column} IS`, value });
        return Promise.resolve(
          opts.calibrationError
            ? { data: null, error: opts.calibrationError }
            : { data: opts.calibrationRows ?? [], error: null },
        );
      },
    };
    return chain;
  }

  const client = {
    from(table: string) {
      if (table === "model_calibration") {
        return makeCalibrationChain();
      }
      if (opts.throwOnFrom) {
        throw new Error('relation "fixture_simulations" does not exist');
      }
      void table;
      return makeFixtureSimChain();
    },
  };
  return { client, queries };
}

const ROUTE_ID_FIXTURE = {
  // The `fixtures` table primary key — the OLD buggy lookup key. The choistats
  // id parsed from source_url is a DIFFERENT id space (the bug under test).
  sourceUrl: "https://www.adamchoi.co.uk/fixture/19427226/england-premier-league-chelsea-vs-tottenham",
  homeTeam: "Chelsea",
  awayTeam: "Tottenham",
  kickoffUtc: "2026-05-19T19:00:00Z",
};

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
    // real queries are the non-empty literals (primary + teams/kickoff
    // fallback — both share the identical scalar column list).
    const real = selects.filter((s) => s.trim().length > 0);
    expect(real.length).toBeGreaterThanOrEqual(1);
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

describe("getFixtureSimulation — id-space mismatch regression", () => {
  /**
   * THE BUG: the page passed `row.id` (the `fixtures` PK, e.g. 716) while the
   * Ruby hook stores `fixture_simulations.fixture_id` = the choistats id
   * parsed from `source_url` (e.g. 19427226). These are different id spaces →
   * 0 rows ever matched → "simulação indisponível" for every fixture.
   *
   * This test gives the new API the fixture identity. The sim row only exists
   * under `fixture_id = 19427226` (the PARSED choistats id). The primary query
   * MUST filter `fixture_id` by 19427226 (parsed from source_url), NOT by any
   * route/table id, and MUST return that row.
   */
  it("matches by the choistats id parsed from source_url (not the route id)", async () => {
    const { client, queries } = buildMock({
      primaryRow: fullSimRow({ fixture_id: 19427226 }),
    });

    const dto = await getFixtureSimulation(ROUTE_ID_FIXTURE, client);

    expect(dto, "the sim row must be found via the parsed id").not.toBeNull();
    expect(dto!.fixture_id).toBe(19427226);

    const primary = queries[0];
    const fidEq = primary.eqs.find((e) => e.column === "fixture_id");
    expect(fidEq, "primary query must filter by fixture_id").toBeDefined();
    // The PARSED choistats id — same regex semantics as Ruby `fixture_api_id`.
    expect(fidEq!.value).toBe(19427226);
  });

  it("uses the SAME regex semantics as the Ruby fixture_api_id", async () => {
    // Ruby: /fixture/(\d+) matched anywhere in source_url; slug after the id
    // is ignored. A trailing slug must not corrupt the parsed id.
    const { client, queries } = buildMock({
      primaryRow: fullSimRow({ fixture_id: 99 }),
    });
    await getFixtureSimulation(
      {
        sourceUrl: "/fixture/99/spain-la-liga-real-vs-barca",
        homeTeam: "Real",
        awayTeam: "Barca",
        kickoffUtc: null,
      },
      client,
    );
    const fidEq = queries[0].eqs.find((e) => e.column === "fixture_id");
    expect(fidEq!.value).toBe(99);
  });

  it("scalar select only — never references detail_json on the wire", async () => {
    const { client, queries } = buildMock({
      primaryRow: fullSimRow({ fixture_id: 19427226 }),
    });
    await getFixtureSimulation(ROUTE_ID_FIXTURE, client);
    expect(queries[0].select).toBeDefined();
    expect(queries[0].select).not.toContain("detail_json");
  });
});

describe("getFixtureSimulation — teams/kickoff fallback", () => {
  it("falls back to teams + kickoff day when source_url has no numeric id", async () => {
    const { client, queries } = buildMock({
      fallbackRow: fullSimRow({ fixture_id: null }),
    });

    const dto = await getFixtureSimulation(
      {
        sourceUrl: null,
        homeTeam: "Chelsea",
        awayTeam: "Tottenham",
        kickoffUtc: "2026-05-19T19:00:00Z",
      },
      client,
    );

    expect(dto, "fallback must resolve the row").not.toBeNull();
    expect(dto!.home_team).toBe("Chelsea");

    // No apiId ⇒ exactly one fixture_simulations query path; F3-prod adiciona
    // uma SEGUNDA query (model_calibration) — filtramos pra contar só a 1ª.
    const fxQueries = queries.filter((q) => q.table === "fixture_simulations");
    expect(fxQueries.length).toBe(1);
    const fb = fxQueries[0];
    expect(fb.eqs.some((e) => e.column === "home_team" && e.value === "Chelsea")).toBe(true);
    expect(fb.eqs.some((e) => e.column === "away_team" && e.value === "Tottenham")).toBe(true);
    // Must constrain by kickoff (same teams can recur within retention) and
    // be deterministic (newest created_at first, limit 1).
    expect(fb.orders.some((o) => o.column === "created_at")).toBe(true);
    expect(fb.limit).toBe(1);
    // No detail_json on the fallback path either.
    expect(fb.select).not.toContain("detail_json");
  });

  it("falls back to teams/kickoff when the PRIMARY id query misses", async () => {
    // apiId present but no fixture_simulations row under it → fallback by
    // teams/kickoff must still resolve (e.g. id-space drift on old rows).
    const { client, queries } = buildMock({
      primaryRow: null,
      fallbackRow: fullSimRow({ fixture_id: null }),
    });

    const dto = await getFixtureSimulation(ROUTE_ID_FIXTURE, client);

    expect(dto, "fallback must rescue a primary miss").not.toBeNull();
    // F3-prod adiciona model_calibration; contamos só fixture_simulations.
    const fxQueries = queries.filter((q) => q.table === "fixture_simulations");
    expect(fxQueries.length).toBe(2); // primary (miss) + fallback (hit)
    expect(fxQueries[0].eqs.some((e) => e.column === "fixture_id")).toBe(true);
    expect(
      fxQueries[1].eqs.some((e) => e.column === "home_team"),
    ).toBe(true);
  });

  it("prefers the PRIMARY id hit and does NOT issue the fallback", async () => {
    const { client, queries } = buildMock({
      primaryRow: fullSimRow({ fixture_id: 19427226 }),
      fallbackRow: fullSimRow({ fixture_id: null, id: 999 }),
    });
    const dto = await getFixtureSimulation(ROUTE_ID_FIXTURE, client);
    expect(dto!.fixture_id).toBe(19427226);
    // F3-prod: contamos só queries de fixture_simulations (a 2ª query é
    // model_calibration buscando curvas — sempre dispara quando há row).
    const fxQueries = queries.filter((q) => q.table === "fixture_simulations");
    expect(fxQueries.length).toBe(1); // fallback never ran
  });
});

/**
 * F5 — multi model_version coexistência (migration 0021).
 *
 * Após o bump v4→v5, a MESMA fixture pode ter 2+ linhas em
 * fixture_simulations distintas por `model_version`. O reader é o "display
 * single-fixture" que SEMPRE retorna a versão mais recente. O agrupamento
 * por versão (e o Brier comparativo) vivem em /calibracao, não aqui.
 *
 * O contrato verificado: PRIMARY path ordena por created_at desc + limit 1
 * (mesmo padrão da FALLBACK), garantindo determinismo independente de qual
 * row o PostgREST devolveria sem ORDER BY.
 */
describe("getFixtureSimulation — F5 multi model_version", () => {
  it("PRIMARY path ordena por created_at desc + limit 1 (retorna a versão mais recente)", async () => {
    // Mock devolve fullSimRow no path PRIMARY. O importante é o CONTRATO da
    // query: a chain DEVE invocar .order("created_at", {ascending:false})
    // e .limit(1) — assim o Postgres devolve sempre a versão mais recente
    // quando 2+ linhas coexistem (v4 + v5).
    const { client, queries } = buildMock({
      primaryRow: fullSimRow({
        fixture_id: 19427226,
        model_version: "sim-v5",
        created_at: "2026-05-20T10:00:00Z",
      }),
    });

    const dto = await getFixtureSimulation(ROUTE_ID_FIXTURE, client);
    expect(dto).not.toBeNull();
    expect(dto!.model_version).toBe("sim-v5");

    const primary = queries[0];
    // Contrato F5: PRIMARY ordena por created_at desc.
    const createdAtOrder = primary.orders.find(
      (o) => o.column === "created_at",
    );
    expect(
      createdAtOrder,
      "PRIMARY path must order by created_at to pick the latest model_version",
    ).toBeDefined();
    expect(
      (createdAtOrder!.opts as { ascending?: boolean } | undefined)?.ascending,
    ).toBe(false);
    // E limita a 1 (a mais recente).
    expect(primary.limit).toBe(1);
  });
});

describe("getFixtureSimulation — DTO mapping + graceful degradation", () => {
  it("maps the row into a typed DTO", async () => {
    const { client } = buildMock({
      primaryRow: fullSimRow({ fixture_id: 19427226 }),
    });
    const dto = await getFixtureSimulation(ROUTE_ID_FIXTURE, client);

    expect(dto).not.toBeNull();
    expect(dto!.fixture_id).toBe(19427226);
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

  it("returns null when no row exists on either path (graceful)", async () => {
    const { client } = buildMock({ primaryRow: null, fallbackRow: null });
    expect(await getFixtureSimulation(ROUTE_ID_FIXTURE, client)).toBeNull();
  });

  it("degrades to null on query error (never throws)", async () => {
    const { client } = buildMock({
      error: { message: "relation does not exist" },
      fallbackError: { message: "relation does not exist" },
    });
    expect(await getFixtureSimulation(ROUTE_ID_FIXTURE, client)).toBeNull();
  });

  it("degrades to null when the table/relation is absent (from throws)", async () => {
    const { client } = buildMock({ throwOnFrom: true });
    expect(await getFixtureSimulation(ROUTE_ID_FIXTURE, client)).toBeNull();
  });

  it("normalizes missing jsonb fields to safe empties", async () => {
    const { client } = buildMock({
      primaryRow: fullSimRow({
        fixture_id: 19427226,
        top_scorelines: null,
        sim_stats: null,
        player_events: null,
        market_anchor: null,
      }),
    });
    const dto = await getFixtureSimulation(ROUTE_ID_FIXTURE, client);
    expect(dto!.top_scorelines).toEqual([]);
    expect(dto!.player_events).toEqual([]);
    expect(dto!.sim_stats).toBeNull();
    expect(dto!.market_anchor).toBeNull();
  });

  it("maps status 'unsimulable' through unchanged", async () => {
    const { client } = buildMock({
      primaryRow: fullSimRow({ fixture_id: 19427226, status: "unsimulable" }),
    });
    const dto = await getFixtureSimulation(ROUTE_ID_FIXTURE, client);
    expect(dto!.status).toBe("unsimulable");
  });
});

/**
 * F3-prod — aplicação das curvas isotônicas de calibração na leitura.
 *
 * Quando há curvas ativas em `model_calibration` para o mesmo
 * `model_version` da sim row, o reader aplica `applyIsotonic` em cada
 * uma das 4 métricas (1x2-home/draw/away + over25). As 3 probs 1X2 são
 * re-normalizadas pra somar 1.0 mantendo razões; over25 é independente.
 * Se NENHUMA das 3 curvas 1X2 existe, probs ficam inalteradas e
 * `calibrated_via_isotonic = false`. Sempre degrada graciosamente em
 * erro (probs originais preservadas).
 */
describe("getFixtureSimulation — F3-prod calibração isotônica", () => {
  // Curvas "espelho-deslocado" que produzem deltas mensuráveis. Toda
  // probabilidade x ∈ [0,1] cai dentro do range coberto por essas curvas
  // (clamping nas bordas é OK pros casos de teste).
  const homeShift: Array<[number, number]> = [
    [0.0, 0.0],
    [0.5, 0.6],
    [1.0, 1.0],
  ];
  const drawShift: Array<[number, number]> = [
    [0.0, 0.0],
    [0.5, 0.4],
    [1.0, 1.0],
  ];
  const awayShift: Array<[number, number]> = [
    [0.0, 0.0],
    [0.5, 0.45],
    [1.0, 1.0],
  ];
  const overShift: Array<[number, number]> = [
    [0.0, 0.0],
    [0.5, 0.55],
    [1.0, 1.0],
  ];

  const MODEL_V = "sim-v7-poisson-dc-nb-mc10k";

  it("aplica isotônica nas 3 probs 1X2 + over25, renormaliza pra soma=1 ± 1e-9", async () => {
    const { client } = buildMock({
      primaryRow: fullSimRow({
        fixture_id: 19427226,
        model_version: MODEL_V,
        p_home: 0.5,
        p_draw: 0.5,
        p_away: 0.5,
        p_over_25: 0.5,
      }),
      calibrationRows: [
        { metric: "1x2-home", pairs: homeShift, n: 320, effective_from: "2026-05-22T10:00:00Z" },
        { metric: "1x2-draw", pairs: drawShift, n: 320, effective_from: "2026-05-22T10:00:00Z" },
        { metric: "1x2-away", pairs: awayShift, n: 320, effective_from: "2026-05-22T10:00:00Z" },
        { metric: "over25", pairs: overShift, n: 320, effective_from: "2026-05-22T10:00:00Z" },
      ],
    });
    const dto = await getFixtureSimulation(ROUTE_ID_FIXTURE, client);

    expect(dto).not.toBeNull();
    // 0.5 → home=0.6, draw=0.4, away=0.45. Soma = 1.45 → normaliza:
    //   home = 0.6/1.45 ≈ 0.4138, draw = 0.4/1.45 ≈ 0.2759, away = 0.45/1.45 ≈ 0.3103
    expect(dto!.p_home).toBeCloseTo(0.6 / 1.45, 6);
    expect(dto!.p_draw).toBeCloseTo(0.4 / 1.45, 6);
    expect(dto!.p_away).toBeCloseTo(0.45 / 1.45, 6);
    // Soma 1X2 ≈ 1.0 exato
    expect(dto!.p_home! + dto!.p_draw! + dto!.p_away!).toBeCloseTo(1.0, 9);
    // Over25 NÃO entra na normalização — vira direto o valor da curva.
    expect(dto!.p_over_25).toBeCloseTo(0.55, 6);
  });

  it("calibrated_via_isotonic=true e calibration_n=meta.n quando há ≥1 curva 1X2", async () => {
    const { client } = buildMock({
      primaryRow: fullSimRow({
        fixture_id: 19427226,
        model_version: MODEL_V,
        p_home: 0.4,
        p_draw: 0.3,
        p_away: 0.3,
        p_over_25: 0.55,
      }),
      calibrationRows: [
        { metric: "1x2-home", pairs: homeShift, n: 380, effective_from: "2026-05-22T10:00:00Z" },
        { metric: "over25", pairs: overShift, n: 420, effective_from: "2026-05-22T10:00:00Z" },
      ],
    });
    const dto = await getFixtureSimulation(ROUTE_ID_FIXTURE, client);
    expect(dto!.calibrated_via_isotonic).toBe(true);
    expect(dto!.calibration_n).toBe(420); // max(n) das curvas devolvidas
  });

  it("calibrated_via_isotonic=false quando só over25 (sem 1X2): não conta como calibração de mercado", async () => {
    // Decisão explícita: o flag rastreia se o resultado 1X2 (o ângulo
    // principal exibido) foi calibrado. Só over25 não deve "contaminar"
    // o badge — over25 é uma side-prob no painel.
    const { client } = buildMock({
      primaryRow: fullSimRow({
        fixture_id: 19427226,
        model_version: MODEL_V,
        p_home: 0.4,
        p_draw: 0.3,
        p_away: 0.3,
        p_over_25: 0.5,
      }),
      calibrationRows: [
        { metric: "over25", pairs: overShift, n: 200, effective_from: "2026-05-22T10:00:00Z" },
      ],
    });
    const dto = await getFixtureSimulation(ROUTE_ID_FIXTURE, client);
    // Over25 foi aplicado, mas o flag fica false porque nenhuma 1X2 entrou.
    expect(dto!.p_over_25).toBeCloseTo(0.55, 6);
    expect(dto!.calibrated_via_isotonic).toBe(false);
    expect(dto!.calibration_n).toBeNull();
  });

  it("calibrated_via_isotonic=false quando model_version sem curva (não corrompe DTO)", async () => {
    const { client } = buildMock({
      primaryRow: fullSimRow({
        fixture_id: 19427226,
        model_version: MODEL_V,
        p_home: 0.55,
        p_draw: 0.25,
        p_away: 0.2,
        p_over_25: 0.6,
      }),
      calibrationRows: [], // nenhuma curva ativa
    });
    const dto = await getFixtureSimulation(ROUTE_ID_FIXTURE, client);
    expect(dto!.calibrated_via_isotonic).toBe(false);
    expect(dto!.calibration_n).toBeNull();
    // Probs preservadas.
    expect(dto!.p_home).toBeCloseTo(0.55, 6);
    expect(dto!.p_draw).toBeCloseTo(0.25, 6);
    expect(dto!.p_away).toBeCloseTo(0.2, 6);
    expect(dto!.p_over_25).toBeCloseTo(0.6, 6);
  });

  it("p_home null → não tenta calibrar nada, calibrated=false", async () => {
    const { client, queries } = buildMock({
      primaryRow: fullSimRow({
        fixture_id: 19427226,
        model_version: MODEL_V,
        p_home: null,
        p_draw: null,
        p_away: null,
        p_over_25: null,
      }),
      calibrationRows: [
        { metric: "1x2-home", pairs: homeShift, n: 320, effective_from: "2026-05-22T10:00:00Z" },
      ],
    });
    const dto = await getFixtureSimulation(ROUTE_ID_FIXTURE, client);
    expect(dto!.calibrated_via_isotonic).toBe(false);
    expect(dto!.calibration_n).toBeNull();
    expect(dto!.p_home).toBeNull();
    // E não deve nem ter chamado model_calibration: short-circuit em p_home==null
    // economiza um round-trip.
    const calQ = queries.find((q) =>
      q.eqs.some((e) => e.column === "model_version"),
    );
    expect(calQ, "no calibration query should fire when p_home is null").toBeUndefined();
  });

  it("supabase erro buscando curvas → calibrated=false, probs originais (degrada)", async () => {
    const { client } = buildMock({
      primaryRow: fullSimRow({
        fixture_id: 19427226,
        model_version: MODEL_V,
        p_home: 0.55,
        p_draw: 0.25,
        p_away: 0.2,
        p_over_25: 0.62,
      }),
      calibrationError: { message: "model_calibration does not exist" },
    });
    const dto = await getFixtureSimulation(ROUTE_ID_FIXTURE, client);
    expect(dto).not.toBeNull();
    expect(dto!.calibrated_via_isotonic).toBe(false);
    expect(dto!.calibration_n).toBeNull();
    expect(dto!.p_home).toBeCloseTo(0.55, 6);
    expect(dto!.p_draw).toBeCloseTo(0.25, 6);
    expect(dto!.p_away).toBeCloseTo(0.2, 6);
    expect(dto!.p_over_25).toBeCloseTo(0.62, 6);
  });

  it("model_version null na sim row → não chama curvas, mantém probs", async () => {
    const { client, queries } = buildMock({
      primaryRow: fullSimRow({
        fixture_id: 19427226,
        model_version: null,
        p_home: 0.4,
      }),
      calibrationRows: [
        { metric: "1x2-home", pairs: homeShift, n: 320, effective_from: "2026-05-22T10:00:00Z" },
      ],
    });
    const dto = await getFixtureSimulation(ROUTE_ID_FIXTURE, client);
    expect(dto!.calibrated_via_isotonic).toBe(false);
    expect(dto!.calibration_n).toBeNull();
    expect(dto!.p_home).toBeCloseTo(0.4, 6);
    // Verifica que NÃO há query de model_calibration nas queries capturadas.
    const calQ = queries.find((q) =>
      q.eqs.some((e) => e.column === "model_version"),
    );
    expect(calQ).toBeUndefined();
  });
});
