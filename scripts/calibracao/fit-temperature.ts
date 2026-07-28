#!/usr/bin/env tsx
/**
 * fit-temperature — fita o T (temperature scaling) por mercado principal
 * (1x2 / over25 / btts) sobre `fixture_simulations` resolvidas e upserta em
 * `model_calibration` como métricas `{market}-temp`.
 *
 * POR QUE (lição B45): medido sobre 3.508 jogos, a sim ESTICA as
 * probabilidades — subconfiante nas caudas baixas, superconfiante nas altas,
 * com a mesma assinatura em todo mercado. Um T por mercado corrige esse viés
 * monotônico. Promovido depois de vencer a arena como challenger
 * (n=7290, meanDelta +0.0121, IC95 [+0.0085,+0.0160], p<.001).
 *
 * Consumo: `EdgeCalculator` (Ruby via TempLookup, TS via getTemperature), com
 * prioridade **curva isotônica → T → raw**.
 *
 * Armazenamento: `pairs = [[1, T]]` — mesma convenção self-describing do
 * `-dist` (o parâmetro é a razão y/x).
 *
 * NÃO bumpa `model_version`: calibra a SAÍDA, não o gerador — mesmo raciocínio
 * da `scoreline-cal` (B33), então a isotônica / league_parameters / dist-k
 * seguem válidos.
 *
 * Uso:
 *   pnpm exec tsx scripts/calibracao/fit-temperature.ts
 *   pnpm exec tsx scripts/calibracao/fit-temperature.ts --dry
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- script CLI: shapes dinâmicos do PostgREST */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fitTemperature, applyTemperature } from "@/lib/calibracao/temperature";

function ensureEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const i = line.indexOf("=");
      if (i <= 0 || line.trim().startsWith("#")) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* CI provê via secrets */
  }
}
ensureEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[fit-temp] faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const DRY = process.argv.includes("--dry");

/** Amostra mínima pra fitar. Abaixo disso T=1 (identidade) — não persiste. */
const MIN_SAMPLE = 300;

interface Row {
  model_version: string;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  p_over_25: number | null;
  p_btts: number | null;
  hg: number;
  ag: number;
}

async function fetchResolved(): Promise<Row[]> {
  const PAGE = 1000;
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("fixture_simulations")
      .select(
        "model_version, p_home, p_draw, p_away, p_over_25, p_btts, actual_home_goals, actual_away_goals",
      )
      .not("actual_home_goals", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows as any[]) {
      if (r.actual_home_goals === null || r.actual_away_goals === null) continue;
      out.push({
        model_version: r.model_version,
        p_home: numOrNull(r.p_home),
        p_draw: numOrNull(r.p_draw),
        p_away: numOrNull(r.p_away),
        p_over_25: numOrNull(r.p_over_25),
        p_btts: numOrNull(r.p_btts),
        hg: Number(r.actual_home_goals),
        ag: Number(r.actual_away_goals),
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return v !== null && v !== undefined && Number.isFinite(n) ? n : null;
}

function meanLogLoss(pts: Array<[number, number]>, T: number): number {
  let s = 0;
  for (const [p, o] of pts) {
    const q = applyTemperature(p, T);
    s -= o === 1 ? Math.log(q) : Math.log(1 - q);
  }
  return s / pts.length;
}

async function persist(version: string, metric: string, T: number, n: number) {
  if (DRY) {
    console.log(`[dry] ${version} ${metric}: T=${T.toFixed(2)} (n=${n}) — não gravado`);
    return;
  }
  await sb
    .from("model_calibration")
    .update({ effective_until: new Date().toISOString() })
    .eq("model_version", version)
    .eq("metric", metric)
    .is("effective_until", null);

  const { error } = await sb.from("model_calibration").insert({
    metric,
    model_version: version,
    pairs: [[1, Number(T.toFixed(4))]],
    n,
  });
  if (error) console.error(`[fail] ${version} ${metric}:`, error.message);
  else console.log(`[ok] ${version} ${metric}: T=${T.toFixed(2)} (n=${n})`);
}

async function main() {
  const rows = await fetchResolved();
  if (rows.length === 0) {
    console.log("[fit-temp] nenhuma simulação resolvida — exit 0.");
    return;
  }

  // Agrupa por model_version: o T é uma propriedade do gerador.
  const byVersion = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.model_version) continue;
    const list = byVersion.get(r.model_version) ?? [];
    list.push(r);
    byVersion.set(r.model_version, list);
  }

  const MARKETS: Array<{
    metric: string;
    pick: (r: Row) => number | null;
    hit: (r: Row) => boolean;
  }> = [
    { metric: "1x2-temp", pick: (r) => r.p_home, hit: (r) => r.hg > r.ag },
    { metric: "over25-temp", pick: (r) => r.p_over_25, hit: (r) => r.hg + r.ag > 2 },
    { metric: "btts-temp", pick: (r) => r.p_btts, hit: (r) => r.hg >= 1 && r.ag >= 1 },
  ];

  for (const [version, list] of byVersion) {
    for (const m of MARKETS) {
      const pts: Array<[number, number]> = [];
      for (const r of list) {
        const p = m.pick(r);
        if (p === null) continue;
        pts.push([p, m.hit(r) ? 1 : 0]);
      }
      if (pts.length < MIN_SAMPLE) {
        console.log(`[skip] ${version} ${m.metric}: n=${pts.length} < ${MIN_SAMPLE}`);
        continue;
      }
      const T = fitTemperature(pts);
      const before = meanLogLoss(pts, 1);
      const after = meanLogLoss(pts, T);
      const gain = (100 * (before - after)) / before;
      console.log(
        `[fit] ${version} ${m.metric}: T=${T.toFixed(2)} | log-loss ${before.toFixed(4)} → ${after.toFixed(4)} (${gain >= 0 ? "+" : ""}${gain.toFixed(2)}% in-sample)`,
      );
      // T=1 é identidade: não vale ocupar uma linha ativa.
      if (T === 1) {
        console.log(`[skip] ${version} ${m.metric}: T=1 (nada a corrigir)`);
        continue;
      }
      await persist(version, m.metric, T, pts.length);
    }
  }
}

main().catch((e) => {
  console.error("[fit-temp] erro:", e?.message ?? e);
  process.exit(1);
});
