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
 * Threshold mínimo de amostras resolvidas por liga.
 *
 * **Universal a partir de 2026-05-25**: substitui o `PRIORITY_LEAGUES`
 * hardcoded (5 ligas) por discovery dinâmico — qualquer liga com n >=
 * MIN_SAMPLES é calibrada, sem allowlist. Motivação: o IA-2 estava
 * gerando edges absurdos (>100%) em ligas como Eliteserien, K League 2,
 * Botola Pro etc. porque os sims usavam o NEUTRAL_BASELINE no lugar de
 * parâmetros próprios. A whitelist hardcoded era o gargalo.
 *
 * Quem fica abaixo de STRICT_THRESHOLD (30) é calibrado mesmo assim mas
 * recebe `low_confidence: true` (a UI já consome esse flag pra mostrar
 * badge). Quem fica abaixo de MIN_SAMPLES (20) é pulado silenciosamente
 * — manteremos NEUTRAL_BASELINE até acumular amostras suficientes.
 */
const MIN_SAMPLES = 20;

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

  const fits = fitLeagueParams(samples, MIN_SAMPLES);
  if (fits.length === 0) {
    console.log(
      `no leagues passing threshold (n >= ${MIN_SAMPLES}); nothing to fit`,
    );
    return;
  }

  console.log(
    `discovered ${fits.length} eligible leagues (universal threshold n >= ${MIN_SAMPLES}); fitting...`,
  );
  let highConfidence = 0;
  let lowConfidence = 0;
  for (const f of fits) {
    await upsertLeague(f);
    const flag = f.low_confidence ? "  ⚠ low_confidence" : "";
    if (f.low_confidence) lowConfidence += 1;
    else highConfidence += 1;
    console.log(
      `[ok] ${f.league}: n=${f.n}, home=${f.avg_goals_home.toFixed(3)}, away=${f.avg_goals_away.toFixed(3)}, rho=${f.rho.toFixed(4)}${flag}`,
    );
  }
  console.log(
    `\nsummary: ${highConfidence} high-confidence + ${lowConfidence} low-confidence = ${fits.length} total`,
  );
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
