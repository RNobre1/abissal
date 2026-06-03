#!/usr/bin/env tsx
/**
 * measure-scoreline-accuracy — quantifica a acurácia de PLACAR da sim (item 1 /
 * B28). Read-only sobre prod (HTTPS — pg TCP bloqueado, B30).
 *
 * Mede, sobre as sims resolvidas: top-1/3/6 hit rate, prob que a sim previa pro
 * top-1 (calibração), e o VIÉS DE EMPATE (taxa de empate prevista vs real).
 *
 *   pnpm exec tsx scripts/calibracao/measure-scoreline-accuracy.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- CLI: shapes dinâmicos do PostgREST */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { scorelineAccuracy, type ScorelineSample } from "@/lib/calibracao/scoreline-accuracy";

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

function asArray(v: any): Array<{ score: string; prob: number }> {
  const a = typeof v === "string" ? JSON.parse(v) : v;
  return Array.isArray(a) ? a : [];
}

async function main() {
  const { data, error } = await sb
    .from("fixture_simulations")
    .select(
      "model_version, top_scorelines, p_home, p_draw, p_away, actual_home_goals, actual_away_goals",
    )
    .eq("status", "resolved")
    .not("actual_home_goals", "is", null)
    .order("actual_resolved_at", { ascending: false })
    .limit(2000);

  if (error) {
    console.error("query failed:", error);
    process.exit(1);
  }
  const rows = (data ?? []) as any[];

  // Agrupa por model_version (relata cada uma; o foco é a v7 ativa).
  const byV = new Map<string, ScorelineSample[]>();
  for (const r of rows) {
    if (r.actual_home_goals == null || r.actual_away_goals == null) continue;
    const sl = asArray(r.top_scorelines);
    const s: ScorelineSample = {
      topScore: sl[0]?.score ?? null,
      pTop: sl[0]?.prob ?? null,
      scorelines: sl,
      pHome: r.p_home,
      pDraw: r.p_draw,
      pAway: r.p_away,
      actualHome: Number(r.actual_home_goals),
      actualAway: Number(r.actual_away_goals),
    };
    const v = r.model_version ?? "?";
    (byV.get(v) ?? byV.set(v, []).get(v)!).push(s);
  }

  console.log(`\n=== Acurácia de PLACAR (item 1 / B28) — ${rows.length} sims resolvidas ===\n`);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  for (const [v, samples] of [...byV.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (samples.length < 30) continue;
    const a = scorelineAccuracy(samples);
    console.log(`[${v}]  n=${a.n}`);
    console.log(`   top-1 hit:  ${pct(a.top1HitRate)}  (a sim previa ${pct(a.top1PredictedMean)} pro top-1 → ${a.top1HitRate >= a.top1PredictedMean ? "sub" : "super"}estimou)`);
    console.log(`   top-3 hit:  ${pct(a.top3HitRate)}   ·   top-6 hit: ${pct(a.top6HitRate)}`);
    console.log(`   EMPATE — previsto ${pct(a.predDrawRate)} vs real ${pct(a.actualDrawRate)}  →  viés ${a.drawBias >= 0 ? "+" : ""}${pct(a.drawBias)} ${a.drawBias > 0.02 ? "⚠️ infla empate (B28)" : a.drawBias < -0.02 ? "⚠️ subestima empate" : "✅ ok"}`);
    console.log(`   RPS (1X2):  ${a.rps.toFixed(4)}  (0=perfeito; ~0.21 = chute pelas freq. base)\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
