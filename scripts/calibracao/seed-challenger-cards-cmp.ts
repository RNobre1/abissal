#!/usr/bin/env tsx
/**
 * seed-challenger-cards-cmp — challenger de CARTÕES via Conway-Maxwell-Poisson,
 * em WALK-FORWARD e COBERTURA TOTAL (ADR-011/B35-B37).
 *
 * JUSTIÇA (pergunta do Pilot): o challenger prediz TODOS os jogos, igual ao
 * champion — não só um split de 30%. Sem leakage: pra cada jogo resolvido (em
 * ordem cronológica) o ν do CMP é fitado APENAS nos jogos anteriores
 * (walk-forward); jogos futuros usam o ν "ao vivo" (fit em todos os resolvidos).
 * Jogos no warmup caem em ν=1 (Poisson, sem fit). Assim toda predição é
 * out-of-sample E a cobertura é total.
 *
 * Usa a MESMA média do champion (sim_stats cards p50 home+away) — isola a FORMA
 * (dispersão). model_version='challenger-cards-cmp-v1', is_champion=false (shadow).
 * Persiste `shadow-params` (ν, r ativos) pro toggle no detalhe do jogo.
 *
 *   pnpm exec tsx scripts/calibracao/seed-challenger-cards-cmp.ts [--dry]
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- CLI: shapes dinâmicos do PostgREST */
import { readFileSync } from "node:fs";
import { dedupeByConflictKey } from "@/lib/calibracao/dedupe-predictions";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { cmpLogLoss } from "@/lib/calibracao/cmp";
import { nbLogLoss } from "@/lib/calibracao/negbin";
import { walkForwardParams, liveParam } from "@/lib/calibracao/walk-forward";

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
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
) as any;

const DRY = process.argv.includes("--dry");
const MODEL = "challenger-cards-cmp-v1";
const WARMUP = 50;
// Refit do ν a cada N jogos em vez de a cada jogo. Fitar por jogo é
// O(n² · grade) e fazia este seed consumir 18 dos 20 minutos do cron semanal,
// morrendo no timeout — `Seed challenger` cancelado e `Compare` nunca rodado
// desde 05/07. Não há leakage: o ν de um jogo segue fitado só no passado.
const REFIT_EVERY = 25;

interface Resolved { fixtureId: number; mean: number; total: number; resolvedAt: string }
interface Upcoming { fixtureId: number; mean: number }

/** Fit de ν (CMP) por grid minimizando log-loss no treino (ν<1 over-disp, >1 under). */
function fitNu(train: Resolved[]): number {
  if (train.length === 0) return 1;
  let best = 1;
  let bestLL = Infinity;
  for (let nu = 0.5; nu <= 2.0001; nu += 0.05) {
    let ll = 0;
    for (const r of train) ll += cmpLogLoss(r.mean, nu, r.total);
    if (ll / train.length < bestLL) { bestLL = ll / train.length; best = Number(nu.toFixed(2)); }
  }
  return best;
}

/** Fit de r (NB) — só pra persistir o param do champion-cards pro toggle. */
function fitR(train: Resolved[]): number {
  const grid = [1, 2, 3, 4, 6, 8, 12, 20, 40, 100, 1e7];
  let best = 1e7;
  let bestLL = Infinity;
  for (const r of grid) {
    let ll = 0;
    for (const row of train) ll += nbLogLoss(row.mean, r, row.total);
    if (ll / train.length < bestLL) { bestLL = ll / train.length; best = r; }
  }
  return best;
}

async function fetchAll(): Promise<{ resolved: Resolved[]; upcoming: Upcoming[]; version: string | null }> {
  const PAGE = 1000;
  let activeVersion: string | null = null;
  let latestT = "";
  const raw: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("fixture_simulations")
      .select("fixture_id, model_version, status, sim_stats, actual_cards_home, actual_cards_away, actual_resolved_at")
      .order("actual_resolved_at", { ascending: true, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    raw.push(...rows);
    for (const r of rows) if (r.status === "resolved" && r.actual_resolved_at > latestT) { latestT = r.actual_resolved_at; activeVersion = r.model_version; }
    if (rows.length < PAGE) break;
  }
  const resolved: Resolved[] = [];
  const upcoming: Upcoming[] = [];
  const seenR = new Set<number>();
  const seenU = new Set<number>();
  for (const r of raw) {
    if (r.model_version !== activeVersion) continue;
    const hp = r.sim_stats?.home?.cards?.p50;
    const ap = r.sim_stats?.away?.cards?.p50;
    if (typeof hp !== "number" || typeof ap !== "number") continue;
    const fid = Number(r.fixture_id);
    const mean = hp + ap;
    if (r.status === "resolved" && r.actual_cards_home != null && r.actual_cards_away != null) {
      if (seenR.has(fid)) continue;
      seenR.add(fid);
      resolved.push({ fixtureId: fid, mean, total: Number(r.actual_cards_home) + Number(r.actual_cards_away), resolvedAt: r.actual_resolved_at });
    } else if (r.status !== "resolved") {
      if (seenU.has(fid)) continue;
      seenU.add(fid);
      upcoming.push({ fixtureId: fid, mean });
    }
  }
  resolved.sort((a, b) => (a.resolvedAt < b.resolvedAt ? -1 : 1)); // cronológico
  return { resolved, upcoming, version: activeVersion };
}

async function upsertRows(rows: any[]) {
  // B53/B56: v7+v8 do mesmo jogo no mesmo batch estoura o ON CONFLICT.
  const deduped = dedupeByConflictKey(rows);
  for (let i = 0; i < deduped.length; i += 500) {
    const { error } = await sb.from("model_predictions").upsert(deduped.slice(i, i + 500), { onConflict: "fixture_id,model_version,market" });
    if (error) {
      if (/relation|does not exist|42P01|model_predictions/.test(error.message)) {
        console.error("[challenger-cards-cmp] migration 0049 ausente — exit 0."); process.exit(0);
      }
      throw new Error(error.message);
    }
  }
}

async function main() {
  let resolved: Resolved[];
  let upcoming: Upcoming[];
  let version: string | null;
  try {
    ({ resolved, upcoming, version } = await fetchAll());
  } catch (e: any) {
    console.error("[challenger-cards-cmp] falha ao ler fixture_simulations:", e.message);
    process.exit(1);
  }
  console.log(`[challenger-cards-cmp] cards: ${resolved.length} resolvidos + ${upcoming.length} futuros (champion ativo)`);
  if (resolved.length < WARMUP) { console.log(`[challenger-cards-cmp] < ${WARMUP} resolvidos — exit 0.`); return; }

  // Walk-forward: ν por jogo resolvido (fit só no passado). ν ao vivo p/ futuros.
  const nuWF = walkForwardParams(resolved, fitNu, { warmup: WARMUP, defaultParam: 1, refitEvery: REFIT_EVERY });
  const liveNu = liveParam(resolved, fitNu, { warmup: WARMUP, defaultParam: 1 });
  const liveR = liveParam(resolved, fitR, { warmup: WARMUP, defaultParam: 1e7 });

  // Preview honesto: log-loss média (só jogos pós-warmup, todos out-of-sample)
  // CMP-walk-forward vs Poisson, sobre TODOS os resolvidos cobertos.
  let cmpLL = 0;
  let poiLL = 0;
  let n = 0;
  for (let i = WARMUP; i < resolved.length; i++) {
    cmpLL += cmpLogLoss(resolved[i].mean, nuWF[i], resolved[i].total);
    poiLL += cmpLogLoss(resolved[i].mean, 1, resolved[i].total);
    n++;
  }
  console.log(`[challenger-cards-cmp] walk-forward (n=${n} out-of-sample): CMP ${(cmpLL / n).toFixed(4)} vs Poisson ${(poiLL / n).toFixed(4)} · ν ao vivo=${liveNu}, r=${liveR}`);

  if (DRY) { console.log("[challenger-cards-cmp] --dry: nada gravado."); return; }

  const mk = (fixtureId: number, mean: number, nu: number, total: number | null, resolvedAt: string | null) => ({
    fixture_id: fixtureId, model_version: MODEL, is_champion: false, market: "cards",
    probs: { mean, nu }, outcome: total != null ? { total } : null,
    log_loss: total != null ? cmpLogLoss(mean, nu, total) : null,
    brier: null, rps: null, crps: null, closing_log_loss: null, resolved_at: resolvedAt,
  });

  const rows = [
    ...resolved.map((r, i) => mk(r.fixtureId, r.mean, nuWF[i], r.total, r.resolvedAt)),
    ...upcoming.map((u) => mk(u.fixtureId, u.mean, liveNu, null, null)),
  ];
  await upsertRows(rows);
  console.log(`[challenger-cards-cmp] ${rows.length} predições semeadas (${resolved.length} resolvidos walk-forward + ${upcoming.length} futuros ao vivo).`);

  // Persiste params ativos pro toggle shadow no detalhe do jogo.
  if (version) {
    await sb.from("model_calibration").update({ effective_until: new Date().toISOString() })
      .eq("model_version", version).eq("metric", "shadow-params").is("effective_until", null);
    const { error: pErr } = await sb.from("model_calibration").insert({
      metric: "shadow-params", model_version: version,
      pairs: { cards: { nu: liveNu, r: liveR, n: resolved.length } } as any, n: resolved.length,
    });
    if (pErr) console.error("[challenger-cards-cmp] falha shadow-params:", pErr.message);
    else console.log(`[challenger-cards-cmp] shadow-params persistido (cards: ν=${liveNu}, r=${liveR}).`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
