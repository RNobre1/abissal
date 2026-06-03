import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShadowCardParams } from "@/lib/fixtures/shadow-card-predictions";

/**
 * Reader dos params ATIVOS dos modelos shadow (`model_calibration` metric
 * `shadow-params`, pairs = OBJETO {cards:{nu,r,n}}). Persistidos pelo
 * seed-challenger-cards-cmp. Usados pelo toggle shadow no detalhe do jogo.
 * Degrada gracioso pra null. Nunca lança.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any> | any;

export interface ShadowParams {
  cards?: ShadowCardParams & { n?: number };
}

export function parseShadowParams(pairs: unknown): ShadowParams | null {
  let obj: unknown = pairs;
  if (typeof pairs === "string") {
    try {
      obj = JSON.parse(pairs);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const cards = (obj as Record<string, unknown>).cards as Record<string, unknown> | undefined;
  if (!cards || typeof cards.nu !== "number" || typeof cards.r !== "number") return null;
  return { cards: { nu: cards.nu, r: cards.r, n: typeof cards.n === "number" ? cards.n : undefined } };
}

export async function getShadowParams(
  modelVersion: string | null,
  supabase: AnySupabase,
): Promise<ShadowParams | null> {
  if (!modelVersion || typeof modelVersion !== "string") return null;
  try {
    const { data, error } = await supabase
      .from("model_calibration")
      .select("pairs")
      .eq("model_version", modelVersion)
      .eq("metric", "shadow-params")
      .is("effective_until", null)
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    return parseShadowParams((data[0] as { pairs: unknown }).pairs);
  } catch {
    return null;
  }
}
