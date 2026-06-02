import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reader dos fatores de calibração de DISTRIBUIÇÃO ativos de `model_calibration`
 * (métricas `corners-dist`/`cards-dist`/`sot-dist`/`goals-dist`).
 *
 * Cada linha `*-dist` guarda `pairs = [[meanPred, meanActual]]` — uma âncora
 * [x,y] self-describing; `k = meanActual / meanPred`. O `k` corrige a média do
 * Poisson dos mercados de contagem (a sim subestima ~6–13%) e serve de fallback
 * pras linhas sem curva isotônica. Ver docs/tasks/calibracao-distribuicao.
 *
 * Porta TS de scripts/scraper/lib/scraper/ai_reco/dist_k_lookup.rb — comportamento
 * idêntico, mudanças sincronizadas. Degrada gracioso pra {} (nunca lança).
 *
 * Worker constraint (B12/B14): lê só `metric, pairs` de model_calibration
 * (jsonb minúsculo, 1 par por linha) — nunca toca `fixtures.detail_json`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any> | any;

export type SecondaryDistStat = "corners" | "cards" | "sot" | "goals";

/** Mapa stat → k (fator multiplicativo da média antes do Poisson). */
export type DistKMap = Partial<Record<SecondaryDistStat, number>>;

const SUFFIX = "-dist";
const STATS: SecondaryDistStat[] = ["corners", "cards", "sot", "goals"];

function kFromPairs(raw: unknown): number | null {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr) || !Array.isArray(arr[0]) || arr[0].length < 2) return null;
  const meanPred = arr[0][0];
  const meanActual = arr[0][1];
  if (
    typeof meanPred !== "number" ||
    typeof meanActual !== "number" ||
    !Number.isFinite(meanPred) ||
    !Number.isFinite(meanActual) ||
    meanPred <= 0
  ) {
    return null;
  }
  return meanActual / meanPred;
}

/**
 * Busca os fatores `k` ativos pro `modelVersion`. Nunca lança — qualquer
 * erro/exceção devolve `{}` (o caller trata como "sem calibração de distribuição",
 * caindo no raw Poisson — degradação graciosa).
 */
export async function getDistK(
  modelVersion: string,
  supabase: AnySupabase,
): Promise<DistKMap> {
  if (!modelVersion || typeof modelVersion !== "string") return {};

  try {
    const { data, error } = await supabase
      .from("model_calibration")
      .select("metric, pairs")
      .eq("model_version", modelVersion)
      .is("effective_until", null);

    if (error || !Array.isArray(data)) return {};

    const out: DistKMap = {};
    for (const row of data as Array<Record<string, unknown>>) {
      const metric = String(row.metric ?? "");
      if (!metric.endsWith(SUFFIX)) continue;
      const stat = metric.slice(0, -SUFFIX.length) as SecondaryDistStat;
      if (!STATS.includes(stat)) continue;
      const k = kFromPairs(row.pairs);
      if (k !== null) out[stat] = k;
    }
    return out;
  } catch {
    return {};
  }
}
