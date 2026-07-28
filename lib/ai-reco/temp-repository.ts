import type { SupabaseClient } from "@supabase/supabase-js";
import type { TemperatureMap } from "./edge-calculator";

/**
 * Reader dos fatores de TEMPERATURA ativos de `model_calibration`
 * (métricas `1x2-temp` / `over25-temp` / `btts-temp`).
 *
 * Cada linha `*-temp` guarda `pairs = [[1, T]]` — mesma convenção
 * self-describing do `-dist` (o parâmetro é a razão y/x).
 *
 * POR QUE EXISTE (lição B45): a sim ESTICA as probabilidades — subconfiante nas
 * caudas baixas, superconfiante nas altas. Um T por mercado corrige esse viés
 * monotônico. Promovido depois de vencer a arena (n=7290, p<.001). Ordem no
 * EdgeCalculator: curva isotônica → T → raw.
 *
 * Porta TS de scripts/scraper/lib/scraper/ai_reco/temp_lookup.rb — comportamento
 * idêntico, mudanças sincronizadas. Degrada gracioso pra {} (nunca lança).
 *
 * Worker constraint (B12/B14): lê só `metric, pairs` de model_calibration
 * (jsonb minúsculo) — nunca toca `fixtures.detail_json`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any> | any;

const SUFFIX = "-temp";
/** Só mercados PRINCIPAIS — corners/cards/sot são corrigidos pelo `k` (B32). */
const MARKETS = ["1x2", "over25", "btts"] as const;
type TempMarket = (typeof MARKETS)[number];

export function tFromPairs(raw: unknown): number | null {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr) || !Array.isArray(arr[0]) || arr[0].length < 2) return null;
  const x = arr[0][0];
  const y = arr[0][1];
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x <= 0 ||
    y <= 0
  ) {
    return null;
  }
  return y / x;
}

/**
 * Busca os fatores `T` ativos pro `modelVersion`. Nunca lança — qualquer
 * erro devolve `{}` (o caller trata como "sem temperatura", caindo na
 * isotônica/raw — degradação graciosa).
 */
export async function getTemperature(
  modelVersion: string,
  supabase: AnySupabase,
): Promise<TemperatureMap> {
  if (!modelVersion || typeof modelVersion !== "string") return {};

  try {
    const { data, error } = await supabase
      .from("model_calibration")
      .select("metric, pairs")
      .eq("model_version", modelVersion)
      .is("effective_until", null);

    if (error || !Array.isArray(data)) return {};

    const out: TemperatureMap = {};
    for (const row of data as Array<Record<string, unknown>>) {
      const metric = String(row.metric ?? "");
      if (!metric.endsWith(SUFFIX)) continue;
      const market = metric.slice(0, -SUFFIX.length) as TempMarket;
      if (!MARKETS.includes(market)) continue;
      const t = tFromPairs(row.pairs);
      if (t !== null) out[market] = t;
    }
    return out;
  } catch {
    return {};
  }
}
