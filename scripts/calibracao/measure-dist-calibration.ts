#!/usr/bin/env tsx
/**
 * measure-dist-calibration — GATE DE EVIDÊNCIA (B24) da calibração de
 * distribuição. Read-only sobre prod (HTTPS/PostgREST — pg TCP bloqueado, B30).
 *
 * Para corners/cards/sot, sobre as simulações RESOLVIDAS:
 *   1. Ordena cronologicamente (actual_resolved_at) e faz split train/test.
 *   2. Fita `k = média(actual)/média(previsto)` no TRAIN (fitDistK).
 *   3. Fita a isotônica por-linha no TRAIN (as 3 linhas do catálogo).
 *   4. Mede Brier no TEST (held-out, anti-walk-forward) pras 3 abordagens:
 *        raw Poisson(mean) · k-Poisson(mean·k) · isotônica(3 linhas).
 *   5. Reporta k, n e o Brier comparativo. Se k empata/ganha a isotônica nas
 *      3 linhas calibradas E cobre todas as outras → a substituição é segura.
 *
 *   pnpm exec tsx scripts/calibracao/measure-dist-calibration.ts [--test-frac 0.3]
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- script CLI: shapes dinâmicos do PostgREST/jsonb */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fitDistK, brierForLine, splitTrainTest } from "@/lib/calibracao/dist-fit";
import { fitIsotonic, applyIsotonic } from "@/lib/calibracao/isotonic";
import {
  secondaryMeanFromSimStats,
  type SecondaryStat,
} from "@/lib/calibracao/secondary-fit";
import { poissonProbOver } from "@/lib/ai-reco/dist-helpers";

function ensureEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* env já exportado */ }
}
ensureEnv();

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const testFrac = Number(arg("test-frac", "0.3"));

// Catálogo de linhas hoje calibradas por isotônica (as 3 do edge-calculator).
const CATALOGUE_LINES: Record<SecondaryStat, number[]> = {
  corners: [8.5, 9.5, 10.5],
  cards: [3.5, 4.5, 5.5],
  sot: [7.5, 9.5, 10.5],
};
// Linhas extras (sem isotônica hoje) pra ilustrar a cobertura do k.
const EXTRA_LINES: Record<SecondaryStat, number[]> = {
  corners: [6.5, 7.5, 11.5, 12.5, 13.5],
  cards: [2.5, 6.5, 7.5],
  sot: [5.5, 6.5, 8.5, 11.5, 12.5],
};

interface Row {
  predMean: number;
  actualTotal: number;
}

function buildRows(rawRows: any[], stat: SecondaryStat): Row[] {
  const out: Row[] = [];
  for (const r of rawRows) {
    const predMean = secondaryMeanFromSimStats(r.sim_stats, stat);
    if (predMean === null) continue;
    const h = r[`actual_${stat}_home`];
    const a = r[`actual_${stat}_away`];
    if (h == null || a == null) continue;
    out.push({ predMean, actualTotal: Number(h) + Number(a) });
  }
  return out;
}

/** Brier no TEST usando a isotônica fitada no TRAIN, por linha. */
function brierIsotonicForLine(train: Row[], test: Row[], line: number): number {
  const pairs: Array<[number, number]> = train.map((r) => [
    poissonProbOver(r.predMean, line),
    r.actualTotal > line ? 1 : 0,
  ]);
  if (pairs.length < 30) return NaN;
  const curve = fitIsotonic(pairs);
  let sse = 0;
  for (const r of test) {
    const p = applyIsotonic(curve, poissonProbOver(r.predMean, line));
    const obs = r.actualTotal > line ? 1 : 0;
    sse += (p - obs) ** 2;
  }
  return test.length === 0 ? NaN : sse / test.length;
}

function mean(xs: number[]): number {
  const f = xs.filter((x) => Number.isFinite(x));
  return f.length === 0 ? NaN : f.reduce((a, b) => a + b, 0) / f.length;
}

async function main() {
  // Ordena DESCENDENTE: os actuals de corners/cards/sot só existem pós-fix do
  // reconciler (28/05); as linhas recentes é que os têm. PostgREST capa em
  // ~1000 linhas/request, então pegamos as mais recentes e reordenamos
  // cronologicamente (ascendente) em código pro split honesto.
  const { data, error } = await (sb as any)
    .from("fixture_simulations")
    .select(
      [
        "sim_stats",
        "actual_corners_home", "actual_corners_away",
        "actual_cards_home", "actual_cards_away",
        "actual_sot_home", "actual_sot_away",
        "actual_resolved_at",
      ].join(", "),
    )
    .eq("status", "resolved")
    .not("actual_resolved_at", "is", null)
    .order("actual_resolved_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.error("query failed:", error);
    process.exit(1);
  }
  // Reordena pra cronológico ascendente (a query veio do mais recente p/ o mais antigo).
  const rawRows = ((data ?? []) as any[]).slice().reverse();
  console.log(`\n=== Calibração de distribuição — gate de evidência (B24) ===`);
  console.log(`resolved sims: ${rawRows.length} · test_frac=${testFrac} (held-out cronológico)\n`);

  const stats: SecondaryStat[] = ["corners", "cards", "sot"];
  for (const stat of stats) {
    const rows = buildRows(rawRows, stat); // já cronológico (query ordenada)
    if (rows.length < 40) {
      console.log(`[${stat}] só ${rows.length} jogos com actual — pulando (precisa ≥40)\n`);
      continue;
    }
    const { train, test } = splitTrainTest(rows, testFrac);
    const fit = fitDistK(train.map((r) => [r.predMean, r.actualTotal]), 30);
    if (!fit) {
      console.log(`[${stat}] fitDistK retornou null (n=${train.length})\n`);
      continue;
    }

    const testPairs: Array<[number, number]> = test.map((r) => [r.predMean, r.actualTotal]);
    const cat = CATALOGUE_LINES[stat];
    const extra = EXTRA_LINES[stat];

    // Brier por linha (held-out) nas 3 abordagens.
    const rawCat = cat.map((l) => brierForLine(testPairs, l, (m) => m));
    const kCat = cat.map((l) => brierForLine(testPairs, l, (m) => m * fit.k));
    const isoCat = cat.map((l) => brierIsotonicForLine(train, test, l));
    const rawExtra = extra.map((l) => brierForLine(testPairs, l, (m) => m));
    const kExtra = extra.map((l) => brierForLine(testPairs, l, (m) => m * fit.k));

    console.log(`[${stat}]  k = ${fit.k.toFixed(4)}  (média prevista ${fit.meanPred.toFixed(2)} → real ${fit.meanActual.toFixed(2)})  n_train=${fit.n} n_test=${test.length}`);
    console.log(`   Brier médio nas 3 linhas calibradas (held-out):`);
    console.log(`      raw Poisson      : ${mean(rawCat).toFixed(4)}`);
    console.log(`      k-Poisson (novo) : ${mean(kCat).toFixed(4)}`);
    console.log(`      isotônica (hoje) : ${mean(isoCat).toFixed(4)}`);
    const kVsIso = mean(kCat) - mean(isoCat);
    const verdict = kVsIso <= 0.003 ? "✅ k empata/ganha — substituição SEGURA" : "⚠️ k pior que isotônica — investigar";
    console.log(`      → k − isotônica = ${kVsIso >= 0 ? "+" : ""}${kVsIso.toFixed(4)}  ${verdict}`);
    console.log(`   Linhas extras (sem isotônica hoje) — k vs raw:`);
    console.log(`      raw Poisson      : ${mean(rawExtra).toFixed(4)}`);
    console.log(`      k-Poisson (novo) : ${mean(kExtra).toFixed(4)}  ${mean(kExtra) < mean(rawExtra) ? "✅ k melhora cobertura" : "≈"}`);
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
