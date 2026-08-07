#!/usr/bin/env tsx
/**
 * Diagnóstico: o gate out-of-sample do `fit-isotonic.ts` treina no FUTURO e
 * testa no PASSADO?
 *
 * A query ordena `actual_resolved_at DESC` (mais recente primeiro) e o
 * `singleCutGate` usa `pairs.slice(0, cut)` como TREINO. Logo o treino são as
 * resolvidas mais RECENTES e o teste as mais ANTIGAS — o inverso do que
 * "held-out temporal" significa e do que a produção faz.
 *
 * Este script roda o MESMO gate nas duas direções e mostra onde o veredito
 * diverge. Só lê.
 *
 *   pnpm exec tsx scripts/analysis/gate-direcao-temporal.ts
 */
import { createClient } from "@supabase/supabase-js";
import { fitIsotonic } from "@/lib/calibracao/isotonic";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SR) { console.error("faltam envs"); process.exit(1); }
const supabase = createClient(URL, SR, { auth: { persistSession: false } });

interface Row {
  model_version: string | null;
  p_home: number | null; p_draw: number | null; p_away: number | null;
  p_over_25: number | null; p_btts: number | null;
  actual_home_goals: number | null; actual_away_goals: number | null;
  actual_btts: boolean | null; actual_resolved_at: string | null;
}

const GATE_CUTS = [0.5, 0.6, 0.7, 0.8, 0.85];
function singleCutGate(pairs: Array<[number, number]>, frac: number) {
  const MIN_TEST = 50;
  const cut = Math.floor(pairs.length * frac);
  const train = pairs.slice(0, cut);
  const test = pairs.slice(cut);
  if (test.length < MIN_TEST || train.length < MIN_TEST) return null;
  const curve = fitIsotonic(train);
  const clamp = (p: number) => Math.min(Math.max(p, 0.01), 0.99);
  const ll = (get: (p: number) => number) =>
    -test.reduce((acc, [p, o]) => {
      const q = clamp(get(p));
      return acc + (o * Math.log(q) + (1 - o) * Math.log(1 - q));
    }, 0) / test.length;
  const lookup = (p: number): number => {
    if (p <= curve[0][0]) return curve[0][1];
    if (p >= curve[curve.length - 1][0]) return curve[curve.length - 1][1];
    let lo = 0, hi = curve.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (curve[mid][0] <= p) lo = mid; else hi = mid - 1;
    }
    return curve[lo][1];
  };
  return { keep: ll(lookup) < ll((p) => p), raw: ll((p) => p), curved: ll(lookup) };
}
function heldOutGate(pairs: Array<[number, number]>) {
  const votes = GATE_CUTS.map((f) => singleCutGate(pairs, f)).filter(Boolean) as Array<
    NonNullable<ReturnType<typeof singleCutGate>>
  >;
  if (!votes.length) return null;
  const keeps = votes.filter((v) => v.keep).length;
  return {
    keep: keeps > votes.length / 2,
    votos: `${keeps}/${votes.length}`,
    curved: votes.reduce((a, v) => a + v.curved, 0) / votes.length,
    raw: votes.reduce((a, v) => a + v.raw, 0) / votes.length,
  };
}

type Metric = "1x2-home" | "1x2-draw" | "1x2-away" | "over25" | "over25-under" | "btts" | "btts-nao";
const METRICS: Metric[] = ["1x2-home", "1x2-draw", "1x2-away", "over25", "over25-under", "btts", "btts-nao"];
function predFor(m: Metric, r: Row): number | null {
  switch (m) {
    case "1x2-home": return r.p_home;
    case "1x2-draw": return r.p_draw;
    case "1x2-away": return r.p_away;
    case "over25": return r.p_over_25;
    case "over25-under": return r.p_over_25 == null ? null : 1 - r.p_over_25;
    case "btts": return r.p_btts;
    case "btts-nao": return r.p_btts == null ? null : 1 - r.p_btts;
  }
}
function obsFor(m: Metric, r: Row): 0 | 1 {
  const hg = r.actual_home_goals!, ag = r.actual_away_goals!;
  switch (m) {
    case "1x2-home": return hg > ag ? 1 : 0;
    case "1x2-draw": return hg === ag ? 1 : 0;
    case "1x2-away": return hg < ag ? 1 : 0;
    case "over25": return hg + ag > 2.5 ? 1 : 0;
    case "over25-under": return hg + ag <= 2.5 ? 1 : 0;
    case "btts": return r.actual_btts != null ? (r.actual_btts ? 1 : 0) : hg > 0 && ag > 0 ? 1 : 0;
    case "btts-nao": return r.actual_btts != null ? (r.actual_btts ? 0 : 1) : hg > 0 && ag > 0 ? 0 : 1;
  }
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = supabase as unknown as { from: (t: string) => any };
  const acc: Row[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await c
      .from("fixture_simulations")
      .select("model_version,p_home,p_draw,p_away,p_over_25,p_btts,actual_home_goals,actual_away_goals,actual_btts,actual_resolved_at")
      .eq("status", "resolved")
      .order("actual_resolved_at", { ascending: false })
      .order("id", { ascending: false })
      .range(off, off + 999);
    if (error) { console.error(error); process.exit(1); }
    const page = (data ?? []) as Row[];
    acc.push(...page);
    if (page.length < 1000) break;
  }
  const todas = acc.filter((r) => r.actual_home_goals != null && r.actual_away_goals != null);
  console.log(`n = ${todas.length} resolvidas\n`);

  const versoes = [...new Set(todas.map((r) => r.model_version).filter(Boolean))] as string[];
  for (const v of versoes) {
    const doV = todas.filter((r) => r.model_version === v);
    if (doV.length < 200) continue;
    const datas = doV.map((r) => r.actual_resolved_at).filter(Boolean).sort() as string[];
    console.log(`${v}  n=${doV.length}  [${datas[0]?.slice(0, 10)} … ${datas[datas.length - 1]?.slice(0, 10)}]`);
    console.log("  métrica".padEnd(16) + "DESC (como está: treina no futuro)".padEnd(38) + "ASC (treina no passado)");
    for (const m of METRICS) {
      const desc: Array<[number, number]> = [];
      for (const r of doV) {
        const p = predFor(m, r);
        if (p == null || !Number.isFinite(p)) continue;
        desc.push([p, obsFor(m, r)]);
      }
      if (desc.length < 100) continue;
      const asc = [...desc].reverse();
      const gd = heldOutGate(desc);
      const ga = heldOutGate(asc);
      if (!gd || !ga) continue;
      const fmt = (g: NonNullable<typeof gd>) =>
        `${g.keep ? "MANTÉM" : "rejeita"} (${g.votos}) ${g.curved.toFixed(4)} vs ${g.raw.toFixed(4)}`;
      const divergiu = gd.keep !== ga.keep ? "   ⚠️ DIVERGE" : "";
      console.log(`  ${m.padEnd(14)}${fmt(gd).padEnd(38)}${fmt(ga)}${divergiu}`);
    }
    console.log("");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
