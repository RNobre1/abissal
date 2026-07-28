#!/usr/bin/env tsx
/**
 * seed-challenger-referee-cards — challenger da arena: cartões previstos com o
 * PERFIL DO ÁRBITRO (média em cartões + ν por árbitro), contra o champion
 * (NB sobre a média da sim).
 *
 * O ACHADO (28/07, 118 fixtures com perfil rico): a dispersão dos cartões
 * varia POR ÁRBITRO — 45 over-dispersos, 42 sub-dispersos, 31 ≈Poisson,
 * mediana 1.02. Isso reinterpreta B34-B37: fitar um ν GLOBAL é fitar a média
 * de duas populações opostas, o que dá ≈Poisson — exatamente o resultado nulo
 * que deixou o CMP global inconclusivo.
 *
 * Duas mudanças, ambas vindas do payload que já existia e era descartado:
 *   1. média em CARTÕES (o F6 usa booking points, unidade composta ≠ mercado)
 *   2. ν derivado da dispersão DAQUELE árbitro (o F6 não modela forma)
 *
 * O peso do blend fica igual ao do F6 (0.4) de propósito — o challenger testa
 * unidade e forma, não peso. Mudar duas coisas de uma vez torna o veredito
 * inútil (lição do baseline strawman, B36).
 *
 * FORWARD-ONLY e por isso URGENTE: o `detail_json` tem retenção de ~4 dias,
 * então o perfil do árbitro de um jogo só existe na janela em torno dele. Cada
 * dia sem semear é dado perdido para sempre (é o motivo de a arena ser
 * forward-only, ADR-011).
 *
 * Shadow: nunca toca `ai_recommendations`. Promoção é humana e gated.
 *
 * Uso:
 *   pnpm exec tsx scripts/calibracao/seed-challenger-referee-cards.ts
 *   pnpm exec tsx scripts/calibracao/seed-challenger-referee-cards.ts --dry
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- script CLI: shapes dinâmicos do PostgREST/jsonb */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { cmpLogLoss, cmpProb } from "@/lib/calibracao/cmp";
import { blendCardMean, nuForDispersion } from "@/lib/calibracao/referee-cards";

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
    /* CI provê via secrets */
  }
}
ensureEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[challenger-ref-cards] faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const DRY = process.argv.includes("--dry");

export const MODEL_VERSION = "challenger-referee-cards-v1";
/** k máximo somado na PMF — cartões acima disso são desprezíveis. */
const KMAX = 25;

interface RefProfile {
  mean: number;
  dispersion: number | null;
  name: string | null;
}

/**
 * Mapa choistatsId → perfil do árbitro.
 *
 * ATENÇÃO ao id-space (lição B29): `fixtures.id` é o PK INTERNO; o id do
 * choistats vive em `source_url` ('/fixture/<id>'). `fixture_simulations.
 * fixture_id` e `model_predictions.fixture_id` usam o id do choistats. Cruzar
 * os dois espaços foi o que estragou um backfill inteiro.
 */
async function fetchRefereeProfiles(): Promise<Map<number, RefProfile>> {
  const out = new Map<number, RefProfile>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("fixtures")
      .select("source_url, detail_json->referee_record")
      .not("detail_json->referee_record->>avg_total_cards", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows as any[]) {
      const m = /\/fixture\/(\d+)/.exec(String(r.source_url ?? ""));
      if (!m) continue;
      const rec = r.referee_record ?? {};
      const mean = Number(rec.avg_total_cards);
      if (!Number.isFinite(mean) || mean <= 0) continue;
      const disp = Number(rec.cards_dispersion);
      out.set(Number(m[1]), {
        mean,
        dispersion: Number.isFinite(disp) && disp > 0 ? disp : null,
        name: rec.name ?? null,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

interface SimRow {
  fixtureId: number;
  simMean: number;
  actualTotal: number | null;
  modelVersion: string;
  status: string;
}

async function fetchSims(): Promise<SimRow[]> {
  const PAGE = 1000;
  const out: SimRow[] = [];
  const seen = new Set<number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("fixture_simulations")
      .select("fixture_id, model_version, status, sim_stats, actual_cards_home, actual_cards_away")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows as any[]) {
      const fid = Number(r.fixture_id);
      if (!Number.isFinite(fid) || seen.has(fid)) continue;
      const hp = r.sim_stats?.home?.cards?.p50;
      const ap = r.sim_stats?.away?.cards?.p50;
      if (typeof hp !== "number" || typeof ap !== "number") continue;
      seen.add(fid);
      const ah = r.actual_cards_home;
      const aa = r.actual_cards_away;
      out.push({
        fixtureId: fid,
        simMean: hp + ap,
        actualTotal: ah != null && aa != null ? Number(ah) + Number(aa) : null,
        modelVersion: r.model_version,
        status: r.status,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

async function upsertRows(rows: any[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb
      .from("model_predictions")
      .upsert(rows.slice(i, i + 500), { onConflict: "fixture_id,model_version,market" });
    if (error) {
      if (/relation|does not exist|42P01|model_predictions/.test(error.message)) {
        console.log("[challenger-ref-cards] migration 0049 ausente — exit 0.");
        process.exit(0);
      }
      throw new Error(error.message);
    }
  }
}

async function main() {
  const [profiles, sims] = await Promise.all([fetchRefereeProfiles(), fetchSims()]);
  console.log(
    `[challenger-ref-cards] ${profiles.size} fixtures com perfil rico de árbitro | ${sims.length} sims com média de cartões`,
  );

  const matched = sims.filter((s) => profiles.has(s.fixtureId));
  if (matched.length === 0) {
    console.log("[challenger-ref-cards] nenhum cruzamento sim × árbitro — exit 0.");
    return;
  }

  const rows: any[] = [];
  let scored = 0;
  let llChal = 0;
  const dispBuckets = { over: 0, sub: 0, poisson: 0 };

  for (const s of matched) {
    const prof = profiles.get(s.fixtureId)!;
    const mean = blendCardMean(s.simMean, prof.mean);
    const nu = nuForDispersion(mean, prof.dispersion);

    if (nu < 0.85) dispBuckets.over++;
    else if (nu > 1.15) dispBuckets.sub++;
    else dispBuckets.poisson++;

    // A arena guarda a distribuição prevista; o scoring de contagem usa a PMF.
    const probs = {
      mean: Number(mean.toFixed(4)),
      nu,
      referee: prof.name,
      referee_mean: prof.mean,
      dispersion: prof.dispersion,
      pmf_head: Array.from({ length: 11 }, (_, k) =>
        Number(cmpProb(mean, nu, k, KMAX).toFixed(5)),
      ),
    };

    const resolved = s.actualTotal !== null;
    let ll: number | null = null;
    if (resolved) {
      ll = cmpLogLoss(mean, nu, s.actualTotal!, KMAX);
      llChal += ll;
      scored++;
    }

    rows.push({
      fixture_id: s.fixtureId,
      model_version: MODEL_VERSION,
      is_champion: false,
      market: "cards",
      probs,
      outcome: resolved ? { total: s.actualTotal } : null,
      log_loss: ll,
      brier: null,
      rps: null,
      crps: null,
      resolved_at: resolved ? new Date().toISOString() : null,
    });
  }

  console.log(
    `[challenger-ref-cards] ${rows.length} predições | ν: ${dispBuckets.over} over-disperso, ${dispBuckets.sub} sub-disperso, ${dispBuckets.poisson} ≈Poisson`,
  );
  if (scored > 0) {
    console.log(
      `[challenger-ref-cards] ${scored} já resolvidas — log-loss médio ${(llChal / scored).toFixed(4)}`,
    );
  } else {
    console.log(
      "[challenger-ref-cards] nenhuma resolvida ainda: as fixtures com perfil rico são todas FUTURAS.",
    );
    console.log(
      "[challenger-ref-cards] elas resolvem nos próximos dias e o compare-models emite o veredito.",
    );
  }

  if (DRY) {
    console.log(`[challenger-ref-cards] --dry: ${rows.length} linhas NÃO gravadas.`);
    return;
  }
  await upsertRows(rows);
  console.log(`[challenger-ref-cards] ${rows.length} predições upsertadas como ${MODEL_VERSION}.`);
}

main().catch((e) => {
  console.error("[challenger-ref-cards] erro:", e?.message ?? e);
  process.exit(1);
});
