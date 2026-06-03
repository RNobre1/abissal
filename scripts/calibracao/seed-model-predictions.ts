#!/usr/bin/env tsx
/**
 * seed-model-predictions — popula `model_predictions` com as predições do
 * CHAMPION a partir de `fixture_simulations`.
 *
 * Uso:
 *   pnpm exec tsx scripts/calibracao/seed-model-predictions.ts
 *   pnpm exec tsx scripts/calibracao/seed-model-predictions.ts --dry
 *
 * Idempotente: upsert em (fixture_id, model_version, market).
 * Degrada gracioso se a migration 0049 não estiver aplicada (catch → exit 0).
 *
 * IMPORTANTE: usa HTTPS/PostgREST — pg TCP 5432 bloqueado (B30).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- script CLI: shapes dinâmicos do PostgREST/jsonb */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  logLoss,
  brier,
  rps1x2Score,
  type Probs1x2,
  type Outcome1x2,
} from "@/lib/calibracao/prediction-scoring";
import { crpsFromPercentiles } from "@/lib/calibracao/crps";
import { nbLogLoss } from "@/lib/calibracao/negbin";

// ── Env ────────────────────────────────────────────────────────────────────────

function ensureEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* env já exportado */
  }
}
ensureEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "[seed-model-predictions] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados — abortando.",
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
}) as any;

// ── CLI args ───────────────────────────────────────────────────────────────────

const isDry = process.argv.includes("--dry");
const PAGE_SIZE = 1000;
const UPSERT_BATCH = 500;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extrai p50 de um lado (home/away) e stat do sim_stats jsonb. */
function extractP50(simStats: any, side: "home" | "away", stat: string): number | null {
  const val = simStats?.[side]?.[stat]?.p50;
  return typeof val === "number" && Number.isFinite(val) ? val : null;
}

/** Deriva o result 1x2 a partir dos gols reais. */
function deriveResult(homeGoals: number, awayGoals: number): "home" | "draw" | "away" {
  if (homeGoals > awayGoals) return "home";
  if (homeGoals < awayGoals) return "away";
  return "draw";
}

interface PredictionRow {
  fixture_id: number;
  model_version: string;
  is_champion: true;
  market: string;
  probs: any;
  outcome: any | null;
  log_loss: number | null;
  brier: number | null;
  rps: number | null;
  crps: number | null;
  closing_log_loss: null;
  resolved_at: string | null;
}

/** Constrói as linhas de predição para uma simulação. `countR` = dispersão NB
 *  (size r) por stat de contagem (cards/corners/sot), fitada held-out — o
 *  champion de contagem usa NB (fiel à produção), não Poisson. */
function buildPredictionRows(sim: any, countR: Record<string, number>): PredictionRow[] {
  const {
    fixture_id,
    model_version,
    p_home,
    p_draw,
    p_away,
    p_over_25,
    p_btts,
    top_scorelines,
    sim_stats,
    status,
    actual_home_goals: ahg,
    actual_away_goals: aag,
    actual_corners_home: ach,
    actual_corners_away: aca,
    actual_cards_home: adh,
    actual_cards_away: ada,
    actual_sot_home: ash,
    actual_sot_away: asa,
    actual_resolved_at,
  } = sim;

  const isResolved = status === "resolved";
  const rows: PredictionRow[] = [];

  // Helper para criar linha com scores opcionais
  function makeRow(
    market: string,
    probs: any,
    outcomeData: any | null,
    llVal: number | null,
    brierVal: number | null,
    rpsVal: number | null,
    crpsVal: number | null,
  ): PredictionRow {
    return {
      fixture_id: Number(fixture_id),
      model_version: model_version ?? "unknown",
      is_champion: true,
      market,
      probs,
      outcome: outcomeData,
      log_loss: llVal,
      brier: brierVal,
      rps: rpsVal,
      crps: crpsVal,
      closing_log_loss: null,
      resolved_at: actual_resolved_at ?? null,
    };
  }

  // ── 1x2 ────────────────────────────────────────────────────────────────────

  if (p_home != null && p_draw != null && p_away != null) {
    const probs1x2: Probs1x2 = { home: Number(p_home), draw: Number(p_draw), away: Number(p_away) };

    let outcome1x2: Outcome1x2 | null = null;
    let ll: number | null = null;
    let br: number | null = null;
    let rps: number | null = null;

    if (isResolved && ahg != null && aag != null) {
      const result = deriveResult(Number(ahg), Number(aag));
      outcome1x2 = { result };
      ll = logLoss("1x2", probs1x2, outcome1x2);
      br = brier("1x2", probs1x2, outcome1x2);
      rps = rps1x2Score(probs1x2, outcome1x2);
    }

    rows.push(makeRow("1x2", probs1x2, outcome1x2, ll, br, rps, null));
  }

  // ── over25 ─────────────────────────────────────────────────────────────────

  if (p_over_25 != null) {
    const probsOver = { over: Number(p_over_25), under: 1 - Number(p_over_25) };

    let outcomeOver: { over: boolean } | null = null;
    let ll: number | null = null;
    let br: number | null = null;

    if (isResolved && ahg != null && aag != null) {
      outcomeOver = { over: Number(ahg) + Number(aag) > 2.5 };
      ll = logLoss("over25", probsOver, outcomeOver);
      br = brier("over25", probsOver, outcomeOver);
    }

    rows.push(makeRow("over25", probsOver, outcomeOver, ll, br, null, null));
  }

  // ── btts ───────────────────────────────────────────────────────────────────

  if (p_btts != null) {
    const probsBtts = { sim: Number(p_btts), nao: 1 - Number(p_btts) };

    let outcomeBtts: { btts: boolean } | null = null;
    let ll: number | null = null;
    let br: number | null = null;

    if (isResolved && ahg != null && aag != null) {
      outcomeBtts = { btts: Number(ahg) > 0 && Number(aag) > 0 };
      ll = logLoss("btts", probsBtts, outcomeBtts);
      br = brier("btts", probsBtts, outcomeBtts);
    }

    rows.push(makeRow("btts", probsBtts, outcomeBtts, ll, br, null, null));
  }

  // ── scoreline ──────────────────────────────────────────────────────────────

  if (Array.isArray(top_scorelines) && top_scorelines.length > 0) {
    const probsScoreline = top_scorelines;

    let outcomeScoreline: { score: string } | null = null;
    let ll: number | null = null;

    if (isResolved && ahg != null && aag != null) {
      outcomeScoreline = { score: `${Number(ahg)}-${Number(aag)}` };
      ll = logLoss("scoreline", probsScoreline, outcomeScoreline);
    }

    rows.push(makeRow("scoreline", probsScoreline, outcomeScoreline, ll, null, null, null));
  }

  // ── corners / cards / sot ─────────────────────────────────────────────────

  const countMarkets: Array<{
    market: "corners" | "cards" | "sot";
    simKey: string;
    actualHome: number | null;
    actualAway: number | null;
    // percentis para CRPS
    actualHomeP10Key?: string;
    actualHomeP90Key?: string;
  }> = [
    {
      market: "corners",
      simKey: "corners",
      actualHome: ach != null ? Number(ach) : null,
      actualAway: aca != null ? Number(aca) : null,
    },
    {
      market: "cards",
      simKey: "cards",
      actualHome: adh != null ? Number(adh) : null,
      actualAway: ada != null ? Number(ada) : null,
    },
    {
      market: "sot",
      simKey: "sot",
      actualHome: ash != null ? Number(ash) : null,
      actualAway: asa != null ? Number(asa) : null,
    },
  ];

  for (const cm of countMarkets) {
    const homeP50 = extractP50(sim_stats, "home", cm.simKey);
    const awayP50 = extractP50(sim_stats, "away", cm.simKey);

    if (homeP50 === null || awayP50 === null) continue; // sem dados de simulação

    const mean = homeP50 + awayP50;
    // Champion de contagem = Negative Binomial (fiel à produção, que é over-disp),
    // NÃO Poisson. r fitado held-out (countR); r grande → Poisson.
    const r = countR[cm.market] ?? 1e7;
    const probsCount = { mean, r };

    let outcomeCount: { total: number } | null = null;
    let ll: number | null = null;
    let crpsVal: number | null = null;

    if (isResolved && cm.actualHome !== null && cm.actualAway !== null) {
      const total = cm.actualHome + cm.actualAway;
      outcomeCount = { total };
      ll = nbLogLoss(mean, r, total);

      // CRPS via percentis do sim_stats (p10/p50/p90 do total home+away)
      const homeP10 = sim_stats?.home?.[cm.simKey]?.p10;
      const homeP90 = sim_stats?.home?.[cm.simKey]?.p90;
      const awayP10 = sim_stats?.away?.[cm.simKey]?.p10;
      const awayP90 = sim_stats?.away?.[cm.simKey]?.p90;
      const awayP50Val = awayP50; // já calculado

      if (
        typeof homeP10 === "number" &&
        typeof homeP90 === "number" &&
        typeof awayP10 === "number" &&
        typeof awayP90 === "number"
      ) {
        // Soma os percentis (aproximação conservadora para a soma de dois Poisson)
        crpsVal = crpsFromPercentiles(
          { p10: homeP10 + awayP10, p50: homeP50 + awayP50Val, p90: homeP90 + awayP90 },
          total,
        );
      }
    }

    rows.push(makeRow(cm.market, probsCount, outcomeCount, ll, null, null, crpsVal));
  }

  return rows;
}

// ── Paginação ─────────────────────────────────────────────────────────────────

async function fetchAllSimulations(): Promise<any[]> {
  const all: any[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await sb
      .from("fixture_simulations")
      .select(
        [
          "fixture_id",
          "model_version",
          "status",
          "p_home",
          "p_draw",
          "p_away",
          "p_over_25",
          "p_btts",
          "top_scorelines",
          "sim_stats",
          "actual_home_goals",
          "actual_away_goals",
          "actual_corners_home",
          "actual_corners_away",
          "actual_cards_home",
          "actual_cards_away",
          "actual_sot_home",
          "actual_sot_away",
          "actual_resolved_at",
        ].join(", "),
      )
      .range(from, from + PAGE_SIZE - 1)
      .order("fixture_id", { ascending: true });

    if (error) {
      throw new Error(`[seed-model-predictions] Erro ao buscar fixture_simulations: ${error.message}`);
    }

    const rows = (data ?? []) as any[];
    all.push(...rows);

    if (rows.length < PAGE_SIZE) break; // última página
    from += PAGE_SIZE;
  }

  return all;
}

// ── Upsert em lotes ───────────────────────────────────────────────────────────

async function upsertBatch(rows: PredictionRow[]): Promise<void> {
  if (rows.length === 0) return;

  const { error } = await sb
    .from("model_predictions")
    .upsert(rows, { onConflict: "fixture_id,model_version,market" });

  if (error) {
    throw new Error(`[seed-model-predictions] Erro no upsert: ${error.message}`);
  }
}

/**
 * Dedup: mantém 1 sim por (fixture_id, model_version). O fixture_simulations tem
 * múltiplas linhas por jogo (re-sims/scrapes) → sem dedup, o upsert estoura com
 * "ON CONFLICT cannot affect row a second time". Preferência: resolvida > pendente;
 * entre iguais, a de actual_resolved_at mais recente.
 */
function dedupeSims(sims: any[]): any[] {
  const best = new Map<string, any>();
  for (const s of sims) {
    const key = `${s.fixture_id}::${s.model_version}`;
    const cur = best.get(key);
    if (!cur) {
      best.set(key, s);
      continue;
    }
    const sResolved = s.status === "resolved";
    const cResolved = cur.status === "resolved";
    if (sResolved !== cResolved) {
      if (sResolved) best.set(key, s);
      continue;
    }
    if ((s.actual_resolved_at ?? "") > (cur.actual_resolved_at ?? "")) best.set(key, s);
  }
  return [...best.values()];
}

/**
 * Versão ATIVA (champion) = a model_version da sim com `actual_resolved_at` mais
 * recente; fallback = a mais frequente. Garante 1 champion único (não mistura
 * v2 antiga com v7 ativa).
 */
function activeChampionVersion(sims: any[]): string | null {
  let latest: { v: string; t: string } | null = null;
  const freq = new Map<string, number>();
  for (const s of sims) {
    const v = s.model_version;
    if (!v) continue;
    freq.set(v, (freq.get(v) ?? 0) + 1);
    const t = s.actual_resolved_at;
    if (t && (!latest || t > latest.t)) latest = { v, t };
  }
  if (latest) return latest.v;
  let bestV: string | null = null;
  let bestN = -1;
  for (const [v, n] of freq) if (n > bestN) { bestN = n; bestV = v; }
  return bestV;
}

/**
 * Fita a dispersão NB (size r) de um stat de contagem, HELD-OUT: ordena os sims
 * resolvidos por actual_resolved_at, fita r no TREINO (70% antigo) por grid-search
 * minimizando log-loss NB. r grande ⇒ Poisson. Mantém o champion honesto
 * (calibração mecânica, não overfit — 1 parâmetro, B24).
 */
function fitCountR(sims: any[], stat: string): number {
  const pts: Array<{ mean: number; total: number; t: string }> = [];
  for (const s of sims) {
    if (s.status !== "resolved") continue;
    const hp = s.sim_stats?.home?.[stat]?.p50;
    const ap = s.sim_stats?.away?.[stat]?.p50;
    const ah = s[`actual_${stat}_home`];
    const aa = s[`actual_${stat}_away`];
    if (typeof hp !== "number" || typeof ap !== "number" || ah == null || aa == null) continue;
    pts.push({ mean: hp + ap, total: Number(ah) + Number(aa), t: s.actual_resolved_at ?? "" });
  }
  if (pts.length < 40) return 1e7; // pouco dado → Poisson (r grande)
  pts.sort((a, b) => (a.t < b.t ? -1 : 1));
  const train = pts.slice(0, Math.floor(pts.length * 0.7));
  const grid = [1, 2, 3, 4, 6, 8, 12, 20, 40, 100, 1e7];
  let best = 1e7;
  let bestLL = Infinity;
  for (const r of grid) {
    let ll = 0;
    for (const p of train) ll += nbLogLoss(p.mean, r, p.total);
    const mean = ll / train.length;
    if (mean < bestLL) { bestLL = mean; best = r; }
  }
  return best;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[seed-model-predictions] início · dry=${isDry}`);

  let sims: any[];
  try {
    sims = await fetchAllSimulations();
  } catch (err: any) {
    // Se a tabela fixture_simulations não existir, o PostgREST retorna 404/406
    console.error("[seed-model-predictions] Falha ao ler fixture_simulations:", err.message);
    process.exit(1);
  }

  console.log(`[seed-model-predictions] ${sims.length} simulações carregadas`);

  // O champion é a model_version ATIVA (a da resolução mais recente). Versões
  // antigas (ex.: v2) são histórico morto — NÃO são champion nem challenger
  // (não compartilham fixtures com a v7 → pareamento vazio). Semeamos só a ativa.
  const champion = activeChampionVersion(sims);
  console.log(`[seed-model-predictions] champion ativo: ${champion ?? "(nenhum)"}`);
  if (!champion) {
    console.log("[seed-model-predictions] nenhuma model_version ativa — nada a semear.");
    return;
  }

  const deduped = dedupeSims(sims.filter((s) => s.model_version === champion));
  console.log(`[seed-model-predictions] ${deduped.length} sims do champion após dedup`);

  // Dispersão NB por mercado de contagem (champion = NB, fiel à produção).
  const countR: Record<string, number> = {
    cards: fitCountR(deduped, "cards"),
    corners: fitCountR(deduped, "corners"),
    sot: fitCountR(deduped, "sot"),
  };
  console.log(`[seed-model-predictions] NB size r (held-out): cards=${countR.cards} corners=${countR.corners} sot=${countR.sot}`);

  const predictionRows: PredictionRow[] = [];
  for (const sim of deduped) {
    const rows = buildPredictionRows(sim, countR);
    predictionRows.push(...rows);
  }

  console.log(`[seed-model-predictions] ${predictionRows.length} linhas de predição derivadas`);

  if (isDry) {
    console.log("[seed-model-predictions] --dry: nenhuma escrita realizada.");
    const byMarket: Record<string, number> = {};
    for (const r of predictionRows) {
      byMarket[r.market] = (byMarket[r.market] ?? 0) + 1;
    }
    console.log("[seed-model-predictions] Distribuição por mercado:", byMarket);
    return;
  }

  // Upsert em lotes
  let written = 0;
  for (let i = 0; i < predictionRows.length; i += UPSERT_BATCH) {
    const batch = predictionRows.slice(i, i + UPSERT_BATCH);
    try {
      await upsertBatch(batch);
      written += batch.length;
      process.stdout.write(`\r[seed-model-predictions] upsertadas ${written}/${predictionRows.length} linhas`);
    } catch (err: any) {
      // Degrade gracioso: se a tabela model_predictions não existir
      if (
        err.message?.includes("relation") ||
        err.message?.includes("does not exist") ||
        err.message?.includes("42P01") ||
        err.message?.includes("model_predictions")
      ) {
        console.error(
          "\n[seed-model-predictions] migration 0049 não aplicada — tabela model_predictions ausente. exit 0.",
        );
        process.exit(0);
      }
      throw err;
    }
  }

  console.log(`\n[seed-model-predictions] concluído · ${written} linhas upsertadas`);
}

main().catch((err) => {
  // Degrade gracioso se tabela não existir
  const msg: string = err?.message ?? String(err);
  if (
    msg.includes("relation") ||
    msg.includes("does not exist") ||
    msg.includes("42P01") ||
    msg.includes("model_predictions")
  ) {
    console.error("[seed-model-predictions] migration 0049 não aplicada — tabela model_predictions ausente. exit 0.");
    process.exit(0);
  }
  console.error("[seed-model-predictions] erro inesperado:", msg);
  process.exit(1);
});
