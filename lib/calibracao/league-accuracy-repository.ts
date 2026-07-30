/**
 * Leitura das simulações resolvidas para o painel de desempenho por liga.
 *
 * RESTRIÇÃO DE PLATAFORMA (B12/B14/B21/B23): o Worker Cloudflare já caiu duas
 * vezes por payload (outages 1101/1102). Aqui isso significa: filtrar por liga
 * NO POSTGRES, selecionar só as colunas usadas, e JAMAIS tocar
 * `fixtures.detail_json`. Uma liga mediana devolve ~32 linhas; a maior, 162.
 *
 * O agregado global (fallback de amostra baixa) varreria os ~2.3k jogos a cada
 * request — por isso é memoizado por processo. Se medir pesado em produção, o
 * passo seguinte é empurrar a agregação pra SQL no molde de
 * `fixture_badges_view`, NÃO aumentar o payload.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDistK, type DistKMap } from "@/lib/ai-reco/dist-k-repository";
import {
  marketAccuracies,
  MIN_LEAGUE_CALLS,
  type AccuracyRow,
  type MarketAccuracy,
} from "@/lib/calibracao/market-accuracy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any> | any;

const COLUMNS =
  "league,sim_stats,p_home,p_draw,p_away,p_over_25,p_btts," +
  "actual_home_goals,actual_away_goals,actual_corners_home,actual_corners_away," +
  "actual_cards_home,actual_cards_away,actual_sot_home,actual_sot_away," +
  "actual_btts,correct_winner,kickoff_utc";

/** Teto de linhas por liga — a maior liga real tem 162; 600 é folga larga. */
const LEAGUE_LIMIT = 600;
/** Teto do agregado global. */
const GLOBAL_LIMIT = 4000;

export interface LeaguePerformance {
  league: string | null;
  tier: "liga" | "global";
  /** Chamadas encontradas na liga — mostrado mesmo quando o tier é global. */
  leagueCalls: number;
  markets: MarketAccuracy[];
  window: { from: string | null; to: string | null };
  /**
   * Versão do motor que produziu ESTA medição. Vai pra tela: sem isso o número
   * fica sem procedência, e foi justamente misturar versões que estragou a
   * medição anterior.
   */
  modelVersion: string;
}

type RowWithKickoff = AccuracyRow & { kickoff_utc: string | null };

// Memoização do agregado global, CHAVEADA POR VERSÃO: cada motor tem a sua
// medição, e um cache único vazaria o número de uma versão pra outra.
const globalCache = new Map<
  string,
  { markets: MarketAccuracy[]; window: LeaguePerformance["window"] }
>();

/** Só para teste — zera a memoização do agregado global. */
export function __resetGlobalCache(): void {
  globalCache.clear();
}

function windowOf(rows: RowWithKickoff[]): LeaguePerformance["window"] {
  const ks = rows
    .map((r) => r.kickoff_utc)
    .filter((k): k is string => typeof k === "string")
    .sort();
  return { from: ks[0] ?? null, to: ks[ks.length - 1] ?? null };
}

function totalCalls(markets: MarketAccuracy[]): number {
  return markets.reduce((s, m) => s + m.calls, 0);
}

async function fetchRows(
  supabase: AnySupabase,
  league: string | null,
  limit: number,
  modelVersion: string,
): Promise<RowWithKickoff[] | null> {
  try {
    let q = supabase
      .from("fixture_simulations")
      .select(COLUMNS)
      .eq("status", "resolved")
      .eq("model_version", modelVersion)
      .not("sim_stats", "is", null)
      .limit(limit);
    if (league !== null) q = q.eq("league", league);
    const { data, error } = await q;
    if (error || !Array.isArray(data)) return null;
    return data as RowWithKickoff[];
  } catch {
    return null;
  }
}

async function globalPerformance(
  supabase: AnySupabase,
  distK: DistKMap,
  modelVersion: string,
): Promise<{ markets: MarketAccuracy[]; window: LeaguePerformance["window"] } | null> {
  const cached = globalCache.get(modelVersion);
  if (cached) return cached;
  const rows = await fetchRows(supabase, null, GLOBAL_LIMIT, modelVersion);
  if (!rows) return null;
  const computed = {
    markets: marketAccuracies(rows, { distK, tier: "global" }),
    window: windowOf(rows),
  };
  globalCache.set(modelVersion, computed);
  return computed;
}

/**
 * Desempenho do modelo na liga. Cai pro agregado global quando a liga não
 * sustenta amostra (< MIN_LEAGUE_CALLS chamadas somadas). Nunca lança — a
 * página do jogo não pode cair porque o painel de contexto falhou.
 */
export async function getLeaguePerformance(
  league: string | null,
  modelVersion: string | null,
  supabase: AnySupabase,
  /**
   * k já buscado pelo caller. A página do jogo precisa do MESMO k pra calcular
   * as chamadas daquele jogo e pra tabela da simulação — injetar evita a
   * segunda ida a `model_calibration` no mesmo request (o Worker deste projeto
   * já caiu por peso: B12/B21/B23) e garante que as superfícies não divirjam.
   * Ausente ⇒ busca normalmente.
   */
  injectedDistK?: DistKMap,
): Promise<LeaguePerformance | null> {
  if (!league) return null;
  // Sem saber de qual motor vieram os números, não há medição honesta a fazer:
  // versões coexistem em `fixture_simulations` e somá-las mede um modelo que
  // não existe. Melhor não mostrar painel do que mostrar número de procedência
  // desconhecida.
  const version = (modelVersion ?? "").trim();
  if (!version) return null;

  let distK: DistKMap = injectedDistK ?? {};
  if (!injectedDistK) {
    try {
      distK = await getDistK(modelVersion ?? "", supabase);
    } catch {
      distK = {};
    }
  }

  const rows = await fetchRows(supabase, league, LEAGUE_LIMIT, version);
  if (!rows) return null;

  const leagueMarkets = marketAccuracies(rows, { distK, tier: "liga" });
  const leagueCalls = totalCalls(leagueMarkets);

  if (leagueCalls >= MIN_LEAGUE_CALLS) {
    return {
      league,
      tier: "liga",
      leagueCalls,
      markets: leagueMarkets,
      window: windowOf(rows),
      modelVersion: version,
    };
  }

  const global = await globalPerformance(supabase, distK, version);
  if (!global) return null;
  return {
    league,
    tier: "global",
    leagueCalls,
    markets: global.markets,
    window: global.window,
    modelVersion: version,
  };
}
