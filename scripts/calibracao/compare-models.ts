#!/usr/bin/env tsx
/**
 * compare-models — Arena champion-challenger (ADR-011).
 *
 * Lê `model_predictions` (migration 0049) — tabela opcional: degrade gracioso
 * se ausente. Para cada challenger, pareia com o champion por (fixture_id, market)
 * e roda paired bootstrap sobre log-loss. Imprime comparativo por challenger
 * (e quebra por market). Se só há champion, imprime baseline.
 *
 *   pnpm exec tsx scripts/calibracao/compare-models.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- script CLI: shapes dinâmicos do PostgREST */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  pairedBootstrap,
  modelVerdict,
  type BootstrapResult,
} from "@/lib/calibracao/model-comparison";

// ── Carrega env ───────────────────────────────────────────────────────────────

function ensureEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
    }
  } catch { /* env já exportado */ }
}
ensureEnv();

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface PredRow {
  fixture_id: number;
  model_version: string;
  market: string;
  log_loss: number;
  is_champion: boolean;
  resolved_at: string;
}

// ── Paginação ─────────────────────────────────────────────────────────────────

async function fetchAllResolved(): Promise<PredRow[]> {
  const PAGE = 1000;
  const rows: PredRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await (sb as any)
      .from("model_predictions")
      .select("fixture_id, model_version, market, log_loss, is_champion, resolved_at")
      .not("resolved_at", "is", null)
      .not("log_loss", "is", null)
      .order("fixture_id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`query error: ${error.message ?? JSON.stringify(error)}`);
    const chunk = (data ?? []) as PredRow[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }

  return rows;
}

// ── Formatação ────────────────────────────────────────────────────────────────

function fmtN(n: number) { return String(n).padStart(5); }
function fmtLL(v: number | null) {
  return v == null || !Number.isFinite(v) ? "    —" : v.toFixed(4).padStart(8);
}
function fmtDelta(v: number) {
  if (!Number.isFinite(v)) return "       —";
  const s = (v >= 0 ? "+" : "") + v.toFixed(4);
  return s.padStart(8);
}
function fmtIC(boot: BootstrapResult) {
  if (!Number.isFinite(boot.ciLo)) return "           —";
  return `[${boot.ciLo >= 0 ? "+" : ""}${boot.ciLo.toFixed(4)}, ${boot.ciHi >= 0 ? "+" : ""}${boot.ciHi.toFixed(4)}]`;
}
function fmtP(p: number) {
  if (!Number.isFinite(p)) return "  —";
  return p < 0.001 ? "<.001" : p.toFixed(3);
}
function verdictBadge(v: string) {
  if (v === "challenger_better") return "✅ challenger melhor";
  if (v === "champion_better")   return "❌ champion melhor";
  return "— inconclusivo";
}

// ── Agregação ─────────────────────────────────────────────────────────────────

/** Média aritmética (ignora NaN). */
function mean(xs: number[]): number {
  const f = xs.filter((x) => Number.isFinite(x));
  return f.length === 0 ? NaN : f.reduce((a, b) => a + b, 0) / f.length;
}

/**
 * Para um par (champion_rows, challenger_rows), agrupa por market e computa
 * deltas pareados por (fixture_id, market).
 */
function computeDeltas(
  champMap: Map<string, number>,  // key = `${fixture_id}:${market}`
  chalRows: PredRow[],
): { all: number[]; byMarket: Map<string, number[]> } {
  const all: number[] = [];
  const byMarket = new Map<string, number[]>();

  for (const row of chalRows) {
    const key = `${row.fixture_id}:${row.market}`;
    const llChamp = champMap.get(key);
    if (llChamp == null) continue; // sem par → pula

    const delta = llChamp - row.log_loss; // + ⇒ challenger melhor
    all.push(delta);

    const arr = byMarket.get(row.market) ?? [];
    arr.push(delta);
    byMarket.set(row.market, arr);
  }

  return { all, byMarket };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== Arena Champion-Challenger (ADR-011) ===\n");

  // ── 1. Busca dados ──────────────────────────────────────────────────────────
  let rows: PredRow[];
  try {
    rows = await fetchAllResolved();
  } catch (err: any) {
    // Degrade gracioso: tabela inexistente (migration ainda não aplicada) ou
    // qualquer erro de rede.
    const msg = err instanceof Error ? err.message : String(err);
    const tableAbsent =
      msg.includes("does not exist") ||
      msg.includes("relation") ||
      msg.includes("42P01");
    if (tableAbsent) {
      console.log("tabela model_predictions ainda não existe em prod.");
      console.log("Aplique a migration 0049_model_predictions.sql pra ativar a arena.\n");
    } else {
      console.error("falha ao ler model_predictions:", msg);
    }
    process.exit(0);
  }

  if (rows.length === 0) {
    console.log("Nenhuma predição resolvida em model_predictions ainda.\n");
    process.exit(0);
  }

  // ── 2. Separa champion e challengers ────────────────────────────────────────
  const champRows    = rows.filter((r) => r.is_champion);
  const chalAllRows  = rows.filter((r) => !r.is_champion);

  if (champRows.length === 0) {
    console.log("Nenhuma linha com is_champion=true encontrada.");
    console.log(`Total resolvidas: ${rows.length}`);
    process.exit(0);
  }

  // ── 3. Champion baseline ────────────────────────────────────────────────────
  const champVersion = champRows[0]!.model_version;
  const champLL = mean(champRows.map((r) => r.log_loss));

  // Quebra do champion por market.
  const champByMarket = new Map<string, number[]>();
  for (const r of champRows) {
    const arr = champByMarket.get(r.market) ?? [];
    arr.push(r.log_loss);
    champByMarket.set(r.market, arr);
  }

  console.log(`Champion: ${champVersion}`);
  console.log(`  n resolvidas  : ${champRows.length}`);
  console.log(`  log-loss médio: ${fmtLL(champLL)}`);
  console.log("  por market:");
  for (const [mkt, lls] of Array.from(champByMarket.entries()).sort()) {
    console.log(`    ${mkt.padEnd(12)} n=${fmtN(lls.length)}  ll=${fmtLL(mean(lls))}`);
  }
  console.log();

  // ── 4. Challengers ─────────────────────────────────────────────────────────
  const chalVersions = Array.from(new Set(chalAllRows.map((r) => r.model_version)));

  if (chalVersions.length === 0) {
    console.log("Sem challengers registrados ainda — a arena está pronta;");
    console.log("challengers entram em shadow na próxima onda.\n");
    process.exit(0);
  }

  console.log(`Challengers: ${chalVersions.join(", ")}\n`);

  // Índice do champion: `${fixture_id}:${market}` → log_loss
  const champMap = new Map<string, number>();
  for (const r of champRows) champMap.set(`${r.fixture_id}:${r.market}`, r.log_loss);

  const numChallengers = chalVersions.length;

  for (const version of chalVersions.sort()) {
    const chalRows = chalAllRows.filter((r) => r.model_version === version);
    const { all: deltas, byMarket } = computeDeltas(champMap, chalRows);

    const chalLL = mean(chalRows.map((r) => r.log_loss));
    const boot   = pairedBootstrap(deltas, { seed: 42 });
    const result = modelVerdict(boot, numChallengers);

    console.log(`── Challenger: ${version} ──────────────────────────────`);
    console.log(`  n pareado      : ${boot.n} (de ${chalRows.length} total challenger)`);
    console.log(`  log-loss champ : ${fmtLL(champLL)}`);
    console.log(`  log-loss chal  : ${fmtLL(chalLL)}`);
    console.log(`  meanDelta      : ${fmtDelta(boot.meanDelta)}  (+ ⇒ challenger melhor)`);
    console.log(`  IC95 bootstrap : ${fmtIC(boot)}`);
    console.log(`  p-value deflac : ${fmtP(result.pDeflated)}`);
    console.log(`  veredito       : ${verdictBadge(result.verdict)}`);

    // Quebra por market (bom-de-ter).
    if (byMarket.size > 0) {
      console.log("  por market:");
      for (const [mkt, mktDeltas] of Array.from(byMarket.entries()).sort()) {
        const mktBoot   = pairedBootstrap(mktDeltas, { seed: 42 });
        const mktResult = modelVerdict(mktBoot, numChallengers);
        const champMktLL = mean(champByMarket.get(mkt) ?? []);
        const chalMktLL  = mean(
          chalRows.filter((r) => r.market === mkt).map((r) => r.log_loss),
        );
        console.log(
          `    ${mkt.padEnd(12)} n=${fmtN(mktBoot.n)}  champ=${fmtLL(champMktLL)}  chal=${fmtLL(chalMktLL)}` +
          `  Δ=${fmtDelta(mktBoot.meanDelta)}  p=${fmtP(mktResult.pDeflated)}  ${verdictBadge(mktResult.verdict)}`,
        );
      }
    }
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
