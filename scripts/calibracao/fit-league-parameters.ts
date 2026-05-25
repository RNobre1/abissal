#!/usr/bin/env tsx
/**
 * Ajusta parâmetros por liga via Method of Moments sobre as resolvidas
 * em prod e upserta em `league_parameters`. Executar manualmente:
 *
 *   pnpm exec tsx scripts/calibracao/fit-league-parameters.ts
 *
 * Futuro (F4-cron): cron mensal via GitHub Actions.
 *
 * Atomicidade por (liga, param):
 *   1. UPDATE marca todas as linhas ativas dessa (liga, param) como
 *      effective_until = now().
 *   2. INSERT nova linha com effective_from = now(), effective_until = NULL.
 */
import { createClient } from "@supabase/supabase-js";
import {
  fitLeagueParams,
  type LeagueParams,
  type ResolvedSample,
} from "@/lib/calibracao/league-params";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SR) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env",
  );
  process.exit(1);
}

const FIT_VERSION = "fit-mom-v1";

/**
 * Ligas que rodam calibração com threshold relaxado (20 amostras em vez
 * de 30). Lista alinhada com `SCRAPER_LEAGUE_SLUGS` do scraper (ligas
 * principais que o Pilot prioriza). Calibrações com n < 30 ainda são
 * úteis (melhores que NEUTRAL_BASELINE), mas marcadas com
 * `low_confidence: true` na lib → UI sinaliza badge.
 *
 * Nomes devem bater EXATAMENTE com `fixture_simulations.league` (que vem
 * da listagem do choistats). Lista validada via query SQL antes do commit.
 */
const PRIORITY_LEAGUES: ReadonlyMap<string, number> = new Map([
  // Nomes EXATOS conforme aparecem em fixture_simulations.league (vindo
  // do choistats listing). Nomes não-existentes no DB são no-ops.
  ["Major League Soccer", 20],
  ["Premier League", 20],
  ["La Liga", 20],
  ["Serie A", 20],
  ["Tipico Bundesliga", 20],
  ["Ligue 1", 20],
  // Brasileirão (Série A/B/C) — adicionar quando aparecerem no DB
  ["Brasileiro", 20],
  ["Brasileiro Serie B", 20],
  // Portugal — adicionar quando aparecerem
  ["Liga Portugal", 20],
  ["Primeira Liga", 20],
]);

const supabase = createClient(URL, SR, { auth: { persistSession: false } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as { from: (t: string) => any };

interface ResolvedRow {
  league: string | null;
  actual_home_goals: number | null;
  actual_away_goals: number | null;
}

async function main() {
  const { data, error } = await sb
    .from("fixture_simulations")
    .select("league, actual_home_goals, actual_away_goals")
    .eq("status", "resolved")
    .limit(50000);
  if (error) {
    console.error("query failed:", error);
    process.exit(1);
  }
  const samples: ResolvedSample[] = ((data ?? []) as ResolvedRow[])
    .filter(
      (r) =>
        r.league && r.actual_home_goals != null && r.actual_away_goals != null,
    )
    .map((r) => ({
      league: r.league as string,
      home_goals: Number(r.actual_home_goals),
      away_goals: Number(r.actual_away_goals),
    }));

  if (samples.length === 0) {
    console.error("no resolved samples; aborting");
    process.exit(0);
  }

  const fits = fitLeagueParams(samples, 30, {
    priorityLeagues: PRIORITY_LEAGUES,
  });
  if (fits.length === 0) {
    console.log(
      "no leagues passing thresholds (default 30, prioritárias 20); nothing to fit",
    );
    return;
  }

  for (const f of fits) {
    await upsertLeague(f);
    const flag = f.low_confidence ? "  ⚠ low_confidence" : "";
    console.log(
      `[ok] ${f.league}: n=${f.n}, home=${f.avg_goals_home.toFixed(3)}, away=${f.avg_goals_away.toFixed(3)}, rho=${f.rho.toFixed(4)}${flag}`,
    );
  }
}

async function upsertLeague(p: LeagueParams) {
  const PARAMS: Array<{ key: keyof LeagueParams; param: string }> = [
    { key: "rho", param: "rho" },
    { key: "avg_goals_for", param: "avg_goals_for" },
    { key: "avg_goals_ag", param: "avg_goals_ag" },
    { key: "avg_goals_home", param: "avg_goals_home" },
    { key: "avg_goals_away", param: "avg_goals_away" },
  ];
  const now = new Date().toISOString();
  for (const { key, param } of PARAMS) {
    // mark previous active as expired
    await sb
      .from("league_parameters")
      .update({ effective_until: now })
      .eq("league", p.league)
      .eq("param", param)
      .is("effective_until", null);
    // insert new active
    const { error: insErr } = await sb.from("league_parameters").insert({
      league: p.league,
      param,
      value: Number(p[key]),
      model_version: FIT_VERSION,
      effective_from: now,
      n: p.n,
    });
    if (insErr) {
      console.error(`[fail] ${p.league} ${param}:`, insErr);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
