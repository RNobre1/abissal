import { computeBadges } from "./badges";
import {
  deriveTeamRecord,
  deriveRecentMatchStats,
  deriveStreakIndex,
  deriveOddsCategories,
} from "@/lib/fixtures/stats/derive";
import { executeFixtureTool, type FixtureToolCtx } from "@/lib/fixtures/fixture-copilot-tools";
import { brtDayWindowUtc, formatUtcAsBrt, parseDateParam, todayBrt } from "./time";
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
  goals_over: { home_over25_pct: number | null; away_over25_pct: number | null; home_avg_total_goals: number | null; away_avg_total_goals: number | null; badge_over_alto: boolean };
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

function avgTotalGoals(matches: NormalizedRecentMatch[]): number | null {
  const ts = matches.map(totalGoals).filter((v): v is number => v !== null);
  if (ts.length === 0) return null;
  return ts.reduce((a, b) => a + b, 0) / ts.length;
}

// Espelha o padrão de seleção honesta de lado do Sub-projeto A
// (get_team_record: deriveTeamRecord({ home: tr?.[side] })) — o deriver
// normaliza a perna passada sob a chave `home`, sem inventar lógica.
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

export interface ScanResult { date: string; total: number; fixtures: ScanEntry[]; error?: string }

const SIGNAL_GROUPS = ["cards", "goals_over", "btts", "first_half", "form", "h2h", "odds"] as const;

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function validField(path: string): boolean {
  const rest = path.startsWith("signals.") ? path.slice("signals.".length) : path;
  const head = rest.split(".")[0];
  return (SIGNAL_GROUPS as readonly string[]).includes(head);
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

  // ── filtros server-side ────────────────────────────────────────────────
  const allFields = [
    ...(args.filters?.map((f) => f.field) ?? []),
    ...(args.sort ? [args.sort.field] : []),
  ];
  const bad = allFields.find((p) => !validField(p));
  if (bad) {
    return { date, total: 0, fixtures: [], error: `campo inválido: ${bad}` };
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

  // signals desconhecidos são descartados; se sobrar vazio, projeta TODOS
  // os grupos (fallback deliberado — nunca devolve signals vazio por engano).
  const wanted = args.signals?.filter((s) => (SIGNAL_GROUPS as readonly string[]).includes(s));
  const projected = filtered.map((e) => {
    if (!wanted || wanted.length === 0) return e;
    const sig: Record<string, unknown> = {};
    for (const g of wanted) sig[g] = (e.signals as unknown as Record<string, unknown>)[g];
    return { ...e, signals: sig as unknown as FixtureSignals };
  });

  const rawLimit = args.limit ?? 15;
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(30, Math.floor(rawLimit)))
    : 15;
  return { date, total, fixtures: projected.slice(0, limit) };
}

// NOTE: a lista de campos pontuados na `description` espelha FixtureSignals —
// manter em sincronia (testes asseguram um subconjunto). O schema espelha
// intencionalmente QUERY_FIXTURES_TOOL: sem `required` (todos os params são
// opcionais), `additionalProperties:false` — mesmo padrão dos 12 FIXTURE_TOOLS.
export const SCAN_FIXTURES_TOOL = {
  type: "function" as const,
  function: {
    name: "scan_fixtures",
    description:
      "Triagem rasa cross-jogo: varre os jogos do dia (BRT) e devolve um shortlist rankeado com sinais derivados. Use ANTES de inspect_fixture para escolher quais jogos mergulhar. Campos de filtro/ordenação (path pontuado): cards.referee_avg_booking|cards.home_avg_cards|cards.away_avg_cards|cards.badge_cartao_alto; goals_over.home_over25_pct|goals_over.away_over25_pct|goals_over.home_avg_total_goals|goals_over.away_avg_total_goals|goals_over.badge_over_alto; btts.home_btts_pct|btts.away_btts_pct|btts.badge_btts_alto; first_half.home_fh_goal_pct|first_half.away_fh_goal_pct|first_half.badge_primeiro_tempo; form.home.pts_recent|form.away.pts_recent|form.home_streak|form.away_streak; h2h.games|h2h.avg_goals; odds.match_favorite|odds.adamchoi_pred.",
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
              value: { description: "Número (gte/lte) ou número/string/boolean (eq) — campos badge_* são boolean." },
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
          items: { type: "string", enum: [...SIGNAL_GROUPS] },
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
      home_avg_total_goals: avgTotalGoals(rh),
      away_avg_total_goals: avgTotalGoals(ra),
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

// Manter em sincronia com FIXTURE_TOOLS[*].function.name em
// fixture-copilot-tools.ts (fonte de verdade das 12 derivações de A).
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
  if (!data) return { error: `fixture ${args.fixture_id} não encontrado` };
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
