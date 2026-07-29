#!/usr/bin/env tsx
/**
 * Backtest da RETA DE TENDÊNCIA — a linha tracejada do painel "ÚLTIMOS JOGOS"
 * (components/fixtures/stats/panels/recent-matches.tsx, regression.linear).
 *
 *   pnpm exec tsx scripts/analysis/backtest-trend.ts [--window 6,10] [--metric corners]
 *
 * PERGUNTA: a inclinação dos últimos K jogos de um time prevê o lado (over/under)
 * do total do PRÓXIMO jogo? É o que o Pilot usa na análise manual pra decidir se
 * entra no over ou no under de uma linha.
 *
 * MÉTODO (walk-forward, sem leakage): a série vem de `detail_json->recent_matches`
 * das fixtures vivas — os últimos jogos de cada time, com corners/cards/sot/gols,
 * MESMA fonte do gráfico. Para cada jogo histórico J em que ambos os times têm >= K
 * jogos ANTERIORES, computa a inclinação dos K anteriores de cada lado, soma, e
 * testa contra o total real de J. Linha de referência = mediana da liga + 0.5.
 *
 * BASELINE HONESTO: "chutar sempre o lado majoritário". A tendência só tem valor
 * se bater ISSO — não os 50%. Sem esse baseline, o viés da linha (em contagem
 * discreta o under costuma ser majoritário) faz qualquer chute parecer skill.
 * É a armadilha que derrubou o backtest da IA-2 em 2026-05-25 (walk-forward-bomb).
 *
 * Read-only. Fonte: Supabase prod via service_role (mesmo padrão de
 * scripts/calibracao/* e scripts/analysis/pre-match-scan.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ── env (.env.local fallback — sem dependência de dotenv) ────────────────
function ensureEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    return;
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* sem .env.local — assume env já exportado */
  }
}
ensureEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── args ─────────────────────────────────────────────────────────────────
function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const WINDOWS = (arg("window") ?? "6,10")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Number.isFinite);
const ONLY_METRIC = arg("metric");

const METRICS = [
  { key: "goals", h: "homeGoalsFt", a: "awayGoalsFt", label: "gols" },
  { key: "corners", h: "homeCorners", a: "awayCorners", label: "escanteios" },
  { key: "cards", h: "homeYellows", a: "awayYellows", label: "cartões" },
  { key: "sot", h: "homeShotsOnTarget", a: "awayShotsOnTarget", label: "finalizações" },
].filter((m) => !ONLY_METRIC || m.key === ONLY_METRIC);

// ── helpers puros ────────────────────────────────────────────────────────
/** Inclinação da regressão linear simples sobre o índice (mesma conta do gráfico). */
export function slope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (ys[i] - my);
    den += (i - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** IC95 de Wilson — mesmo estimador de lib/calibracao/wilson-ic.ts. */
function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const p = k / n;
  const z = 1.96;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}

// ── coleta ───────────────────────────────────────────────────────────────
interface HistGame {
  id: number;
  date: number;
  league: string;
  status: string;
  home_team: string;
  away_team: string;
  [metric: string]: unknown;
}

async function collectHistory(): Promise<HistGame[]> {
  const ids: number[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("fixtures")
      .select("id")
      .range(from, from + 999);
    if (error) throw new Error(`fixtures: ${error.message}`);
    ids.push(...(data ?? []).map((r) => (r as { id: number }).id));
    if (!data || data.length < 1000) break;
  }

  // Só o sub-campo recent_matches: `detail_json` inteiro é blob pesado (B12/B14).
  const games = new Map<number, HistGame>();
  for (let i = 0; i < ids.length; i += 40) {
    const { data, error } = await db
      .from("fixtures")
      .select("id,detail_json->recent_matches")
      .in("id", ids.slice(i, i + 40));
    if (error) throw new Error(`recent_matches: ${error.message}`);
    for (const row of data ?? []) {
      const rm = (row as unknown as { recent_matches?: Record<string, HistGame[]> })
        .recent_matches;
      if (!rm) continue;
      for (const side of ["home", "away"]) {
        for (const g of rm[side] ?? []) {
          if (g?.id != null && g.status === "FT" && !games.has(g.id))
            games.set(g.id, g);
        }
      }
    }
  }
  console.log(`fixtures vivas: ${ids.length} · jogos históricos únicos: ${games.size}`);
  return [...games.values()].filter((g) => g.date && g.home_team && g.away_team);
}

// ── série por time ───────────────────────────────────────────────────────
type TeamObs = { t: number; v: Record<string, number | null> };

function buildTeamSeries(all: HistGame[]): Map<string, TeamObs[]> {
  const byTeam = new Map<string, TeamObs[]>();
  for (const g of all) {
    for (const [team, own] of [
      [g.home_team, "h"],
      [g.away_team, "a"],
    ] as const) {
      const v: Record<string, number | null> = {};
      for (const m of METRICS)
        v[m.key] = (g[own === "h" ? m.h : m.a] as number) ?? null;
      const arr = byTeam.get(team) ?? [];
      arr.push({ t: g.date, v });
      byTeam.set(team, arr);
    }
  }
  for (const a of byTeam.values()) a.sort((x, y) => x.t - y.t);
  return byTeam;
}

// ── backtest ─────────────────────────────────────────────────────────────
async function main() {
  const all = await collectHistory();
  const byTeam = buildTeamSeries(all);
  const sizes = [...byTeam.values()].map((a) => a.length).sort((a, b) => b - a);
  console.log(
    `times: ${byTeam.size} · jogos/time mediana ${sizes[Math.floor(sizes.length / 2)]} · máx ${sizes[0]}\n`,
  );

  for (const K of WINDOWS) {
    console.log("=".repeat(78));
    console.log(`JANELA = ${K} jogos anteriores`);
    console.log("=".repeat(78));

    for (const m of METRICS) {
      // linha de referência = mediana observada do total naquela liga
      const totals = new Map<string, number[]>();
      for (const g of all) {
        const h = g[m.h] as number | null;
        const a = g[m.a] as number | null;
        if (h == null || a == null) continue;
        const arr = totals.get(g.league) ?? [];
        arr.push(h + a);
        totals.set(g.league, arr);
      }
      const lineOf = new Map<string, number>();
      for (const [lg, arr] of totals) {
        const s = [...arr].sort((x, y) => x - y);
        lineOf.set(lg, s[Math.floor(s.length / 2)] + 0.5);
      }

      const calls: { s: number; over: boolean }[] = [];
      let overs = 0;
      let tot = 0;
      for (const g of all) {
        const h = g[m.h] as number | null;
        const a = g[m.a] as number | null;
        if (h == null || a == null) continue;
        const line = lineOf.get(g.league);
        if (line == null) continue;
        const prior = (team: string) =>
          (byTeam.get(team) ?? [])
            .filter((o) => o.t < g.date && o.v[m.key] != null)
            .slice(-K)
            .map((o) => o.v[m.key] as number);
        const ph = prior(g.home_team);
        const pa = prior(g.away_team);
        if (ph.length < K || pa.length < K) continue;
        tot++;
        const over = h + a > line;
        if (over) overs++;
        calls.push({ s: slope(ph) + slope(pa), over });
      }

      const baseRate = tot ? Math.max(overs / tot, 1 - overs / tot) : 0;
      const strength = calls.map((c) => Math.abs(c.s)).sort((x, y) => y - x);
      console.log(
        `\n  ${m.label}  (universo ${tot} jogos · taxa-base ${(baseRate * 100).toFixed(1)}%)`,
      );
      console.log("    corte de força        n     acerto   IC95              lift");
      for (const q of [1.0, 0.5, 0.25, 0.1, 0.05]) {
        const cut = strength[Math.max(0, Math.floor(strength.length * q) - 1)] ?? 0;
        const sel = calls.filter((c) => Math.abs(c.s) >= cut);
        const hit = sel.filter((c) => c.s > 0 === c.over).length;
        const acc = sel.length ? hit / sel.length : 0;
        const [lo, hi] = wilson(hit, sel.length);
        const lift = (acc - baseRate) * 100;
        const tag = q === 1.0 ? "todas" : `top ${(q * 100).toFixed(0)}% mais fortes`;
        console.log(
          `    ${tag.padEnd(22)}${String(sel.length).padStart(5)}   ${(acc * 100).toFixed(1)}%   ` +
            `[${(lo * 100).toFixed(1)}%-${(hi * 100).toFixed(1)}%]`.padEnd(18) +
            `${lift >= 0 ? "+" : ""}${lift.toFixed(1)}pp`,
        );
      }
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
