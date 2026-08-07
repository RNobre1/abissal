#!/usr/bin/env tsx
/**
 * fit-dist — calibração de DISTRIBUIÇÃO dos mercados de contagem (corners/cards/
 * sot). Ajusta `k = média(actual)/média(previsto)` por (stat, model_version)
 * sobre as simulações resolvidas e upserta em `model_calibration` como a métrica
 * `${stat}-dist`, com `pairs = [[meanPred, meanActual]]` (âncora self-describing;
 * k = y/x) e `n` = nº de jogos.
 *
 * POR QUE (docs/tasks/calibracao-distribuicao + evidência B24): a sim subestima
 * o total (corners +6.5%, cards +12.8%, sot +7.1%). A isotônica por-linha só
 * cobre 3 linhas; o `k` corrige a MÉDIA e serve de fallback pras linhas sem
 * curva (cold-start de nova model_version). O `k` é refit MECÂNICO/semanal —
 * não mexe em prompt/threshold/Kelly (B24).
 *
 *   pnpm exec tsx scripts/calibracao/fit-dist.ts
 *
 * Secrets: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import { fitDistK } from "@/lib/calibracao/dist-fit";
import { fetchAllPages } from "@/lib/supabase/paginated-fetch";
import { assertCronologico } from "@/lib/calibracao/held-out-gate";
import {
  secondaryMeanFromSimStats,
  type SecondaryStat,
} from "@/lib/calibracao/secondary-fit";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SR) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SR, {
  auth: { persistSession: false },
});

const STATS: SecondaryStat[] = ["corners", "cards", "sot"];
const MIN_SAMPLES = 30; // gate B24 (mesmo da isotônica)

interface ResolvedRow {
  model_version: string | null;
  actual_resolved_at: string | null;
  actual_corners_home: number | null;
  actual_corners_away: number | null;
  actual_cards_home: number | null;
  actual_cards_away: number | null;
  actual_sot_home: number | null;
  actual_sot_away: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sim_stats: any | null;
}

function actualTotal(r: ResolvedRow, stat: SecondaryStat): number | null {
  const h = r[`actual_${stat}_home` as keyof ResolvedRow] as number | null;
  const a = r[`actual_${stat}_away` as keyof ResolvedRow] as number | null;
  if (h == null || a == null) return null;
  return Number(h) + Number(a);
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = supabase as unknown as { from: (t: string) => any };
  const SELECT_COLUMNS = [
    "model_version",
    "actual_resolved_at",
    "actual_corners_home", "actual_corners_away",
    "actual_cards_home", "actual_cards_away",
    "actual_sot_home", "actual_sot_away",
    "sim_stats",
  ].join(", ");
  let rows: ResolvedRow[];
  try {
    // ASCENDENTE (mais antigo primeiro) — mesma convenção do fit-isotonic:
    // qualquer split treino/teste futuro sobre esta amostra tem que treinar
    // no passado e testar no futuro, não o contrário.
    rows = await fetchAllPages<ResolvedRow>((from, to) =>
      c
        .from("fixture_simulations")
        .select(SELECT_COLUMNS)
        .eq("status", "resolved")
        .not("actual_resolved_at", "is", null)
        .order("actual_resolved_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (error) {
    console.error("query failed:", error);
    process.exit(1);
  }
  if (rows.length === 0) {
    console.error("no resolved sims; aborting dist fit");
    process.exit(0);
  }
  // Guarda em runtime: ver `lib/calibracao/held-out-gate.ts`.
  assertCronologico(rows, (r) => r.actual_resolved_at);

  // Agrupar por model_version (mesma convenção do fit-isotonic).
  const byVersion = new Map<string, ResolvedRow[]>();
  for (const r of rows) {
    if (!r.model_version) continue;
    const list = byVersion.get(r.model_version) ?? [];
    list.push(r);
    byVersion.set(r.model_version, list);
  }

  for (const [version, rowsV] of byVersion.entries()) {
    for (const stat of STATS) {
      const pairs: Array<[number, number]> = [];
      for (const r of rowsV) {
        const predMean = secondaryMeanFromSimStats(r.sim_stats, stat);
        if (predMean === null) continue;
        const actual = actualTotal(r, stat);
        if (actual === null) continue;
        pairs.push([predMean, actual]);
      }

      const fit = fitDistK(pairs, MIN_SAMPLES);
      const metric = `${stat}-dist`;
      if (!fit) {
        console.log(`[skip] ${version} ${metric}: só ${pairs.length} pares (precisa ≥${MIN_SAMPLES})`);
        continue;
      }

      // Expira a ativa anterior.
      await c
        .from("model_calibration")
        .update({ effective_until: new Date().toISOString() })
        .eq("model_version", version)
        .eq("metric", metric)
        .is("effective_until", null);

      // Insere a nova ativa: pairs = [[meanPred, meanActual]] (k = y/x).
      const { error: insErr } = await c.from("model_calibration").insert({
        metric,
        model_version: version,
        pairs: [[fit.meanPred, fit.meanActual]],
        n: fit.n,
      });
      if (insErr) {
        console.error(`[fail] ${version} ${metric}:`, insErr);
      } else {
        console.log(
          `[ok] ${version} ${metric}: k=${fit.k.toFixed(4)} (${fit.meanPred.toFixed(2)}→${fit.meanActual.toFixed(2)}), n=${fit.n}`,
        );
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
