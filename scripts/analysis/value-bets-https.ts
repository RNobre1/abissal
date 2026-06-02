#!/usr/bin/env tsx
/**
 * value-bets-https — caça-valor PRÓPRIO via HTTPS/PostgREST (fallback quando o
 * pg TCP 5432/6543 está bloqueado pelo ISP — ADR-004 / lição B30). Cobre TODOS
 * os mercados catalogados na calibração, derivados da NOSSA simulação calibrada
 * × odds da casa, com guardrails (trust/avoid) + FADE do inverso.
 *
 * Deriva (fiel ao `ai_reco/edge_calculator.rb` + `dist_helpers.rb`):
 *   - 1x2 (home/away): p_home/p_away calibrados (isotônica) × odd Result.
 *   - over25 (over/under), btts (sim/nao): idem com as curvas próprias.
 *   - corners/cards/sot (over/under, por linha): Poisson(total_mean) onde
 *     total_mean = sim_stats.home[m].p50 + away[m].p50 → isotônica → × odd.
 * Funciona pra TODO jogo com sim (não só os que a IA-2 já analisou).
 *
 *   pnpm exec tsx scripts/analysis/value-bets-https.ts --to 2026-06-07 [--date YYYY-MM-DD] [--min-edge 0.05] [--min-prob 0.45]
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- script CLI de análise: shapes dinâmicos do PostgREST/jsonb */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { applyIsotonic } from "@/lib/calibracao/isotonic";

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
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } });

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const date = arg("date", new Date().toISOString().slice(0, 10)) as string;
const toDate = arg("to", date) as string;
const minEdge = Number(arg("min-edge", "0.05"));
const minProb = Number(arg("min-prob", "0.45"));
const nowIso = new Date().toISOString();
const lower = nowIso > `${date}T00:00:00Z` ? nowIso : `${date}T00:00:00Z`;
const upper = `${toDate}T23:59:59.999Z`;

// ── Poisson (porta de dist_helpers.rb) ──
function poissonCdf(lambda: number, k: number): number {
  if (k < 0) return 0;
  const lam = Math.max(lambda, 1e-9);
  let logP = -lam, cdf = Math.exp(logP);
  for (let i = 0; i < Math.min(k, 500); i++) { logP += Math.log(lam) - Math.log(i + 1); cdf += Math.exp(logP); }
  return Math.min(cdf, 1);
}
const pOver = (mean: number, line: number) => Math.min(Math.max(1 - poissonCdf(Math.max(mean, 1e-9), Math.floor(line)), 0), 1);
const pUnder = (mean: number, line: number) => Math.min(Math.max(poissonCdf(Math.max(mean, 1e-9), Math.floor(line)), 0), 1);

// ── reliability + fade (porta de analysis/value_bets.rb) ──
type Klass = "trust" | "avoid" | "weak" | "trust_inverse" | "avoid_inverse" | "unknown";
const classifyRow = (n: number, roi: number | null): Klass => n < 8 || roi == null ? "weak" : roi < -0.1 ? "avoid" : roi > 0.1 ? "trust" : "weak";
function opposite(market: string, side: string): [string, string] | null {
  if (market === "over25") return ["over25", side === "under" ? "over" : "under"];
  if (market === "btts") return ["btts", side === "nao" ? "sim" : "nao"];
  for (const f of ["corners", "sot", "cards"]) { if (market === `${f}-under`) return [`${f}-over`, side]; if (market === `${f}-over`) return [`${f}-under`, side]; }
  return null;
}
function klassFor(market: string, side: string, cls: Map<string, { roi: number | null; klass: Klass }>): Klass {
  const own = cls.get(`${market}|${side}`);
  if (own && own.klass !== "weak") return own.klass;
  const opp = opposite(market, side);
  if (opp) { const o = cls.get(`${opp[0]}|${opp[1]}`); if (o) { if (o.klass === "avoid") return "trust_inverse"; if (o.klass === "trust") return "avoid_inverse"; } }
  return own ? own.klass : "unknown";
}
const allowed = (k: Klass) => k !== "avoid" && k !== "avoid_inverse";

type OddsMkt = Record<string, { decimal_odds?: number }> | undefined;
function oddOf(m: OddsMkt, ...keys: string[]): number | null {
  if (!m) return null;
  for (const k of keys) if (m[k]?.decimal_odds) return m[k].decimal_odds as number;
  for (const [name, o] of Object.entries(m)) for (const k of keys) if (name.toLowerCase().includes(k.toLowerCase()) && k.length >= 3 && o?.decimal_odds) return o.decimal_odds as number;
  return null;
}
const p50 = (stats: any, side: string, metric: string): number | null => {
  const v = stats?.[side]?.[metric]?.p50 ?? stats?.[side]?.[metric]?.mean;
  return typeof v === "number" && isFinite(v) ? v : null;
};

interface Cand { game: string; ko: string; lg: string; market: string; side: string; p: number; o: number; edge: number; eff: number; klass: Klass }

async function main() {
  // 1) confiabilidade histórica
  const { data: resv } = await sb.from("ai_recommendations").select("market,side,bet_won,pl_units,units_final,forced").not("bet_won", "is", null);
  const agg = new Map<string, { n: number; pl: number; u: number }>();
  for (const r of (resv ?? []) as any[]) { if (r.forced === true) continue; const k = `${r.market}|${r.side}`; const a = agg.get(k) ?? { n: 0, pl: 0, u: 0 }; a.n++; a.pl += Number(r.pl_units ?? 0); a.u += Number(r.units_final ?? 0); agg.set(k, a); }
  const cls = new Map<string, { roi: number | null; klass: Klass }>();
  for (const [k, a] of agg) { const roi = a.u > 0 ? a.pl / a.u : null; cls.set(k, { roi, klass: classifyRow(a.n, roi) }); }

  // calibração de DISTRIBUIÇÃO (task calibracao-distribuicao): a sim subestima
  // corners/sot/cards (PoC: k≈1.06/1.08/1.14). Corrige a média com TODO o
  // histórico resolvido (k = média_actual/média_prevista) → calibra TODAS as
  // linhas de uma vez (não só 85/95/105), sample-efficient. Fallback k=1 se n<30.
  const SECM: Record<string, [string, string]> = { corners: ["actual_corners_home", "actual_corners_away"], sot: ["actual_sot_home", "actual_sot_away"], cards: ["actual_cards_home", "actual_cards_away"] };
  const kFactor: Record<string, number> = {};
  {
    const { data: rr } = await sb.from("fixture_simulations")
      .select("sim_stats,actual_corners_home,actual_corners_away,actual_sot_home,actual_sot_away,actual_cards_home,actual_cards_away")
      .eq("status", "resolved").not("actual_corners_home", "is", null).order("actual_resolved_at", { ascending: false }).limit(1000);
    for (const [metric, [ch, ca]] of Object.entries(SECM)) {
      let sp = 0, sa = 0, n = 0;
      for (const r of (rr ?? []) as any[]) { const hp = r.sim_stats?.home?.[metric]?.p50, ap = r.sim_stats?.away?.[metric]?.p50; if (typeof hp === "number" && typeof ap === "number" && r[ch] != null && r[ca] != null) { sp += hp + ap; sa += Number(r[ch]) + Number(r[ca]); n++; } }
      kFactor[metric] = n >= 30 && sp > 0 ? sa / sp : 1;
    }
  }

  // 2) sims do intervalo (latest por fixture)
  const { data: sims } = await sb.from("fixture_simulations")
    .select("home_team,away_team,league,kickoff_utc,model_version,created_at,p_home,p_away,p_over_25,p_btts,sim_stats")
    .gte("kickoff_utc", lower).lt("kickoff_utc", upper).order("created_at", { ascending: false });
  const latest = new Map<string, any>();
  for (const s of (sims ?? []) as any[]) { const k = `${s.home_team}|${s.away_team}|${(s.kickoff_utc as string)?.slice(0, 16)}`; if (!latest.has(k)) latest.set(k, s); }
  const mv = (sims?.[0] as any)?.model_version as string | undefined;

  // 3) curvas isotônicas ativas
  const curves: Record<string, Array<[number, number]>> = {};
  if (mv) { const { data: cal } = await sb.from("model_calibration").select("metric,pairs").eq("model_version", mv).is("effective_until", null);
    for (const r of (cal ?? []) as any[]) { const a = typeof r.pairs === "string" ? JSON.parse(r.pairs) : r.pairs; if (Array.isArray(a)) curves[r.metric] = a; } }
  const C = (metric: string, p: number) => (curves[metric] ? applyIsotonic(curves[metric], p) : p);

  // 4) odds (subpath odds_summary — NUNCA o detail_json inteiro, B12)
  const { data: fx } = await sb.from("fixtures").select("home_team,away_team,kickoff_utc,detail_json->odds_summary").gte("kickoff_utc", lower).lt("kickoff_utc", upper);
  const oddsByKey = new Map<string, any>();
  for (const f of (fx ?? []) as any[]) oddsByKey.set(`${f.home_team}|${f.away_team}|${(f.kickoff_utc as string)?.slice(0, 16)}`, f.odds_summary ?? {});

  // metric → mercado de odds no choistats. Linhas: TODAS as que o book oferecer
  // (não só as calibradas). Curva isotônica aplicada quando existe; senão Poisson
  // cru (marcado `raw` — overconfiante, não confiar cego).
  const SEC = [
    { metric: "corners", oddsKey: "Total Corners" },
    { metric: "sot", oddsKey: "Total shots on target" },
    { metric: "cards", oddsKey: "Total Cards" },
  ];
  const cands: Cand[] = [];
  for (const [k, s] of latest) {
    const os = oddsByKey.get(k); if (!os) continue;
    const res = os["Result"], mg = os["Match Goals Overs/Unders"], bt = os["BTTS"];
    const h = String(s.home_team), a = String(s.away_team);
    const add = (market: string, side: string, p: number, o: number | null) => {
      if (o == null || o <= 1 || !isFinite(p) || p < minProb) return;
      const edge = p * o - 1; if (edge < minEdge) return;
      const klass = klassFor(market, side, cls); if (!allowed(klass)) return;
      cands.push({ game: `${h} x ${a}`, ko: String(s.kickoff_utc).slice(5, 16), lg: String(s.league ?? ""), market, side, p, o, edge, eff: Math.log(1 + edge) / Math.log(o), klass });
    };
    // 1x2 / over25 / btts (sempre calibrados)
    add("1x2", "home", C("1x2-home", Number(s.p_home)), oddOf(res, h, h.split(" ")[0]));
    add("1x2", "away", C("1x2-away", Number(s.p_away)), oddOf(res, a, a.split(" ")[0]));
    add("over25", "over", C("over25", Number(s.p_over_25)), oddOf(mg, "Over 2.5"));
    add("over25", "under", C("over25-under", 1 - Number(s.p_over_25)), oddOf(mg, "Under 2.5"));
    add("btts", "sim", C("btts", Number(s.p_btts)), oddOf(bt, "Yes"));
    add("btts", "nao", C("btts-nao", 1 - Number(s.p_btts)), oddOf(bt, "No"));
    // corners / sot / cards: Poisson(total_mean) em TODAS as linhas do book
    for (const sec of SEC) {
      const hv = p50(s.sim_stats, "home", sec.metric), av = p50(s.sim_stats, "away", sec.metric);
      if (hv == null || av == null) continue;
      const mean = (hv + av) * (kFactor[sec.metric] ?? 1); // média calibrada por distribuição → TODAS as linhas calibradas
      const mkt = os[sec.oddsKey] as OddsMkt; if (!mkt) continue;
      const lines = new Set<number>();
      for (const key of Object.keys(mkt)) { const m = key.match(/^(?:Over|Under)\s+(\d+(?:\.\d)?)$/i); if (m) lines.add(Number(m[1])); }
      for (const L of [...lines].sort((x, y) => x - y)) {
        const lbl = String(Math.round(L * 10)); // 8.5 → "85"
        add(`${sec.metric}-over`, lbl, pOver(mean, L), oddOf(mkt, `Over ${L}`));
        add(`${sec.metric}-under`, lbl, pUnder(mean, L), oddOf(mkt, `Under ${L}`));
      }
    }
  }
  cands.sort((a, b) => b.eff - a.eff);
  console.log(`janela ${date}→${toDate} (próximos) | mv=${mv} | ${latest.size} jogos | ${cands.length} candidatos (prob≥${minProb}, edge≥${Math.round(minEdge * 100)}%, mercado permitido)\n`);
  for (const c of cands) console.log(`${(c.edge * 100).toFixed(0).padStart(4)}%  ef=${c.eff.toFixed(2)}  ${c.game.slice(0, 30).padEnd(30)} ${(c.market + "/" + c.side).padEnd(17)} @ ${c.o.toFixed(2)}  p=${c.p.toFixed(2)}  [${c.klass}]  (${c.ko}, ${c.lg.slice(0, 14)})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
