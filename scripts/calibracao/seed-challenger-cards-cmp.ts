#!/usr/bin/env tsx
/**
 * seed-challenger-cards-cmp — primeiro CHALLENGER real da arena (ADR-011/B34).
 *
 * A pesquisa L3 achou que CARTÕES são SUB-dispersos → o Poisson/NB do champion
 * erra a FORMA. Este challenger prevê cartões com Conway-Maxwell-Poisson (CMP),
 * usando a MESMA média do champion (sim_stats) — isola o efeito da dispersão.
 *
 * HONESTIDADE (anti walk-forward-bomb): fita ν num split de TREINO (70% mais
 * antigos) e SEMEIA só o TESTE (30% mais recentes, held-out). A arena
 * (compare-models, bootstrap pareado deflacionado) é quem decide se ganha —
 * este script NÃO promove nada (is_champion=false, shadow puro).
 *
 * model_version = 'challenger-cards-cmp-v1', market='cards'. Pareia com o
 * champion (mesmo fixture_id). Idempotente (upsert). Degrade gracioso (B30/0049).
 *
 *   pnpm exec tsx scripts/calibracao/seed-challenger-cards-cmp.ts [--dry]
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- CLI: shapes dinâmicos do PostgREST */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { cmpLogLoss } from "@/lib/calibracao/cmp";

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
const TEST_FRAC = 0.3;

interface CardRow { fixtureId: number; mean: number; total: number; resolvedAt: string }

/** Poisson log-loss (ν=1 da CMP) — baseline do champion, mesma matemática. */
function poissonLogLoss(mean: number, k: number): number {
  return cmpLogLoss(mean, 1, k);
}

async function fetchCards(): Promise<CardRow[]> {
  const out: CardRow[] = [];
  const PAGE = 1000;
  // Versão ativa (champion) = a da resolução mais recente; pareamos com ela.
  let activeVersion: string | null = null;
  let latestT = "";
  const raw: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("fixture_simulations")
      .select("fixture_id, model_version, status, sim_stats, actual_cards_home, actual_cards_away, actual_resolved_at")
      .eq("status", "resolved")
      .not("actual_cards_home", "is", null)
      .not("actual_resolved_at", "is", null)
      .order("actual_resolved_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    raw.push(...rows);
    for (const r of rows) if (r.actual_resolved_at > latestT) { latestT = r.actual_resolved_at; activeVersion = r.model_version; }
    if (rows.length < PAGE) break;
  }
  const seen = new Set<number>();
  for (const r of raw) {
    if (r.model_version !== activeVersion) continue;
    const hp = r.sim_stats?.home?.cards?.p50;
    const ap = r.sim_stats?.away?.cards?.p50;
    if (typeof hp !== "number" || typeof ap !== "number") continue;
    if (r.actual_cards_home == null || r.actual_cards_away == null) continue;
    const fid = Number(r.fixture_id);
    if (seen.has(fid)) continue; // dedup por fixture (já cronológico)
    seen.add(fid);
    out.push({ fixtureId: fid, mean: hp + ap, total: Number(r.actual_cards_home) + Number(r.actual_cards_away), resolvedAt: r.actual_resolved_at });
  }
  return out; // ordenado cronológico (asc)
}

/** Fit de ν por grid-search minimizando log-loss CMP no train. */
function fitNu(train: CardRow[]): { nu: number; trainLL: number } {
  let best = { nu: 1, trainLL: Infinity };
  // Grade ampla: ν<1 (over-dispersão) E ν>1 (under-dispersão) — deixa a NOSSA
  // data decidir a direção, não a premissa da pesquisa (ligas diferentes).
  for (let nu = 0.5; nu <= 2.0001; nu += 0.05) {
    let ll = 0;
    for (const r of train) ll += cmpLogLoss(r.mean, nu, r.total);
    const mean = ll / train.length;
    if (mean < best.trainLL) best = { nu: Number(nu.toFixed(2)), trainLL: mean };
  }
  return best;
}

async function main() {
  let rows: CardRow[];
  try {
    rows = await fetchCards();
  } catch (e: any) {
    console.error("[challenger-cards-cmp] falha ao ler fixture_simulations:", e.message);
    process.exit(1);
  }
  console.log(`[challenger-cards-cmp] ${rows.length} jogos com cartões resolvidos (champion ativo)`);
  if (rows.length < 50) {
    console.log("[challenger-cards-cmp] amostra < 50 — não vale fitar. exit 0.");
    return;
  }

  const cut = Math.floor(rows.length * (1 - TEST_FRAC));
  const train = rows.slice(0, cut);
  const test = rows.slice(cut);
  const { nu, trainLL } = fitNu(train);

  // Comparação held-out (preview do que a arena vai julgar): no TESTE,
  // log-loss média Poisson (champion) vs CMP (challenger).
  let champLL = 0;
  let chalLL = 0;
  for (const r of test) {
    champLL += poissonLogLoss(r.mean, r.total);
    chalLL += cmpLogLoss(r.mean, nu, r.total);
  }
  champLL /= test.length;
  chalLL /= test.length;

  console.log(`[challenger-cards-cmp] ν fitado (train n=${train.length}): ${nu}  ·  train logLoss ${trainLL.toFixed(4)}`);
  console.log(`[challenger-cards-cmp] HELD-OUT (test n=${test.length}): champion(Poisson) ${champLL.toFixed(4)}  vs  challenger(CMP) ${chalLL.toFixed(4)}  → Δ ${(champLL - chalLL >= 0 ? "+" : "")}${(champLL - chalLL).toFixed(4)} ${chalLL < champLL ? "(CMP melhor)" : "(CMP NÃO melhora)"}`);

  if (DRY) { console.log("[challenger-cards-cmp] --dry: nada gravado."); return; }

  // Semeia SÓ o teste (held-out) — pareável com o champion no mesmo fixture.
  const upserts = test.map((r) => ({
    fixture_id: r.fixtureId,
    model_version: MODEL,
    is_champion: false,
    market: "cards",
    probs: { mean: r.mean, nu },
    outcome: { total: r.total },
    log_loss: cmpLogLoss(r.mean, nu, r.total),
    brier: null,
    rps: null,
    crps: null,
    closing_log_loss: null,
    resolved_at: r.resolvedAt,
  }));

  for (let i = 0; i < upserts.length; i += 500) {
    const batch = upserts.slice(i, i + 500);
    const { error } = await sb.from("model_predictions").upsert(batch, { onConflict: "fixture_id,model_version,market" });
    if (error) {
      if (/relation|does not exist|42P01|model_predictions/.test(error.message)) {
        console.error("[challenger-cards-cmp] migration 0049 ausente — exit 0."); process.exit(0);
      }
      throw new Error(error.message);
    }
  }
  console.log(`[challenger-cards-cmp] ${upserts.length} predições do challenger (cards/CMP, ν=${nu}) semeadas no teste.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
