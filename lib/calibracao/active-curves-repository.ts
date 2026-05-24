import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reader das curvas isotônicas ATIVAS de `model_calibration`
 * (migration 0019 — `pairs jsonb, n int, effective_from, effective_until`).
 *
 * "Ativa" = `effective_until IS NULL`. Para cada `model_version` há até 4
 * curvas (uma por métrica: `1x2-home`, `1x2-draw`, `1x2-away`, `over25`).
 *
 * Worker constraint (B12/B14/outage 1101): mesma regra das outras readers
 * — NUNCA tocar `fixtures.detail_json`. Esta query lê apenas
 * `metric, pairs, n, effective_from` da tabela `model_calibration`
 * (pairs é uma jsonb pequena, ~300 pontos por curva).
 *
 * Falhou? Devolve `{ curves: {}, meta: { n: null, appliedAt: null } }` —
 * o caller (`getFixtureSimulation`) trata isso como "sem calibração",
 * mantendo as probs do modelo cru (degradação graciosa, igual ao
 * pattern de `repository.ts` e `simulation-repository.ts`).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any> | any;

/**
 * As 4 curvas ativas (cada uma é o `Array<[number, number]>` que
 * `applyIsotonic` espera). Campos opcionais: uma métrica pode estar
 * ausente se o fit não rodou pra ela (n < 30 samples) ou se a row foi
 * desativada manualmente.
 */
export interface ActiveCurves {
  oneX2Home?: Array<[number, number]>;
  draw?: Array<[number, number]>;
  away?: Array<[number, number]>;
  over25?: Array<[number, number]>;
}

/**
 * Metadados agregados das curvas devolvidas — usados pela UI para
 * mostrar `calibrado (isotônica, n=<n>)` e por debug/observabilidade.
 *
 * - `n`: max(n) entre as curvas ativas (toda métrica é treinada no
 *   MESMO universo de fixtures resolvidas, mas tomamos max por robustez
 *   caso uma métrica tenha mais samples válidos que outra).
 * - `appliedAt`: max(effective_from) — quando a calibração mais recente
 *   entrou em vigor; útil para exibir "calibração de 2026-05-22".
 */
export interface ActiveCurvesMeta {
  n: number | null;
  appliedAt: string | null;
}

/** Mapa metric (DB) → slot (DTO). */
const METRIC_TO_SLOT: Record<string, keyof ActiveCurves> = {
  "1x2-home": "oneX2Home",
  "1x2-draw": "draw",
  "1x2-away": "away",
  over25: "over25",
};

function asPairs(v: unknown): Array<[number, number]> | null {
  if (!Array.isArray(v)) return null;
  // Sanity defensiva: cada elemento deve ser [number, number]. Linhas
  // malformadas não derrubam a chamada — degrada pra null silenciosamente.
  for (const p of v) {
    if (
      !Array.isArray(p) ||
      p.length !== 2 ||
      typeof p[0] !== "number" ||
      typeof p[1] !== "number" ||
      !Number.isFinite(p[0]) ||
      !Number.isFinite(p[1])
    ) {
      return null;
    }
  }
  return v as Array<[number, number]>;
}

/**
 * Busca as curvas ativas pro `modelVersion`. Nunca lança — em qualquer
 * erro/exceção devolve `{ curves: {}, meta: { n: null, appliedAt: null } }`.
 *
 * `modelVersion` vazio/null/undefined faz short-circuit sem chamar supabase
 * (caller pode passar `sim.model_version` direto, que é nullable).
 */
export async function getActiveCurves(
  modelVersion: string,
  supabase: AnySupabase,
): Promise<{ curves: ActiveCurves; meta: ActiveCurvesMeta }> {
  const EMPTY = {
    curves: {} as ActiveCurves,
    meta: { n: null as number | null, appliedAt: null as string | null },
  };

  if (!modelVersion || typeof modelVersion !== "string") return EMPTY;

  try {
    const { data, error } = await supabase
      .from("model_calibration")
      .select("metric, pairs, n, effective_from")
      .eq("model_version", modelVersion)
      .is("effective_until", null);

    if (error || !Array.isArray(data)) return EMPTY;

    const curves: ActiveCurves = {};
    let maxN: number | null = null;
    let maxAppliedAt: string | null = null;

    for (const row of data as Array<Record<string, unknown>>) {
      const metric = String(row.metric ?? "");
      const slot = METRIC_TO_SLOT[metric];
      if (!slot) continue; // métrica desconhecida → ignora silenciosamente

      const pairs = asPairs(row.pairs);
      if (!pairs) continue;

      curves[slot] = pairs;

      const n = typeof row.n === "number" && Number.isFinite(row.n)
        ? row.n
        : null;
      if (n !== null && (maxN === null || n > maxN)) {
        maxN = n;
      }

      const appliedAt =
        typeof row.effective_from === "string" ? row.effective_from : null;
      if (appliedAt && (maxAppliedAt === null || appliedAt > maxAppliedAt)) {
        maxAppliedAt = appliedAt;
      }
    }

    return { curves, meta: { n: maxN, appliedAt: maxAppliedAt } };
  } catch {
    return EMPTY;
  }
}
