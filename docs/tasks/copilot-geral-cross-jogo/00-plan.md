# Copilot geral cross-jogo profundo (Sub-projeto B) — Implementation Plan

> **⚠️ HISTÓRICO / SUPERSEDED (2026-05-28).** O copilot agêntico planejado aqui foi **substituído pelo recomendador IA-2** (`deepseek/deepseek-r1` → tabela `ai_recommendations`, rotas `/api/ai-reco/*`). Plano mantido como registro de execução; **não reflete o código atual**.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each wave runs in its own manually-created git worktree in the **abissal** repo (`git worktree add .worktrees/tN -b feat/... main` + `ln -sf ../../node_modules .worktrees/tN/node_modules`); never the Agent `isolation:"worktree"` flag. Single authorship — **never** `Co-Authored-By`. Conventional Commits pt-BR. `git -c commit.gpgsign=false commit`. Gate order: remover worktree → `rm -rf .next` → `pnpm lint` → `pnpm typecheck` → `pnpm test`.

**Goal:** Dar ao copilot geral (`/api/copilot`, FAB da home) profundidade cross-jogo: triagem rasa rankeada (`scan_fixtures`) → mergulho profundo nas 12 derivações de A (`inspect_fixture`), tudo no mesmo tool-loop.

**Architecture:** Novo módulo puro `lib/fixtures/copilot-scan-tools.ts` (scanFixtures + inspectFixture + schemas), reaproveitando `derive.ts`/`badges.ts`/`time.ts` e o `executeFixtureTool` de `fixture-copilot-tools.ts`. `/api/copilot/route.ts` é estendido in-place (3 tools, dispatch, `MAX_TOOL_HOPS=6`, system prompt 2 etapas) com retrocompat total. UI híbrida: chips sempre-visíveis + `<details>` log mantido.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod, vitest + happy-dom, @testing-library/react, Playwright + axe-core, OpenRouter tool-calling.

**Spec:** `docs/pesquisas/copilot-geral-cross-jogo-design.md` (commit `177782d`).

---

## File Structure

- **Create** `lib/fixtures/copilot-scan-tools.ts` — `FixtureSignals`, `computeFixtureSignals`, `ScanFixturesArgs`, `ScanFilter`, `scanFixtures`, `scanResultSummary`, `inspectFixture`, `SCAN_FIXTURES_TOOL`, `INSPECT_FIXTURE_TOOL`. (Não tocar `copilot-tools.ts`.)
- **Create** `lib/fixtures/copilot-scan-tools.test.ts` — unit (W1).
- **Modify** `app/api/copilot/route.ts` — registro das 3 tools, dispatch, `MAX_TOOL_HOPS`, `summarizeResult(name,result)`, `SYSTEM_PROMPT` (W2).
- **Modify** `tests/api/copilot.test.ts` — integração/regressão (W2).
- **Create** `components/fixtures/copilot-tool-steps.tsx` — `CopilotToolSteps` (W3).
- **Create** `tests/integration/copilot-tool-steps.test.tsx` — component (W3).
- **Modify** `components/fixtures/copilot-fab.tsx` — fiação dos chips (W3).
- **Create** `tests/e2e/copilot-cross-jogo.spec.ts` — e2e + axe (W3).

Shapes reaproveitados (já testados): `NormalizedRecentMatch`, `RawRecentMatch`, `TeamRecordDerived`, `Streak`, `RefereeRecord`, `Prediction`, `OddsCategoryMap` (`lib/fixtures/stats/detail-json-types.ts`); `deriveTeamRecord`, `deriveRecentMatchStats`, `deriveStreakIndex`, `deriveOddsCategories` (`derive.ts`); `computeBadges` (`badges.ts`); `todayBrt`, `parseDateParam`, `brtDayWindowUtc`, `formatUtcAsBrt` (`time.ts`); `executeFixtureTool`, `summarizeFixtureToolResult`, `FixtureToolCtx` (`fixture-copilot-tools.ts`).

---

# Wave 1 — Módulo `copilot-scan-tools.ts` (solo, TDD strict, sem endpoint/UI)

Worktree: `git worktree add .worktrees/t1 -b feat/scan-tools main && ln -sf ../../node_modules .worktrees/t1/node_modules`

### Task 1: `computeFixtureSignals` — os 7 grupos de sinal

**Files:**
- Create: `lib/fixtures/copilot-scan-tools.ts`
- Test: `lib/fixtures/copilot-scan-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/fixtures/copilot-scan-tools.test.ts
import { describe, it, expect } from "vitest";
import { computeFixtureSignals, type FixtureRowLite } from "./copilot-scan-tools";

function rmMatch(o: Partial<Record<string, unknown>>): Record<string, unknown> {
  // Raw recent-match shape consumed by deriveRecentMatchStats. `is_home`
  // perspective is resolved by normalizeMatch via home_team/away_team.
  return {
    id: 1, date: 0, date_iso: "2026-05-01", status: "FT", league: "L",
    home_team: "Alpha", away_team: "Z", result: "W", htResult: "W",
    homeGoalsFt: 2, awayGoalsFt: 1, homeGoalsHt: 1, awayGoalsHt: 0,
    homeYellows: 2, awayYellows: 3, homeReds: 0, awayReds: 0,
    homeYellowReds: 0, awayYellowReds: 0, homeBookingPoints: 20,
    awayBookingPoints: 30, homeTotalShots: 10, awayTotalShots: 8,
    homeShotsOnTarget: 5, awayShotsOnTarget: 3, homeCorners: 6,
    awayCorners: 4, homeCorners1h: 3, awayCorners1h: 2, homeCorners2h: 3,
    awayCorners2h: 2, homeFouls: 10, awayFouls: 11, homeOffsides: 1,
    awayOffsides: 2, homeTackles: 15, awayTackles: 14, ...o,
  };
}

const FULL_DETAIL = {
  team_record: {
    home: { type: "Home", played: 5, won: 3, draw: 1, lost: 1 },
    away: { type: "Away", played: 5, won: 1, draw: 2, lost: 2 },
  },
  recent_matches: {
    home: [rmMatch({}), rmMatch({ homeGoalsFt: 0, awayGoalsFt: 0, homeGoalsHt: 0, awayGoalsHt: 0 })],
    away: [rmMatch({ home_team: "Beta", away_team: "Alpha", homeGoalsFt: 1, awayGoalsFt: 2 })],
  },
  streaks: {
    home: [{ desc: "Over 2.5 nos últimos 6", group: "Goals", overall_perc: 80 }],
    away: [],
  },
  referee_record: { name: "Ref", completed: 10, fixtures_count: 10, avg_total_booking_points: 48, avg_home_booking_points: 24, avg_away_booking_points: 24, total_yellow_reds: 1 },
  odds_summary: { "Match Result": { Home: { bookmaker: "bk", decimal_odds: 1.8 }, Draw: { bookmaker: "bk", decimal_odds: 3.4 }, Away: { bookmaker: "bk", decimal_odds: 4.5 } } },
  predictions: [
    { stat_type: "Over 2.5 Goals", chance: 0.72, chance_team: null, best_odds: 1.7, best_odds_bookmaker: "bk", home_stats: [], away_stats: [] },
    { stat_type: "Win", chance: 0.55, chance_team: "Alpha", best_odds: 1.8, best_odds_bookmaker: "bk", home_stats: [], away_stats: [] },
  ],
  h2h: [
    { ...rmMatch({}), homeGoalsFt: 2, awayGoalsFt: 2 },
    { ...rmMatch({}), homeGoalsFt: 1, awayGoalsFt: 0 },
  ],
};

function baseRow(detail: unknown): FixtureRowLite {
  return {
    id: 7, match_date: "2026-05-16", ko_time: "20:00", home_team: "Alpha",
    away_team: "Beta", league: "Serie A", country: "brazil",
    source_url: null, kickoff_utc: "2026-05-16T23:00:00Z", detail_json: detail,
  };
}

describe("computeFixtureSignals", () => {
  it("computes all 7 signal groups from a full detail_json", () => {
    const s = computeFixtureSignals(baseRow(FULL_DETAIL));
    expect(s.cards?.referee_avg_booking).toBe(48);
    expect(typeof s.cards?.home_avg_cards).toBe("number");
    expect(s.cards?.badge_cartao_alto).toBe(true); // 48 >= 45 threshold
    expect(s.goals_over?.home_over25_pct).toBeCloseTo(0.5); // 1 of 2 home matches total>2.5
    expect(typeof s.goals_over?.avg_total_goals).toBe("number");
    expect(s.btts?.home_btts_pct).toBeCloseTo(0.5);
    expect(s.first_half?.home_fh_goal_pct).toBeCloseTo(0.5);
    expect(s.form?.home).toEqual({ w: 3, d: 1, l: 1, pts_recent: 10 });
    expect(s.form?.away).toEqual({ w: 1, d: 2, l: 2, pts_recent: 5 });
    expect(s.form?.home_streak).toBe("Over 2.5 nos últimos 6");
    expect(s.form?.away_streak).toBeNull();
    expect(s.h2h).toEqual({ games: 2, avg_goals: 2.5 });
    expect(s.odds?.categories.length).toBeGreaterThan(0);
    expect(s.odds?.match_favorite).toBe("Home");
    expect(s.odds?.adamchoi_pred).toBe("Over 2.5 Goals");
  });

  it("omits groups whose source section is absent (never throws)", () => {
    const s = computeFixtureSignals(baseRow({}));
    expect(s.cards?.referee_avg_booking).toBeNull();
    expect(s.form?.home).toBeNull();
    expect(s.h2h).toEqual({ games: 0, avg_goals: 0 });
    expect(s.odds?.match_favorite).toBeNull();
    expect(s.odds?.adamchoi_pred).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm vitest run lib/fixtures/copilot-scan-tools.test.ts`
Expected: FAIL — `computeFixtureSignals is not a function` / module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/fixtures/copilot-scan-tools.ts
import { computeBadges } from "./badges";
import {
  deriveTeamRecord,
  deriveRecentMatchStats,
  deriveStreakIndex,
  deriveOddsCategories,
} from "@/lib/fixtures/stats/derive";
import type {
  NormalizedRecentMatch,
  Prediction,
  RawRecentMatch,
} from "@/lib/fixtures/stats/detail-json-types";

export interface FixtureRowLite {
  id: number;
  match_date: string;
  ko_time: string | null;
  home_team: string;
  away_team: string;
  league: string | null;
  country: string | null;
  source_url: string | null;
  kickoff_utc: string | null;
  detail_json: unknown;
}

interface FormSide { w: number; d: number; l: number; pts_recent: number }

export interface FixtureSignals {
  cards: { referee_avg_booking: number | null; home_avg_cards: number | null; away_avg_cards: number | null; badge_cartao_alto: boolean };
  goals_over: { home_over25_pct: number | null; away_over25_pct: number | null; avg_total_goals: number | null; badge_over_alto: boolean };
  btts: { home_btts_pct: number | null; away_btts_pct: number | null; badge_btts_alto: boolean };
  first_half: { home_fh_goal_pct: number | null; away_fh_goal_pct: number | null; badge_primeiro_tempo: boolean };
  form: { home: FormSide | null; away: FormSide | null; home_streak: string | null; away_streak: string | null };
  h2h: { games: number; avg_goals: number };
  odds: { categories: string[]; match_favorite: string | null; adamchoi_pred: string | null };
}

function section(detail: unknown, key: string): unknown {
  if (!detail || typeof detail !== "object") return undefined;
  return (detail as Record<string, unknown>)[key];
}

function recent(detail: unknown, side: "home" | "away", team: string): NormalizedRecentMatch[] {
  const rm = section(detail, "recent_matches") as { home?: unknown; away?: unknown } | undefined;
  try {
    return deriveRecentMatchStats(rm?.[side], null, team);
  } catch {
    return [];
  }
}

function pct(matches: NormalizedRecentMatch[], pred: (m: NormalizedRecentMatch) => boolean): number | null {
  if (matches.length === 0) return null;
  return matches.filter(pred).length / matches.length;
}

function avgCards(matches: NormalizedRecentMatch[]): number | null {
  const vals = matches.map((m) => m.cards_for).filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function totalGoals(m: NormalizedRecentMatch): number | null {
  if (m.goals_ft_for === null || m.goals_ft_against === null) return null;
  return m.goals_ft_for + m.goals_ft_against;
}

function formSide(raw: unknown): FormSide | null {
  const d = deriveTeamRecord({ home: raw });
  if (!d) return null;
  const { won: w, draw: d2, lost: l } = d.split;
  return { w, d: d2, l, pts_recent: 3 * w + d2 };
}

function topStreakDesc(raw: unknown): string | null {
  const idx = deriveStreakIndex(raw);
  return idx.all.length > 0 ? (idx.all[0].desc ?? null) : null;
}

function h2hSignal(detail: unknown): { games: number; avg_goals: number } {
  const h2h = section(detail, "h2h");
  if (!Array.isArray(h2h) || h2h.length === 0) return { games: 0, avg_goals: 0 };
  const rows = h2h as RawRecentMatch[];
  const totals = rows.map((r) => (r.homeGoalsFt ?? 0) + (r.awayGoalsFt ?? 0));
  return { games: rows.length, avg_goals: totals.reduce((a, b) => a + b, 0) / rows.length };
}

function oddsSignal(detail: unknown): { categories: string[]; match_favorite: string | null; adamchoi_pred: string | null } {
  const cats = deriveOddsCategories(section(detail, "odds_summary"));
  const categories = Object.keys(cats);
  let match_favorite: string | null = null;
  const summary = section(detail, "odds_summary");
  if (summary && typeof summary === "object") {
    const matchMarket = (summary as Record<string, unknown>)["Match Result"];
    if (matchMarket && typeof matchMarket === "object") {
      let best: { name: string; odds: number } | null = null;
      for (const [name, o] of Object.entries(matchMarket as Record<string, unknown>)) {
        const odds = (o as { decimal_odds?: number })?.decimal_odds;
        if (typeof odds === "number" && (best === null || odds < best.odds)) best = { name, odds };
      }
      match_favorite = best?.name ?? null;
    }
  }
  const preds = section(detail, "predictions");
  let adamchoi_pred: string | null = null;
  if (Array.isArray(preds) && preds.length > 0) {
    const top = [...(preds as Prediction[])].sort((a, b) => (b.chance ?? 0) - (a.chance ?? 0))[0];
    adamchoi_pred = top ? top.stat_type + (top.chance_team ? `: ${top.chance_team}` : "") : null;
  }
  return { categories, match_favorite, adamchoi_pred };
}

export function computeFixtureSignals(row: FixtureRowLite): FixtureSignals {
  const d = row.detail_json;
  const rh = recent(d, "home", row.home_team);
  const ra = recent(d, "away", row.away_team);
  const badges = computeBadges(d);
  const has = (id: string) => badges.some((b) => b.id === id);
  const ref = section(d, "referee_record") as { avg_total_booking_points?: number } | undefined;
  const tr = section(d, "team_record") as { home?: unknown; away?: unknown } | undefined;
  const st = section(d, "streaks") as { home?: unknown; away?: unknown } | undefined;

  return {
    cards: {
      referee_avg_booking: typeof ref?.avg_total_booking_points === "number" ? ref.avg_total_booking_points : null,
      home_avg_cards: avgCards(rh),
      away_avg_cards: avgCards(ra),
      badge_cartao_alto: has("cartao-alto"),
    },
    goals_over: {
      home_over25_pct: pct(rh, (m) => { const t = totalGoals(m); return t !== null && t > 2.5; }),
      away_over25_pct: pct(ra, (m) => { const t = totalGoals(m); return t !== null && t > 2.5; }),
      avg_total_goals: (() => {
        const ts = rh.map(totalGoals).filter((v): v is number => v !== null);
        return ts.length === 0 ? null : ts.reduce((a, b) => a + b, 0) / ts.length;
      })(),
      badge_over_alto: has("over-alto"),
    },
    btts: {
      home_btts_pct: pct(rh, (m) => (m.goals_ft_for ?? 0) > 0 && (m.goals_ft_against ?? 0) > 0),
      away_btts_pct: pct(ra, (m) => (m.goals_ft_for ?? 0) > 0 && (m.goals_ft_against ?? 0) > 0),
      badge_btts_alto: has("btts-alto"),
    },
    first_half: {
      home_fh_goal_pct: pct(rh, (m) => (m.goals_1h_for ?? 0) + (m.goals_1h_against ?? 0) > 0),
      away_fh_goal_pct: pct(ra, (m) => (m.goals_1h_for ?? 0) + (m.goals_1h_against ?? 0) > 0),
      badge_primeiro_tempo: has("primeiro-tempo"),
    },
    form: {
      home: formSide(tr?.home),
      away: formSide(tr?.away),
      home_streak: topStreakDesc(st?.home),
      away_streak: topStreakDesc(st?.away),
    },
    h2h: h2hSignal(d),
    odds: oddsSignal(d),
  };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm vitest run lib/fixtures/copilot-scan-tools.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/fixtures/copilot-scan-tools.ts lib/fixtures/copilot-scan-tools.test.ts
git -c commit.gpgsign=false commit -m "feat(copilot): computeFixtureSignals — 7 grupos de sinal cheap"
```

---

### Task 2: `scanFixtures` — varredura do dia (data + filtros coarse + exclui sem-detail)

**Files:**
- Modify: `lib/fixtures/copilot-scan-tools.ts`
- Test: `lib/fixtures/copilot-scan-tools.test.ts`

- [ ] **Step 1: Write the failing test** (append to the test file)

```ts
import { scanFixtures, type ScanFixturesArgs } from "./copilot-scan-tools";

function buildAdmin(rows: unknown[]) {
  return {
    from(table: string) {
      if (table !== "fixtures") throw new Error(`unexpected table: ${table}`);
      const chain = {
        select() { return chain; },
        or() { return chain; },
        order() { return chain; },
        then(resolve: (v: { data: unknown[]; error: null }) => void) {
          resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
  };
}

describe("scanFixtures — core", () => {
  it("returns one entry per fixture with detail, excluding null-detail rows", async () => {
    const rows = [
      baseRow(FULL_DETAIL),
      { ...baseRow(null), id: 8 },
      { ...baseRow(FULL_DETAIL), id: 9, league: "Premier League", country: "england" },
    ];
    const res = await scanFixtures({ date: "2026-05-16" }, buildAdmin(rows));
    expect(res.date).toBe("2026-05-16");
    expect(res.total).toBe(2); // id 8 excluded (no detail)
    expect(res.fixtures.map((f) => f.id).sort()).toEqual([7, 9]);
    expect(res.fixtures[0]).toMatchObject({ home_team: "Alpha", away_team: "Beta" });
    expect(res.fixtures[0].signals.cards.referee_avg_booking).toBe(48);
  });

  it("applies coarse league_substr / country pre-filters", async () => {
    const rows = [
      baseRow(FULL_DETAIL),
      { ...baseRow(FULL_DETAIL), id: 9, league: "Premier League", country: "england" },
    ];
    const r1 = await scanFixtures({ country: "england" }, buildAdmin(rows));
    expect(r1.fixtures.map((f) => f.id)).toEqual([9]);
    const r2 = await scanFixtures({ league_substr: "serie" }, buildAdmin(rows));
    expect(r2.fixtures.map((f) => f.id)).toEqual([7]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm vitest run lib/fixtures/copilot-scan-tools.test.ts -t "scanFixtures — core"`
Expected: FAIL — `scanFixtures is not a function`.

- [ ] **Step 3: Add implementation** (append to `copilot-scan-tools.ts`)

```ts
import { brtDayWindowUtc, formatUtcAsBrt, parseDateParam, todayBrt } from "./time";

const SCAN_COLUMNS =
  "id, match_date, ko_time, home_team, away_team, league, country, source_url, detail_json, kickoff_utc";

interface AdminLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
}

export interface ScanFilter { field: string; op: "gte" | "lte" | "eq"; value: number | string }
export interface ScanSort { field: string; dir: "asc" | "desc" }

export interface ScanFixturesArgs {
  date?: string;
  league_substr?: string;
  country?: string;
  filters?: ScanFilter[];
  sort?: ScanSort;
  signals?: string[];
  limit?: number;
}

export interface ScanEntry {
  id: number;
  home_team: string;
  away_team: string;
  league: string | null;
  country: string | null;
  kickoff_brt: string | null;
  signals: FixtureSignals;
}

export interface ScanResult { date: string; total: number; fixtures: ScanEntry[] }

function resolveDate(input: string | undefined): string {
  if (!input) return todayBrt();
  return parseDateParam(input) ?? todayBrt();
}

export async function scanFixtures(args: ScanFixturesArgs, admin: AdminLike): Promise<ScanResult> {
  const date = resolveDate(args.date);
  const { startUtc, endUtc } = brtDayWindowUtc(date);
  const orExpr =
    `and(kickoff_utc.gte.${startUtc},kickoff_utc.lt.${endUtc}),` +
    `and(kickoff_utc.is.null,match_date.eq.${date})`;

  const result = await admin
    .from("fixtures")
    .select(SCAN_COLUMNS)
    .or(orExpr)
    .order("kickoff_utc", { ascending: true, nullsFirst: false });

  const data: FixtureRowLite[] = (result?.data ?? []) as FixtureRowLite[];

  const coarse = data.filter((row) => {
    if (row.detail_json === null || row.detail_json === undefined) return false;
    if (args.country && (row.country ?? "").toLowerCase() !== args.country.toLowerCase()) return false;
    if (args.league_substr && !(row.league ?? "").toLowerCase().includes(args.league_substr.toLowerCase())) return false;
    return true;
  });

  const entries: ScanEntry[] = coarse.map((row) => ({
    id: row.id,
    home_team: row.home_team,
    away_team: row.away_team,
    league: row.league,
    country: row.country,
    kickoff_brt: formatUtcAsBrt(row.kickoff_utc),
    signals: computeFixtureSignals(row),
  }));

  return { date, total: entries.length, fixtures: entries };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm vitest run lib/fixtures/copilot-scan-tools.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/fixtures/copilot-scan-tools.ts lib/fixtures/copilot-scan-tools.test.ts
git -c commit.gpgsign=false commit -m "feat(copilot): scanFixtures — varredura do dia + filtros coarse"
```

---

### Task 3: filtros server-side (`gte/lte/eq`, path pontuado) + sort + projeção + limit

**Files:**
- Modify: `lib/fixtures/copilot-scan-tools.ts`
- Test: `lib/fixtures/copilot-scan-tools.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
describe("scanFixtures — filter/sort/projection/limit", () => {
  const rows = [
    { ...baseRow(FULL_DETAIL), id: 1 },
    { ...baseRow({ ...FULL_DETAIL, referee_record: { ...FULL_DETAIL.referee_record, avg_total_booking_points: 20 } }), id: 2 },
  ];

  it("filters server-side by dotted field with gte", async () => {
    const args: ScanFixturesArgs = { filters: [{ field: "cards.referee_avg_booking", op: "gte", value: 40 }] };
    const res = await scanFixtures(args, buildAdmin(rows));
    expect(res.fixtures.map((f) => f.id)).toEqual([1]);
    expect(res.total).toBe(1);
  });

  it("sorts by dotted field desc and respects limit", async () => {
    const res = await scanFixtures({ sort: { field: "cards.referee_avg_booking", dir: "desc" }, limit: 1 }, buildAdmin(rows));
    expect(res.fixtures.map((f) => f.id)).toEqual([1]);
    expect(res.total).toBe(2); // total counts pre-limit
  });

  it("projects only requested signal groups", async () => {
    const res = await scanFixtures({ signals: ["cards"] }, buildAdmin(rows));
    expect(Object.keys(res.fixtures[0].signals)).toEqual(["cards"]);
  });

  it("returns { error } for an unknown filter field", async () => {
    const res = await scanFixtures({ filters: [{ field: "nope.bad", op: "eq", value: 1 }] }, buildAdmin(rows));
    expect((res as unknown as { error?: string }).error).toMatch(/campo inválido/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm vitest run lib/fixtures/copilot-scan-tools.test.ts -t "filter/sort/projection"`
Expected: FAIL — filtering/sort/projection not implemented.

- [ ] **Step 3: Replace the tail of `scanFixtures`**

Replace the final `return { date, total: entries.length, fixtures: entries };` with the block below, and add the helpers above `scanFixtures`:

```ts
const SIGNAL_GROUPS = ["cards", "goals_over", "btts", "first_half", "form", "h2h", "odds"] as const;

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function validField(path: string): boolean {
  return path.startsWith("signals.") || SIGNAL_GROUPS.some((g) => path === g || path.startsWith(`${g}.`));
}

function normPath(path: string): string {
  return path.startsWith("signals.") ? path : `signals.${path}`;
}

function passesFilter(entry: ScanEntry, f: ScanFilter): boolean {
  const v = getByPath(entry, normPath(f.field));
  if (v === null || v === undefined) return false;
  if (f.op === "eq") return v === f.value;
  if (typeof v !== "number" || typeof f.value !== "number") return false;
  return f.op === "gte" ? v >= f.value : v <= f.value;
}
```

```ts
  // ── filtros server-side ────────────────────────────────────────────────
  const allFields = [
    ...(args.filters?.map((f) => f.field) ?? []),
    ...(args.sort ? [args.sort.field] : []),
  ];
  const bad = allFields.find((p) => !validField(p));
  if (bad) {
    return { date, total: 0, fixtures: [], error: `campo inválido: ${bad}` } as ScanResult & { error: string };
  }

  let filtered = entries;
  for (const f of args.filters ?? []) filtered = filtered.filter((e) => passesFilter(e, f));

  if (args.sort) {
    const { field, dir } = args.sort;
    filtered = [...filtered].sort((a, b) => {
      const av = getByPath(a, normPath(field));
      const bv = getByPath(b, normPath(field));
      const an = typeof av === "number" ? av : Number.NEGATIVE_INFINITY;
      const bn = typeof bv === "number" ? bv : Number.NEGATIVE_INFINITY;
      return dir === "asc" ? an - bn : bn - an;
    });
  }

  const total = filtered.length;

  const wanted = args.signals?.filter((s) => (SIGNAL_GROUPS as readonly string[]).includes(s));
  const projected = filtered.map((e) => {
    if (!wanted || wanted.length === 0) return e;
    const sig: Record<string, unknown> = {};
    for (const g of wanted) sig[g] = (e.signals as unknown as Record<string, unknown>)[g];
    return { ...e, signals: sig as unknown as FixtureSignals };
  });

  const limit = Math.max(1, Math.min(30, Math.floor(args.limit ?? 15)));
  return { date, total, fixtures: projected.slice(0, limit) };
```

Add `error?: string` to `ScanResult`: `export interface ScanResult { date: string; total: number; fixtures: ScanEntry[]; error?: string }`.

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm vitest run lib/fixtures/copilot-scan-tools.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/fixtures/copilot-scan-tools.ts lib/fixtures/copilot-scan-tools.test.ts
git -c commit.gpgsign=false commit -m "feat(copilot): scan filtros/sort/projeção server-side + limit"
```

---

### Task 4: `SCAN_FIXTURES_TOOL` (schema) + `scanResultSummary`

**Files:**
- Modify: `lib/fixtures/copilot-scan-tools.ts`
- Test: `lib/fixtures/copilot-scan-tools.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { SCAN_FIXTURES_TOOL, scanResultSummary } from "./copilot-scan-tools";

describe("SCAN_FIXTURES_TOOL + summary", () => {
  it("exposes a function schema named scan_fixtures with the expected args", () => {
    expect(SCAN_FIXTURES_TOOL.function.name).toBe("scan_fixtures");
    const props = SCAN_FIXTURES_TOOL.function.parameters.properties as Record<string, unknown>;
    for (const k of ["date", "league_substr", "country", "filters", "sort", "signals", "limit"]) {
      expect(props[k]).toBeDefined();
    }
  });

  it("summarizes a scan result compactly", () => {
    expect(scanResultSummary({ date: "2026-05-16", total: 12, fixtures: [{}, {}] })).toBe(
      "scan_fixtures: 2/12 (2026-05-16)",
    );
    expect(scanResultSummary({ error: "campo inválido: x" })).toBe("error: campo inválido: x");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm vitest run lib/fixtures/copilot-scan-tools.test.ts -t "SCAN_FIXTURES_TOOL"`
Expected: FAIL — exports missing.

- [ ] **Step 3: Add implementation** (append to `copilot-scan-tools.ts`)

```ts
export const SCAN_FIXTURES_TOOL = {
  type: "function" as const,
  function: {
    name: "scan_fixtures",
    description:
      "Triagem rasa cross-jogo: varre os jogos do dia (BRT) e devolve um shortlist rankeado com sinais derivados. Use ANTES de inspect_fixture para escolher quais jogos mergulhar. Campos de filtro/ordenação (path pontuado): cards.referee_avg_booking|home_avg_cards|away_avg_cards|badge_cartao_alto; goals_over.home_over25_pct|away_over25_pct|avg_total_goals|badge_over_alto; btts.home_btts_pct|away_btts_pct|badge_btts_alto; first_half.home_fh_goal_pct|away_fh_goal_pct|badge_primeiro_tempo; form.home.pts_recent|form.away.pts_recent|form.home_streak|form.away_streak; h2h.games|h2h.avg_goals; odds.match_favorite|odds.adamchoi_pred.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "'today'(default) | 'tomorrow' | 'YYYY-MM-DD' (BRT)." },
        league_substr: { type: "string", description: "Pré-filtro: substring do nome da liga (case-insensitive)." },
        country: { type: "string", description: "Pré-filtro: slug do país (case-insensitive)." },
        filters: {
          type: "array",
          description: "Predicados aplicados server-side sobre os sinais.",
          items: {
            type: "object",
            properties: {
              field: { type: "string", description: "Path pontuado (ver description da tool)." },
              op: { type: "string", enum: ["gte", "lte", "eq"] },
              value: { description: "Número (gte/lte) ou número/string (eq)." },
            },
            required: ["field", "op", "value"],
            additionalProperties: false,
          },
        },
        sort: {
          type: "object",
          properties: {
            field: { type: "string" },
            dir: { type: "string", enum: ["asc", "desc"] },
          },
          required: ["field", "dir"],
          additionalProperties: false,
        },
        signals: {
          type: "array",
          items: { type: "string", enum: ["cards", "goals_over", "btts", "first_half", "form", "h2h", "odds"] },
          description: "Projeta só estes grupos (default: todos).",
        },
        limit: { type: "number", description: "Tamanho do shortlist, 1..30 (default 15)." },
      },
      additionalProperties: false,
    },
  },
};

export function scanResultSummary(result: unknown): string {
  if (!result || typeof result !== "object") return String(result);
  const r = result as Record<string, unknown>;
  if (typeof r.error === "string") return `error: ${r.error}`;
  const n = Array.isArray(r.fixtures) ? r.fixtures.length : 0;
  const total = typeof r.total === "number" ? r.total : n;
  const date = typeof r.date === "string" ? r.date : "?";
  return `scan_fixtures: ${n}/${total} (${date})`;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm vitest run lib/fixtures/copilot-scan-tools.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/fixtures/copilot-scan-tools.ts lib/fixtures/copilot-scan-tools.test.ts
git -c commit.gpgsign=false commit -m "feat(copilot): SCAN_FIXTURES_TOOL schema + scanResultSummary"
```

---

### Task 5: `inspectFixture` + `INSPECT_FIXTURE_TOOL` (delega a `executeFixtureTool` de A)

**Files:**
- Modify: `lib/fixtures/copilot-scan-tools.ts`
- Test: `lib/fixtures/copilot-scan-tools.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { inspectFixture, INSPECT_FIXTURE_TOOL } from "./copilot-scan-tools";

function buildAdminById(byId: Record<number, unknown>) {
  return {
    from(table: string) {
      if (table !== "fixtures") throw new Error("unexpected table");
      let wanted: number | null = null;
      const chain = {
        select() { return chain; },
        eq(_col: string, id: number) { wanted = id; return chain; },
        maybeSingle() {
          const row = wanted !== null ? byId[wanted] ?? null : null;
          return Promise.resolve({ data: row, error: null });
        },
      };
      return chain;
    },
  };
}

describe("inspectFixture", () => {
  const admin = buildAdminById({
    7: { id: 7, home_team: "Alpha", away_team: "Beta", detail_json: FULL_DETAIL },
  });

  it("delegates to an A tool over the fixture's detail_json", async () => {
    const res = await inspectFixture({ fixture_id: 7, tool: "get_referee", tool_args: {} }, admin);
    expect((res as Record<string, unknown>).name).toBe("Ref");
  });

  it("returns { error } for a missing fixture", async () => {
    const res = await inspectFixture({ fixture_id: 999, tool: "get_referee" }, admin);
    expect((res as { error?: string }).error).toMatch(/não encontr/);
  });

  it("returns { error } when the fixture has no detail_json", async () => {
    const a2 = buildAdminById({ 8: { id: 8, home_team: "X", away_team: "Y", detail_json: null } });
    const res = await inspectFixture({ fixture_id: 8, tool: "get_referee" }, a2);
    expect((res as { error?: string }).error).toMatch(/sem detail/);
  });

  it("exposes a schema named inspect_fixture enumerating the 12 A tools", () => {
    expect(INSPECT_FIXTURE_TOOL.function.name).toBe("inspect_fixture");
    const toolProp = (INSPECT_FIXTURE_TOOL.function.parameters.properties as Record<string, { enum?: string[] }>).tool;
    expect(toolProp.enum).toContain("get_insights");
    expect(toolProp.enum?.length).toBe(12);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm vitest run lib/fixtures/copilot-scan-tools.test.ts -t "inspectFixture"`
Expected: FAIL — exports missing.

- [ ] **Step 3: Add implementation** (append to `copilot-scan-tools.ts`)

```ts
import { executeFixtureTool, type FixtureToolCtx } from "@/lib/fixtures/fixture-copilot-tools";

const A_TOOL_NAMES = [
  "get_insights", "get_team_record", "get_recent_matches", "get_h2h",
  "get_splits", "get_distributions", "get_radar", "get_player_stats",
  "get_streaks", "get_referee", "get_odds", "get_predictions",
] as const;

export interface InspectFixtureArgs {
  fixture_id: number;
  tool: string;
  tool_args?: unknown;
}

export async function inspectFixture(
  args: InspectFixtureArgs,
  admin: AdminLike,
): Promise<Record<string, unknown>> {
  if (typeof args?.fixture_id !== "number") return { error: "fixture_id obrigatório" };
  const { data } = await admin
    .from("fixtures")
    .select("id, home_team, away_team, detail_json")
    .eq("id", args.fixture_id)
    .maybeSingle();
  if (!data) return { error: `fixture ${args.fixture_id} não encontrado na janela` };
  const row = data as { home_team: string; away_team: string; detail_json: unknown };
  if (row.detail_json === null || row.detail_json === undefined) {
    return { error: `fixture ${args.fixture_id} sem detail_json ainda` };
  }
  const ctx: FixtureToolCtx = {
    detail: row.detail_json,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
  };
  return executeFixtureTool(args.tool, args.tool_args, ctx);
}

export const INSPECT_FIXTURE_TOOL = {
  type: "function" as const,
  function: {
    name: "inspect_fixture",
    description:
      "Mergulho profundo num jogo: roda UMA das 12 derivações do dashboard sobre o detail_json do fixture. Use nos jogos do shortlist do scan_fixtures para análise de alta qualidade. Chame várias vezes (tools/lados diferentes) conforme precisar.",
    parameters: {
      type: "object",
      properties: {
        fixture_id: { type: "number", description: "id do fixture (vindo de query_fixtures/scan_fixtures)." },
        tool: { type: "string", enum: [...A_TOOL_NAMES], description: "Qual derivação rodar." },
        tool_args: {
          type: "object",
          description: "Args da derivação. Ex.: { side: 'home'|'away' } para tools com lado; {} caso não use.",
          additionalProperties: true,
        },
      },
      required: ["fixture_id", "tool"],
      additionalProperties: false,
    },
  },
};
```

- [ ] **Step 4: Run full W1 suite, verify green**

Run: `pnpm vitest run lib/fixtures/copilot-scan-tools.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/fixtures/copilot-scan-tools.ts lib/fixtures/copilot-scan-tools.test.ts
git -c commit.gpgsign=false commit -m "feat(copilot): inspectFixture delega a executeFixtureTool de A + schema"
```

**Wave 1 gate:** merge `feat/scan-tools` → main (`git merge --no-ff`), remover worktree, `rm -rf .next`, `pnpm lint && pnpm typecheck && pnpm test`. Tudo verde antes da Wave 2.

---

# Wave 2 — Estender `/api/copilot` (depende W1)

Worktree: `git worktree add .worktrees/t2 -b feat/copilot-tools main && ln -sf ../../node_modules .worktrees/t2/node_modules`

### Task 6: registrar as 3 tools + dispatch + `summarizeResult(name,result)`

**Files:**
- Modify: `app/api/copilot/route.ts`
- Modify: `tests/api/copilot.test.ts`

- [ ] **Step 1: Write the failing test** — add to `tests/api/copilot.test.ts` (reusa `buildAdminMock`/`jsonResponse`/env já no arquivo). Add an `eq/maybeSingle` branch to the existing `buildAdminMock` chain object:

```ts
// inside buildAdminMock's `chain`, add:
        eq() { return chain; },
        maybeSingle() {
          return Promise.resolve({ data: (state as { single?: unknown }).single ?? null, error: null });
        },
```

```ts
describe("/api/copilot — 3 tools", () => {
  it("executes scan_fixtures then inspect_fixture in a tool loop", async () => {
    adminState.rows = [
      { id: 7, match_date: "2026-05-16", ko_time: "20:00", home_team: "Alpha",
        away_team: "Beta", league: "Serie A", country: "brazil", source_url: null,
        kickoff_utc: "2026-05-16T23:00:00Z",
        detail_json: { referee_record: { name: "Ref", avg_total_booking_points: 48, completed: 10, fixtures_count: 10, avg_home_booking_points: 24, avg_away_booking_points: 24, total_yellow_reds: 1 } } },
    ];
    (adminState as { single?: unknown }).single = { id: 7, home_team: "Alpha", away_team: "Beta", detail_json: adminState.rows[0] && (adminState.rows[0] as { detail_json: unknown }).detail_json };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "scan_fixtures", arguments: JSON.stringify({ date: "2026-05-16" }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "inspect_fixture", arguments: JSON.stringify({ fixture_id: 7, tool: "get_referee" }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { role: "assistant", content: "Pronto." } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/copilot/route");
    const res = await POST(new Request("http://t/api/copilot", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "melhor árbitro hoje?" }] }) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.meta.hops.map((h: { tool: string }) => h.tool)).toEqual(["scan_fixtures", "inspect_fixture"]);
    expect(json.meta.hops[1].result_summary).toMatch(/get_referee|ok/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm vitest run tests/api/copilot.test.ts -t "3 tools"`
Expected: FAIL — `unknown tool: scan_fixtures`.

- [ ] **Step 3: Implement dispatch in `app/api/copilot/route.ts`**

Add imports near the top:

```ts
import {
  SCAN_FIXTURES_TOOL,
  INSPECT_FIXTURE_TOOL,
  scanFixtures,
  scanResultSummary,
  inspectFixture,
  type ScanFixturesArgs,
  type InspectFixtureArgs,
} from "@/lib/fixtures/copilot-scan-tools";
import { summarizeFixtureToolResult } from "@/lib/fixtures/fixture-copilot-tools";
```

In `callOpenRouter`, change the `tools` array:

```ts
    tools: [QUERY_FIXTURES_TOOL, SCAN_FIXTURES_TOOL, INSPECT_FIXTURE_TOOL],
```

Replace `executeToolCall` with a name dispatch:

```ts
async function executeToolCall(
  fn: { name: string; arguments: string },
  admin: ReturnType<typeof createAdminClient>,
): Promise<unknown> {
  let args: unknown;
  try {
    args = JSON.parse(fn.arguments);
  } catch {
    return { error: "invalid JSON arguments" };
  }
  const a = admin as unknown as { from: (t: string) => unknown };
  if (fn.name === "query_fixtures") return queryFixtures(args as QueryFixturesArgs, a);
  if (fn.name === "scan_fixtures") return scanFixtures(args as ScanFixturesArgs, a);
  if (fn.name === "inspect_fixture") return inspectFixture(args as InspectFixtureArgs, a);
  return { error: `unknown tool: ${fn.name}` };
}
```

Change `summarizeResult` to take the tool name and branch:

```ts
function summarizeResult(name: string, result: unknown): string {
  if (!result || typeof result !== "object") return String(result);
  const r = result as Record<string, unknown>;
  if (typeof r.error === "string") return `error: ${r.error}`;
  if (name === "scan_fixtures") return scanResultSummary(result);
  if (name === "inspect_fixture") return summarizeFixtureToolResult(name, result);
  if (Array.isArray(r.fixtures)) {
    const n = r.fixtures.length;
    const total = typeof r.total === "number" ? r.total : n;
    const date = typeof r.date === "string" ? r.date : "?";
    return `${n} fixture(s) returned (total ${total}, date ${date})`;
  }
  return JSON.stringify(result).slice(0, 120);
}
```

Update the single call site inside the hop loop from `summarizeResult(result)` to `summarizeResult(call.function.name, result)`.

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm vitest run tests/api/copilot.test.ts`
Expected: PASS (existing copilot tests + the new "3 tools" test).

- [ ] **Step 5: Commit**

```bash
git add app/api/copilot/route.ts tests/api/copilot.test.ts
git -c commit.gpgsign=false commit -m "feat(copilot): registra scan/inspect + dispatch por nome no tool-loop"
```

---

### Task 7: `MAX_TOOL_HOPS` 3→6 + `SYSTEM_PROMPT` 2 etapas + regressão retrocompat

**Files:**
- Modify: `app/api/copilot/route.ts`
- Modify: `tests/api/copilot.test.ts`

- [ ] **Step 1: Write the failing test** (append to `tests/api/copilot.test.ts`)

```ts
describe("/api/copilot — hops cap + retrocompat", () => {
  it("still answers a simple question using only query_fixtures (retrocompat)", async () => {
    adminState.rows = [];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "query_fixtures", arguments: "{}" } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { role: "assistant", content: "Nenhum jogo." } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/copilot/route");
    const res = await POST(new Request("http://t/api/copilot", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "tem jogo hoje?" }] }) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.meta.hops.map((h: { tool: string }) => h.tool)).toEqual(["query_fixtures"]);
  });

  it("caps the loop at 6 hops", async () => {
    adminState.rows = [];
    const loop = jsonResponse({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "query_fixtures", arguments: "{}" } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const fetchMock = vi.fn().mockResolvedValue(loop);
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/copilot/route");
    const res = await POST(new Request("http://t/api/copilot", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "loop" }] }) }));
    const json = await res.json();
    expect(json.meta.hops.length).toBe(6);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm vitest run tests/api/copilot.test.ts -t "hops cap"`
Expected: FAIL — `hops.length` is 3, not 6.

- [ ] **Step 3: Implement**

In `app/api/copilot/route.ts`: change `const MAX_TOOL_HOPS = 3;` → `const MAX_TOOL_HOPS = 6;`. Update the capped-loop user message string `"em até 3 consultas"` → `"em até 6 consultas"`. Replace `SYSTEM_PROMPT` with:

```ts
const SYSTEM_PROMPT = `Você é um copiloto de apostas pré-jogo focado nos jogos de futebol do dia.

Ferramentas (use sempre dados frescos — nunca invente jogos/números):
- query_fixtures: lista compacta dos jogos do dia (badges, árbitro).
- scan_fixtures: TRIAGEM rasa cross-jogo — varre o dia com sinais derivados, filtra/ordena/projeta server-side. Use para "quais jogos…", rankings e comparações amplas.
- inspect_fixture: MERGULHO profundo — roda uma das 12 derivações do dashboard sobre UM jogo. Use só nos jogos do shortlist do scan, para a análise de alta qualidade.

Disciplina (2 etapas):
1. Para qualquer pergunta cross-jogo, comece por query_fixtures/scan_fixtures (triagem). Nunca pule direto pro inspect sem ter o id de um jogo.
2. Só então chame inspect_fixture nos top-N do shortlist (várias vezes se preciso) antes de concluir.
3. Toda afirmação numérica cita o valor exato vindo de uma tool + a leitura; nada fora do detail_json.

Convenções de resposta:
- Português do Brasil, em markdown, seções curtas.
- Comece dizendo quantos jogos casaram ("Achei 3 jogos…").
- Liste como "HH:MM BRT • Time A vs Time B (Liga, País)".
- Se nada casar o filtro, diga isso explicitamente.`;
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm vitest run tests/api/copilot.test.ts`
Expected: PASS (all copilot tests, incl. retrocompat + 6-hop cap).

- [ ] **Step 5: Commit**

```bash
git add app/api/copilot/route.ts tests/api/copilot.test.ts
git -c commit.gpgsign=false commit -m "feat(copilot): MAX_TOOL_HOPS=6 + system prompt 2 etapas + regressão"
```

**Wave 2 gate:** merge `feat/copilot-tools` → main, remover worktree, `rm -rf .next`, `pnpm lint && pnpm typecheck && pnpm test`. Contrato `meta.hops` permanece `{tool,args,result_summary,took_ms}` (inalterado). Tudo verde antes da Wave 3.

---

# Wave 3 — UI híbrida + E2E (depende do contrato W2)

Worktree: `git worktree add .worktrees/t3 -b feat/copilot-ui main && ln -sf ../../node_modules .worktrees/t3/node_modules`

### Task 8: componente `CopilotToolSteps` (chips sempre-visíveis)

**Files:**
- Create: `components/fixtures/copilot-tool-steps.tsx`
- Test: `tests/integration/copilot-tool-steps.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/integration/copilot-tool-steps.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CopilotToolSteps } from "@/components/fixtures/copilot-tool-steps";

describe("CopilotToolSteps", () => {
  it("renders one chip per hop with name + summary and a success mark", () => {
    render(
      <CopilotToolSteps
        hops={[
          { tool: "scan_fixtures", args: {}, result_summary: "scan_fixtures: 3/12 (2026-05-16)", took_ms: 10 },
          { tool: "inspect_fixture", args: {}, result_summary: "get_referee: ok", took_ms: 5 },
        ]}
      />,
    );
    expect(screen.getByText("scan_fixtures")).toBeTruthy();
    expect(screen.getByText(/3\/12/)).toBeTruthy();
    expect(screen.getAllByText("✓").length).toBe(2);
  });

  it("marks a hop whose result_summary starts with error: as failed", () => {
    render(
      <CopilotToolSteps
        hops={[{ tool: "scan_fixtures", args: {}, result_summary: "error: campo inválido: x", took_ms: 1 }]}
      />,
    );
    expect(screen.getByText("✗")).toBeTruthy();
  });

  it("renders nothing when there are no hops", () => {
    const { container } = render(<CopilotToolSteps hops={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm vitest run tests/integration/copilot-tool-steps.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// components/fixtures/copilot-tool-steps.tsx
interface Hop {
  tool: string;
  args: unknown;
  result_summary: string;
  took_ms: number;
}

/**
 * Sempre-visível: uma linha-chip por tool chamada no turno. Espelha o
 * FixtureToolSteps do Sub-projeto A (não acopla ao endpoint dele). O log
 * verboso (args JSON, tokens) continua no <details> "log do turno".
 */
export function CopilotToolSteps({ hops }: { hops: Hop[] }) {
  if (!hops || hops.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label="ferramentas usadas">
      {hops.map((h, i) => {
        const failed = h.result_summary.startsWith("error:");
        return (
          <li
            key={i}
            className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] bg-[var(--color-surface-2)] px-2 py-1 font-mono text-[11px]"
          >
            <span aria-hidden style={{ color: failed ? "var(--color-vermelho)" : "var(--color-ink-muted)" }}>
              {failed ? "✗" : "✓"}
            </span>
            <span className="text-[var(--color-vermelho)]">{h.tool}</span>
            <span className="truncate text-[var(--color-ink-muted)]">· {h.result_summary}</span>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm vitest run tests/integration/copilot-tool-steps.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/fixtures/copilot-tool-steps.tsx tests/integration/copilot-tool-steps.test.tsx
git -c commit.gpgsign=false commit -m "feat(copilot): CopilotToolSteps — chips de tool sempre-visíveis"
```

---

### Task 9: fiar `CopilotToolSteps` no `copilot-fab.tsx`

**Files:**
- Modify: `components/fixtures/copilot-fab.tsx`
- Modify: `tests/integration/copilot-tool-steps.test.tsx`

- [ ] **Step 1: Write the failing test** (append; renders the drawer flow is heavy — assert the wiring contract instead by importing the fab and checking the chips render for an assistant message). Use a focused integration test:

```tsx
import { CopilotFab } from "@/components/fixtures/copilot-fab";
import { render } from "@testing-library/react";

describe("CopilotFab wiring", () => {
  it("imports CopilotToolSteps (smoke: module composes without throwing)", () => {
    const { container } = render(<CopilotFab date="today" />);
    expect(container).toBeTruthy();
  });
});
```

(The behavioral assertion that chips show for assistant turns is covered by Task 8; here we only guard that `copilot-fab` still composes after wiring.)

- [ ] **Step 2: Run test, verify it passes for the wrong reason**

Run: `pnpm vitest run tests/integration/copilot-tool-steps.test.tsx -t "CopilotFab wiring"`
Expected: PASS (component renders) — this guards against an import/JSX regression introduced by Step 3.

- [ ] **Step 3: Wire the component**

In `components/fixtures/copilot-fab.tsx`:

Add the import next to the other component imports:

```ts
import { CopilotToolSteps } from "./copilot-tool-steps";
```

In the messages map (currently around lines 251–263), insert the always-visible chips between `<ChatMessageView message={m} />` and the `showLog`-gated `<CopilotLogDetails>`:

```tsx
                    <ChatMessageView message={m} />
                    {m.role === "assistant" && messagesMeta[i] ? (
                      <CopilotToolSteps hops={messagesMeta[i].hops} />
                    ) : null}
                    {showLog && m.role === "assistant" && messagesMeta[i] ? (
                      <CopilotLogDetails meta={messagesMeta[i]} />
                    ) : null}
```

- [ ] **Step 4: Run the W3 suite, verify green**

Run: `pnpm vitest run tests/integration/copilot-tool-steps.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/fixtures/copilot-fab.tsx tests/integration/copilot-tool-steps.test.tsx
git -c commit.gpgsign=false commit -m "feat(copilot): chips sempre-visíveis no copilot-fab (log <details> mantido)"
```

---

### Task 10: E2E (Playwright) + axe + regressão de mount

**Files:**
- Create: `tests/e2e/copilot-cross-jogo.spec.ts`

- [ ] **Step 1: Write the e2e spec** (mirror `tests/e2e/fixture-copilot.spec.ts` patterns from Sub-projeto A — same fixtures-home route, FAB open, axe scan)

```ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Copilot geral cross-jogo", () => {
  test("home → FAB abre, sem chamada LLM no mount, axe limpo", async ({ page }) => {
    const llmCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/copilot")) llmCalls.push(r.method() + " " + r.url());
    });

    await page.goto("/fixtures");
    // Guard de custo: abrir a página não dispara o copilot.
    await page.waitForTimeout(1000);
    expect(llmCalls).toHaveLength(0);

    const fab = page.getByRole("button", { name: /copilot|assistente|pergunte/i }).first();
    await fab.click();

    const input = page.getByPlaceholder(/pergunte sobre os jogos do dia/i);
    await expect(input).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the e2e (CI/local with .env)**

Run: `pnpm test:e2e tests/e2e/copilot-cross-jogo.spec.ts`
Expected: PASS. (If the worktree lacks `.env`, the dev server won't boot — this is environment-only; the spec runs in CI. Classify accordingly, do NOT weaken the assertions.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/copilot-cross-jogo.spec.ts
git -c commit.gpgsign=false commit -m "test(copilot): e2e cross-jogo + axe + guard de custo no mount"
```

**Wave 3 gate / merge final:** merge `feat/copilot-ui` → main, remover worktree, `rm -rf .next`, `pnpm lint && pnpm typecheck && pnpm test`. Push → CI/deploy (Cloudflare Workers). Monitorar o deploy.

---

## Self-Review (executado pelo autor do plano)

**1. Spec coverage:**
- Capacidades (mergulho/filtro-ranking/comparação) → `inspect_fixture` (T5/T6), `scan_fixtures` filtros+sort (T3) ✔
- Escopo dia + qualidade → resolver de data igual `query_fixtures` (T2); 2 etapas no system prompt (T7) ✔
- Abordagem B (triagem→mergulho), sem pipeline → T2–T5 puros, sem schema/migration ✔
- Estende `/api/copilot`, retrocompat → T6/T7 + teste de retrocompat ✔
- Transparência/auditoria → chips sempre-visíveis (T8/T9); `hops`/`route='copilot'` inalterados (T6/T7), sem DDL ✔
- Reuso das 12 tools de A → `inspectFixture` delega a `executeFixtureTool` (T5) ✔
- Catálogo 7 grupos (com estreitamento h2h/odds da spec) → `computeFixtureSignals` (T1) ✔
- Pirâmide de testes → unit (T1–T5), integração rota (T6/T7), component (T8/T9), regressão (T7), e2e/axe (T10) ✔

**2. Placeholder scan:** nenhum "TBD/TODO"; todo passo de código tem o código real; comandos e saídas esperadas explícitos. ✔

**3. Type consistency:** `FixtureRowLite`, `FixtureSignals`, `ScanFixturesArgs`, `ScanFilter`, `ScanSort`, `ScanResult`, `ScanEntry`, `InspectFixtureArgs` definidos em T1–T5 e reusados com os mesmos nomes em T6 (`scanFixtures`/`inspectFixture`/`scanResultSummary` importados). `FixtureToolCtx`/`executeFixtureTool`/`summarizeFixtureToolResult` batem com as assinaturas reais de `fixture-copilot-tools.ts`. `meta.hops` shape `{tool,args,result_summary,took_ms}` preservado. ✔

---

## Execution Handoff

**Plan complete and saved to `docs/tasks/copilot-geral-cross-jogo/00-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch fresh subagent per task, two-stage review (spec + code-quality) entre tasks, fast iteration. Mesma pipeline das duas features anteriores.

**2. Inline Execution** — executar as tasks nesta sessão via executing-plans, batches com checkpoints de revisão.

**Which approach?**
