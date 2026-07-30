/**
 * Ferramentas escopadas a UM fixture para o copilot do jogo
 * (/api/fixture-copilot). Cada função é um wrapper FINO sobre as funções
 * puras já testadas de stats/derive.ts e stats/insights.ts, fechadas sobre
 * o detail_json carregado uma única vez pelo endpoint. Nenhuma lógica de
 * dados nova vive aqui.
 *
 * Contrato de erro: NUNCA lança. Seção ausente / entrada inválida →
 * { error: string } — a IA segue com o que tem e diz o que faltou.
 *
 * Disciplina de payload: os resultados voltam pro LLM como JSON no tool
 * message — arrays são capados (MAX_*) e jogadores compactados pra não
 * inflar tokens nem trafegar o detail_json inteiro.
 */
import {
  deriveTeamRecord,
  deriveRecentMatchStats,
  deriveSplits1h2h,
  deriveDistributions,
  deriveRadarAxes,
  deriveStreakIndex,
  deriveOddsCategories,
} from "@/lib/fixtures/stats/derive";
import {
  computeCorrelations,
  computeTrends,
  computePatterns,
  computeOutliers,
  rankInsights,
} from "@/lib/fixtures/stats/insights";
import type {
  NormalizedRecentMatch,
  Player,
  RefereeRecord,
  Streaks,
} from "@/lib/fixtures/stats/detail-json-types";

export interface FixtureToolCtx {
  /** fixtures.detail_json cru (unknown — as tools degradam se malformado). */
  detail: unknown;
  homeTeam: string;
  awayTeam: string;
}

type ToolResult = Record<string, unknown>;

const MAX_MATCHES = 10;
const MAX_H2H = 10;
const MAX_PLAYERS = 10;
const MAX_STREAKS = 30;
const MAX_INSIGHTS = 10;

// ─── Helpers ────────────────────────────────────────────────────────────

function section(detail: unknown, key: string): unknown {
  if (!detail || typeof detail !== "object") return undefined;
  return (detail as Record<string, unknown>)[key];
}

function asSide(args: unknown): "home" | "away" {
  const s = (args as { side?: unknown } | null)?.side;
  return s === "away" ? "away" : "home";
}

function recentFor(
  ctx: FixtureToolCtx,
  side: "home" | "away",
): NormalizedRecentMatch[] {
  const rm = section(ctx.detail, "recent_matches") as
    | { home?: unknown; away?: unknown }
    | undefined;
  const team = side === "home" ? ctx.homeTeam : ctx.awayTeam;
  const raw = rm?.[side];
  try {
    return deriveRecentMatchStats(raw, raw, team);
  } catch {
    return [];
  }
}

/** Player → subconjunto relevante pra aposta (poupa tokens). */
function compactPlayer(p: Player): Record<string, unknown> {
  return {
    name: p.name,
    injured: p.injured,
    started: p.started,
    minutes: p.minutes,
    goals: p.goals,
    first_goals: p.first_goals,
    assists: p.assists,
    yellows: p.yellows,
    reds: p.reds,
    shots_on_target: p.shots_on_target,
    fouls_committed: p.fouls_committed,
  };
}

// ─── As 12 tools ────────────────────────────────────────────────────────

const TOOL_FNS: Record<string, (args: unknown, ctx: FixtureToolCtx) => ToolResult> = {
  get_insights: (args, ctx) => {
    const home = recentFor(ctx, "home");
    if (home.length === 0) return { error: "sem jogos recentes para insights" };
    const kinds = (args as { kinds?: unknown } | null)?.kinds;
    const streaks = (section(ctx.detail, "streaks") ?? {
      home: [],
      away: [],
    }) as Streaks;
    const referee = (section(ctx.detail, "referee_record") ??
      null) as RefereeRecord | null;
    const all = [
      ...computeCorrelations(home),
      ...computeTrends(home),
      ...computePatterns({ streaks, referee, matches: home }),
      ...computeOutliers(home),
    ];
    const ranked = rankInsights(all, MAX_INSIGHTS);
    const filtered =
      Array.isArray(kinds) && kinds.length > 0
        ? ranked.filter((i) => kinds.includes(i.kind))
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
    return { side, matches: matches.slice(0, MAX_MATCHES) };
  },

  get_h2h: (_args, ctx) => {
    const h2h = section(ctx.detail, "h2h");
    if (!Array.isArray(h2h) || h2h.length === 0) return { error: "sem h2h" };
    return { matches: h2h.slice(0, MAX_H2H) };
  },

  get_splits: (args, ctx) => {
    const side = asSide(args);
    const matches = recentFor(ctx, side);
    if (matches.length === 0) return { error: `sem jogos para splits de ${side}` };
    return { side, splits: deriveSplits1h2h(matches) };
  },

  get_distributions: (args, ctx) => {
    const side = asSide(args);
    const matches = recentFor(ctx, side);
    if (matches.length === 0)
      return { error: `sem jogos para distribuições de ${side}` };
    return { side, distributions: deriveDistributions(matches) };
  },

  get_radar: (_args, ctx) => {
    const home = recentFor(ctx, "home");
    const away = recentFor(ctx, "away");
    if (home.length === 0 && away.length === 0)
      return { error: "sem dados para radar" };
    return { radar: deriveRadarAxes(home, away) };
  },

  get_player_stats: (args, ctx) => {
    const ps = section(ctx.detail, "player_stats") as
      | { home?: { top_players?: unknown }; away?: { top_players?: unknown } }
      | undefined;
    const side = asSide(args);
    const players = ps?.[side]?.top_players;
    if (!Array.isArray(players) || players.length === 0)
      return { error: `sem player_stats para ${side}` };
    return {
      side,
      top_players: (players as Player[]).slice(0, MAX_PLAYERS).map(compactPlayer),
    };
  },

  get_streaks: (_args, ctx) => {
    const st = section(ctx.detail, "streaks") as
      | { home?: unknown[]; away?: unknown[] }
      | undefined;
    const flat = [
      ...(Array.isArray(st?.home) ? st.home : []),
      ...(Array.isArray(st?.away) ? st.away : []),
    ];
    if (flat.length === 0) return { error: "sem streaks" };
    const index = deriveStreakIndex(flat);
    return {
      streaks: {
        all: index.all.slice(0, MAX_STREAKS),
        by_group: index.by_group,
      },
    };
  },

  get_referee: (_args, ctx) => {
    const ref = section(ctx.detail, "referee_record");
    if (!ref || typeof ref !== "object") return { error: "sem árbitro designado" };
    return ref as ToolResult;
  },

  get_odds: (_args, ctx) => {
    const odds = section(ctx.detail, "odds_summary");
    const categories = deriveOddsCategories(odds);
    if (Object.keys(categories).length === 0) return { error: "sem odds" };
    return { categories };
  },

  get_predictions: (_args, ctx) => {
    const preds = section(ctx.detail, "predictions");
    if (!Array.isArray(preds) || preds.length === 0)
      return { error: "sem predições do provedor" };
    return { predictions: preds };
  },
};

// ─── Defs OpenRouter (function calling) ─────────────────────────────────

const SIDE_PROP = {
  side: {
    type: "string",
    enum: ["home", "away"],
    description:
      "Lado do confronto: 'home' (mandante) ou 'away' (visitante). Default 'home'.",
  },
} as const;

const NO_ARGS = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const SIDE_ARGS = {
  type: "object",
  properties: { ...SIDE_PROP },
  additionalProperties: false,
} as const;

export interface FixtureToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const FIXTURE_TOOLS: FixtureToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_insights",
      description:
        "Insights estatísticos ranqueados do mandante (correlações, tendências, padrões, outliers) com a leitura para aposta.",
      parameters: {
        type: "object",
        properties: {
          kinds: {
            type: "array",
            items: {
              type: "string",
              enum: ["correlation", "trend", "pattern", "outlier"],
            },
            description: "Filtra por tipo de insight. Vazio = todos.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_team_record",
      description:
        "Aproveitamento de temporada do time (split casa/fora + geral, forma recente, posição na tabela).",
      parameters: SIDE_ARGS,
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_matches",
      description:
        "Últimos jogos normalizados de um lado (gols/cantos/cartões/SOT por 1T/2T/FT, na perspectiva do time).",
      parameters: SIDE_ARGS,
    },
  },
  {
    type: "function",
    function: {
      name: "get_h2h",
      description: "Confrontos diretos (head-to-head) entre os dois times.",
      parameters: NO_ARGS,
    },
  },
  {
    type: "function",
    function: {
      name: "get_splits",
      description:
        "Médias 1º tempo vs 2º tempo (gols, cantos, cartões, SOT) de um lado.",
      parameters: SIDE_ARGS,
    },
  },
  {
    type: "function",
    function: {
      name: "get_distributions",
      description:
        "Box stats (min/q1/mediana/q3/max) por métrica dos últimos jogos de um lado.",
      parameters: SIDE_ARGS,
    },
  },
  {
    type: "function",
    function: {
      name: "get_radar",
      description:
        "6 eixos comparativos casa×fora (gols, gols sofridos, SOT, booking points, cantos, faltas) normalizados.",
      parameters: NO_ARGS,
    },
  },
  {
    type: "function",
    function: {
      name: "get_player_stats",
      description:
        "Top jogadores de um lado (minutos, gols, assistências, cartões, lesão).",
      parameters: SIDE_ARGS,
    },
  },
  {
    type: "function",
    function: {
      name: "get_streaks",
      description:
        "Sequências ativas dos dois times agrupadas (ex.: over, BTTS, cartões, cantos), ordenadas por percentual.",
      parameters: NO_ARGS,
    },
  },
  {
    type: "function",
    function: {
      name: "get_referee",
      description:
        "Árbitro designado e o perfil dele: média de booking points/cartões/faltas por jogo.",
      parameters: NO_ARGS,
    },
  },
  {
    type: "function",
    function: {
      name: "get_odds",
      description:
        "Mercados de odds do jogo agrupados por categoria (match, halves, corners, cards…).",
      parameters: NO_ARGS,
    },
  },
  {
    type: "function",
    function: {
      name: "get_predictions",
      description: "Predições do provedor (adamchoi/choistats) para o jogo.",
      parameters: NO_ARGS,
    },
  },
];

// ─── Dispatch ───────────────────────────────────────────────────────────

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

// ─── Summarizer (vira `result_summary` do hop auditado) ────────────────

export function summarizeFixtureToolResult(name: string, result: unknown): string {
  if (!result || typeof result !== "object") return String(result);
  const r = result as Record<string, unknown>;
  if (typeof r.error === "string") return `error: ${r.error}`;
  for (const k of ["insights", "matches", "predictions", "top_players"]) {
    if (Array.isArray(r[k])) return `${name}: ${(r[k] as unknown[]).length} item(s)`;
  }
  const streaks = r.streaks as { all?: unknown[] } | undefined;
  if (streaks && Array.isArray(streaks.all)) {
    return `${name}: ${streaks.all.length} item(s)`;
  }
  return `${name}: ok`;
}
