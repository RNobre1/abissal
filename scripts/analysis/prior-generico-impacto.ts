#!/usr/bin/env tsx
/**
 * Diagnóstico: qual o efeito de EXCLUIR da calibração as simulações que só
 * reemitem o prior genérico (ausência de dado vestida de predição — 07/08).
 *
 * Não escreve nada. Reusa o código de produção (`fitIsotonic`, o gate
 * out-of-sample do `fit-isotonic.ts`, `fitTemperature`, `brierScore*`) para
 * que o número aqui seja o mesmo que o cron produziria.
 *
 *   pnpm exec tsx scripts/analysis/prior-generico-impacto.ts
 */
import { createClient } from "@supabase/supabase-js";
import { fitIsotonic } from "@/lib/calibracao/isotonic";
import { fitTemperature, temperatureHeldOutGate } from "@/lib/calibracao/temperature";
import { brierScore, brierScoreMulticlass } from "@/lib/ai/calibration-metrics";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SR) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SR, { auth: { persistSession: false } });

interface Row {
  model_version: string | null;
  home_team: string | null;
  away_team: string | null;
  league: string | null;
  kickoff_utc: string | null;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  p_over_25: number | null;
  p_btts: number | null;
  actual_home_goals: number | null;
  actual_away_goals: number | null;
  actual_btts: boolean | null;
  actual_resolved_at: string | null;
}

// ── classificação ────────────────────────────────────────────────────────────
const PLACEHOLDER_RE = /\b(tbc|tbd|to be confirmed|winner of|loser of|vencedor)\b/i;

function timePlaceholder(kickoff: string | null): boolean {
  if (!kickoff) return false;
  const d = new Date(kickoff);
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
}
function teamPlaceholder(r: Row): boolean {
  return PLACEHOLDER_RE.test(r.home_team ?? "") || PLACEHOLDER_RE.test(r.away_team ?? "");
}
/** Prior genérico EXATO: o vetor modal 0.4424 / 0.2809 / 0.2767. */
function priorExato(r: Row): boolean {
  return (
    r.p_home != null && r.p_draw != null &&
    Math.abs(r.p_home - 0.4424) < 5e-5 && Math.abs(r.p_draw - 0.2809) < 5e-5
  );
}
/** Colado no prior: shrinkage esmagou a fixture contra o baseline neutro. */
function priorColado(r: Row): boolean {
  return (
    r.p_home != null && r.p_draw != null && r.p_away != null &&
    Math.abs(r.p_home - 0.4424) < 0.02 &&
    Math.abs(r.p_draw - 0.2809) < 0.02 &&
    Math.abs(r.p_away - 0.2767) < 0.02
  );
}

// ── métricas ─────────────────────────────────────────────────────────────────
function brier1x2(rows: Row[]): { n: number; brier: number; acerto: number } {
  const pts = rows.filter((r) => r.p_home != null && r.p_draw != null && r.p_away != null);
  if (!pts.length) return { n: 0, brier: NaN, acerto: NaN };
  let soma = 0;
  let acertos = 0;
  for (const r of pts) {
    const hg = r.actual_home_goals!;
    const ag = r.actual_away_goals!;
    const obs: "home" | "draw" | "away" = hg > ag ? "home" : hg === ag ? "draw" : "away";
    const probs = { home: r.p_home!, draw: r.p_draw!, away: r.p_away! };
    soma += brierScoreMulticlass(probs, obs);
    const ordem = (["home", "draw", "away"] as const);
    const argmax = ordem[[probs.home, probs.draw, probs.away].indexOf(Math.max(probs.home, probs.draw, probs.away))];
    if (argmax === obs) acertos++;
  }
  return { n: pts.length, brier: soma / pts.length, acerto: acertos / pts.length };
}
function brierBin(rows: Row[], pred: (r: Row) => number | null, obs: (r: Row) => 0 | 1) {
  const pts = rows.map((r) => [pred(r), obs(r)] as const).filter(([p]) => p != null);
  if (!pts.length) return { n: 0, brier: NaN, prevPrev: NaN, obsPrev: NaN };
  const brier = pts.reduce((a, [p, o]) => a + brierScore(p as number, o), 0) / pts.length;
  return {
    n: pts.length,
    brier,
    prevPrev: pts.reduce((a, [p]) => a + (p as number), 0) / pts.length,
    obsPrev: pts.reduce((a, [, o]) => a + o, 0) / pts.length,
  };
}

// ── gate out-of-sample: cópia literal do fit-isotonic.ts ─────────────────────
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
  const raw = ll((p) => p);
  const curved = ll(lookup);
  return { keep: curved < raw, raw, curved, nTest: test.length };
}
function heldOutGate(pairs: Array<[number, number]>) {
  const votes = GATE_CUTS.map((f) => singleCutGate(pairs, f)).filter((v) => v !== null) as Array<
    NonNullable<ReturnType<typeof singleCutGate>>
  >;
  if (!votes.length) return { keep: false, raw: NaN, curved: NaN, nTest: 0, votos: "0/0" };
  const keeps = votes.filter((v) => v.keep).length;
  return {
    keep: keeps > votes.length / 2,
    raw: votes.reduce((a, v) => a + v.raw, 0) / votes.length,
    curved: votes.reduce((a, v) => a + v.curved, 0) / votes.length,
    nTest: Math.round(votes.reduce((a, v) => a + v.nTest, 0) / votes.length),
    votos: `${keeps}/${votes.length}`,
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
function pairsFor(m: Metric, rows: Row[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const r of rows) {
    const p = predFor(m, r);
    if (p == null || !Number.isFinite(p)) continue;
    if (r.actual_home_goals == null || r.actual_away_goals == null) continue;
    out.push([p, obsFor(m, r)]);
  }
  return out;
}

const f = (v: number, d = 4) => (Number.isFinite(v) ? v.toFixed(d) : "—");

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = supabase as unknown as { from: (t: string) => any };
  // ⚠️ O PostgREST corta em 1.000 linhas por resposta — `.limit(5000)` NÃO
  // devolve 5.000 (é o bug que o `fit-isotonic.ts` de produção ainda tem).
  // Aqui paginamos com .range() até esgotar.
  const PAGE = 1000;
  const acc: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await c
      .from("fixture_simulations")
      .select(
        [
          "model_version", "home_team", "away_team", "league", "kickoff_utc",
          "p_home", "p_draw", "p_away", "p_over_25", "p_btts",
          "actual_home_goals", "actual_away_goals", "actual_btts", "actual_resolved_at",
        ].join(", "),
      )
      .eq("status", "resolved")
      .order("actual_resolved_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    const page = (data ?? []) as Row[];
    acc.push(...page);
    if (page.length < PAGE) break;
  }

  const todas = acc.filter(
    (r) => r.actual_home_goals != null && r.actual_away_goals != null,
  );

  const marca = (r: Row) => ({
    time: teamPlaceholder(r),
    hora: timePlaceholder(r.kickoff_utc),
    exato: priorExato(r),
    colado: priorColado(r),
  });

  console.log(`\n${"═".repeat(78)}\nUNIVERSO: ${todas.length} simulações resolvidas (todas as model_version)\n${"═".repeat(78)}`);
  const cnt = { time: 0, hora: 0, exato: 0, colado: 0, qualquer: 0 };
  for (const r of todas) {
    const m = marca(r);
    if (m.time) cnt.time++;
    if (m.hora) cnt.hora++;
    if (m.exato) cnt.exato++;
    if (m.colado) cnt.colado++;
    if (m.time || m.hora || m.colado) cnt.qualquer++;
  }
  console.log(`  time placeholder (TBC/TBD/winner) : ${cnt.time}`);
  console.log(`  hora placeholder (00:00 UTC)      : ${cnt.hora}`);
  console.log(`  prior genérico EXATO              : ${cnt.exato}`);
  console.log(`  colado no prior (±0.02)           : ${cnt.colado}`);
  console.log(`  união (o que o expurgo removeria) : ${cnt.qualquer}`);

  const cenarios: Array<[string, Row[]]> = [
    ["A · como está hoje", todas],
    ["B · sem placeholder (time|hora)", todas.filter((r) => !teamPlaceholder(r) && !timePlaceholder(r.kickoff_utc))],
    ["C · sem prior EXATO", todas.filter((r) => !priorExato(r))],
    ["D · sem colado no prior", todas.filter((r) => !priorColado(r))],
    ["E · sem placeholder E sem colado", todas.filter((r) => !teamPlaceholder(r) && !timePlaceholder(r.kickoff_utc) && !priorColado(r))],
  ];

  // ── 1. Brier ──────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(78)}\n1. BRIER\n${"─".repeat(78)}`);
  console.log(
    "cenário".padEnd(34) + "n".padStart(6) + "1x2".padStart(9) + "acerto".padStart(9) +
    "over2.5".padStart(10) + "btts".padStart(9),
  );
  for (const [nome, rows] of cenarios) {
    const b = brier1x2(rows);
    const o = brierBin(rows, (r) => r.p_over_25, (r) => (r.actual_home_goals! + r.actual_away_goals! > 2.5 ? 1 : 0));
    const bt = brierBin(rows, (r) => r.p_btts, (r) => obsFor("btts", r));
    console.log(
      nome.padEnd(34) + String(b.n).padStart(6) + f(b.brier).padStart(9) +
      `${(b.acerto * 100).toFixed(1)}%`.padStart(9) + f(o.brier).padStart(10) + f(bt.brier).padStart(9),
    );
  }

  // Só o conjunto contaminado, isolado.
  console.log(`\n  ── só o conjunto suspeito, isolado ──`);
  for (const [nome, pred] of [
    ["time|hora placeholder", (r: Row) => teamPlaceholder(r) || timePlaceholder(r.kickoff_utc)],
    ["prior EXATO", priorExato],
    ["colado no prior", priorColado],
  ] as Array<[string, (r: Row) => boolean]>) {
    const sub = todas.filter(pred);
    const b = brier1x2(sub);
    const o = brierBin(sub, (r) => r.p_over_25, (r) => (r.actual_home_goals! + r.actual_away_goals! > 2.5 ? 1 : 0));
    console.log(
      `  ${nome.padEnd(32)}` + String(b.n).padStart(6) + f(b.brier).padStart(9) +
      `${(b.acerto * 100).toFixed(1)}%`.padStart(9) + f(o.brier).padStart(10) +
      `   (over previsto ${f(o.prevPrev, 3)} vs real ${f(o.obsPrev, 3)})`,
    );
  }

  // ── 2. Isotônica: o gate muda de veredito? ────────────────────────────────
  console.log(`\n${"─".repeat(78)}\n2. ISOTÔNICA — gate out-of-sample (o que o cron de domingo decidiria)\n${"─".repeat(78)}`);
  const versoes = [...new Set(todas.map((r) => r.model_version).filter(Boolean))] as string[];
  for (const v of versoes) {
    const doV = todas.filter((r) => r.model_version === v);
    if (doV.length < 80) { console.log(`\n${v}: n=${doV.length} — abaixo do piso, pulado`); continue; }
    console.log(`\n${v} (n=${doV.length} resolvidas)`);
    console.log("  métrica".padEnd(16) + "cenário".padEnd(34) + "n".padStart(6) + "votos".padStart(8) + "curva".padStart(9) + "raw".padStart(9) + "  veredito");
    for (const m of METRICS) {
      for (const [nome, rows] of cenarios) {
        const sub = rows.filter((r) => r.model_version === v);
        const pairs = pairsFor(m, sub);
        if (pairs.length < 30) { console.log(`  ${m.padEnd(14)}${nome.padEnd(34)}${String(pairs.length).padStart(6)}   n<30 (pulado)`); continue; }
        const g = heldOutGate(pairs);
        console.log(
          `  ${m.padEnd(14)}${nome.padEnd(34)}${String(pairs.length).padStart(6)}${g.votos.padStart(8)}` +
          f(g.curved).padStart(9) + f(g.raw).padStart(9) + `  ${g.keep ? "MANTÉM curva" : "rejeita (aposenta a ativa)"}`,
        );
      }
      console.log("");
    }
  }

  // ── 3. Temperature scaling ────────────────────────────────────────────────
  console.log(`${"─".repeat(78)}\n3. TEMPERATURE SCALING — o T fitado muda?\n${"─".repeat(78)}`);
  console.log("  métrica".padEnd(16) + "cenário".padEnd(34) + "n".padStart(6) + "T".padStart(7) + "  gate held-out");
  for (const m of METRICS) {
    for (const [nome, rows] of cenarios) {
      const pairs = pairsFor(m, rows);
      if (pairs.length < 100) continue;
      const T = fitTemperature(pairs);
      const g = temperatureHeldOutGate(pairs);
      const ganho = "gainPct" in g ? (g as { gainPct?: number }).gainPct : undefined;
      console.log(
        `  ${m.padEnd(14)}${nome.padEnd(34)}${String(pairs.length).padStart(6)}${T.toFixed(2).padStart(7)}` +
        `   ${JSON.stringify(g).slice(0, 110)}${ganho != null ? "" : ""}`,
      );
    }
    console.log("");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
