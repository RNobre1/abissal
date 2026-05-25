/**
 * CLV (Closing Line Value) — métrica única que sobrevive a small-sample.
 *
 * Fórmula: `CLV% = (odd_taken / odd_close - 1) * 100`.
 *   - Positivo: peguei valor melhor que o mercado fechou.
 *   - Negativo: peguei pior — mercado discordou.
 *
 * Target Wave C (Abissal): **+1.5% sustentado em ≥300 bets** = sinal real
 * de skill detectável. Brier/ROI precisam de 300+ bets pra distinguir
 * sorte de skill; CLV diz isso em ~50.
 *
 * Sem I/O, sem mocks; puro. A página `/calibracao` chama essas funções
 * uma vez por render. Carregamento das amostras (JOIN ai_recommendations
 * × closing_odds) fica no caller (page.tsx) — aqui só agregação.
 */

// ── tipos ────────────────────────────────────────────────────────────────────

export type ClvMarket = "1x2" | "over25" | "btts";

/**
 * Amostra de CLV: uma reco com `odd_captured` (taken) e uma `closing_odd`
 * persistida pelo capture cron. `league` é da reco (não da fixture) — o
 * lookup vem do JOIN no caller.
 */
export interface ClvSample {
  ai_recommendation_id: number;
  league: string | null;
  market: ClvMarket;
  side: string;
  odd_taken: number;
  odd_close: number;
}

export interface ClvSummary {
  n: number;
  mean: number | null; // em pontos percentuais (ex: 1.5 = +1.5%)
  ci95Lower: number | null;
  ci95Upper: number | null;
}

export interface ClvGroupRow {
  n: number;
  mean: number | null;
}

export interface ClvByLeagueRow extends ClvGroupRow {
  league: string;
}

export interface ClvByMarketRow extends ClvGroupRow {
  market: ClvMarket;
}

// ── fórmula CLV ──────────────────────────────────────────────────────────────

/**
 * Calcula CLV% pra um par (odd_taken, odd_close). Retorna `null` quando
 * qualquer odd for inválida (≤ 0, NaN, Infinity) — *não* polui agregações.
 */
export function clvPercent(
  oddTaken: number,
  oddClose: number,
): number | null {
  if (!Number.isFinite(oddTaken) || oddTaken <= 0) return null;
  if (!Number.isFinite(oddClose) || oddClose <= 0) return null;
  return (oddTaken / oddClose - 1) * 100;
}

// ── agregação ────────────────────────────────────────────────────────────────

const MARKET_ORDER: readonly ClvMarket[] = ["1x2", "over25", "btts"];
const Z_95 = 1.96;

/**
 * Agrega amostras: média + IC95% (`σ/√n × 1.96`). Amostras com odds
 * inválidas são silenciosamente descartadas (clvPercent retorna null).
 * IC95 só é calculado quando `n >= 2` (precisa do desvio padrão amostral).
 */
export function summarizeClv(samples: ClvSample[]): ClvSummary {
  const clvs: number[] = [];
  for (const s of samples) {
    const v = clvPercent(s.odd_taken, s.odd_close);
    if (v == null) continue;
    clvs.push(v);
  }
  const n = clvs.length;
  if (n === 0) {
    return { n: 0, mean: null, ci95Lower: null, ci95Upper: null };
  }
  const mean = clvs.reduce((a, b) => a + b, 0) / n;
  if (n < 2) {
    return { n, mean, ci95Lower: null, ci95Upper: null };
  }
  // Sample stddev (n-1).
  const variance =
    clvs.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1);
  const stdErr = Math.sqrt(variance / n);
  const half = Z_95 * stdErr;
  return {
    n,
    mean,
    ci95Lower: mean - half,
    ci95Upper: mean + half,
  };
}

/**
 * Quebra por liga; ordena por volume `n` desc. Caller fatia top-N.
 * Liga null vira `'(sem liga)'`.
 */
export function groupClvByLeague(samples: ClvSample[]): ClvByLeagueRow[] {
  const buckets = new Map<string, number[]>();
  for (const s of samples) {
    const v = clvPercent(s.odd_taken, s.odd_close);
    if (v == null) continue;
    const key = (s.league ?? "(sem liga)").trim() || "(sem liga)";
    const arr = buckets.get(key) ?? [];
    arr.push(v);
    buckets.set(key, arr);
  }
  const rows: ClvByLeagueRow[] = [];
  for (const [league, vals] of buckets) {
    rows.push({
      league,
      n: vals.length,
      mean: vals.reduce((a, b) => a + b, 0) / vals.length,
    });
  }
  rows.sort((a, b) => b.n - a.n);
  return rows;
}

/**
 * Quebra por market preservando a ordem fixa `1x2 → over25 → btts`.
 * Markets não-suportados (ex: `asian` futuro) são silenciosamente
 * ignorados — o capture é quem dita quais markets são persistidos.
 */
export function groupClvByMarket(samples: ClvSample[]): ClvByMarketRow[] {
  const buckets = new Map<ClvMarket, number[]>();
  for (const s of samples) {
    if (!MARKET_ORDER.includes(s.market)) continue;
    const v = clvPercent(s.odd_taken, s.odd_close);
    if (v == null) continue;
    const arr = buckets.get(s.market) ?? [];
    arr.push(v);
    buckets.set(s.market, arr);
  }
  return MARKET_ORDER.filter((m) => buckets.has(m)).map((m) => {
    const vals = buckets.get(m)!;
    return {
      market: m,
      n: vals.length,
      mean: vals.reduce((a, b) => a + b, 0) / vals.length,
    };
  });
}
