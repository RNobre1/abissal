/**
 * Funções puras para agregar `ai_recommendations` no painel /calibracao.
 *
 * Lê APENAS escalares — jamais detail_json, edge_table_snapshot, reasoning_full
 * (Lição B12). O caller é responsável por já ter filtrado/selecionado as
 * colunas certas via Supabase.
 *
 * Sem I/O, sem mocks; testáveis isoladamente. A página `/calibracao` chama
 * essas 4 funções uma vez por render.
 */

import { brierScore } from "@/lib/ai/calibration-metrics";

// ── tipos ────────────────────────────────────────────────────────────────────

/**
 * Linha mínima de `ai_recommendations` consumida pelas agregações. Tudo
 * escalar — `prob_estimated` é declarado como `numeric(5,4)` no schema
 * (Postgres devolve como string via PostgREST; Number(...) coerce nas funções).
 */
export interface AiRecoRow {
  id: number;
  league: string | null;
  status: "pending" | "resolved" | "unresolvable";
  verdict: "bet" | "skip";
  confidence: "alto" | "medio" | "baixo" | null;
  prob_estimated: number | string | null;
  prob_calibrated?: number | string | null;
  units_final: number | string | null;
  bet_won: boolean | null;
  pl_units: number | string | null;
}

export interface RoiSummary {
  betCount: number;
  resolvedCount: number;
  won: number;
  lost: number;
  totalPl: number;
  totalUnitsRisked: number;
  winRate: number | null; // null se betCount == 0
  roiPerUnit: number | null; // totalPl / totalUnitsRisked (null se 0)
}

// ── ROI cumulativo (resolved bets) ───────────────────────────────────────────

export function summarizeAiRecoRoi(rows: AiRecoRow[]): RoiSummary {
  let betCount = 0;
  let resolvedCount = 0;
  let won = 0;
  let lost = 0;
  let totalPl = 0;
  let totalUnitsRisked = 0;
  for (const r of rows) {
    if (r.status !== "resolved") continue;
    resolvedCount += 1;
    if (r.verdict !== "bet") continue;
    betCount += 1;
    if (r.bet_won === true) won += 1;
    else if (r.bet_won === false) lost += 1;
    totalPl += toNum(r.pl_units);
    totalUnitsRisked += toNum(r.units_final);
  }
  return {
    betCount,
    resolvedCount,
    won,
    lost,
    totalPl,
    totalUnitsRisked,
    winRate: betCount > 0 ? won / betCount : null,
    roiPerUnit: totalUnitsRisked > 0 ? totalPl / totalUnitsRisked : null,
  };
}

// ── Brier do prob_estimated ──────────────────────────────────────────────────

export interface BrierSummary {
  n: number;
  brier: number | null;
}

/**
 * Brier sobre apostas resolvidas: y=1 se bet_won, y=0 caso contrário.
 * Ignora linhas sem prob_estimated ou sem bet_won definido. Skips são
 * ignorados (sem prob a calibrar).
 */
export function brierAiReco(rows: AiRecoRow[]): BrierSummary {
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    if (r.status !== "resolved" || r.verdict !== "bet") continue;
    if (r.bet_won == null) continue;
    // Skip null/undefined explicitly — `toNum(null)` returns 0, which would
    // pollute Brier with bogus 0 probs.
    if (r.prob_estimated == null) continue;
    const p = toNum(r.prob_estimated);
    if (!Number.isFinite(p)) continue;
    const y: 0 | 1 = r.bet_won ? 1 : 0;
    sum += brierScore(p, y);
    n += 1;
  }
  return { n, brier: n > 0 ? sum / n : null };
}

// ── Por liga ─────────────────────────────────────────────────────────────────

export interface LeagueRoiRow {
  league: string;
  total: number; // todas as recos (bet + skip)
  bets: number;
  won: number;
  totalPl: number;
  winRate: number | null;
}

/**
 * Agrupa por liga (resolved + bet). Skips entram em `total` mas não em
 * `bets`/`won`/`totalPl` — útil pra ver volume completo do IA por liga.
 * Ordena por volume (total desc); caller fatia top-N.
 */
export function groupAiRecoByLeague(rows: AiRecoRow[]): LeagueRoiRow[] {
  const map = new Map<string, LeagueRoiRow>();
  for (const r of rows) {
    if (r.status !== "resolved") continue;
    const key = (r.league ?? "(sem liga)").trim() || "(sem liga)";
    const entry =
      map.get(key) ?? {
        league: key,
        total: 0,
        bets: 0,
        won: 0,
        totalPl: 0,
        winRate: null,
      };
    entry.total += 1;
    if (r.verdict === "bet") {
      entry.bets += 1;
      if (r.bet_won === true) entry.won += 1;
      entry.totalPl += toNum(r.pl_units);
    }
    map.set(key, entry);
  }
  for (const entry of map.values()) {
    entry.winRate = entry.bets > 0 ? entry.won / entry.bets : null;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

// ── Por confidence ───────────────────────────────────────────────────────────

export interface ConfidenceRow {
  confidence: "alto" | "medio" | "baixo";
  total: number;
  bets: number;
  won: number;
  totalPl: number;
  winRate: number | null;
}

/** Ordem fixa para sanity-check: alto deve ter WR > medio > baixo. */
const CONFIDENCE_ORDER: Array<ConfidenceRow["confidence"]> = [
  "alto",
  "medio",
  "baixo",
];

export function groupAiRecoByConfidence(rows: AiRecoRow[]): ConfidenceRow[] {
  const map = new Map<ConfidenceRow["confidence"], ConfidenceRow>();
  for (const c of CONFIDENCE_ORDER) {
    map.set(c, { confidence: c, total: 0, bets: 0, won: 0, totalPl: 0, winRate: null });
  }
  for (const r of rows) {
    if (r.status !== "resolved") continue;
    const c = r.confidence;
    if (c !== "alto" && c !== "medio" && c !== "baixo") continue;
    const entry = map.get(c)!;
    entry.total += 1;
    if (r.verdict === "bet") {
      entry.bets += 1;
      if (r.bet_won === true) entry.won += 1;
      entry.totalPl += toNum(r.pl_units);
    }
  }
  for (const entry of map.values()) {
    entry.winRate = entry.bets > 0 ? entry.won / entry.bets : null;
  }
  return CONFIDENCE_ORDER.map((c) => map.get(c)!).filter((r) => r.total > 0);
}

// ── ROI realizado (bets reais vinculadas via ai_recommendation_id, 0025) ─────

/**
 * Linha mínima da tabela `bets` JOIN `ai_recommendations` consumida pelas
 * agregações de ROI realizado. Tudo escalar. PL é derivado de
 * `status` + `total_stake` + `total_odds` (won: stake*(odd-1), lost: -stake,
 * void: 0) — não do `actual_return` (que pode ter half_won etc).
 *
 * `league` e `confidence` vêm via JOIN com `ai_recommendations` (do lado
 * da query SQL). Quando o JOIN não retorna a reco (purgada/SET NULL), ambos
 * caem pra null e o fallback '(sem liga)' / ignore aplica.
 */
export interface RealizedBetRow {
  id: string;
  ai_recommendation_id: number | null;
  house_id: string;
  total_stake: number | string;
  total_odds: number | string;
  status:
    | "pending"
    | "won"
    | "lost"
    | "void"
    | "cashed_out"
    | "half_won"
    | "half_lost"
    | "partially_void";
  actual_return: number | string | null;
  league: string | null;
  confidence: "alto" | "medio" | "baixo" | null;
}

export interface RealizedRoiSummary {
  betCount: number;
  resolvedCount: number;
  won: number;
  lost: number;
  void: number;
  totalStake: number;
  totalPl: number;
  winRate: number | null;
  roi: number | null;
}

/**
 * P/L para uma bet resolvida.
 *   - won  → stake * (odd - 1)
 *   - lost → -stake
 *   - void → 0
 * Status partial (half_won, cashed_out…) ficam fora do MVP — caem em 0 (PL
 * neutro) pra não distorcer a métrica até termos UI/lógica pra cashout.
 */
function realizedPl(row: RealizedBetRow): number {
  const stake = toNum(row.total_stake);
  const odd = toNum(row.total_odds);
  switch (row.status) {
    case "won":
      return stake * (odd - 1);
    case "lost":
      return -stake;
    case "void":
      return 0;
    default:
      return 0;
  }
}

const RESOLVED_REALIZED_STATUSES: Set<RealizedBetRow["status"]> = new Set([
  "won",
  "lost",
  "void",
]);

/**
 * Agrega ROI realizado sobre bets que foram criadas via /api/ai-reco/apostei
 * (têm ai_recommendation_id != null). Ignora bets pending no cálculo de
 * resolvedCount/winRate/roi, mas conta no betCount pra mostrar penetração
 * (quantas bets vinculadas existem no total).
 */
export function summarizeRealizedRoi(rows: RealizedBetRow[]): RealizedRoiSummary {
  let betCount = 0;
  let resolvedCount = 0;
  let won = 0;
  let lost = 0;
  let voidCount = 0;
  let totalStake = 0;
  let totalPl = 0;
  for (const r of rows) {
    if (r.ai_recommendation_id == null) continue;
    betCount += 1;
    if (!RESOLVED_REALIZED_STATUSES.has(r.status)) continue;
    resolvedCount += 1;
    totalStake += toNum(r.total_stake);
    totalPl += realizedPl(r);
    if (r.status === "won") won += 1;
    else if (r.status === "lost") lost += 1;
    else if (r.status === "void") voidCount += 1;
  }
  const wlDenom = won + lost;
  return {
    betCount,
    resolvedCount,
    won,
    lost,
    void: voidCount,
    totalStake,
    totalPl,
    winRate: wlDenom > 0 ? won / wlDenom : null,
    roi: totalStake > 0 ? totalPl / totalStake : null,
  };
}

export interface RealizedLeagueRow {
  league: string;
  bets: number;
  won: number;
  totalPl: number;
  winRate: number | null;
}

export function groupRealizedRoiByLeague(
  rows: RealizedBetRow[],
): RealizedLeagueRow[] {
  const map = new Map<string, RealizedLeagueRow>();
  for (const r of rows) {
    if (r.ai_recommendation_id == null) continue;
    if (!RESOLVED_REALIZED_STATUSES.has(r.status)) continue;
    const key = (r.league ?? "(sem liga)").trim() || "(sem liga)";
    const entry =
      map.get(key) ?? {
        league: key,
        bets: 0,
        won: 0,
        totalPl: 0,
        winRate: null,
      };
    entry.bets += 1;
    if (r.status === "won") entry.won += 1;
    entry.totalPl += realizedPl(r);
    map.set(key, entry);
  }
  for (const entry of map.values()) {
    entry.winRate = entry.bets > 0 ? entry.won / entry.bets : null;
  }
  return Array.from(map.values()).sort((a, b) => b.bets - a.bets);
}

export interface RealizedConfidenceRow {
  confidence: "alto" | "medio" | "baixo";
  bets: number;
  won: number;
  totalPl: number;
  winRate: number | null;
}

export function groupRealizedRoiByConfidence(
  rows: RealizedBetRow[],
): RealizedConfidenceRow[] {
  const map = new Map<RealizedConfidenceRow["confidence"], RealizedConfidenceRow>();
  for (const c of CONFIDENCE_ORDER) {
    map.set(c, { confidence: c, bets: 0, won: 0, totalPl: 0, winRate: null });
  }
  for (const r of rows) {
    if (r.ai_recommendation_id == null) continue;
    if (!RESOLVED_REALIZED_STATUSES.has(r.status)) continue;
    const c = r.confidence;
    if (c !== "alto" && c !== "medio" && c !== "baixo") continue;
    const entry = map.get(c)!;
    entry.bets += 1;
    if (r.status === "won") entry.won += 1;
    entry.totalPl += realizedPl(r);
  }
  for (const entry of map.values()) {
    entry.winRate = entry.bets > 0 ? entry.won / entry.bets : null;
  }
  return CONFIDENCE_ORDER.map((c) => map.get(c)!).filter((r) => r.bets > 0);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function toNum(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? Number.parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}
