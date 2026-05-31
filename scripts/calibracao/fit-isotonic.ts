#!/usr/bin/env tsx
/**
 * Ajusta curvas isotônicas (PAV) sobre as simulações resolvidas em prod
 * e upserta em `model_calibration`. Executar manualmente:
 *
 *   pnpm exec tsx scripts/calibracao/fit-isotonic.ts
 *
 * Futuro: cron mensal via GitHub Actions.
 */
import { createClient } from "@supabase/supabase-js";
import { fitIsotonic } from "@/lib/calibracao/isotonic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SR) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SR, {
  auth: { persistSession: false },
});

interface ResolvedRow {
  model_version: string | null;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  p_over_25: number | null;
  p_btts: number | null;
  actual_home_goals: number | null;
  actual_away_goals: number | null;
  actual_btts: boolean | null;
}

// Binary metrics suitable for isotonic calibration (PAV).
// COUNT metrics (corners, cards, SOT) are evaluated via CRPS — see sim-reliability.ts.
// Rationale: isotonic regression calibrates P(event) → observed frequency, which
// requires a binary outcome. Count distributions need CRPS/CORP decomposition.
// over25-under e btts-nao ganham curva PRÓPRIA (não 1 − cal_over): a calibração
// é ASSIMÉTRICA (a IA acertava over25-over mas dava 1/18 no under). PAV sobre
// (1 − p) vs outcome-do-under ≠ 1 − PAV(p, outcome-do-over).
type Metric =
  | "1x2-home"
  | "1x2-draw"
  | "1x2-away"
  | "over25"
  | "over25-under"
  | "btts"
  | "btts-nao";

function observedFor(metric: Metric, hg: number, ag: number, row: ResolvedRow): 0 | 1 {
  switch (metric) {
    case "1x2-home": return hg > ag ? 1 : 0;
    case "1x2-draw": return hg === ag ? 1 : 0;
    case "1x2-away": return hg < ag ? 1 : 0;
    case "over25": return hg + ag > 2.5 ? 1 : 0;
    case "over25-under": return hg + ag <= 2.5 ? 1 : 0;
    case "btts": {
      // Prefer actual_btts column; fall back to deriving from goals.
      if (row.actual_btts != null) return row.actual_btts ? 1 : 0;
      return hg > 0 && ag > 0 ? 1 : 0;
    }
    case "btts-nao": {
      if (row.actual_btts != null) return row.actual_btts ? 0 : 1;
      return hg > 0 && ag > 0 ? 0 : 1;
    }
  }
}

function predFor(metric: Metric, r: ResolvedRow): number | null {
  switch (metric) {
    case "1x2-home": return r.p_home;
    case "1x2-draw": return r.p_draw;
    case "1x2-away": return r.p_away;
    case "over25": return r.p_over_25;
    case "over25-under": return r.p_over_25 == null ? null : 1 - r.p_over_25;
    case "btts": return r.p_btts;
    case "btts-nao": return r.p_btts == null ? null : 1 - r.p_btts;
  }
}

async function main() {
  // 1. fetch resolved sims
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = supabase as unknown as { from: (t: string) => any };
  const { data, error } = await c
    .from("fixture_simulations")
    .select("model_version, p_home, p_draw, p_away, p_over_25, p_btts, actual_home_goals, actual_away_goals, actual_btts")
    .eq("status", "resolved")
    .order("actual_resolved_at", { ascending: false })
    .limit(5000);
  if (error) {
    console.error("query failed:", error);
    process.exit(1);
  }
  const rows = (data ?? []) as ResolvedRow[];
  if (rows.length === 0) {
    console.error("no resolved sims; aborting fit");
    process.exit(0);
  }
  // Agrupar por model_version
  const byVersion = new Map<string, ResolvedRow[]>();
  for (const r of rows) {
    if (!r.model_version) continue;
    const list = byVersion.get(r.model_version) ?? [];
    list.push(r);
    byVersion.set(r.model_version, list);
  }

  const metrics: Metric[] = [
    "1x2-home",
    "1x2-draw",
    "1x2-away",
    "over25",
    "over25-under",
    "btts",
    "btts-nao",
  ];
  for (const [version, rowsV] of byVersion.entries()) {
    for (const metric of metrics) {
      const pairs: Array<[number, number]> = [];
      for (const r of rowsV) {
        const p = predFor(metric, r);
        if (p == null || !Number.isFinite(p)) continue;
        if (r.actual_home_goals == null || r.actual_away_goals == null) continue;
        pairs.push([p, observedFor(metric, r.actual_home_goals, r.actual_away_goals, r)]);
      }
      if (pairs.length < 30) {
        console.log(`[skip] ${version} ${metric}: only ${pairs.length} samples (need ≥30)`);
        continue;
      }
      const curve = fitIsotonic(pairs);

      // Mark previous active as expired
      await c
        .from("model_calibration")
        .update({ effective_until: new Date().toISOString() })
        .eq("model_version", version)
        .eq("metric", metric)
        .is("effective_until", null);

      // Insert new active
      const { error: insErr } = await c.from("model_calibration").insert({
        metric,
        model_version: version,
        pairs: curve,
        n: pairs.length,
      });
      if (insErr) {
        console.error(`[fail] ${version} ${metric}:`, insErr);
      } else {
        console.log(`[ok] ${version} ${metric}: ${pairs.length} samples, ${curve.length} curve points`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
