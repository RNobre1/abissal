#!/usr/bin/env tsx
/**
 * fit-scoreline-cal — calibração de PLACAR (item 1 / B28). Sobre TODAS as sims
 * resolvidas (paginado — não só as 1000 do limite do PostgREST):
 *   1. Mede a acurácia CRUA (top-1/3/6 hit, viés de empate, RPS).
 *   2. Fita (T, δ) que recalibram a FORMA do top-6 (achata o pico + deflaciona
 *      empate) pra bater as frequências reais.
 *   3. Mede a acurácia CALIBRADA (antes→depois).
 *   4. Persiste em `model_calibration` (metric `scoreline-cal`, pairs = OBJETO
 *      com T/δ + resumo antes/depois) — lido pelo apply-on-read e pelo gráfico
 *      em /calibracao. É refit MECÂNICO (B24); NÃO bumpa model_version (calibra
 *      a saída, não o gerador).
 *
 *   pnpm exec tsx scripts/calibracao/fit-scoreline-cal.ts [--dry]
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- CLI: shapes dinâmicos do PostgREST */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { scorelineAccuracy, type ScorelineSample } from "@/lib/calibracao/scoreline-accuracy";
import {
  fitScorelineCalibration,
  calibrateScorelines,
  meanLogLoss,
} from "@/lib/calibracao/scoreline-calibration";

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
const DRY = process.argv.includes("--dry");

function asArray(v: any): Array<{ score: string; prob: number }> {
  const a = typeof v === "string" ? JSON.parse(v) : v;
  return Array.isArray(a) ? a : [];
}

/** Pagina TODAS as sims resolvidas (PostgREST capa em 1000/request). */
async function fetchAllResolved(): Promise<any[]> {
  const out: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("fixture_simulations")
      .select("model_version, top_scorelines, p_home, p_draw, p_away, actual_home_goals, actual_away_goals")
      .eq("status", "resolved")
      .not("actual_home_goals", "is", null)
      .order("actual_resolved_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("query failed:", error);
      process.exit(1);
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function toSample(r: any): ScorelineSample {
  const sl = asArray(r.top_scorelines);
  return {
    topScore: sl[0]?.score ?? null,
    pTop: sl[0]?.prob ?? null,
    scorelines: sl,
    pHome: r.p_home,
    pDraw: r.p_draw,
    pAway: r.p_away,
    actualHome: Number(r.actual_home_goals),
    actualAway: Number(r.actual_away_goals),
  };
}

/** Reconstrói uma sample com os placares JÁ calibrados (reordenados). */
function calibratedSample(s: ScorelineSample, T: number, d: number): ScorelineSample {
  const cal = calibrateScorelines(s.scorelines, { temperature: T, drawFactor: d })
    .slice()
    .sort((a, b) => b.prob - a.prob);
  return { ...s, scorelines: cal, topScore: cal[0]?.score ?? null, pTop: cal[0]?.prob ?? null };
}

async function main() {
  const rows = await fetchAllResolved();
  console.log(`\n=== fit-scoreline-cal — ${rows.length} sims resolvidas (TODAS, paginado) ===\n`);

  const byV = new Map<string, any[]>();
  for (const r of rows) {
    const v = r.model_version ?? "?";
    (byV.get(v) ?? byV.set(v, []).get(v)!).push(r);
  }

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  for (const [v, vRows] of [...byV.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const samples = vRows.map(toSample);
    if (samples.length < 30) {
      console.log(`[skip] ${v}: ${samples.length} sims (precisa ≥30)\n`);
      continue;
    }
    const raw = scorelineAccuracy(samples);
    const fit = fitScorelineCalibration(
      samples.map((s) => ({ scorelines: s.scorelines, actualHome: s.actualHome, actualAway: s.actualAway })),
    );
    if (!fit) {
      console.log(`[skip] ${v}: fit retornou null\n`);
      continue;
    }
    const calSamples = samples.map((s) => calibratedSample(s, fit.temperature, fit.drawFactor));
    const cal = scorelineAccuracy(calSamples);

    // Validação HELD-OUT (anti-walk-forward): fita no train 70% (mais antigos,
    // samples já estão em ordem cronológica) e avalia a log-loss no test 30%.
    const fitSamples = samples.map((s) => ({ scorelines: s.scorelines, actualHome: s.actualHome, actualAway: s.actualAway }));
    const cut = Math.floor(fitSamples.length * 0.7);
    const train = fitSamples.slice(0, cut);
    const test = fitSamples.slice(cut);
    const trainFit = fitScorelineCalibration(train);
    let heldOut = "n/d";
    if (trainFit && test.length >= 20) {
      const llRawTest = meanLogLoss(test, 1, 1);
      const llCalTest = meanLogLoss(test, trainFit.temperature, trainFit.drawFactor);
      heldOut = `held-out: ${llRawTest.toFixed(4)} → ${llCalTest.toFixed(4)} (${llCalTest <= llRawTest ? "✅ generaliza" : "⚠️ piora out-of-sample"})`;
    }

    console.log(`[${v}]  n=${raw.n}  →  T=${fit.temperature.toFixed(2)}  δ=${fit.drawFactor.toFixed(2)}  ·  log-loss ${fit.logLossRaw.toFixed(4)} → ${fit.logLoss.toFixed(4)} (${fit.logLoss < fit.logLossRaw ? "✅ melhora" : "="})`);
    console.log(`   top-1:  cru ${pct(raw.top1PredictedMean)} previa / ${pct(raw.top1HitRate)} real  →  calibrado prevê ${pct(cal.top1PredictedMean)}`);
    console.log(`   empate: cru ${pct(raw.predDrawRate)} previa / ${pct(raw.actualDrawRate)} real  →  calibrado prevê ${pct(cal.predDrawRate)}`);
    console.log(`   |viés top-1|: ${pct(Math.abs(raw.top1PredictedMean - raw.top1HitRate))} → ${pct(Math.abs(cal.top1PredictedMean - cal.top1HitRate))}`);
    console.log(`   |viés empate|: ${pct(Math.abs(raw.drawBias))} → ${pct(Math.abs(cal.predDrawRate - cal.actualDrawRate))}`);
    console.log(`   ${heldOut}\n`);

    if (DRY) continue;

    const payload = {
      temperature: fit.temperature,
      drawFactor: fit.drawFactor,
      raw: {
        top1Hit: raw.top1HitRate,
        top1Pred: raw.top1PredictedMean,
        drawReal: raw.actualDrawRate,
        drawPred: raw.predDrawRate,
        top3Hit: raw.top3HitRate,
        top6Hit: raw.top6HitRate,
        rps: raw.rps,
      },
      cal: {
        top1Pred: cal.top1PredictedMean,
        drawPred: cal.predDrawRate,
      },
    };

    await sb
      .from("model_calibration")
      .update({ effective_until: new Date().toISOString() })
      .eq("model_version", v)
      .eq("metric", "scoreline-cal")
      .is("effective_until", null);
    const { error: insErr } = await sb.from("model_calibration").insert({
      metric: "scoreline-cal",
      model_version: v,
      pairs: payload as any,
      n: raw.n,
    });
    if (insErr) console.error(`[fail] ${v} scoreline-cal:`, insErr);
    else console.log(`[ok] ${v} scoreline-cal persistido (T=${fit.temperature.toFixed(2)}, δ=${fit.drawFactor.toFixed(2)})\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
