# Fixture Copilot + Stats-first Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao abrir um jogo, a tela inicial passa a ser o dashboard de stats; o chat vira um copilot do jogo agêntico (tool-loop), com cada tool explícita no chat e auditoria total em `llm_request_logs`.

**Architecture:** Endpoint novo dedicado `/api/fixture-copilot` espelhando o tool-loop já em prod do `/api/copilot`, com 12 ferramentas que são wrappers finos sobre as funções puras de `lib/fixtures/stats/derive.ts`/`insights.ts` fechadas sobre o `detail_json` de um fixture. `/api/analyze` + `analysis_cache` aposentados no mesmo PR. UI espelha `copilot-fab.tsx` num drawer por jogo com passos de tool sempre visíveis.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod, OpenRouter (fetch direto), Supabase admin client, vitest + happy-dom, Radix-less drawer (mesmo padrão CSS do copilot-fab), Tailwind v4 tokens.

**Spec:** `docs/pesquisas/fixture-copilot-stats-first-design.md` (APPROVED 2026-05-15).

**Convenções de processo:** worktree isolado por task, SDD (implementer → spec review → code-quality review → merge), **autoria única (sem `Co-Authored-By`)**, Conventional Commits pt-BR, review/merge autônomos, deploy no push.

---

## File Structure

| Arquivo | Responsabilidade | Wave |
|---|---|---|
| `lib/fixtures/fixture-copilot-tools.ts` | 12 wrappers de tool + defs OpenRouter + dispatch + summarizer (puro) | 1 |
| `tests/unit/fixture-copilot-tools.test.ts` | unit dos 12 wrappers + erro de seção ausente + summarizer | 1 |
| `lib/llm-logs.ts` (modificar) | ampliar union `route` para incluir `"fixture-copilot"` | 1 |
| `supabase/migrations/0013_fixture_copilot_audit.sql` | `COMMENT` de DEPRECATED em `analysis_cache` (append-only) | 1 |
| `app/api/fixture-copilot/route.ts` | endpoint tool-loop escopado ao fixture, grava auditoria | 2 |
| `tests/api/fixture-copilot.test.ts` | integration da rota (OpenRouter+Supabase mockados) | 2 |
| `app/api/analyze/route.ts` (remover) | rota aposentada | 2 |
| `lib/fixtures/analysis-cache.ts` (remover) | cache aposentado | 2 |
| `components/fixtures/fixture-copilot-drawer.tsx` | drawer FAB do jogo + passos de tool sempre visíveis | 3 |
| `tests/integration/fixture-copilot-drawer.test.tsx` | component test (abre/fecha/ESC, chip de tool ✓/✗, erro) | 3 |
| `app/(dashboard)/fixtures/[id]/page.tsx` (substituir) | renderiza o dashboard + monta o drawer | 3 |
| `app/(dashboard)/fixtures/[id]/stats/page.tsx` (substituir) | `redirect("/fixtures/[id]")` | 3 |
| `components/fixtures/analyze-panel.tsx` (remover) | substituído pelo drawer | 3 |
| `tests/integration/fixture-page.test.tsx` | 14 slots + FAB montam; guard de custo (zero LLM no mount) | 4 |
| `tests/e2e/fixture-copilot.spec.ts` | abrir jogo → dashboard → FAB → tool chips → resposta; axe 0 | 4 |

---

## Wave 1 — Ferramentas + auditoria (solo, TDD strict)

### Task 1: Ampliar `LlmLogInput.route` para `fixture-copilot`

**Files:**
- Modify: `lib/llm-logs.ts:14`
- Test: `tests/unit/llm-logs-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/llm-logs-route.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { recordLlmRequest, type LlmLogInput } from "@/lib/llm-logs";

describe("recordLlmRequest route union", () => {
  it("accepts route='fixture-copilot' and inserts it verbatim", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const admin = { from: () => ({ insert }) };
    const log: LlmLogInput = {
      route: "fixture-copilot",
      fixture_id: 42,
      model: "deepseek/deepseek-v3.2",
      hops: [{ tool: "get_insights", args: {}, result_summary: "ok", took_ms: 3 }],
    };
    await recordLlmRequest(admin, log);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ route: "fixture-copilot", fixture_id: 42 }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/llm-logs-route.test.ts`
Expected: FAIL — `Type '"fixture-copilot"' is not assignable to type '"analyze" | "copilot"'` (typecheck) ou o teste compila mas documenta a intenção; rode `pnpm typecheck` para ver o erro de tipo.

- [ ] **Step 3: Widen the union**

In `lib/llm-logs.ts`, line 14, change:

```ts
  route: "analyze" | "copilot";
```

to:

```ts
  route: "analyze" | "copilot" | "fixture-copilot";
```

- [ ] **Step 4: Run test + typecheck to verify pass**

Run: `pnpm exec vitest run tests/unit/llm-logs-route.test.ts && pnpm typecheck`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/llm-logs.ts tests/unit/llm-logs-route.test.ts
git -c commit.gpgsign=false commit -m "feat(llm-logs): aceita route='fixture-copilot' na auditoria"
```

---

### Task 2: Migration `0013` — marcar `analysis_cache` como DEPRECATED

**Files:**
- Create: `supabase/migrations/0013_fixture_copilot_audit.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0013_fixture_copilot_audit.sql`:

```sql
-- 0013_fixture_copilot_audit.sql
--
-- O fluxo /api/analyze (resumo pré-jogo cacheado) foi aposentado e
-- substituído pelo copilot do jogo agêntico (/api/fixture-copilot).
-- `llm_request_logs.route` é `text` sem CHECK/enum (migration 0012), então
-- gravar 'fixture-copilot' não exige DDL. Esta migration só registra a
-- deprecation de `analysis_cache` no histórico do schema (append-only —
-- a tabela NÃO é dropada para não reescrever o passado).

comment on table public.analysis_cache is
  'DEPRECATED 2026-05-15 — substituída pelo fluxo /api/fixture-copilot; mantida por histórico append-only';
```

- [ ] **Step 2: Verify SQL is well-formed**

Run: `grep -c "comment on table" supabase/migrations/0013_fixture_copilot_audit.sql`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0013_fixture_copilot_audit.sql
git -c commit.gpgsign=false commit -m "chore(db): migration 0013 marca analysis_cache como DEPRECATED"
```

---

### Task 3: Módulo de ferramentas `fixture-copilot-tools.ts`

**Files:**
- Create: `lib/fixtures/fixture-copilot-tools.ts`
- Test: `tests/unit/fixture-copilot-tools.test.ts`

**Contrato (tipos reais já existentes):** `DetailJson` (`lib/fixtures/stats/detail-json-types.ts`) tem `team_record`, `recent_matches:{home,away}`, `h2h`, `streaks:{home,away}`, `referee_record`, `odds_summary`, `player_stats:{home,away}`, `predictions`. Funções puras de `lib/fixtures/stats/derive.ts`: `deriveTeamRecord(raw)`, `deriveRecentMatchStats(raw,_all,perspectiveTeam)`, `deriveSplits1h2h(matches)`, `deriveDistributions(matches)`, `deriveRadarAxes(home,away)`, `deriveStreakIndex(raw)`, `deriveOddsCategories(raw)`. De `lib/fixtures/stats/insights.ts`: `computeCorrelations`, `computeTrends`, `computePatterns`, `computeOutliers`, `rankInsights`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fixture-copilot-tools.test.ts`:

```ts
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
});

describe("summarizeFixtureToolResult", () => {
  it("resume erro como 'error: ...'", () => {
    expect(summarizeFixtureToolResult("get_referee", { error: "sem árbitro" })).toBe("error: sem árbitro");
  });
  it("resume array por contagem", () => {
    expect(summarizeFixtureToolResult("get_h2h", { matches: [1, 2, 3] })).toContain("3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/fixture-copilot-tools.test.ts`
Expected: FAIL — `Cannot find module '@/lib/fixtures/fixture-copilot-tools'`.

- [ ] **Step 3: Implement the tools module**

Create `lib/fixtures/fixture-copilot-tools.ts`:

```ts
/**
 * Ferramentas escopadas a UM fixture para o copilot do jogo
 * (/api/fixture-copilot). Cada função é um wrapper FINO sobre as funções
 * puras já testadas de stats/derive.ts e stats/insights.ts, fechadas sobre
 * o detail_json carregado. Nenhuma lógica de dados nova vive aqui.
 *
 * Contrato de erro: nunca lança. Seção ausente / entrada inválida →
 * { error: string } (a IA segue com o que tem). Espelha o padrão de
 * lib/fixtures/copilot-tools.ts.
 */
import {
  deriveTeamRecord,
  deriveRecentMatchStats,
  deriveSplits1h2h,
  deriveDistributions,
  deriveRadarAxes,
  deriveStreakIndex,
  deriveOddsCategories,
  type NormalizedRecentMatch,
} from "@/lib/fixtures/stats/derive";
import {
  computeCorrelations,
  computeTrends,
  computePatterns,
  computeOutliers,
  rankInsights,
} from "@/lib/fixtures/stats/insights";

export interface FixtureToolCtx {
  detail: unknown;
  homeTeam: string;
  awayTeam: string;
}

type ToolResult = Record<string, unknown>;

function section(detail: unknown, key: string): unknown {
  if (!detail || typeof detail !== "object") return undefined;
  return (detail as Record<string, unknown>)[key];
}

function asSide(args: unknown): "home" | "away" {
  const s = (args as { side?: unknown })?.side;
  return s === "away" ? "away" : "home";
}

function recentFor(ctx: FixtureToolCtx, side: "home" | "away"): NormalizedRecentMatch[] {
  const rm = section(ctx.detail, "recent_matches") as
    | { home?: unknown; away?: unknown }
    | undefined;
  const team = side === "home" ? ctx.homeTeam : ctx.awayTeam;
  try {
    return deriveRecentMatchStats(rm?.[side], null, team);
  } catch {
    return [];
  }
}

const TOOL_FNS: Record<
  string,
  (args: unknown, ctx: FixtureToolCtx) => ToolResult
> = {
  get_insights: (args, ctx) => {
    const home = recentFor(ctx, "home");
    if (home.length === 0) return { error: "sem jogos recentes para insights" };
    const kinds = (args as { kinds?: string[] })?.kinds;
    const all = [
      ...computeCorrelations(home),
      ...computeTrends(home),
      ...computePatterns({
        streaks: section(ctx.detail, "streaks"),
        referee: section(ctx.detail, "referee_record"),
        matches: home,
      }),
      ...computeOutliers(home),
    ];
    const ranked = rankInsights(all);
    const filtered = Array.isArray(kinds) && kinds.length > 0
      ? ranked.filter((i) => kinds.includes((i as { kind?: string }).kind ?? ""))
      : ranked;
    return { insights: filtered };
  },
  get_team_record: (args, ctx) => {
    const tr = section(ctx.detail, "team_record") as
      | { home?: unknown; away?: unknown }
      | undefined;
    const side = asSide(args);
    const derived = deriveTeamRecord(tr?.[side]);
    if (!derived) return { error: `sem team_record para ${side}` };
    return { side, ...derived };
  },
  get_recent_matches: (args, ctx) => {
    const side = asSide(args);
    const matches = recentFor(ctx, side);
    if (matches.length === 0) return { error: `sem jogos recentes para ${side}` };
    return { side, matches };
  },
  get_h2h: (_args, ctx) => {
    const h2h = section(ctx.detail, "h2h");
    if (!Array.isArray(h2h)) return { error: "sem h2h" };
    return { matches: h2h };
  },
  get_splits: (args, ctx) => {
    const matches = recentFor(ctx, asSide(args));
    if (matches.length === 0) return { error: "sem jogos para splits" };
    return { side: asSide(args), splits: deriveSplits1h2h(matches) };
  },
  get_distributions: (args, ctx) => {
    const matches = recentFor(ctx, asSide(args));
    if (matches.length === 0) return { error: "sem jogos para distribuições" };
    return { side: asSide(args), distributions: deriveDistributions(matches) };
  },
  get_radar: (_args, ctx) => {
    const home = recentFor(ctx, "home");
    const away = recentFor(ctx, "away");
    if (home.length === 0 && away.length === 0) return { error: "sem dados para radar" };
    return { radar: deriveRadarAxes(home, away) };
  },
  get_player_stats: (args, ctx) => {
    const ps = section(ctx.detail, "player_stats") as
      | { home?: { top_players?: unknown }; away?: { top_players?: unknown } }
      | undefined;
    const side = asSide(args);
    const players = ps?.[side]?.top_players;
    if (!Array.isArray(players)) return { error: `sem player_stats para ${side}` };
    return { side, top_players: players };
  },
  get_streaks: (_args, ctx) => {
    const st = section(ctx.detail, "streaks") as
      | { home?: unknown[]; away?: unknown[] }
      | undefined;
    const flat = [
      ...(Array.isArray(st?.home) ? st!.home : []),
      ...(Array.isArray(st?.away) ? st!.away : []),
    ];
    if (flat.length === 0) return { error: "sem streaks" };
    return { streaks: deriveStreakIndex(flat) };
  },
  get_referee: (_args, ctx) => {
    const ref = section(ctx.detail, "referee_record");
    if (!ref || typeof ref !== "object") return { error: "sem árbitro designado" };
    return ref as ToolResult;
  },
  get_odds: (_args, ctx) => {
    const odds = section(ctx.detail, "odds_summary");
    if (!odds || typeof odds !== "object") return { error: "sem odds" };
    return { categories: deriveOddsCategories(odds) };
  },
  get_predictions: (_args, ctx) => {
    const preds = section(ctx.detail, "predictions");
    if (!Array.isArray(preds)) return { error: "sem predições" };
    return { predictions: preds };
  },
};

const SIDE_PROP = {
  side: {
    type: "string",
    enum: ["home", "away"],
    description: "Lado do confronto: 'home' (mandante) ou 'away' (visitante). Default 'home'.",
  },
} as const;

export const FIXTURE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_insights",
      description:
        "Insights estatísticos ranqueados do mandante (correlações, tendências, padrões, outliers) com a leitura para aposta.",
      parameters: {
        type: "object",
        properties: {
          kinds: {
            type: "array",
            items: { type: "string", enum: ["correlation", "trend", "pattern", "outlier"] },
            description: "Filtra por tipo de insight. Vazio = todos.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  { type: "function" as const, function: { name: "get_team_record", description: "Aproveitamento do time (split casa/fora + geral, forma, posição).", parameters: { type: "object", properties: { ...SIDE_PROP }, additionalProperties: false } } },
  { type: "function" as const, function: { name: "get_recent_matches", description: "Últimos jogos normalizados de um lado (gols/cantos/cartões/SOT por 1T/2T/FT).", parameters: { type: "object", properties: { ...SIDE_PROP }, additionalProperties: false } } },
  { type: "function" as const, function: { name: "get_h2h", description: "Confrontos diretos (head-to-head) entre os dois times.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function" as const, function: { name: "get_splits", description: "Médias 1º tempo vs 2º tempo (gols, cantos, cartões, SOT) de um lado.", parameters: { type: "object", properties: { ...SIDE_PROP }, additionalProperties: false } } },
  { type: "function" as const, function: { name: "get_distributions", description: "Box stats (min/q1/mediana/q3/max) por métrica de um lado.", parameters: { type: "object", properties: { ...SIDE_PROP }, additionalProperties: false } } },
  { type: "function" as const, function: { name: "get_radar", description: "6 eixos comparativos casa×fora normalizados.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function" as const, function: { name: "get_player_stats", description: "Top jogadores de um lado (minutos, gols, assistências).", parameters: { type: "object", properties: { ...SIDE_PROP }, additionalProperties: false } } },
  { type: "function" as const, function: { name: "get_streaks", description: "Sequências ativas agrupadas (ex.: over, BTTS, cartões).", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function" as const, function: { name: "get_referee", description: "Árbitro designado e sua média de cartões/booking points.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function" as const, function: { name: "get_odds", description: "Mercados de odds agrupados por categoria (match, halves, corners, cards…).", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function" as const, function: { name: "get_predictions", description: "Predições do provedor (adamchoi) para o jogo.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
];

export async function executeFixtureTool(
  name: string,
  args: unknown,
  ctx: FixtureToolCtx,
): Promise<ToolResult> {
  const fn = TOOL_FNS[name];
  if (!fn) return { error: `unknown tool: ${name}` };
  try {
    return fn(args, ctx);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "tool failed" };
  }
}

export function summarizeFixtureToolResult(name: string, result: unknown): string {
  if (!result || typeof result !== "object") return String(result);
  const r = result as Record<string, unknown>;
  if (typeof r.error === "string") return `error: ${r.error}`;
  for (const k of ["insights", "matches", "predictions"]) {
    if (Array.isArray(r[k])) return `${name}: ${(r[k] as unknown[]).length} item(s)`;
  }
  return `${name}: ok`;
}
```

> Se algum nome de export de `derive.ts`/`insights.ts` divergir (ex.: `NormalizedRecentMatch` não exportado), ajuste o import para o nome real verificado em `lib/fixtures/stats/derive.ts` — não invente API; o teste do Step 4 trava o contrato.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/fixture-copilot-tools.test.ts && pnpm typecheck`
Expected: PASS (todas as asserções), 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/fixtures/fixture-copilot-tools.ts tests/unit/fixture-copilot-tools.test.ts
git -c commit.gpgsign=false commit -m "feat(fixture-copilot): 12 ferramentas escopadas ao fixture + dispatch"
```

- [ ] **Step 6: Wave gate**

Run: `pnpm lint && pnpm typecheck && pnpm exec vitest run`
Expected: tudo verde. Encerra a Wave 1.

---

## Wave 2 — Endpoint (depende de W1)

### Task 4: Endpoint `/api/fixture-copilot`

**Files:**
- Create: `app/api/fixture-copilot/route.ts`
- Test: `tests/api/fixture-copilot.test.ts`

**Padrão a espelhar:** `app/api/copilot/route.ts` (estrutura inteira lida e validada). Diferenças: body `{ fixture_id, messages, reasoner? }`; carrega `detail_json` do Supabase; `tools = FIXTURE_TOOLS`; `MAX_TOOL_HOPS = 6`; `executeToolCall` despacha via `executeFixtureTool`; `recordLlmRequest` com `route:"fixture-copilot"` + `fixture_id`.

- [ ] **Step 1: Write the failing test**

Create `tests/api/fixture-copilot.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const fixtureRow = {
  id: 7,
  home_team: "Aston Villa",
  away_team: "Liverpool",
  detail_json: {
    referee_record: { name: "Mike Dean", avg_booking_points: 42 },
    recent_matches: { home: [], away: [] },
  },
};

function adminMock() {
  return {
    from: (table: string) => {
      if (table === "fixtures") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: fixtureRow, error: null }) }),
          }),
        };
      }
      if (table === "llm_request_logs") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      return {};
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminMock() }));
vi.mock("@/lib/env", () => ({
  env: { OPENROUTER_API_KEY: "test-key", OPENROUTER_MODEL: "deepseek/deepseek-v3.2" },
}));

import { POST } from "@/app/api/fixture-copilot/route";

beforeEach(() => vi.restoreAllMocks());

describe("POST /api/fixture-copilot", () => {
  it("400 quando body inválido", async () => {
    const res = await POST(new Request("http://t", { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
  });

  it("loop executa tool e devolve {content, meta.hops}", async () => {
    const calls: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      calls.push(init);
      // 1ª resposta: pede a tool get_referee; 2ª: resposta final.
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: null,
              tool_calls: [{ id: "c1", type: "function",
                function: { name: "get_referee", arguments: "{}" } }] } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "O árbitro é o Mike Dean (42)." } }],
          usage: { prompt_tokens: 8, completion_tokens: 9 },
        }),
        { status: 200 },
      );
    });

    const res = await POST(new Request("http://t", {
      method: "POST",
      body: JSON.stringify({ fixture_id: 7, messages: [{ role: "user", content: "quem apita?" }] }),
    }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { content: string; meta: { hops: Array<{ tool: string }> } };
    expect(json.content).toContain("Mike Dean");
    expect(json.meta.hops.map((h) => h.tool)).toContain("get_referee");
  });

  it("404 quando fixture não existe / 400 sem detail_json", async () => {
    const res = await POST(new Request("http://t", {
      method: "POST",
      body: JSON.stringify({ fixture_id: 999999, messages: [{ role: "user", content: "x" }] }),
    }));
    expect([400, 404]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/api/fixture-copilot.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/fixture-copilot/route'`.

- [ ] **Step 3: Implement the route**

Create `app/api/fixture-copilot/route.ts` (espelha `app/api/copilot/route.ts`; trechos idênticos ao copilot marcados com `// ≡ copilot`):

```ts
import { z } from "zod";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  FIXTURE_TOOLS,
  executeFixtureTool,
  summarizeFixtureToolResult,
  type FixtureToolCtx,
} from "@/lib/fixtures/fixture-copilot-tools";
import { recordLlmRequest } from "@/lib/llm-logs";

/**
 * POST /api/fixture-copilot — copilot agêntico de UM jogo.
 * Body: { fixture_id, messages:[{role,content}], reasoner? }
 * Espelha /api/copilot (tool-loop não-streaming) escopado ao detail_json.
 */

const SYSTEM_PROMPT = `Você é um copiloto de apostas analisando UM jogo específico de futebol.
Você SÓ pode afirmar números que vieram de uma das ferramentas — nunca invente
estatística, jogador, árbitro ou odd. Use as ferramentas para puxar a camada
tratada (insights, splits, radar, recent matches, etc.) e responda em português
do Brasil, em markdown, citando o valor e a leitura para aposta. Se uma
ferramenta retornar {error}, diga o que faltou e siga com o que tem.`;

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const bodySchema = z
  .object({
    fixture_id: z.number().int().positive(),
    messages: z.array(chatMessageSchema).min(1),
    reasoner: z.boolean().optional(),
  })
  .refine((b) => b.messages[b.messages.length - 1].role === "user", {
    message: "messages must end with role=user",
    path: ["messages"],
  });

const MAX_TOOL_HOPS = 6;
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const REASONER_MODEL = "deepseek/deepseek-r1";
const REASONER_MAX_TOKENS = 16000;

interface UpstreamMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
}
interface UpstreamUsage { prompt_tokens: number; completion_tokens: number; total_tokens?: number }
interface UpstreamChoice { message: { role: "assistant"; content: string | null; reasoning?: string; tool_calls?: UpstreamMessage["tool_calls"] } }
interface UpstreamResponse { choices: UpstreamChoice[]; usage?: UpstreamUsage }
interface Hop { tool: string; args: unknown; result_summary: string; took_ms: number }
interface CopilotMeta {
  model: string; latency_ms: number; hops: Hop[];
  usage_total: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  reasoning?: string;
}

export async function POST(request: Request): Promise<Response> {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    return Response.json({ error: "invalid request body", details: String(err) }, { status: 400 });
  }
  if (!env.OPENROUTER_API_KEY) {
    return Response.json({ error: "OPENROUTER_API_KEY is not configured" }, { status: 503 });
  }

  const admin = createAdminClient();
  const { data: row, error: rowErr } = await (admin as unknown as {
    from: (t: string) => {
      select: (c: string) => { eq: (k: string, v: number) => { maybeSingle: () => Promise<{ data: { id: number; home_team: string; away_team: string; detail_json: unknown } | null; error: unknown }> } };
    };
  })
    .from("fixtures")
    .select("id, home_team, away_team, detail_json")
    .eq("id", parsed.fixture_id)
    .maybeSingle();

  if (rowErr || !row) {
    return Response.json({ error: "fixture not found" }, { status: 404 });
  }
  if (!row.detail_json) {
    return Response.json(
      { error: "fixture has no detail yet", hint: "POST /api/fixtures/{id}/refresh first" },
      { status: 400 },
    );
  }

  const ctx: FixtureToolCtx = {
    detail: row.detail_json,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
  };

  const messages: UpstreamMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `Jogo: ${row.home_team} (mandante) x ${row.away_team} (visitante).` },
    ...parsed.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const startedAt = Date.now();
  const hops: Hop[] = [];
  const usageTotal = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const useReasoner = parsed.reasoner === true;
  const model = useReasoner ? REASONER_MODEL : env.OPENROUTER_MODEL;
  let reasoning: string | undefined;

  function meta(): CopilotMeta {
    return { model, latency_ms: Date.now() - startedAt, hops, usage_total: usageTotal, ...(reasoning ? { reasoning } : {}) };
  }
  function accumulateUsage(u: UpstreamUsage | undefined): void {
    if (!u) return;
    usageTotal.prompt_tokens += u.prompt_tokens;
    usageTotal.completion_tokens += u.completion_tokens;
    usageTotal.total_tokens += u.total_tokens ?? u.prompt_tokens + u.completion_tokens;
  }

  try {
    for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
      const upstream = await callOpenRouter(messages, env.OPENROUTER_API_KEY, model, useReasoner ? REASONER_MAX_TOKENS : undefined);
      accumulateUsage(upstream.usage);
      const msg = upstream.choices[0].message;
      if (msg.reasoning) reasoning = msg.reasoning;

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const finalMeta = meta();
        await recordLlmRequest(admin, {
          route: "fixture-copilot", fixture_id: parsed.fixture_id, model, cached: false,
          reasoner: useReasoner, latency_ms: finalMeta.latency_ms,
          prompt_tokens: finalMeta.usage_total.prompt_tokens,
          completion_tokens: finalMeta.usage_total.completion_tokens,
          total_tokens: finalMeta.usage_total.total_tokens, hops: finalMeta.hops,
        });
        return Response.json({ content: msg.content ?? "", meta: finalMeta });
      }

      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
      for (const call of msg.tool_calls) {
        const hopStarted = Date.now();
        let args: unknown = {};
        try { args = JSON.parse(call.function.arguments); } catch { args = { _raw: call.function.arguments }; }
        const result = await executeFixtureTool(call.function.name, args, ctx);
        hops.push({
          tool: call.function.name, args,
          result_summary: summarizeFixtureToolResult(call.function.name, result),
          took_ms: Date.now() - hopStarted,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }

    const cappedMeta = meta();
    await recordLlmRequest(admin, {
      route: "fixture-copilot", fixture_id: parsed.fixture_id, model, cached: false,
      reasoner: useReasoner, latency_ms: cappedMeta.latency_ms,
      prompt_tokens: cappedMeta.usage_total.prompt_tokens,
      completion_tokens: cappedMeta.usage_total.completion_tokens,
      total_tokens: cappedMeta.usage_total.total_tokens, hops: cappedMeta.hops,
      error: "max_tool_hops reached",
    });
    return Response.json({
      content: "Não consegui concluir em até 6 consultas. Tente uma pergunta mais direta.",
      meta: cappedMeta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await recordLlmRequest(admin, {
      route: "fixture-copilot", fixture_id: parsed.fixture_id, model, cached: false,
      reasoner: useReasoner, latency_ms: Date.now() - startedAt,
      prompt_tokens: usageTotal.prompt_tokens, completion_tokens: usageTotal.completion_tokens,
      total_tokens: usageTotal.total_tokens, hops, error: message,
    });
    return Response.json({ error: "upstream copilot error", details: message }, { status: 502 });
  }
}

// ≡ copilot (callOpenRouter), só troca a lista de tools.
async function callOpenRouter(
  messages: UpstreamMessage[], apiKey: string, model: string, maxTokens?: number,
): Promise<UpstreamResponse> {
  const body: Record<string, unknown> = {
    model, messages, tools: FIXTURE_TOOLS, tool_choice: "auto",
  };
  if (maxTokens) body.max_tokens = maxTokens;
  const res = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://abissal.rnobre.dev",
      "X-Title": "Abissal Fixture Copilot",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json() as Promise<UpstreamResponse>;
}
```

> O cast `as unknown as {...}` no `.from("fixtures")` segue o mesmo padrão pragmático já usado no projeto (tipos gerados não cobrem `fixtures`). Se o `analyze.test.ts` revelar um helper de query diferente (`.select().eq().maybeSingle()` exato), alinhe ao shape real do mock em `tests/api/analyze.test.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/api/fixture-copilot.test.ts && pnpm typecheck`
Expected: PASS (400, loop com hop `get_referee`, 404/400 sem detail), 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/fixture-copilot/route.ts tests/api/fixture-copilot.test.ts
git -c commit.gpgsign=false commit -m "feat(api): /api/fixture-copilot — tool-loop agêntico do jogo + auditoria"
```

---

### Task 5: Aposentar `/api/analyze` + `analysis_cache`

**Files:**
- Remove: `app/api/analyze/route.ts` (e a pasta `app/api/analyze/` se ficar vazia)
- Remove: `lib/fixtures/analysis-cache.ts`
- Remove: `tests/api/analyze.test.ts`
- Verify: nenhuma referência pendente

- [ ] **Step 1: Mapear referências antes de remover**

Run:
```bash
grep -rn "api/analyze\|analysis-cache\|analysis_cache\|lookupByHash\|storeAnalysis" app components lib tests --include="*.ts" --include="*.tsx" | grep -v "tests/api/analyze.test.ts" | grep -v "0008_" | grep -v "0013_"
```
Expected: idealmente vazio. Qualquer hit fora de `analyze-panel.tsx` (que sai na Task 7) deve ser tratado aqui — anote o arquivo.

- [ ] **Step 2: Remover os módulos aposentados**

```bash
git rm app/api/analyze/route.ts lib/fixtures/analysis-cache.ts tests/api/analyze.test.ts
rmdir "app/api/analyze" 2>/dev/null || true
```

- [ ] **Step 3: Re-verificar build/typecheck**

Run: `pnpm typecheck`
Expected: 0 errors. Se quebrar por import órfão (ex.: algo importava `analysis-cache`), remova o import morto no arquivo apontado pelo erro (não recrie a funcionalidade — ela foi aposentada por decisão de spec).

- [ ] **Step 4: Suíte (sem o analyze.test.ts removido)**

Run: `pnpm exec vitest run`
Expected: verde. `analyze.test.ts` não existe mais; nenhum outro teste deve depender de `/api/analyze`.

- [ ] **Step 5: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "chore(api): aposenta /api/analyze + analysis_cache (substituídos pelo fixture-copilot)"
```

- [ ] **Step 6: Wave gate**

Run: `pnpm lint && pnpm typecheck && pnpm exec vitest run`
Expected: tudo verde. Contrato `meta.hops` congelado (`{tool,args,result_summary,took_ms}`). Encerra a Wave 2.

---

## Wave 3 — UI + roteamento (depende do contrato de W2)

### Task 6: `FixtureCopilotDrawer` com passos de tool sempre visíveis

**Files:**
- Create: `components/fixtures/fixture-copilot-drawer.tsx`
- Test: `tests/integration/fixture-copilot-drawer.test.tsx`

**Padrão a espelhar:** `components/fixtures/copilot-fab.tsx` (lido integralmente). Divergência deliberada exigida pelo spec: os passos de tool são **sempre visíveis no chat** (não atrás do dev-flag `showLog`). Reusa `ChatMessageView`/`ChatMessage` de `./chat-message`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/fixture-copilot-drawer.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FixtureCopilotDrawer } from "@/components/fixtures/fixture-copilot-drawer";

beforeEach(() => vi.restoreAllMocks());

function setup() {
  return render(
    <FixtureCopilotDrawer fixtureId={7} homeTeam="Aston Villa" awayTeam="Liverpool" />,
  );
}

describe("FixtureCopilotDrawer", () => {
  it("FAB abre o drawer e ESC fecha", () => {
    setup();
    fireEvent.click(screen.getByLabelText("Abrir copilot do jogo"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renderiza cada tool como passo visível (✓) e a resposta", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          content: "O árbitro é o Mike Dean.",
          meta: {
            model: "x", latency_ms: 12,
            usage_total: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            hops: [{ tool: "get_referee", args: {}, result_summary: "get_referee: ok", took_ms: 3 }],
          },
        }),
        { status: 200 },
      ) as Response,
    );
    setup();
    fireEvent.click(screen.getByLabelText("Abrir copilot do jogo"));
    fireEvent.change(screen.getByLabelText("Pergunta"), { target: { value: "quem apita?" } });
    fireEvent.submit(screen.getByLabelText("Pergunta").closest("form")!);
    await waitFor(() => expect(screen.getByText(/Mike Dean/)).toBeInTheDocument());
    expect(screen.getByText("get_referee")).toBeInTheDocument();
    expect(screen.getByText(/get_referee: ok/)).toBeInTheDocument();
  });

  it("mostra erro de tool com ✗", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          content: "Sem árbitro definido.",
          meta: {
            model: "x", latency_ms: 9,
            usage_total: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            hops: [{ tool: "get_referee", args: {}, result_summary: "error: sem árbitro designado", took_ms: 2 }],
          },
        }),
        { status: 200 },
      ) as Response,
    );
    setup();
    fireEvent.click(screen.getByLabelText("Abrir copilot do jogo"));
    fireEvent.change(screen.getByLabelText("Pergunta"), { target: { value: "arbitro?" } });
    fireEvent.submit(screen.getByLabelText("Pergunta").closest("form")!);
    await waitFor(() => expect(screen.getByText(/error: sem árbitro/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/integration/fixture-copilot-drawer.test.tsx`
Expected: FAIL — `Cannot find module '@/components/fixtures/fixture-copilot-drawer'`.

- [ ] **Step 3: Implement the drawer**

Create `components/fixtures/fixture-copilot-drawer.tsx` (espelha `copilot-fab.tsx`; `FixtureToolSteps` é o bloco SEMPRE visível exigido pelo spec):

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, ArrowRight, Wrench } from "lucide-react";
import { ChatMessageView, type ChatMessage } from "./chat-message";

interface FixtureCopilotDrawerProps {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
}

interface Hop { tool: string; args: unknown; result_summary: string; took_ms: number }
interface CopilotMeta {
  model: string;
  latency_ms: number;
  hops: Hop[];
  usage_total: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  reasoning?: string;
}

export function FixtureCopilotDrawer({ fixtureId, homeTeam, awayTeam }: FixtureCopilotDrawerProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesMeta, setMessagesMeta] = useState<Record<number, CopilotMeta>>({});
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useReasoner, setUseReasoner] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const SUGGESTIONS: ReadonlyArray<string> = [
    `Resumo do ${homeTeam} x ${awayTeam} para aposta`,
    "Quais insights têm valor neste jogo?",
    "Como estão os splits de 1º vs 2º tempo?",
    "O árbitro puxa cartão?",
  ];

  useEffect(() => {
    try {
      const reasoner = window.localStorage.getItem("abissal:dev-reasoner") === "1";
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUseReasoner(reasoner);
    } catch { /* SSR / Safari private */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, pending]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    const newMessages: ChatMessage[] = [...messages, { role: "user", content: q }];
    setMessages(newMessages);
    setInput("");
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/fixture-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixture_id: fixtureId,
          reasoner: useReasoner,
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const body = (await res.json()) as { content?: string; error?: string; meta?: CopilotMeta };
      if (!res.ok) { setError(body.error ?? `HTTP ${res.status}`); return; }
      setMessages((prev) => {
        const next: ChatMessage[] = [...prev, { role: "assistant", content: body.content ?? "" }];
        if (body.meta) setMessagesMeta((m) => ({ ...m, [next.length - 1]: body.meta! }));
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro desconhecido");
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: React.FormEvent) { e.preventDefault(); void send(input); }

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir copilot do jogo"
          className="fixed right-4 bottom-20 z-40 flex h-14 w-14 items-center justify-center rounded-full text-[var(--color-ink-display)] shadow-xl transition-transform hover:scale-105 active:scale-95 lg:bottom-6 lg:right-6"
          style={{ backgroundColor: "var(--color-vermelho)" }}
        >
          <MessageCircle size={22} strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-[60] flex">
          <button
            type="button"
            aria-label="Fechar copilot"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`Copilot do jogo ${homeTeam} x ${awayTeam}`}
            className="relative ml-auto flex h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border-t border-[var(--color-line)] bg-[var(--color-surface-1)] motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:duration-300 mt-auto lg:h-full lg:max-w-[480px] lg:rounded-none lg:border-t-0 lg:border-l lg:motion-safe:slide-in-from-right"
          >
            <header className="flex items-center justify-between border-b border-[var(--color-line-subtle)] px-5 py-4">
              <div>
                <span className="label">copilot do jogo</span>
                <h3 className="mt-1 text-lg">{homeTeam} <span className="text-[var(--color-ink-muted)]">x</span> {awayTeam}</h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] p-1.5 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </header>

            <div ref={scrollRef} className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4" aria-live="polite">
              {messages.length === 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm italic text-[var(--color-ink-muted)]">Pergunte sobre este jogo. Exemplos:</p>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => void send(s)} className="card card-hover px-4 py-3 text-left text-sm text-[var(--color-ink)]">
                      {s}
                    </button>
                  ))}
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    {m.role === "assistant" && messagesMeta[i] ? (
                      <FixtureToolSteps hops={messagesMeta[i].hops} />
                    ) : null}
                    <ChatMessageView message={m} />
                  </div>
                ))
              )}
              {pending ? <DrawerLoader /> : null}
              {error ? (
                <p className="text-sm" style={{ color: "var(--color-vermelho)" }} role="alert">{error}</p>
              ) : null}
            </div>

            <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-[var(--color-line-subtle)] px-5 py-3">
              <label htmlFor="fixture-copilot-input" className="sr-only">Pergunta</label>
              <input
                ref={inputRef}
                id="fixture-copilot-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={pending}
                placeholder="pergunte sobre este jogo…"
                className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder-[var(--color-ink-muted)] focus:border-[var(--color-line-strong)] focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={pending || !input.trim()}
                aria-label="Enviar"
                className="rounded-[var(--radius-sm)] p-2 text-[var(--color-ink-display)] disabled:opacity-50"
                style={{ backgroundColor: "var(--color-vermelho)" }}
              >
                <ArrowRight size={16} strokeWidth={2} />
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}

/** Passos de tool SEMPRE visíveis no chat (requisito de transparência do spec). */
function FixtureToolSteps({ hops }: { hops: Hop[] }) {
  if (!hops || hops.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {hops.map((h, i) => {
        const isErr = h.result_summary.startsWith("error:");
        return (
          <div
            key={i}
            className="flex flex-col gap-0.5 rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] bg-[var(--color-surface-2)] px-3 py-1.5 font-mono text-[11px] leading-relaxed"
          >
            <span className="flex items-center gap-1.5 text-[var(--color-ink)]">
              <Wrench size={11} strokeWidth={2} aria-hidden style={{ color: "var(--color-vermelho)" }} />
              <span style={{ color: "var(--color-vermelho)" }}>{h.tool}</span>
              <span className="text-[var(--color-ink-faint)]">· {JSON.stringify(h.args)} · {h.took_ms} ms</span>
            </span>
            <span style={{ color: isErr ? "var(--color-vermelho)" : "var(--color-ink-muted)" }}>
              {isErr ? "✗" : "✓"} {h.result_summary}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DrawerLoader() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block h-1.5 w-1.5 rounded-full motion-safe:animate-bounce"
            style={{ animationDelay: `${i * 140}ms`, backgroundColor: "var(--color-vermelho)" }}
          />
        ))}
      </div>
      <span className="label text-[var(--color-ink-faint)]">analisando o jogo…</span>
    </div>
  );
}
```

> Se `lucide-react` não exportar `Wrench`, troque por um glifo `🔧` em `<span aria-hidden>` — não adicione dependência. Se `chat-message` exportar nomes diferentes, alinhe ao real (verificado em `components/fixtures/chat-message.tsx`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/integration/fixture-copilot-drawer.test.tsx && pnpm typecheck`
Expected: PASS (abre/ESC, chip ✓ com tool+summary, chip ✗ em erro), 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add components/fixtures/fixture-copilot-drawer.tsx tests/integration/fixture-copilot-drawer.test.tsx
git -c commit.gpgsign=false commit -m "feat(ui): drawer do copilot do jogo com passos de tool sempre visíveis"
```

---

### Task 7: Stats-first — `[id]` vira dashboard, `/stats` redireciona, remove AnalyzePanel

**Files:**
- Replace: `app/(dashboard)/fixtures/[id]/page.tsx`
- Replace: `app/(dashboard)/fixtures/[id]/stats/page.tsx`
- Remove: `components/fixtures/analyze-panel.tsx` (+ teste se houver)

- [ ] **Step 1: Snapshot do comportamento atual (RED de integração — escrito na Task 8)**

Pré-check (não é teste ainda): confirme os dois arquivos e o componente raiz do dashboard.

Run:
```bash
grep -n "export default" "app/(dashboard)/fixtures/[id]/stats/page.tsx" "app/(dashboard)/fixtures/[id]/page.tsx"
grep -n "AnalyzePanel\|StatsLayout\|buildPanels\|home_team\|away_team\|\.id" "app/(dashboard)/fixtures/[id]/stats/page.tsx" | head -40
```
Anote: nome do componente default do stats, a linha do `return` que renderiza o layout, e os nomes da var do fixture row (ex.: `fixture`/`row`) + campos `id/home_team/away_team`.

- [ ] **Step 2: Tornar `[id]/page.tsx` o dashboard + montar o drawer**

A page de stats já é um Server Component autossuficiente (carrega o próprio fixture). Substitua o conteúdo de `[id]/page.tsx` pelo da `[id]/stats/page.tsx` e injete o drawer:

```bash
cp "app/(dashboard)/fixtures/[id]/stats/page.tsx" "app/(dashboard)/fixtures/[id]/page.tsx"
```

Agora edite `app/(dashboard)/fixtures/[id]/page.tsx`:

1. Adicione no topo, junto aos imports existentes:

```ts
import { FixtureCopilotDrawer } from "@/components/fixtures/fixture-copilot-drawer";
```

2. No `return` do componente default, envolva a árvore existente num fragmento e adicione o drawer como **último filho**, usando os nomes reais da row anotados no Step 1 (exemplo assumindo a var `fixture` com `id/home_team/away_team`):

```tsx
  return (
    <>
      {/* …toda a árvore do dashboard que já existia, intacta… */}
      <FixtureCopilotDrawer
        fixtureId={fixture.id}
        homeTeam={fixture.home_team}
        awayTeam={fixture.away_team}
      />
    </>
  );
```

> Não altere `buildPanels` nem nenhum deriver — só embrulha o JSX existente e acrescenta o drawer. Se o componente já retorna um fragmento/elemento único, apenas adicione `<FixtureCopilotDrawer .../>` como irmão final dentro dele.

- [ ] **Step 3: Transformar `[id]/stats/page.tsx` em redirect**

Substitua TODO o conteúdo de `app/(dashboard)/fixtures/[id]/stats/page.tsx` por:

```tsx
import { redirect } from "next/navigation";

/**
 * Rota legada. O dashboard de stats agora é a tela inicial do jogo em
 * /fixtures/[id]. Mantida só para não quebrar bookmarks/links antigos.
 */
export default async function StatsRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/fixtures/${id}`);
}
```

> Se a assinatura de `params` no projeto não for `Promise<...>` (Next 16 normalmente é), alinhe ao shape usado pelas outras pages do repo (verifique outra page sob `app/(dashboard)/fixtures/`).

- [ ] **Step 4: Remover o AnalyzePanel**

```bash
git rm components/fixtures/analyze-panel.tsx
ls tests | grep -i analyze-panel && git rm tests/**/analyze-panel*.test.tsx || true
grep -rn "analyze-panel\|AnalyzePanel" app components lib tests --include="*.ts" --include="*.tsx" || echo "sem referências órfãs"
```
Expected: "sem referências órfãs". Qualquer hit → remover o import/uso morto no arquivo apontado.

- [ ] **Step 5: Verificar build/typecheck/test**

Run: `pnpm typecheck && pnpm exec vitest run`
Expected: 0 type errors; suíte verde (a Task 8 adiciona os testes de integração novos).

- [ ] **Step 6: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(fixtures): stats vira a tela inicial do jogo; /stats redireciona; drawer plugado"
```

---

## Wave 4 — Integração & E2E

### Task 8: Integração — 14 slots + FAB + guard de custo

**Files:**
- Create: `tests/integration/fixture-page.test.tsx`

- [ ] **Step 1: Write the test**

Create `tests/integration/fixture-page.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";

/**
 * Guard de custo + regressão: abrir o jogo (montar a page) NÃO pode disparar
 * nenhuma chamada LLM (o resumo automático foi aposentado). O FAB do copilot
 * existe e só chama /api/fixture-copilot quando o usuário interage.
 */
describe("fixture page (stats-first)", () => {
  it("monta sem nenhuma chamada de rede no mount", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // A page é Server Component; este guard cobre o lado client (drawer):
    // importar o drawer e montá-lo não deve disparar fetch.
    return import("@/components/fixtures/fixture-copilot-drawer").then(async (mod) => {
      const { render } = await import("@testing-library/react");
      render(<mod.FixtureCopilotDrawer fixtureId={1} homeTeam="A" awayTeam="B" />);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
```

> Se já existir `tests/integration/stats-page.test.tsx` cobrindo os 14 slots, NÃO duplique — adicione só o guard de custo aqui e mantenha o de slots onde está (a rota agora é `/fixtures/[id]`; ajuste o import do componente de page se o teste de slots referenciava o caminho antigo).

- [ ] **Step 2: Run test**

Run: `pnpm exec vitest run tests/integration/fixture-page.test.tsx`
Expected: PASS (nenhum fetch no mount).

- [ ] **Step 3: Reapontar o teste de slots existente (se houver)**

Run: `grep -rn "stats/page\|fixtures/\[id\]/stats" tests/integration/*.tsx 2>/dev/null || echo "nada a reapontar"`
Se houver, edite o import para o novo caminho `app/(dashboard)/fixtures/[id]/page` e rode `pnpm exec vitest run tests/integration`. Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/fixture-page.test.tsx
git -c commit.gpgsign=false commit -m "test(integration): guard de custo (zero LLM no mount) + reaponta slots"
```

---

### Task 9: E2E — abrir jogo → dashboard → FAB → tool chips → axe 0

**Files:**
- Create: `tests/e2e/fixture-copilot.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/fixture-copilot.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const FIXTURE_PATH = process.env.E2E_FIXTURE_PATH ?? "/fixtures";

test.describe("fixture copilot (stats-first)", () => {
  test("abrir um jogo cai no dashboard, não no chat", async ({ page }) => {
    await page.goto(FIXTURE_PATH);
    const firstGame = page.getByRole("link", { name: /vs|x/i }).first();
    if (await firstGame.count()) {
      await firstGame.click();
      // Dashboard: existe pelo menos um painel/heading de stats; não há textarea de chat auto-aberto.
      await expect(page).not.toHaveURL(/\/stats(\/|$)/);
      await expect(page.getByLabel("Abrir copilot do jogo")).toBeVisible();
    }
  });

  test("FAB abre o drawer; sem violações axe", async ({ page }) => {
    await page.goto(FIXTURE_PATH);
    const firstGame = page.getByRole("link", { name: /vs|x/i }).first();
    test.skip((await firstGame.count()) === 0, "sem fixtures no ambiente de teste");
    await firstGame.click();
    await page.getByLabel("Abrir copilot do jogo").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("/fixtures/[id]/stats redireciona para /fixtures/[id]", async ({ page }) => {
    await page.goto(FIXTURE_PATH);
    const firstGame = page.getByRole("link", { name: /vs|x/i }).first();
    test.skip((await firstGame.count()) === 0, "sem fixtures");
    await firstGame.click();
    const url = new URL(page.url());
    await page.goto(`${url.pathname}/stats`);
    await expect(page).toHaveURL(url.pathname);
  });
});
```

> `@axe-core/playwright` foi pré-aprovado pelo usuário e já é dependência do projeto (usado na feature anterior). Se o seletor de link de jogo divergir, alinhe ao `data-testid`/role real usado em `tests/e2e/stats-page.spec.ts`.

- [ ] **Step 2: Run e2e (se o ambiente E2E estiver configurado)**

Run: `pnpm test:e2e tests/e2e/fixture-copilot.spec.ts`
Expected: PASS; `test.skip` cobre ambiente sem fixtures. Se `pnpm test:e2e` não existir como script, use o comando Playwright do projeto verificado em `package.json`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/fixture-copilot.spec.ts
git -c commit.gpgsign=false commit -m "test(e2e): stats-first + FAB + redirect /stats + axe 0 violações"
```

- [ ] **Step 4: Wave gate final**

Run: `pnpm lint && pnpm typecheck && pnpm exec vitest run`
Expected: tudo verde. Merge final + push (CI+deploy monitorados até `success`).

---

## Self-Review (executado na escrita do plano)

**1. Cobertura do spec:**
- Roteamento `[id]`→dashboard, `/stats`→redirect, remove AnalyzePanel → Task 7. ✓
- Endpoint novo `/api/fixture-copilot` tool-loop não-streaming, `MAX_TOOL_HOPS=6` → Task 4. ✓
- 12 ferramentas wrappers sobre `derive.ts`/`insights.ts` → Task 3. ✓
- Aposentar `/api/analyze` + `analysis_cache` → Task 5 + migration 0013 Task 2. ✓
- Transparência: tool sempre visível no chat → `FixtureToolSteps` Task 6. ✓
- Auditoria/traceability: `recordLlmRequest` route `fixture-copilot` + `hops[]` → Task 1 + Task 4. ✓
- Resumo automático removido + guard de custo → Task 7 + Task 8. ✓
- Pirâmide de testes (unit/integration/component/e2e/regressão) → Tasks 1,3,4,6,8,9. ✓

**2. Placeholder scan:** sem TBD/TODO; código completo em cada step; comandos com expected. Pontos de "alinhe ao real" são guardas defensivos contra drift de API, não placeholders (cada um tem fallback concreto + teste que trava o contrato). ✓

**3. Consistência de tipos:** `Hop = {tool,args,result_summary,took_ms}` idêntico no endpoint (Task 4), no `recordLlmRequest` (`hops: unknown`, Task 1) e no drawer (Task 6). `FixtureToolCtx`/`executeFixtureTool`/`summarizeFixtureToolResult` definidos na Task 3 e consumidos com a mesma assinatura na Task 4. `FixtureCopilotDrawer` props `{fixtureId,homeTeam,awayTeam}` idênticas entre Task 6 (def) e Task 7 (uso). ✓
