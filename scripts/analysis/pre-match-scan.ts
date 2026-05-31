#!/usr/bin/env tsx
/**
 * Scans pré-jogo sob demanda (usados pelos agentes do projeto):
 *
 *   pnpm exec tsx scripts/analysis/pre-match-scan.ts --metric duplo-green [--date YYYY-MM-DD] [--limit 10]
 *   pnpm exec tsx scripts/analysis/pre-match-scan.ts --metric corners     [--date YYYY-MM-DD] [--limit 10]
 *
 * Rankeia os jogos do dia pelos ESCALARES da simulação (migration 0046),
 * NÃO pelos edges da IA. Anexa um sidecar EMPÍRICO (base-rate das partidas
 * recentes) só de conferência. Fonte: Supabase prod via service_role
 * (mesmo padrão de scripts/calibracao/*). Read-only.
 *
 * Duas fases: (1) rankeia lendo só escalares leves de `fixture_simulations`;
 * (2) busca `detail_json` apenas do top-N pro empírico (evita arrastar o blob
 * pesado de todos os ~130 jogos do dia).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { deriveRecentMatchStats } from "@/lib/fixtures/stats/derive";
import {
  corners2PlusBothHalvesRate,
  blewHalftime2LeadRate,
} from "@/lib/fixtures/stats/empirical-halves";
import {
  rankDuploGreen,
  rankCornersBothHalves,
  scanKey,
  type ScanFixture,
  type DuploGreenSidecar,
  type CornersSidecar,
  type RankedScan,
} from "@/lib/analysis/pre-match-scan";

// ── env (.env.local fallback — sem dependência de dotenv) ────────────────
function ensureEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const mt = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (mt && !process.env[mt[1]]) process.env[mt[1]] = mt[2];
    }
  } catch {
    /* sem .env.local — assume env já exportado */
  }
}
ensureEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SR) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no env (.env.local).");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SR, { auth: { persistSession: false } });

// ── args ─────────────────────────────────────────────────────────────────
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const metric = (arg("metric") || "").toLowerCase();
if (metric !== "duplo-green" && metric !== "corners") {
  console.error("Use --metric duplo-green | corners");
  process.exit(1);
}
const date = arg("date") || new Date().toISOString().slice(0, 10); // hoje UTC
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`--date inválida: ${date} (use YYYY-MM-DD)`);
  process.exit(1);
}
const limit = Number(arg("limit") || "10");
const upcomingOnly = process.argv.includes("--upcoming");

const dayStart = `${date}T00:00:00Z`;
const dayEnd = `${date}T23:59:59.999Z`;
// `--upcoming`: só jogos ainda não iniciados (scan pré-jogo). Limite inferior =
// max(início do dia, agora). Em datas futuras `now < dayStart` ⇒ pega o dia todo.
const nowIso = new Date().toISOString();
const lowerBound = upcomingOnly && nowIso > dayStart ? nowIso : dayStart;

function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}
function side(r: { made: number; eligible: number; rate: number | null }): string {
  return r.rate === null ? "—" : `${r.made}/${r.eligible} (${Math.round(r.rate * 100)}%)`;
}

async function main() {
  // Fase 1 — escalares leves de fixture_simulations do dia.
  const { data: simRows, error: simErr } = await supabase
    .from("fixture_simulations")
    .select(
      "fixture_id, home_team, away_team, league, kickoff_utc, model_version, created_at, " +
        "per_half_available, p_duplo_green, p_duplo_green_home, p_duplo_green_away, " +
        "p_both_2corners_both_halves",
    )
    .gte("kickoff_utc", lowerBound)
    .lt("kickoff_utc", dayEnd)
    .order("created_at", { ascending: false });
  if (simErr) {
    console.error("Erro lendo fixture_simulations:", simErr.message);
    process.exit(1);
  }

  // Dedupe: linha mais recente por jogo (created_at desc já garante a 1ª).
  const latest = new Map<string, ScanFixture>();
  for (const r of (simRows ?? []) as unknown as Array<Record<string, unknown>>) {
    const key = scanKey({
      homeTeam: String(r.home_team),
      awayTeam: String(r.away_team),
      kickoffUtc: (r.kickoff_utc as string | null) ?? null,
    });
    if (latest.has(key)) continue; // 1ª = mais recente
    latest.set(key, {
      fixtureId: r.fixture_id == null ? null : Number(r.fixture_id),
      homeTeam: String(r.home_team),
      awayTeam: String(r.away_team),
      league: (r.league as string | null) ?? null,
      kickoffUtc: (r.kickoff_utc as string | null) ?? null,
      perHalfAvailable: r.per_half_available === true,
      pDuploGreen: numOrNull(r.p_duplo_green),
      pDuploGreenHome: numOrNull(r.p_duplo_green_home),
      pDuploGreenAway: numOrNull(r.p_duplo_green_away),
      pBoth2CornersBothHalves: numOrNull(r.p_both_2corners_both_halves),
    });
  }
  const fixtures = [...latest.values()];

  if (metric === "duplo-green") {
    const ranked = rankDuploGreen(fixtures, new Map(), limit);
    await attachSidecars(ranked, "duplo-green");
    printDuploGreen(ranked);
  } else {
    const ranked = rankCornersBothHalves(fixtures, new Map(), limit);
    await attachSidecars(ranked, "corners");
    printCorners(ranked);
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Fase 2 — busca detail_json só dos jogos rankeados e computa o empírico.
async function attachSidecars(
  ranked: Array<RankedScan<unknown>>,
  kind: "duplo-green" | "corners",
) {
  if (ranked.length === 0) return;
  const homes = ranked.map((r) => r.fixture.homeTeam);
  const aways = ranked.map((r) => r.fixture.awayTeam);
  const { data: fxRows } = await supabase
    .from("fixtures")
    .select("home_team, away_team, kickoff_utc, detail_json")
    .gte("kickoff_utc", dayStart)
    .lt("kickoff_utc", dayEnd)
    .in("home_team", homes)
    .in("away_team", aways);

  const byKey = new Map<string, Record<string, unknown>>();
  for (const fx of (fxRows ?? []) as unknown as Array<Record<string, unknown>>) {
    const key = scanKey({
      homeTeam: String(fx.home_team),
      awayTeam: String(fx.away_team),
      kickoffUtc: (fx.kickoff_utc as string | null) ?? null,
    });
    byKey.set(key, fx as Record<string, unknown>);
  }

  for (const r of ranked) {
    const fx = byKey.get(scanKey(r.fixture));
    const detail = fx?.detail_json as
      | { recent_matches?: { home?: unknown; away?: unknown } }
      | undefined;
    if (!detail?.recent_matches) continue;
    const home = deriveRecentMatchStats(
      detail.recent_matches.home,
      detail.recent_matches.home,
      r.fixture.homeTeam,
    );
    const away = deriveRecentMatchStats(
      detail.recent_matches.away,
      detail.recent_matches.away,
      r.fixture.awayTeam,
    );
    if (kind === "duplo-green") {
      (r as RankedScan<DuploGreenSidecar>).sidecar = {
        home: blewHalftime2LeadRate(home),
        away: blewHalftime2LeadRate(away),
      };
    } else {
      (r as RankedScan<CornersSidecar>).sidecar = {
        home: corners2PlusBothHalvesRate(home),
        away: corners2PlusBothHalvesRate(away),
      };
    }
  }
}

function header(title: string, n: number) {
  console.log(`\n${title} — ${date}${upcomingOnly ? " (próximos)" : ""} (top ${n})\n`);
}

function printDuploGreen(ranked: Array<RankedScan<DuploGreenSidecar>>) {
  header("DUPLO GREEN (abrir +2 e não vencer)", ranked.length);
  if (ranked.length === 0) {
    console.log("Nenhum jogo com simulação para a data (ou escalar não computado).");
    return;
  }
  ranked.forEach((r, i) => {
    const f = r.fixture;
    const ko = (f.kickoffUtc ?? "").slice(11, 16);
    const sc = r.sidecar;
    const emp = sc
      ? `  [HT parcial — abriu 2 e não venceu: casa ${side(sc.home)} · fora ${side(sc.away)}]`
      : "";
    console.log(
      `${String(i + 1).padStart(2)}. ${pct(r.prob).padStart(6)}  ${f.homeTeam} x ${f.awayTeam}` +
        `  (${f.league ?? "?"}, ${ko} UTC)  [casa ${pct(f.pDuploGreenHome)} · fora ${pct(f.pDuploGreenAway)}]${emp}`,
    );
  });
}

function printCorners(ranked: Array<RankedScan<CornersSidecar>>) {
  header("ESCANTEIOS — ambos os times 2+ em ambos os tempos", ranked.length);
  if (ranked.length === 0) {
    console.log("Nenhum jogo com simulação por-tempo para a data (per_half_available/escalar ausente).");
    return;
  }
  ranked.forEach((r, i) => {
    const f = r.fixture;
    const ko = (f.kickoffUtc ?? "").slice(11, 16);
    const sc = r.sidecar;
    const emp = sc
      ? `  [empírico 2+/2+ (~53% fill): casa ${side(sc.home)} · fora ${side(sc.away)}]`
      : "";
    console.log(
      `${String(i + 1).padStart(2)}. ${pct(r.prob).padStart(6)}  ${f.homeTeam} x ${f.awayTeam}` +
        `  (${f.league ?? "?"}, ${ko} UTC)${emp}`,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
