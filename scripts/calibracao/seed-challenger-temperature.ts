#!/usr/bin/env tsx
/**
 * seed-challenger-temperature — challenger da arena: champion + TEMPERATURE
 * SCALING nas probabilidades de mercado (1x2 / over25 / btts).
 *
 * Motivação (medido em 28/07 sobre 3.508 jogos resolvidos): a simulação
 * ESTICA as probabilidades — subconfiante nas caudas baixas, superconfiante
 * nas altas, com a mesma assinatura em todos os mercados. Ex. 1x2-home:
 * previsto ~25% → real 30%; previsto ~85% → real 72%. Um viés sistemático e
 * monotônico é exatamente o que UM parâmetro (T) corrige.
 *
 * Preview medido out-of-sample (60/40 temporal, só v7, n=2858): ganho de
 * log-loss positivo em TODOS os mercados — 1x2 away +2.47%, BTTS +1.47%,
 * over25 +1.35%, 1x2 home +1.07%, 1x2 draw +0.09%.
 *
 * Este script NÃO muda produção: grava em `model_predictions` como challenger
 * (is_champion=false), em shadow, pra a arena julgar com bootstrap pareado
 * (ADR-011). Promoção é HUMANA e gated por evidência (B24).
 *
 * Metodologia (anti walk-forward-bomb, B37):
 *   - T por jogo é fitado APENAS nos jogos ANTERIORES (walk-forward expansivo).
 *   - Cobertura TOTAL, igual ao champion — não um split 70/30 (coverage parity).
 *   - Jogos no warmup usam T=1 (identidade = o próprio champion), sem leakage.
 *   - Jogos FUTUROS usam o T fitado em todos os resolvidos (liveParam).
 *
 * Uso:
 *   pnpm exec tsx scripts/calibracao/seed-challenger-temperature.ts
 *   pnpm exec tsx scripts/calibracao/seed-challenger-temperature.ts --dry
 *
 * Idempotente: upsert em (fixture_id, model_version, market).
 * Degrada gracioso se a migration 0049 não estiver aplicada (exit 0).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- script CLI: shapes dinâmicos do PostgREST/jsonb */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { logLoss, brier, rps1x2Score } from "@/lib/calibracao/prediction-scoring";
import {
  applyTemperature,
  applyTemperatureVector,
  fitTemperature,
} from "@/lib/calibracao/temperature";
import { walkForwardParams, liveParam } from "@/lib/calibracao/walk-forward";

// ── Env ──────────────────────────────────────────────────────────────────────

function ensureEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const i = line.indexOf("=");
      if (i <= 0 || line.trim().startsWith("#")) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* sem .env.local — CI provê via secrets */
  }
}
ensureEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[challenger-temp] faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const DRY = process.argv.includes("--dry");
export const MODEL_VERSION = "challenger-temperature-v1";
/** Mín. de jogos resolvidos anteriores pra fitar T; abaixo disso T=1. */
const WARMUP = 100;
/** Refit em blocos — ver nota em seed-challenger-cards-cmp.ts. */
const REFIT_EVERY = 25;

// ── Tipos ────────────────────────────────────────────────────────────────────

interface Sim {
  fixtureId: number;
  pHome: number | null;
  pDraw: number | null;
  pAway: number | null;
  pOver: number | null;
  pBtts: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
  resolvedAt: string | null;
}

// ── Leitura ──────────────────────────────────────────────────────────────────

async function fetchAll(): Promise<{ resolved: Sim[]; upcoming: Sim[]; version: string | null }> {
  const PAGE = 1000;
  const raw: any[] = [];
  let activeVersion: string | null = null;
  let latestT = "";

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("fixture_simulations")
      .select(
        "fixture_id, model_version, status, p_home, p_draw, p_away, p_over_25, p_btts, actual_home_goals, actual_away_goals, actual_resolved_at",
      )
      .order("actual_resolved_at", { ascending: true, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    raw.push(...rows);
    for (const r of rows) {
      if (r.status === "resolved" && r.actual_resolved_at && r.actual_resolved_at > latestT) {
        latestT = r.actual_resolved_at;
        activeVersion = r.model_version;
      }
    }
    if (rows.length < PAGE) break;
  }

  const resolved: Sim[] = [];
  const upcoming: Sim[] = [];
  const seenR = new Set<number>();
  const seenU = new Set<number>();

  for (const r of raw) {
    if (r.model_version !== activeVersion) continue;
    const fid = Number(r.fixture_id);
    const sim: Sim = {
      fixtureId: fid,
      pHome: num(r.p_home),
      pDraw: num(r.p_draw),
      pAway: num(r.p_away),
      pOver: num(r.p_over_25),
      pBtts: num(r.p_btts),
      homeGoals: num(r.actual_home_goals),
      awayGoals: num(r.actual_away_goals),
      resolvedAt: r.actual_resolved_at ?? null,
    };
    const isResolved =
      r.status === "resolved" && sim.homeGoals !== null && sim.awayGoals !== null;
    if (isResolved) {
      if (seenR.has(fid)) continue;
      seenR.add(fid);
      resolved.push(sim);
    } else if (r.status !== "resolved") {
      if (seenU.has(fid)) continue;
      seenU.add(fid);
      upcoming.push(sim);
    }
  }

  resolved.sort((a, b) => ((a.resolvedAt ?? "") < (b.resolvedAt ?? "") ? -1 : 1));
  return { resolved, upcoming, version: activeVersion };
}

function num(v: unknown): number | null {
  const n = Number(v);
  return v !== null && v !== undefined && Number.isFinite(n) ? n : null;
}

// ── Resultados observados ────────────────────────────────────────────────────

const outcome1x2 = (s: Sim): "home" | "draw" | "away" =>
  s.homeGoals! > s.awayGoals! ? "home" : s.homeGoals! === s.awayGoals! ? "draw" : "away";
const outcomeOver = (s: Sim) => s.homeGoals! + s.awayGoals! > 2;
const outcomeBtts = (s: Sim) => s.homeGoals! >= 1 && s.awayGoals! >= 1;

// ── Walk-forward do T por mercado ────────────────────────────────────────────

/**
 * `fitTemperature` sobre um recorte de jogos, extraindo (prob, resultado) pelo
 * seletor do mercado. Jogos sem a probabilidade são ignorados.
 */
function makeFit(pick: (s: Sim) => number | null, hit: (s: Sim) => boolean) {
  return (train: Sim[]): number => {
    const pts: Array<[number, number]> = [];
    for (const s of train) {
      const p = pick(s);
      if (p === null) continue;
      pts.push([p, hit(s) ? 1 : 0]);
    }
    return fitTemperature(pts);
  };
}

// ── Escrita ──────────────────────────────────────────────────────────────────

async function upsertRows(rows: any[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb
      .from("model_predictions")
      .upsert(rows.slice(i, i + 500), { onConflict: "fixture_id,model_version,market" });
    if (error) {
      if (/relation|does not exist|42P01|model_predictions/.test(error.message)) {
        console.log("[challenger-temp] migration 0049 ausente — exit 0 (degrada gracioso).");
        process.exit(0);
      }
      throw new Error(error.message);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let resolved: Sim[];
  let upcoming: Sim[];
  let version: string | null;
  try {
    ({ resolved, upcoming, version } = await fetchAll());
  } catch (e: any) {
    console.error("[challenger-temp] falha ao ler fixture_simulations:", e.message);
    process.exit(1);
  }

  console.log(
    `[challenger-temp] champion ativo: ${version} | ${resolved.length} resolvidos + ${upcoming.length} futuros`,
  );
  if (resolved.length < WARMUP) {
    console.log(`[challenger-temp] < ${WARMUP} resolvidos — exit 0.`);
    return;
  }

  const opts = { warmup: WARMUP, defaultParam: 1, refitEvery: REFIT_EVERY };

  // Um T por mercado. O 1x2 usa a prob do FAVORITO da casa como sinal escalar
  // pro fit (o vetor inteiro é reescalado depois com o mesmo T).
  const fitHome = makeFit((s) => s.pHome, (s) => outcome1x2(s) === "home");
  const fitOver = makeFit((s) => s.pOver, outcomeOver);
  const fitBtts = makeFit((s) => s.pBtts, outcomeBtts);

  const tHomeWF = walkForwardParams(resolved, fitHome, opts);
  const tOverWF = walkForwardParams(resolved, fitOver, opts);
  const tBttsWF = walkForwardParams(resolved, fitBtts, opts);

  const liveTHome = liveParam(resolved, fitHome, opts);
  const liveTOver = liveParam(resolved, fitOver, opts);
  const liveTBtts = liveParam(resolved, fitBtts, opts);

  console.log(
    `[challenger-temp] T ao vivo — 1x2 ${liveTHome.toFixed(2)} | over25 ${liveTOver.toFixed(2)} | btts ${liveTBtts.toFixed(2)}`,
  );

  const rows: any[] = [];
  let champLL = 0;
  let challLL = 0;
  let scored = 0;

  const push = (
    fixtureId: number,
    market: string,
    probs: any,
    outcome: any | null,
    ll: number | null,
    br: number | null,
    rps: number | null,
  ) =>
    rows.push({
      fixture_id: fixtureId,
      model_version: MODEL_VERSION,
      is_champion: false,
      market,
      probs,
      outcome,
      log_loss: ll,
      brier: br,
      rps,
      crps: null,
      resolved_at: outcome ? new Date().toISOString() : null,
    });

  // ── resolvidos: T walk-forward (out-of-sample por construção) ──────────────
  resolved.forEach((s, i) => {
    if (s.pHome !== null && s.pDraw !== null && s.pAway !== null) {
      const [home, draw, away] = applyTemperatureVector(
        [s.pHome, s.pDraw, s.pAway],
        tHomeWF[i],
      );
      const probs = { home, draw, away };
      const out = { result: outcome1x2(s) };
      const ll = logLoss("1x2", probs, out);
      push(s.fixtureId, "1x2", probs, out, ll, brier("1x2", probs, out), rps1x2Score(probs, out));
      champLL += logLoss("1x2", { home: s.pHome, draw: s.pDraw, away: s.pAway }, out);
      challLL += ll;
      scored++;
    }
    if (s.pOver !== null) {
      const over = applyTemperature(s.pOver, tOverWF[i]);
      const probs = { over, under: 1 - over };
      const out = { over: outcomeOver(s) };
      push(s.fixtureId, "over25", probs, out, logLoss("over25", probs, out), brier("over25", probs, out), null);
    }
    if (s.pBtts !== null) {
      const sim = applyTemperature(s.pBtts, tBttsWF[i]);
      const probs = { sim, nao: 1 - sim };
      const out = { btts: outcomeBtts(s) };
      push(s.fixtureId, "btts", probs, out, logLoss("btts", probs, out), brier("btts", probs, out), null);
    }
  });

  // ── futuros: T ao vivo, sem outcome (o reconciler preenche depois) ─────────
  for (const s of upcoming) {
    if (s.pHome !== null && s.pDraw !== null && s.pAway !== null) {
      const [home, draw, away] = applyTemperatureVector([s.pHome, s.pDraw, s.pAway], liveTHome);
      push(s.fixtureId, "1x2", { home, draw, away }, null, null, null, null);
    }
    if (s.pOver !== null) {
      const over = applyTemperature(s.pOver, liveTOver);
      push(s.fixtureId, "over25", { over, under: 1 - over }, null, null, null, null);
    }
    if (s.pBtts !== null) {
      const sim = applyTemperature(s.pBtts, liveTBtts);
      push(s.fixtureId, "btts", { sim, nao: 1 - sim }, null, null, null, null);
    }
  }

  if (scored > 0) {
    const delta = (champLL - challLL) / scored;
    console.log(
      `[challenger-temp] preview 1x2 (walk-forward, n=${scored}): champion ${(champLL / scored).toFixed(4)} vs challenger ${(challLL / scored).toFixed(4)} → meanDelta ${delta >= 0 ? "+" : ""}${delta.toFixed(4)} ${delta > 0 ? "(challenger melhor)" : "(champion melhor)"}`,
    );
    console.log("[challenger-temp] veredito formal fica com compare-models.ts (bootstrap pareado deflacionado).");
  }

  if (DRY) {
    console.log(`[challenger-temp] --dry: ${rows.length} linhas NÃO gravadas.`);
    return;
  }
  await upsertRows(rows);
  console.log(`[challenger-temp] ${rows.length} predições upsertadas como ${MODEL_VERSION}.`);
}

main().catch((e) => {
  console.error("[challenger-temp] erro:", e?.message ?? e);
  process.exit(1);
});
