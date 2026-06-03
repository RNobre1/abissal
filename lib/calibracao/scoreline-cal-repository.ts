import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScorelineCalParams } from "./scoreline-calibration";

/**
 * Reader dos parâmetros de calibração de PLACAR ativos (`model_calibration`,
 * metric `scoreline-cal`). Diferente das curvas isotônicas, a linha guarda em
 * `pairs` um OBJETO `{ temperature, drawFactor, raw, cal }` (não um array [x,y])
 * — por isso os readers isotônicos a ignoram (Array.isArray falha).
 *
 * Degrada gracioso pra null (sem calibração → display segue cru). Nunca lança.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any> | any;

/** Resumo antes/depois pra exibição em /calibracao (gráfico). */
export interface ScorelineCalSummary extends ScorelineCalParams {
  n: number;
  raw: {
    top1Hit: number;
    top1Pred: number;
    drawReal: number;
    drawPred: number;
    top3Hit?: number;
    top6Hit?: number;
    rps?: number;
  };
  cal: { top1Pred: number; drawPred: number };
}

/** Extrai os params {temperature, drawFactor} do objeto `pairs` (string ou obj). */
export function parseScorelineCal(pairs: unknown): ScorelineCalSummary | null {
  let raw: unknown = pairs;
  if (typeof pairs === "string") {
    try {
      raw = JSON.parse(pairs);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const T = obj.temperature;
  const d = obj.drawFactor;
  if (typeof T !== "number" || typeof d !== "number" || !Number.isFinite(T) || !Number.isFinite(d)) {
    return null;
  }
  return {
    temperature: T,
    drawFactor: d,
    n: typeof obj.n === "number" ? obj.n : 0,
    raw: (obj.raw as ScorelineCalSummary["raw"]) ?? { top1Hit: 0, top1Pred: 0, drawReal: 0, drawPred: 0 },
    cal: (obj.cal as ScorelineCalSummary["cal"]) ?? { top1Pred: 0, drawPred: 0 },
  };
}

/**
 * Busca os params de calibração de placar ativos pro `modelVersion`.
 * null em qualquer erro / ausência (caller mostra o placar cru).
 */
export async function getScorelineCal(
  modelVersion: string | null,
  supabase: AnySupabase,
): Promise<ScorelineCalSummary | null> {
  if (!modelVersion || typeof modelVersion !== "string") return null;
  try {
    const { data, error } = await supabase
      .from("model_calibration")
      .select("pairs, n")
      .eq("model_version", modelVersion)
      .eq("metric", "scoreline-cal")
      .is("effective_until", null)
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const parsed = parseScorelineCal((data[0] as { pairs: unknown }).pairs);
    if (parsed && !parsed.n && typeof (data[0] as { n?: number }).n === "number") {
      parsed.n = (data[0] as { n: number }).n;
    }
    return parsed;
  } catch {
    return null;
  }
}
