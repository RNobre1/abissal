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
import { fetchAllPages } from "@/lib/supabase/paginated-fetch";
import { heldOutGate, assertCronologico } from "@/lib/calibracao/held-out-gate";
import {
  SECONDARY_MARKETS,
  secondaryMetricKey,
  secondaryPred,
  secondaryObserved,
  secondaryMeanFromSimStats,
  type SecondaryActuals,
} from "@/lib/calibracao/secondary-fit";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SR) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SR, {
  auth: { persistSession: false },
});

interface ResolvedRow extends SecondaryActuals {
  model_version: string | null;
  actual_resolved_at: string | null;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  p_over_25: number | null;
  p_btts: number | null;
  actual_home_goals: number | null;
  actual_away_goals: number | null;
  actual_btts: boolean | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sim_stats: any | null;
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

// Gate out-of-sample: `heldOutGate`/`assertCronologico` vêm de
// `lib/calibracao/held-out-gate.ts` (compartilhado com `fit-dist.ts`) — exige
// amostra em ordem cronológica ASCENDENTE (mais antigo primeiro), porque o
// treino é o PREFIXO do array. Ver o cabeçalho do módulo para o porquê.

async function main() {
  // 1. fetch resolved sims — paginado: o PostgREST corta em POSTGREST_MAX_ROWS
  // (1.000) por resposta, qualquer que seja o .limit() pedido (ticket T1).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = supabase as unknown as { from: (t: string) => any };
  const SELECT_COLUMNS = [
    "model_version",
    "actual_resolved_at",
    "p_home", "p_draw", "p_away", "p_over_25", "p_btts",
    "actual_home_goals", "actual_away_goals", "actual_btts",
    // Secondary markets actuals
    "actual_corners_home", "actual_corners_away",
    "actual_cards_home", "actual_cards_away",
    "actual_sot_home", "actual_sot_away",
    // sim_stats for p50 means
    "sim_stats",
  ].join(", ");
  let rows: ResolvedRow[];
  try {
    // ASCENDENTE (mais antigo primeiro) — o gate treina no PREFIXO do array
    // e testa no restante; DESC treinaria no futuro e testaria no passado.
    rows = await fetchAllPages<ResolvedRow>((from, to) =>
      c
        .from("fixture_simulations")
        .select(SELECT_COLUMNS)
        .eq("status", "resolved")
        .order("actual_resolved_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (error) {
    console.error("query failed:", error);
    process.exit(1);
  }
  if (rows.length === 0) {
    console.error("no resolved sims; aborting fit");
    process.exit(0);
  }
  // Guarda em runtime: a ordem vem da query e o gate não consegue inferi-la —
  // uma ordem errada precisa falhar alto, não produzir veredito plausível.
  assertCronologico(rows, (r) => r.actual_resolved_at);
  // Agrupar por model_version
  const byVersion = new Map<string, ResolvedRow[]>();
  for (const r of rows) {
    if (!r.model_version) continue;
    const list = byVersion.get(r.model_version) ?? [];
    list.push(r);
    byVersion.set(r.model_version, list);
  }
  console.log(
    `[paginacao] ${rows.length} linhas lidas no total; por model_version: ` +
      Array.from(byVersion.entries())
        .map(([version, rowsV]) => `${version}=${rowsV.length}`)
        .join(", "),
  );

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

      // GATE OUT-OF-SAMPLE (29/07). Sem isto, uma curva overfitada é
      // persistida e passa a ser aplicada em produção mesmo sendo PIOR que
      // não calibrar nada. Foi o que aconteceu: medido num corte único
      // 70/30 (n_test=865), as curvas ativas de over25 e btts estavam piores
      // que o raw (over25 .6944 vs .6925; btts .6984 vs .6970), exatamente o
      // overfit que a lição B34 previa abaixo de ~500 pontos.
      //
      // A curva só é persistida se BATER o raw em dado que ela não viu, por
      // MAIORIA de vários cortes (`lib/calibracao/held-out-gate.ts`) — e a
      // amostra tem que estar em ordem cronológica ascendente, garantida
      // acima por `assertCronologico`. Quando não bate, a curva ativa é
      // aposentada e o mercado passa a depender só do temperature scaling —
      // que é validado out-of-sample.
      const gate = heldOutGate(pairs);
      if (!gate.keep) {
        console.log(
          `[reject] ${version} ${metric}: curva PIOR que raw no held-out ` +
            `(${gate.curved.toFixed(4)} vs ${gate.raw.toFixed(4)}, n_test=${gate.nTest}) — aposentando a ativa`,
        );
        await c
          .from("model_calibration")
          .update({ effective_until: new Date().toISOString() })
          .eq("model_version", version)
          .eq("metric", metric)
          .is("effective_until", null);
        continue;
      }
      console.log(
        `[gate ok] ${version} ${metric}: ${gate.curved.toFixed(4)} vs raw ${gate.raw.toFixed(4)} (n_test=${gate.nTest})`,
      );

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

    // ── Secondary markets (corners / cards / SOT) ──────────────────────────
    // For each stat × line, fit over + under separately (asymmetric calibration
    // — same rationale as over25/over25-under, btts/btts-nao above).
    for (const { stat, line, label } of SECONDARY_MARKETS) {
      for (const side of ["over", "under"] as const) {
        const metricKey = secondaryMetricKey(stat, side, label);
        const pairs: Array<[number, number]> = [];

        for (const r of rowsV) {
          // Derive Poisson mean from sim_stats p50 (home+away)
          const mean = secondaryMeanFromSimStats(r.sim_stats, stat);
          if (mean === null) continue;

          const pred = secondaryPred(mean, line, side);
          if (!Number.isFinite(pred)) continue;

          const obs = secondaryObserved(stat, line, side, r);
          if (obs === null) continue;

          pairs.push([pred, obs]);
        }

        if (pairs.length < 30) {
          console.log(`[skip] ${version} ${metricKey}: only ${pairs.length} samples (need ≥30)`);
          continue;
        }

        const curve = fitIsotonic(pairs);

        // Mark previous active as expired
        await c
          .from("model_calibration")
          .update({ effective_until: new Date().toISOString() })
          .eq("model_version", version)
          .eq("metric", metricKey)
          .is("effective_until", null);

        // Insert new active
        const { error: insErr2 } = await c.from("model_calibration").insert({
          metric: metricKey,
          model_version: version,
          pairs: curve,
          n: pairs.length,
        });
        if (insErr2) {
          console.error(`[fail] ${version} ${metricKey}:`, insErr2);
        } else {
          console.log(`[ok] ${version} ${metricKey}: ${pairs.length} samples, ${curve.length} curve points`);
        }
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
