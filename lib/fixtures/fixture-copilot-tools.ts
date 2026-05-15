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
} from "@/lib/fixtures/stats/derive";
import type {
  NormalizedRecentMatch,
  RefereeRecord,
  Streaks,
} from "@/lib/fixtures/stats/detail-json-types";
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

function recentFor(
  ctx: FixtureToolCtx,
  side: "home" | "away",
): NormalizedRecentMatch[] {
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
    const streaks = (section(ctx.detail, "streaks") as Streaks | undefined) ?? {
      home: [],
      away: [],
    };
    const refRaw = section(ctx.detail, "referee_record");
    const referee =
      refRaw && typeof refRaw === "object"
        ? (refRaw as RefereeRecord)
        : null;
    const all = [
      ...computeCorrelations(home),
      ...computeTrends(home),
      ...computePatterns({ streaks, referee, matches: home }),
      ...computeOutliers(home),
    ];
    const ranked = rankInsights(all);
    const filtered =
      Array.isArray(kinds) && kinds.length > 0
        ? ranked.filter((i) =>
            kinds.includes((i as { kind?: string }).kind ?? ""),
          )
        : ranked;
    return { insights: filtered };
  },
  get_team_record: (args, ctx) => {
    // deriveTeamRecord só normaliza a perna `home` (depois `away`/`split`).
    // Para honrar `side` honestamente sem inventar lógica, reposicionamos a
    // perna escolhida em `{ home: tr[side] }` — o deriver normaliza o split
    // do lado pedido. Passar `tr` cru sempre devolvia o split de `home`.
    const tr = section(ctx.detail, "team_record") as
      | { home?: unknown; away?: unknown }
      | undefined;
    const side = asSide(args);
    const derived = deriveTeamRecord({ home: tr?.[side] });
    if (!derived) return { error: `sem team_record para ${side}` };
    return { side, ...derived };
  },
  get_recent_matches: (args, ctx) => {
    const side = asSide(args);
    const matches = recentFor(ctx, side);
    return { side, matches };
  },
  get_h2h: (_args, ctx) => {
    const h2h = section(ctx.detail, "h2h");
    if (!Array.isArray(h2h)) return { error: "sem h2h" };
    return { matches: h2h };
  },
  get_splits: (args, ctx) => {
    const side = asSide(args);
    const matches = recentFor(ctx, side);
    if (matches.length === 0) return { error: "sem jogos para splits" };
    return { side, splits: deriveSplits1h2h(matches) };
  },
  get_distributions: (args, ctx) => {
    const side = asSide(args);
    const matches = recentFor(ctx, side);
    if (matches.length === 0) return { error: "sem jogos para distribuições" };
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
    if (!Array.isArray(players))
      return { error: `sem player_stats para ${side}` };
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
    description:
      "Lado do confronto: 'home' (mandante) ou 'away' (visitante). Default 'home'.",
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
    type: "function" as const,
    function: {
      name: "get_team_record",
      description:
        "Aproveitamento do time (split casa/fora + geral, forma, posição).",
      parameters: {
        type: "object",
        properties: { ...SIDE_PROP },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_recent_matches",
      description:
        "Últimos jogos normalizados de um lado (gols/cantos/cartões/SOT por 1T/2T/FT).",
      parameters: {
        type: "object",
        properties: { ...SIDE_PROP },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_h2h",
      description: "Confrontos diretos (head-to-head) entre os dois times.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_splits",
      description:
        "Médias 1º tempo vs 2º tempo (gols, cantos, cartões, SOT) de um lado.",
      parameters: {
        type: "object",
        properties: { ...SIDE_PROP },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_distributions",
      description: "Box stats (min/q1/mediana/q3/max) por métrica de um lado.",
      parameters: {
        type: "object",
        properties: { ...SIDE_PROP },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_radar",
      description: "6 eixos comparativos casa×fora normalizados.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_player_stats",
      description: "Top jogadores de um lado (minutos, gols, assistências).",
      parameters: {
        type: "object",
        properties: { ...SIDE_PROP },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_streaks",
      description: "Sequências ativas agrupadas (ex.: over, BTTS, cartões).",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_referee",
      description: "Árbitro designado e sua média de cartões/booking points.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_odds",
      description:
        "Mercados de odds agrupados por categoria (match, halves, corners, cards…).",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_predictions",
      description: "Predições do provedor (adamchoi) para o jogo.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
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

export function summarizeFixtureToolResult(
  name: string,
  result: unknown,
): string {
  if (!result || typeof result !== "object") return String(result);
  const r = result as Record<string, unknown>;
  if (typeof r.error === "string") return `error: ${r.error}`;
  for (const k of ["insights", "matches", "predictions"]) {
    if (Array.isArray(r[k])) return `${name}: ${(r[k] as unknown[]).length} item(s)`;
  }
  return `${name}: ok`;
}
