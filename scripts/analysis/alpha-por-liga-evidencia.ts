#!/usr/bin/env tsx
/**
 * T2 — α por liga: EVIDÊNCIA, não implementação (07/08/2026).
 *
 * Hipótese a testar (registrada como TODO em edge_calculator.rb:26): a
 * simulação merece mais peso (α maior) onde há `league_parameters`
 * calibrados. Hoje `DEFAULT_BLEND_ALPHA = 0.3` é universal — 75 das 130
 * recos recentes são de liga NÃO calibrada e recebem o mesmo α das 55
 * calibradas.
 *
 * Read-only. Não escreve em nenhuma tabela; não importa nem toca
 * `edge_calculator.rb`/`edge-calculator.ts` além dos exports puros
 * reaproveitados abaixo (clampProb, EDGE_THRESHOLD) — a fórmula de
 * blend/edge/Kelly é reescrita aqui porque os helpers privados do
 * calculator não são exportados; qualquer bump neles deve ser refletido aqui
 * manualmente (comentado ponto a ponto com o arquivo-fonte).
 *
 * Reaproveita `ai_recommendations.edge_table_snapshot`: cada linha grava,
 * por candidata, `prob_calibrated`/`prob_market`/`odd`/`edge_pct`/
 * `kelly_units` já calculados no α de produção — não precisa re-simular
 * nada, só recalcular o blend sob outros α.
 *
 *   pnpm exec tsx scripts/analysis/alpha-por-liga-evidencia.ts
 */
import { createClient } from "@supabase/supabase-js";
import { clampProb, PROB_FLOOR, PROB_CEILING } from "@/lib/ai-reco/edge-calculator";
import { EDGE_THRESHOLD } from "@/lib/ai-reco/prompts";
import { DEFAULT_BANKROLL } from "@/lib/ai-reco/stake-calculator";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SR) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SR, { auth: { persistSession: false } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const c = supabase as unknown as { from: (t: string) => any };

// ── constantes espelhadas de lib/ai-reco/edge-calculator.ts (portas gêmeas) ──
// R2 walk-forward (2026-05-25 noite): ¼ Kelly → ⅛ Kelly. NÃO exportado no
// calculator (const privada) — mirror manual de edge-calculator.ts:168 /
// edge_calculator.rb:34. Se esse número mudar em produção sem atualizar
// aqui, a grade sai errada em silêncio — é por isso que o resto das
// constantes (PROB_FLOOR/CEILING, EDGE_THRESHOLD, DEFAULT_BANKROLL) é
// IMPORTADO em vez de copiado.
const KELLY_FRACTION = 0.125;
const KELLY_SCALAR = (KELLY_FRACTION * DEFAULT_BANKROLL) / 100; // 1.25

const ALPHAS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1.0];
// Mesma convenção de fit-isotonic.ts (heldOutGate) — 5 cortes temporais,
// decisão por maioria em vez de confiar num único split 70/30.
const GATE_CUTS = [0.5, 0.6, 0.7, 0.8, 0.85];
// fit-isotonic.ts usa MIN_TEST=50 sobre ~4.900 sims. Aqui o universo total é
// duas ordens de grandeza menor (recos resolvidas, não sims) — 50 zeraria
// TODOS os cortes. Baixado pra 15 e documentado: qualquer corte abaixo disso
// é reportado como "n insuficiente", nunca silenciosamente ignorado.
const MIN_TEST = 15;
const MIN_ELIGIBLE_PER_ALPHA = 5; // piso pra um α entrar na votação de vencedor do corte

const f = (v: number, d = 4) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const pctFmt = (v: number, d = 1) => (Number.isFinite(v) ? `${v.toFixed(d)}%` : "—");

// ── paginação manual (helper de lib/supabase/paginated-fetch.ts é o T1,
// ainda esqueleto/RED de propósito — não posso depender dele aqui) ──────────
async function fetchAllPages<T>(
  table: string,
  select: string,
  build: (q: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<T[]> {
  const PAGE = 1000;
  const acc: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = c.from(table).select(select);
    q = build(q);
    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) {
      console.error(`fetchAllPages(${table}) failed:`, error);
      process.exit(1);
    }
    const page = (data ?? []) as T[];
    acc.push(...page);
    if (page.length < PAGE) break;
  }
  return acc;
}

// ── tipos ────────────────────────────────────────────────────────────────
interface EdgeCandidateSnap {
  market: string;
  side: string;
  prob_estimated: number;
  prob_calibrated: number;
  prob_market?: number;
  prob_blended?: number;
  odd: number;
  edge_pct: number;
  kelly_units: number;
}

interface RecoRow {
  id: number;
  fixture_id: number | null;
  league: string | null;
  league_calibrated: boolean;
  kickoff_utc: string | null;
  verdict: "bet" | "skip";
  market: string | null;
  side: string | null;
  status: string;
  bet_won: boolean | null;
  odd_captured: number | null;
  forced: boolean;
  edge_table_snapshot: EdgeCandidateSnap[] | null;
}

interface ClosingOddsRow {
  fixture_id: number;
  market: string;
  side: string;
  odd_close: number;
  source: string;
}

// ── fórmula (mirror de edge-calculator.ts, ver comentário de constantes) ───
function blend(probCal: number, probMarket: number | undefined, alpha: number): number {
  if (alpha >= 1.0) return probCal;
  if (probMarket === undefined || !Number.isFinite(probMarket)) return probCal;
  return alpha * probCal + (1 - alpha) * probMarket;
}
function edgePct(prob: number, odd: number): number {
  return (prob * odd - 1) * 100;
}
function kellyUnits(prob: number, odd: number): number {
  const b = odd - 1;
  if (b <= 0) return 0;
  const q = 1 - prob;
  const fFrac = (prob * b - q) / b;
  if (fFrac <= 0) return 0;
  return fFrac * KELLY_SCALAR;
}

// ── linha preparada: junta candidata + closing odds, faz UMA vez por row ───
interface Prepared {
  id: number;
  fixtureId: number;
  leagueCalibrated: boolean;
  kickoffUtc: string;
  odd: number;
  won: boolean;
  probCal: number;
  probMarket: number | undefined;
  closeOdd: number | null;
}

function closingOddsKey(fixtureId: number, market: string, side: string): string {
  return `${fixtureId}|${market}|${side}`;
}

let candidateMismatchCount = 0;
function prepareRow(row: RecoRow, closingMap: Map<string, number>): Prepared | null {
  if (
    row.market == null ||
    row.side == null ||
    row.odd_captured == null ||
    row.bet_won == null ||
    row.kickoff_utc == null ||
    row.fixture_id == null
  ) {
    return null;
  }
  const snap = Array.isArray(row.edge_table_snapshot) ? row.edge_table_snapshot : [];
  const matches = snap.filter((cand) => cand.market === row.market && cand.side === row.side);
  if (matches.length !== 1) {
    // B29-style: join/match errado devolve 0 ou >1 em silêncio. Conta, não ignora.
    candidateMismatchCount++;
    return null;
  }
  const candidate = matches[0];
  const closeOdd = closingMap.get(closingOddsKey(row.fixture_id, row.market, row.side)) ?? null;
  return {
    id: row.id,
    fixtureId: row.fixture_id,
    leagueCalibrated: !!row.league_calibrated,
    kickoffUtc: row.kickoff_utc,
    odd: row.odd_captured,
    won: row.bet_won === true,
    probCal: clampProb(candidate.prob_calibrated),
    probMarket:
      candidate.prob_market != null && Number.isFinite(candidate.prob_market)
        ? clampProb(candidate.prob_market)
        : undefined,
    closeOdd,
  };
}

interface Computed {
  passes: boolean;
  kelly: number;
  pl: number;
  logloss: number;
  clv: number | null;
}
function computeForAlpha(p: Prepared, alpha: number): Computed {
  const blended = clampProb(blend(p.probCal, p.probMarket, alpha));
  const edge = edgePct(blended, p.odd);
  const passes = edge >= EDGE_THRESHOLD;
  const kelly = passes ? kellyUnits(blended, p.odd) : 0;
  const pl = passes ? (p.won ? (p.odd - 1) * kelly : -kelly) : 0;
  const clampedForLL = Math.min(Math.max(blended, PROB_FLOOR), PROB_CEILING);
  const logloss = -(p.won ? Math.log(clampedForLL) : Math.log(1 - clampedForLL));
  const clv = passes && p.closeOdd ? (p.odd / p.closeOdd - 1) * 100 : null;
  return { passes, kelly, pl, logloss, clv };
}

interface Aggregate {
  n: number;
  roi: number;
  logloss: number;
  clvMean: number;
  clvCI: number;
  nClv: number;
}
function aggregate(rows: Computed[]): Aggregate {
  const passing = rows.filter((r) => r.passes);
  const n = passing.length;
  const sumPl = passing.reduce((a, r) => a + r.pl, 0);
  const sumUnits = passing.reduce((a, r) => a + r.kelly, 0);
  const roi = sumUnits > 0 ? sumPl / sumUnits : NaN;
  const logloss = n > 0 ? passing.reduce((a, r) => a + r.logloss, 0) / n : NaN;
  const clvVals = passing.map((r) => r.clv).filter((v): v is number => v != null);
  const clvMean = clvVals.length ? clvVals.reduce((a, v) => a + v, 0) / clvVals.length : NaN;
  let clvCI = NaN;
  if (clvVals.length >= 2) {
    const mean = clvMean;
    const variance =
      clvVals.reduce((a, v) => a + (v - mean) ** 2, 0) / (clvVals.length - 1);
    clvCI = (1.96 * Math.sqrt(variance)) / Math.sqrt(clvVals.length);
  }
  return { n, roi, logloss, clvMean, clvCI, nClv: clvVals.length };
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${"═".repeat(90)}\nT2 — α por liga: evidência (read-only)\n${"═".repeat(90)}`);

  // 1. ai_recommendations resolvidas, verdict='bet', NÃO forçadas (0045: forced
  //    é excluído de TODA métrica de calibração — bypassou o threshold).
  const primaryRaw = await fetchAllPages<RecoRow>(
    "ai_recommendations",
    [
      "id", "fixture_id", "league", "league_calibrated", "kickoff_utc",
      "verdict", "market", "side", "status", "bet_won", "odd_captured",
      "forced", "edge_table_snapshot",
    ].join(", "),
    (q) => q.eq("status", "resolved").eq("verdict", "bet").eq("forced", false).order("id", { ascending: true }),
  );
  console.log(`\nai_recommendations resolved+bet+não-forçadas: ${primaryRaw.length}`);

  // 2. TODAS as não-forçadas (bet+skip, qualquer status) — insumo do §3
  //    (contrafactual). Não precisa de outcome resolvido: a pergunta é só
  //    "quantos candidatos cruzam o threshold sob outro α", não "quem ganhou".
  const allRaw = await fetchAllPages<RecoRow>(
    "ai_recommendations",
    ["id", "fixture_id", "league_calibrated", "verdict", "market", "side", "forced", "edge_table_snapshot"].join(", "),
    (q) => q.eq("forced", false).order("id", { ascending: true }),
  );
  console.log(`ai_recommendations não-forçadas (bet+skip, qualquer status): ${allRaw.length}`);

  // 3. closing_odds — só cobre fixtures verdict='bet' (o capture pula skip).
  const closingRaw = await fetchAllPages<ClosingOddsRow>(
    "closing_odds",
    ["fixture_id", "market", "side", "odd_close", "source"].join(", "),
    (q) => q,
  );
  console.log(`closing_odds: ${closingRaw.length} linhas`);

  const closingMap = new Map<string, number>();
  for (const row of closingRaw) {
    const key = closingOddsKey(row.fixture_id, row.market, row.side);
    // prefere choistats se houver mais de uma fonte pro mesmo (fixture,market,side)
    if (!closingMap.has(key) || row.source === "choistats") {
      closingMap.set(key, row.odd_close);
    }
  }

  // ── validação B29: o join fixture_id casa alguma coisa? ──────────────────
  const primaryFixtureIds = new Set(primaryRaw.map((r) => r.fixture_id).filter((v): v is number => v != null));
  const closingFixtureIds = new Set(closingRaw.map((r) => r.fixture_id));
  let overlap = 0;
  for (const id of primaryFixtureIds) if (closingFixtureIds.has(id)) overlap++;
  console.log(
    `Overlap de fixture_id (ai_recommendations ∩ closing_odds): ${overlap} / ${primaryFixtureIds.size} fixtures com bet resolvido`,
  );
  if (primaryFixtureIds.size > 0 && overlap === 0) {
    console.error("⚠️  ZERO overlap — join de fixture_id provavelmente errado (B29). Abortando.");
    process.exit(1);
  }

  const prepared = primaryRaw
    .map((row) => prepareRow(row, closingMap))
    .filter((p): p is Prepared => p !== null);
  console.log(
    `Linhas preparadas (candidata encontrada 1:1 no snapshot): ${prepared.length} / ${primaryRaw.length} ` +
      `(${candidateMismatchCount} descartadas por mismatch de candidata — B29-style guard)`,
  );

  // ── sanity check: reproduz os números já medidos no artefato-pai? ────────
  console.log(`\n${"─".repeat(90)}\n0. SANITY CHECK — Kelly mediano por α (compara com o medido em 07/08: 0,102u @0.3 · 0,446u @1.0)\n${"─".repeat(90)}`);
  for (const alpha of ALPHAS) {
    const kellys = prepared
      .map((p) => computeForAlpha(p, alpha))
      .filter((r) => r.passes)
      .map((r) => r.kelly)
      .sort((a, b) => a - b);
    const median = kellys.length ? kellys[Math.floor(kellys.length / 2)] : NaN;
    console.log(`  α=${alpha.toFixed(1)}  n_passa=${String(kellys.length).padStart(4)}  kelly_mediano=${f(median, 3)}`);
  }

  // ── 1. grade α × estrato (dataset completo, sem split) ───────────────────
  console.log(`\n${"─".repeat(90)}\n1. GRADE α × ESTRATO (dataset completo — ver §2 pra validação out-of-sample)\n${"─".repeat(90)}`);
  const estratos: Array<[string, Prepared[]]> = [
    ["league_calibrated=true", prepared.filter((p) => p.leagueCalibrated)],
    ["league_calibrated=false", prepared.filter((p) => !p.leagueCalibrated)],
  ];
  for (const [nome, rows] of estratos) {
    console.log(`\n${nome}  (n_total_disponível=${rows.length})`);
    console.log(
      "  α".padEnd(6) + "n_passa".padStart(9) + "ROI".padStart(9) + "log-loss".padStart(10) +
        "CLV médio".padStart(12) + "CLV IC95".padStart(11) + "n_CLV".padStart(8),
    );
    for (const alpha of ALPHAS) {
      const computed = rows.map((p) => computeForAlpha(p, alpha));
      const agg = aggregate(computed);
      console.log(
        `  ${alpha.toFixed(1)}`.padEnd(6) + String(agg.n).padStart(9) + pctFmt(agg.roi * 100).padStart(9) +
          f(agg.logloss, 4).padStart(10) + pctFmt(agg.clvMean).padStart(12) +
          `±${f(agg.clvCI, 2)}`.padStart(11) + String(agg.nClv).padStart(8),
      );
    }
  }

  // ── 2. validação temporal (5 cortes, maioria) ────────────────────────────
  console.log(`\n${"─".repeat(90)}\n2. VALIDAÇÃO TEMPORAL — 5 cortes por kickoff_utc, decisão por maioria (MIN_TEST=${MIN_TEST})\n${"─".repeat(90)}`);
  for (const [nome, rowsUnsorted] of estratos) {
    const rows = [...rowsUnsorted].sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc));
    console.log(`\n${nome}  (n=${rows.length}, kickoff de ${rows[0]?.kickoffUtc ?? "—"} a ${rows[rows.length - 1]?.kickoffUtc ?? "—"})`);
    const clvVotes = new Map<number, number>();
    const loglossVotes = new Map<number, number>();
    let cutsVotados = 0;
    for (const frac of GATE_CUTS) {
      const cutIdx = Math.floor(rows.length * frac);
      const train = rows.slice(0, cutIdx);
      const test = rows.slice(cutIdx);
      if (train.length < MIN_TEST || test.length < MIN_TEST) {
        console.log(`  corte ${frac}: train=${train.length} test=${test.length} — insuficiente (<${MIN_TEST}), PULADO`);
        continue;
      }
      const perAlpha = ALPHAS.map((alpha) => {
        const computed = test.map((p) => computeForAlpha(p, alpha));
        return { alpha, ...aggregate(computed) };
      });
      const eligible = perAlpha.filter((p) => p.n >= MIN_ELIGIBLE_PER_ALPHA);
      const clvWinner = eligible.length
        ? eligible.reduce((best, p) => (p.clvMean > best.clvMean ? p : best)).alpha
        : null;
      const loglossWinner = eligible.length
        ? eligible.reduce((best, p) => (p.logloss < best.logloss ? p : best)).alpha
        : null;
      if (clvWinner != null) clvVotes.set(clvWinner, (clvVotes.get(clvWinner) ?? 0) + 1);
      if (loglossWinner != null) loglossVotes.set(loglossWinner, (loglossVotes.get(loglossWinner) ?? 0) + 1);
      cutsVotados++;
      console.log(
        `  corte ${frac}: train=${train.length} test=${test.length} α_elegíveis(n≥${MIN_ELIGIBLE_PER_ALPHA})=${eligible.length}/${ALPHAS.length}` +
          `  vencedor_CLV=${clvWinner ?? "—"}  vencedor_logloss=${loglossWinner ?? "—"}`,
      );
    }
    const fmtVotes = (m: Map<number, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).map(([a, v]) => `α=${a}:${v}`).join("  ") || "(nenhum voto)";
    console.log(`  cortes com voto válido: ${cutsVotados}/${GATE_CUTS.length}`);
    console.log(`  votos CLV:      ${fmtVotes(clvVotes)}`);
    console.log(`  votos log-loss: ${fmtVotes(loglossVotes)}`);
    const maioria = Math.floor(GATE_CUTS.length / 2) + 1;
    const clvMaioria = [...clvVotes.entries()].find(([, v]) => v >= maioria);
    const loglossMaioria = [...loglossVotes.entries()].find(([, v]) => v >= maioria);
    console.log(
      `  VEREDITO: CLV ${clvMaioria ? `α=${clvMaioria[0]} vence em maioria (${clvMaioria[1]}/${GATE_CUTS.length})` : "indistinguível — sem maioria"};` +
        ` log-loss ${loglossMaioria ? `α=${loglossMaioria[0]} vence em maioria (${loglossMaioria[1]}/${GATE_CUTS.length})` : "indistinguível — sem maioria"}`,
    );
  }

  // ── 3. contrafactual honesto — tamanho do viés de seleção ────────────────
  console.log(`\n${"─".repeat(90)}\n3. CONTRAFACTUAL — quanto do resultado é seleção sob α=0,3?\n${"─".repeat(90)}`);
  console.log(
    "Pergunta: sob um α diferente, quantas decisões de verdict/mercado MUDARIAM?\n" +
      "Isto NÃO reproduz o que o LLM decidiria (units_final, red_flags, reduction_reason) —\n" +
      "só mede se o CONJUNTO de candidatas que cruza o threshold de edge muda.\n",
  );
  const allPrepared = allRaw
    .filter((row) => row.fixture_id != null && Array.isArray(row.edge_table_snapshot))
    .map((row) => ({
      fixtureId: row.fixture_id as number,
      leagueCalibrated: !!row.league_calibrated,
      verdict: row.verdict,
      market: row.market,
      side: row.side,
      snap: row.edge_table_snapshot as EdgeCandidateSnap[],
    }));
  console.log(`Linhas com snapshot utilizável (bet+skip, qualquer status): ${allPrepared.length}`);

  for (const alpha of [0.0, 0.2, 0.5, 0.7, 1.0]) {
    let wasSkipNowBet = 0;
    let wasBetNowNoLongerPasses = 0;
    let wasBetNowDifferentBest = 0;
    let totalBet = 0;
    let totalSkip = 0;
    for (const row of allPrepared) {
      const candEdges = row.snap.map((cand) => {
        const probMarket =
          cand.prob_market != null && Number.isFinite(cand.prob_market) ? clampProb(cand.prob_market) : undefined;
        const blended = clampProb(blend(clampProb(cand.prob_calibrated), probMarket, alpha));
        return { market: cand.market, side: cand.side, edge: edgePct(blended, cand.odd) };
      });
      const passing = candEdges.filter((cd) => cd.edge >= EDGE_THRESHOLD);
      if (row.verdict === "skip") {
        totalSkip++;
        if (passing.length > 0) wasSkipNowBet++;
      } else {
        totalBet++;
        const originalStillPasses = passing.some((cd) => cd.market === row.market && cd.side === row.side);
        if (!originalStillPasses) wasBetNowNoLongerPasses++;
        if (passing.length > 0) {
          const best = passing.reduce((b, cd) => (cd.edge > b.edge ? cd : b));
          if (best.market !== row.market || best.side !== row.side) wasBetNowDifferentBest++;
        }
      }
    }
    console.log(
      `α=${alpha.toFixed(1)}:  skip→bet=${wasSkipNowBet}/${totalSkip} (${pctFmt((wasSkipNowBet / Math.max(1, totalSkip)) * 100)})` +
        `   bet→deixa-de-passar=${wasBetNowNoLongerPasses}/${totalBet} (${pctFmt((wasBetNowNoLongerPasses / Math.max(1, totalBet)) * 100)})` +
        `   bet→melhor-candidata-muda=${wasBetNowDifferentBest}/${totalBet} (${pctFmt((wasBetNowDifferentBest / Math.max(1, totalBet)) * 100)})`,
    );
  }

  console.log(`\n${"═".repeat(90)}\nFIM\n${"═".repeat(90)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
