/**
 * Fiação de calibração compartilhada entre os consumidores da edge table.
 *
 * Extraída de `app/api/ai-reco/compute/route.ts` (onde vivia inline) quando o
 * F2 "advogado do diabo do bilhete" passou a precisar da MESMA cadeia
 * (curva isotônica por métrica + detecção de liga calibrada) — duplicar a
 * lógica criaria duas definições divergentes de "prob calibrada" (classe de
 * bug B16/B25). `getDistK`/`getTemperature` já eram libs próprias; aqui moram
 * os dois helpers que faltavam.
 *
 * Worker constraint (B12/B14): lê apenas `metric, pairs` de
 * `model_calibration` e `league` de `league_parameters` — jsonb minúsculo,
 * nunca `fixtures.detail_json`.
 */
import { applyIsotonic } from "@/lib/calibracao/isotonic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

/**
 * Lê TODAS as curvas isotônicas ativas de `model_calibration` por metric
 * (genérico) — 1x2-home/draw/away, over25/over25-under, btts/btts-nao e os
 * secundários (corners/cards/sot) — no shape `isotonicLookup` que
 * `buildEdgeTable` consome. Espelha o Ruby `AiReco::IsotonicLookup.load`.
 * Métricas `*-dist` são fatores de distribuição (getDistK), não curvas.
 */
export async function buildIsotonicLookup(
  modelVersion: string | null,
  supabase: AnySupabase,
): Promise<Partial<Record<string, (p: number) => number>>> {
  if (!modelVersion) return {};
  const { data, error } = await supabase
    .from("model_calibration")
    .select("metric, pairs")
    .eq("model_version", modelVersion)
    .is("effective_until", null);
  if (error || !data) return {};
  const lookup: Partial<Record<string, (p: number) => number>> = {};
  for (const row of data as Array<{ metric: string | null; pairs: unknown }>) {
    const metric = String(row.metric ?? "");
    // '*-dist' são fatores de distribuição (getDistK), não curvas isotônicas.
    if (metric.endsWith("-dist")) continue;
    const pairs = asPairs(row.pairs);
    if (!metric || pairs.length === 0) continue;
    lookup[metric] = (p: number) => applyIsotonic(pairs, p);
  }
  return lookup;
}

/** jsonb `pairs` → Array<[number,number]> validado; [] se inválido. */
function asPairs(raw: unknown): Array<[number, number]> {
  if (!Array.isArray(raw)) return [];
  const out: Array<[number, number]> = [];
  for (const p of raw) {
    if (
      Array.isArray(p) &&
      p.length >= 2 &&
      typeof p[0] === "number" &&
      typeof p[1] === "number"
    ) {
      out.push([p[0], p[1]]);
    }
  }
  return out;
}

/**
 * `effective_until IS NULL` row in `league_parameters` for the given league
 * means the engine has fit a per-league parameter set — used as the
 * "calibrated league" gate that determines the 2.0u vs 0.5u units cap.
 */
export async function isLeagueCalibrated(
  league: string | null,
  supabase: AnySupabase,
): Promise<boolean> {
  if (!league) return false;
  try {
    const { data, error } = await supabase
      .from("league_parameters")
      .select("league")
      .eq("league", league)
      .is("effective_until", null)
      .limit(1)
      .maybeSingle();
    if (!error && data) return true;
  } catch {
    // missing table / transient → not calibrated (safer default: 0.5u cap)
  }
  return false;
}
