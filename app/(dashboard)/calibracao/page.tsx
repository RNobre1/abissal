import { createAdminClient } from "@/lib/supabase/admin";
import {
  hitRate,
  calibrationBuckets,
  brierScore,
  brierScoreMulticlass,
  type ResolvedPrediction,
} from "@/lib/ai/calibration-metrics";
import {
  reliabilityBins,
  brierOverTime,
  marketDeviation,
  type ResolvedSimRow,
} from "@/lib/calibracao/sim-reliability";
import {
  summarizeAiRecoRoi,
  brierAiReco,
  groupAiRecoByLeague,
  groupAiRecoByConfidence,
  summarizeRealizedRoi,
  groupRealizedRoiByLeague,
  groupRealizedRoiByConfidence,
  type AiRecoRow,
  type RealizedBetRow,
} from "@/lib/calibracao/ai-reco-metrics";
import { ClvPanel } from "./_components/clv-panel";
import { summarizeClv } from "@/lib/calibracao/clv-metrics";
import type { ClvSample, ClvMarket } from "@/lib/calibracao/clv-metrics";
import { SummaryMetricCards } from "@/components/calibracao/summary-cards";
import { ClvGauge } from "@/components/calibracao/clv-gauge";
import { ReliabilityDiagram } from "@/components/calibracao/reliability-diagram";
import {
  PipelineHealthCard,
  type PipelineHealthData,
} from "@/components/calibracao/pipeline-health-card";

// Sempre fresco — métricas de calibração mudam a cada scrape.
export const dynamic = "force-dynamic";

interface PredRow {
  id: number;
  status: "pending" | "resolved" | "unresolvable";
  model: string | null;
  route: string;
  pred_confidence: number;
  correct_winner: boolean | null;
  correct_over_under: boolean | null;
}

/**
 * Linha escalar de `fixture_simulations` (migration 0018). SOMENTE escalares —
 * jamais detail_json (proteção outage 1101). Tabela SEPARADA de ai_predictions:
 * o Brier da simulação NÃO se mistura com o hitRate do copilot.
 */
interface SimRow {
  id: number;
  status: "pending" | "resolved" | "unsimulable" | "unresolvable";
  league: string | null;
  model_version: string | null;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  p_over_25: number | null;
  market_anchor: unknown;
  correct_winner: boolean | null;
  correct_over_under: boolean | null;
  actual_home_goals: number | null;
  actual_away_goals: number | null;
  actual_resolved_at: string | null;
}

interface SimBrierSummary {
  resolved: number;
  brier1x2: number | null; // média de brierScoreMulticlass
  brierOver: number | null; // média de brierScore (binário over 2.5)
}

/**
 * Linha de `model_calibration` (migration 0019) — curva isotônica ativa.
 * Esta task NÃO aplica a curva na leitura; só exibe metadados. Aplicação
 * fica como follow-up F3-prod.
 */
interface CalibrationRow {
  id: number;
  metric: string;
  model_version: string;
  n: number;
  pairs: unknown;
  created_at: string;
}

/**
 * Linha de `league_parameters` (migration 0020) — parâmetro ativo por
 * (liga, param). Exibido agrupado por liga em formato tabular. Ajustado
 * offline via `scripts/calibracao/fit-league-parameters.ts`.
 */
interface LeagueParamRow {
  league: string;
  param: string;
  value: number;
  n: number;
  created_at: string;
  model_version: string;
}

/** Agrupamento em memória para renderização da tabela por liga. */
interface CalibratedLeague {
  league: string;
  params: Record<string, number>;
  n: number;
  updated_at: string;
  model_version: string;
}

/**
 * Agrega o Brier sobre simulações resolvidas. Puro; degrada para null quando
 * não há linhas resolvidas com probabilidades/placar válidos.
 */
function summarizeSimulationBrier(rows: SimRow[]): SimBrierSummary {
  const resolved = rows.filter((r) => r.status === "resolved");

  let sum1x2 = 0;
  let n1x2 = 0;
  let sumOver = 0;
  let nOver = 0;

  for (const r of resolved) {
    const hg = r.actual_home_goals;
    const ag = r.actual_away_goals;
    if (hg == null || ag == null) continue;

    const ph = Number(r.p_home);
    const pd = Number(r.p_draw);
    const pa = Number(r.p_away);
    if ([ph, pd, pa].every((v) => Number.isFinite(v))) {
      const outcome: "home" | "draw" | "away" =
        hg > ag ? "home" : hg < ag ? "away" : "draw";
      sum1x2 += brierScoreMulticlass(
        { home: ph, draw: pd, away: pa },
        outcome,
      );
      n1x2 += 1;
    }

    const pOver = Number(r.p_over_25);
    if (Number.isFinite(pOver)) {
      const y: 0 | 1 = hg + ag > 2.5 ? 1 : 0;
      sumOver += brierScore(pOver, y);
      nOver += 1;
    }
  }

  return {
    resolved: resolved.length,
    brier1x2: n1x2 > 0 ? sum1x2 / n1x2 : null,
    brierOver: nOver > 0 ? sumOver / nOver : null,
  };
}

export default async function CalibracaoPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as unknown as { from: (t: string) => any };

  // ── Pipeline Health: queries paralelas, degradam graciosamente ──────────────
  const pipelineHealth = await (async (): Promise<PipelineHealthData> => {
    let lastScrapeAt: string | null = null;
    let simsToday = 0;
    let lastReconciledAt: string | null = null;
    let recoPendingPastKickoff = 0;
    let topLeagues: PipelineHealthData["topLeagues"] = [];

    // Fonte do scrape: max(scraped_at) de fixtures
    try {
      const { data } = await admin
        .from("fixtures")
        .select("scraped_at")
        .order("scraped_at", { ascending: false })
        .limit(1)
        .single();
      lastScrapeAt = (data as { scraped_at: string } | null)?.scraped_at ?? null;
    } catch {
      /* degrada graciosamente */
    }

    // Sims criadas hoje BRT (UTC-3 fixo)
    try {
      const todayBrtStart = new Date();
      todayBrtStart.setUTCHours(todayBrtStart.getUTCHours() + 3);
      todayBrtStart.setUTCHours(0, 0, 0, 0);
      todayBrtStart.setUTCHours(todayBrtStart.getUTCHours() - 3);

      const { count } = await admin
        .from("fixture_simulations")
        .select("id", { count: "exact", head: true })
        .gte("created_at", todayBrtStart.toISOString());
      simsToday = count ?? 0;
    } catch {
      /* degrada graciosamente */
    }

    // Último reconcile: max(resolved_at) das recos resolvidas
    try {
      const { data } = await admin
        .from("ai_recommendations")
        .select("resolved_at")
        .eq("status", "resolved")
        .not("resolved_at", "is", null)
        .order("resolved_at", { ascending: false })
        .limit(1)
        .single();
      lastReconciledAt = (data as { resolved_at: string } | null)?.resolved_at ?? null;
    } catch {
      /* degrada graciosamente */
    }

    // Recos pending pós-KO (3h de grace para evitar falsos alarmes)
    try {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const { count } = await admin
        .from("ai_recommendations")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lt("kickoff_utc", threeHoursAgo);
      recoPendingPastKickoff = count ?? 0;
    } catch {
      /* degrada graciosamente */
    }

    // Top 5 ligas por volume de recos resolvidas (agrupamento em memória —
    // Supabase não suporta GROUP BY nativo no SDK sem RPC)
    try {
      const { data } = await admin
        .from("ai_recommendations")
        .select("league")
        .eq("status", "resolved")
        .not("league", "is", null)
        .limit(2000);
      const counts = new Map<string, number>();
      for (const r of (data ?? []) as { league: string }[]) {
        if (r.league) counts.set(r.league, (counts.get(r.league) ?? 0) + 1);
      }
      topLeagues = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([league, count]) => ({ league, count }));
    } catch {
      /* degrada graciosamente */
    }

    return { lastScrapeAt, simsToday, lastReconciledAt, recoPendingPastKickoff, topLeagues };
  })();

  let rows: PredRow[] = [];
  let queryError: string | null = null;
  try {
    const { data, error } = await admin
      .from("ai_predictions")
      .select(
        "id, status, model, route, pred_confidence, correct_winner, correct_over_under",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message ?? "failed to fetch ai_predictions");
    rows = (data ?? []) as PredRow[];
  } catch (err) {
    queryError = err instanceof Error ? err.message : "erro desconhecido";
  }

  // Tabela SEPARADA: fixture_simulations. Leitura escalar-only (sem
  // detail_json) — mesmo padrão Supabase admin acima. Não conflaciona com
  // ai_predictions. Degrada para [] em qualquer falha.
  let simRows: SimRow[] = [];
  let simQueryError: string | null = null;
  try {
    const { data, error } = await admin
      .from("fixture_simulations")
      .select(
        "id, status, league, model_version, p_home, p_draw, p_away, p_over_25, market_anchor, correct_winner, correct_over_under, actual_home_goals, actual_away_goals, actual_resolved_at",
      )
      // Order by `status DESC` first so RESOLVED rows (the only ones that
      // contribute to Brier/reliability/market-deviation) come before the
      // PENDING majority. Without this, a fixed `.limit(N)` on
      // `created_at DESC` only sees the freshest pending batch (typical
      // when a re-sim just ran) and Brier/charts go empty even though
      // resolved rows exist in the table.
      .order("status", { ascending: false })
      .order("actual_resolved_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error)
      throw new Error(error.message ?? "failed to fetch fixture_simulations");
    simRows = (data ?? []) as SimRow[];
  } catch (err) {
    simQueryError = err instanceof Error ? err.message : "erro desconhecido";
  }
  const simBrier = summarizeSimulationBrier(simRows);

  // F5 — Brier por model_version: agrupa as linhas resolvidas por
  // `model_version` e reusa `summarizeSimulationBrier` (lib pura) em cada
  // grupo. Permite comparar a qualidade probabilística entre versões do
  // motor (ex. v4 vs v5) lado a lado quando o histórico está preservado
  // (migration 0021).
  const simBrierByVersion = (() => {
    const groups = new Map<string, SimRow[]>();
    for (const r of simRows) {
      const mv = (r.model_version ?? "—").trim() || "—";
      const arr = groups.get(mv) ?? [];
      arr.push(r);
      groups.set(mv, arr);
    }
    return Array.from(groups.entries())
      .map(([mv, rows]) => ({
        model_version: mv,
        ...summarizeSimulationBrier(rows),
      }))
      .sort((a, b) => b.resolved - a.resolved);
  })();

  // Curvas isotônicas ativas (effective_until IS NULL). Esta seção é
  // somente leitura/display — a curva é ajustada offline por
  // `scripts/calibracao/fit-isotonic.ts` e ainda não é aplicada na leitura
  // (follow-up F3-prod).
  let calRows: CalibrationRow[] = [];
  let calQueryError: string | null = null;
  try {
    const { data, error } = await admin
      .from("model_calibration")
      .select("id, metric, model_version, n, pairs, created_at")
      .is("effective_until", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error)
      throw new Error(error.message ?? "failed to fetch model_calibration");
    calRows = (data ?? []) as CalibrationRow[];
  } catch (err) {
    calQueryError = err instanceof Error ? err.message : "erro desconhecido";
  }

  // Parâmetros calibrados POR LIGA (migration 0020). Display somente —
  // motor Ruby já lê via `Simulation::LeagueCalibration.load` no scrape.
  // Ajuste offline via `scripts/calibracao/fit-league-parameters.ts`.
  let leagueRows: LeagueParamRow[] = [];
  let leagueQueryError: string | null = null;
  try {
    const { data, error } = await admin
      .from("league_parameters")
      .select("league, param, value, n, created_at, model_version")
      .is("effective_until", null)
      .order("league", { ascending: true });
    if (error)
      throw new Error(error.message ?? "failed to fetch league_parameters");
    leagueRows = (data ?? []) as LeagueParamRow[];
  } catch (err) {
    leagueQueryError = err instanceof Error ? err.message : "erro desconhecido";
  }

  // Agrupa em memória: 1 linha por (liga, param) ⇒ 1 entrada por liga
  // com `params` indexado pelo nome. `n` agregado pelo máximo (cada param
  // foi fit com a mesma amostra, mas pode haver discrepância em re-fits
  // parciais — pega o maior por garantia).
  const groupedLeagues = new Map<string, CalibratedLeague>();
  for (const r of leagueRows) {
    const g = groupedLeagues.get(r.league) ?? {
      league: r.league,
      params: {},
      n: 0,
      updated_at: r.created_at,
      model_version: r.model_version,
    };
    g.params[r.param] = Number(r.value);
    g.n = Math.max(g.n, Number(r.n));
    // Usa o created_at mais recente como "atualizada em".
    if (r.created_at > g.updated_at) g.updated_at = r.created_at;
    g.model_version = r.model_version;
    groupedLeagues.set(r.league, g);
  }
  const calibratedLeagues: CalibratedLeague[] = Array.from(
    groupedLeagues.values(),
  ).sort((a, b) => b.n - a.n);

  // ── Wave 5: IA Recommendations (migration 0022). Leitura escalar-only
  // (sem edge_table_snapshot, sem reasoning_full) — Lição B12. Degrada
  // graciosamente: a página continua renderizando outras seções.
  let aiRecoRows: AiRecoRow[] = [];
  let aiRecoQueryError: string | null = null;
  try {
    const { data, error } = await admin
      .from("ai_recommendations")
      .select(
        "id, league, status, verdict, confidence, prob_estimated, prob_calibrated, units_final, bet_won, pl_units",
      )
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error)
      throw new Error(error.message ?? "failed to fetch ai_recommendations");
    aiRecoRows = (data ?? []) as AiRecoRow[];
  } catch (err) {
    aiRecoQueryError = err instanceof Error ? err.message : "erro desconhecido";
  }
  const aiRecoRoi = summarizeAiRecoRoi(aiRecoRows);
  const aiRecoBrier = brierAiReco(aiRecoRows);
  const aiRecoByLeague = groupAiRecoByLeague(aiRecoRows).slice(0, 5);
  const aiRecoByConfidence = groupAiRecoByConfidence(aiRecoRows);

  // ── A2: ROI realizado = bets manuais vinculadas a uma reco IA via
  // `bets.ai_recommendation_id` (migration 0025). Lê via admin client +
  // JOIN PostgREST com `ai_recommendations(league, confidence)` pra
  // herdar metadados da reco no agrupamento. Bets sem reco (ledger
  // legado) ficam fora — métricas só fazem sentido pra recos.
  let realizedBetRows: RealizedBetRow[] = [];
  let realizedQueryError: string | null = null;
  try {
    const { data, error } = await admin
      .from("bets")
      .select(
        "id, ai_recommendation_id, house_id, total_stake, total_odds, status, actual_return, ai_recommendations(league, confidence)",
      )
      .not("ai_recommendation_id", "is", null)
      .order("placed_at", { ascending: false })
      .limit(2000);
    if (error)
      throw new Error(error.message ?? "failed to fetch realized bets");
    // PostgREST embeds the joined row as `ai_recommendations: { league, confidence }`
    // (single object since the FK is many-to-one). Map to flat RealizedBetRow.
    realizedBetRows = ((data ?? []) as Array<Record<string, unknown>>).map(
      (r) => {
        const join = r.ai_recommendations as
          | { league?: unknown; confidence?: unknown }
          | null
          | undefined;
        const conf = join?.confidence;
        return {
          id: String(r.id),
          ai_recommendation_id:
            r.ai_recommendation_id == null
              ? null
              : Number(r.ai_recommendation_id),
          house_id: String(r.house_id ?? ""),
          total_stake: r.total_stake as number | string,
          total_odds: r.total_odds as number | string,
          status: r.status as RealizedBetRow["status"],
          actual_return: (r.actual_return ?? null) as number | string | null,
          league:
            join && typeof join.league === "string" ? join.league : null,
          confidence:
            conf === "alto" || conf === "medio" || conf === "baixo"
              ? conf
              : null,
        };
      },
    );
  } catch (err) {
    realizedQueryError = err instanceof Error ? err.message : "erro desconhecido";
  }
  const realizedRoi = summarizeRealizedRoi(realizedBetRows);
  const realizedByLeague = groupRealizedRoiByLeague(realizedBetRows).slice(0, 5);
  const realizedByConfidence = groupRealizedRoiByConfidence(realizedBetRows);
  // Penetração: quantas das recos resolvidas tiveram bet de fato.
  const realizedPenetration: number | null =
    aiRecoRoi.betCount > 0
      ? realizedRoi.betCount / aiRecoRoi.betCount
      : null;

  // CLV_TARGET constants (matches ClvPanel)
  const CLV_TARGET_PCT = 0.015; // 1.5% as proportion
  const CLV_TARGET_N = 300;

  // ── CLV tracking (tarefa A1): JOIN ai_recommendations × closing_odds.
  // Lê só escalares — odd_captured (taken), league, e o JOIN traz odd_close.
  // Filtra `verdict='bet'` no SQL pra não trazer skips inúteis.
  let clvSamples: ClvSample[] = [];
  let clvQueryError: string | null = null;
  try {
    const { data, error } = await admin
      .from("closing_odds")
      .select(
        "fixture_id, market, side, odd_close, ai_recommendation_id, ai_recommendations(id, league, market, side, odd_captured, verdict)",
      )
      .eq("source", "choistats")
      .limit(2000);
    if (error)
      throw new Error(error.message ?? "failed to fetch closing_odds");
    // PostgREST devolve a relação como objeto único (FK nullable). Filtra
    // linhas órfãs (reco deletada) e mantém só verdict='bet' com odd_captured
    // não-nulo — único cenário válido pra CLV.
    type RawClv = {
      fixture_id: number | null;
      market: string;
      side: string;
      odd_close: number | string;
      ai_recommendation_id: number | null;
      ai_recommendations:
        | {
            id: number;
            league: string | null;
            market: string | null;
            side: string | null;
            odd_captured: number | string | null;
            verdict: string;
          }
        | null;
    };
    const raw = (data ?? []) as unknown as RawClv[];
    clvSamples = raw.flatMap((r): ClvSample[] => {
      const reco = r.ai_recommendations;
      if (!reco) return [];
      if (reco.verdict !== "bet") return [];
      if (reco.odd_captured == null) return [];
      // Só agrega CLV no MESMO market+side da reco. (Capturamos todos os 7
      // markets na fixture, mas só o que a IA escolheu virou bet — comparar
      // odd_close de outros markets contra odd_captured nem faz sentido.)
      if (reco.market !== r.market || reco.side !== r.side) return [];
      if (r.market !== "1x2" && r.market !== "over25" && r.market !== "btts")
        return [];
      const oddTaken =
        typeof reco.odd_captured === "string"
          ? Number.parseFloat(reco.odd_captured)
          : reco.odd_captured;
      const oddClose =
        typeof r.odd_close === "string"
          ? Number.parseFloat(r.odd_close)
          : r.odd_close;
      return [
        {
          ai_recommendation_id: reco.id,
          league: reco.league,
          market: r.market as ClvMarket,
          side: r.side,
          odd_taken: oddTaken,
          odd_close: oddClose,
        },
      ];
    });
  } catch (err) {
    clvQueryError = err instanceof Error ? err.message : "erro desconhecido";
  }

  // Summary cards data — computed here so the server component can pass
  // typed props to SummaryMetricCards.
  // clvSummary.mean is in % (e.g. 1.5 = 1.5%), convert to proportion for SummaryMetricCards.
  const clvSummary = summarizeClv(clvSamples);
  const clvMeanProp = clvSummary.mean != null ? clvSummary.mean / 100 : null;

  const resolvedSims: ResolvedSimRow[] = simRows
    .filter((r) => r.status === "resolved")
    .map((r) => ({
      league: r.league,
      p_home: r.p_home == null ? null : Number(r.p_home),
      p_draw: r.p_draw == null ? null : Number(r.p_draw),
      p_away: r.p_away == null ? null : Number(r.p_away),
      p_over_25: r.p_over_25 == null ? null : Number(r.p_over_25),
      market_anchor: r.market_anchor,
      actual_home_goals: r.actual_home_goals,
      actual_away_goals: r.actual_away_goals,
      actual_resolved_at: r.actual_resolved_at,
    }));

  const relHome = reliabilityBins(resolvedSims, "1x2-home");
  const relOver = reliabilityBins(resolvedSims, "over25");
  const brierTime = brierOverTime(resolvedSims, "week");
  const marketDev = marketDeviation(resolvedSims);

  const resolved = rows.filter((r) => r.status === "resolved");
  const pending = rows.filter((r) => r.status === "pending");
  const unresolvable = rows.filter((r) => r.status === "unresolvable");

  const resolvedForMetrics: Array<ResolvedPrediction & { pred_confidence: number }> =
    resolved.map((r) => ({
      correct_winner: r.correct_winner ?? false,
      correct_over_under: r.correct_over_under ?? false,
      // PostgREST pode devolver numeric como string — coerce explícito aqui
      // evita que calibrationBuckets zere todos os buckets silenciosamente.
      pred_confidence: Number(r.pred_confidence),
    }));

  const rates = hitRate(resolvedForMetrics);
  const buckets = calibrationBuckets(resolvedForMetrics);

  // Breakdown por modelo (apenas predições resolvidas)
  const byModel: Record<string, { total: number; correct: number }> = {};
  for (const r of resolved) {
    const key = abbreviateModel(r.model ?? "desconhecido");
    if (!byModel[key]) byModel[key] = { total: 0, correct: 0 };
    byModel[key].total += 1;
    if (r.correct_winner) byModel[key].correct += 1;
  }

  const isEmpty = rows.length === 0;

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
      <header className="mb-8">
        <span className="label">calibração IA</span>
        <h2 className="mt-2">acerto e calibração do copilot</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          predições do fixture-copilot vs. resultado real (placar final via choistats).
        </p>
      </header>

      {/* Pipeline Health Card — ANTES das métricas. Detecta scrape quebrado,
          sims zeradas, reconciler parado ou recos travadas em 5s. */}
      <PipelineHealthCard data={pipelineHealth} />

      {queryError && (
        <p
          className="card mb-8 p-4 text-sm"
          style={{ color: "var(--color-vermelho)" }}
          role="alert"
        >
          falha ao ler predições: {queryError}
        </p>
      )}

      {isEmpty ? (
        <p className="card mt-8 p-8 text-center text-sm italic text-[var(--color-ink-muted)]">
          sem predições ainda — faça perguntas ao fixture-copilot para gerar predições.
        </p>
      ) : (
        <>
          {/* Cards de resumo */}
          <SummaryCards
            resolved={resolved.length}
            pending={pending.length}
            unresolvable={unresolvable.length}
            rates={rates}
          />

          {/* Breakdown por modelo */}
          {Object.keys(byModel).length > 0 && (
            <section className="mt-10">
              <h3 className="mb-4 text-base font-semibold">acerto por modelo</h3>
              <ModelBreakdown byModel={byModel} />
            </section>
          )}

          {/* Curva de calibração */}
          {resolved.length > 0 && (
            <section className="mt-10">
              <h3 className="mb-4 text-base font-semibold">
                curva de calibração (confiança prevista vs. acerto real)
              </h3>
              <CalibrationBucketsTable buckets={buckets} />
            </section>
          )}
        </>
      )}

      {/* Seção simulação — Brier, SEPARADA do hitRate do copilot.
          fixture_simulations ≠ ai_predictions; nunca conflacionar. */}
      <section className="mt-16 border-t border-[var(--color-line-subtle)] pt-10">
        <header className="mb-6">
          <span className="label">simulação pré-jogo</span>
          <h3 className="mt-2 text-base font-semibold">
            Brier da simulação (Poisson + Dixon-Coles + Monte Carlo)
          </h3>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            qualidade probabilística da simulação vs. resultado real — separado
            do acerto do copilot acima.
          </p>
        </header>

        {simQueryError && (
          <p
            className="card mb-6 p-4 text-sm"
            style={{ color: "var(--color-vermelho)" }}
            role="alert"
          >
            falha ao ler simulações: {simQueryError}
          </p>
        )}

        {simBrier.resolved === 0 ? (
          <p className="card p-8 text-center text-sm italic text-[var(--color-ink-muted)]">
            sem simulações resolvidas ainda — o reconciler preenche o Brier
            após os jogos terminarem.
          </p>
        ) : (
          <SimBrierCards summary={simBrier} />
        )}

        {simBrierByVersion.length > 0 && (
          <section className="mt-10" data-section="sim-brier-by-version">
            <h3 className="mb-4 text-base font-semibold">
              brier por model_version (histórico A/B entre versões do motor)
            </h3>
            <SimBrierByVersionTable rows={simBrierByVersion} />
          </section>
        )}

        {simBrier.resolved > 0 && (
          <>
            {/* U.3 — ReliabilityDiagram SVG (substitui SimReliabilityTable) */}
            <section className="mt-10" data-section="sim-reliability">
              <h3 className="mb-4 text-base font-semibold">
                reliability (probabilidade prevista vs frequência observada)
              </h3>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <ReliabilityDiagram bins={relHome} labelMetric="vitória mandante" />
                <ReliabilityDiagram bins={relOver} labelMetric="over 2.5 gols" />
              </div>
              <details className="mt-4">
                <summary className="cursor-pointer select-none py-2 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                  tabela de dados (reliability)
                </summary>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <SimReliabilityTable bins={relHome} labelMetric="vitória mandante" />
                  <SimReliabilityTable bins={relOver} labelMetric="over 2.5 gols" />
                </div>
              </details>
            </section>
            <section className="mt-10" data-section="sim-brier-time">
              <h3 className="mb-4 text-base font-semibold">
                brier ao longo do tempo (por semana ISO)
              </h3>
              <SimBrierTimeTable buckets={brierTime} />
            </section>
            <section className="mt-10" data-section="sim-market-deviation">
              <h3 className="mb-4 text-base font-semibold">
                desvio vs mercado (modelo p_home vs favorito mercado) por liga
              </h3>
              <SimMarketDevTable rows={marketDev} />
            </section>
          </>
        )}
        {simBrier.resolved === 0 && simRows.length > 0 && (
          <p className="card mt-6 p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
            reliability · brier ao longo do tempo · desvio vs mercado: esperando primeiros jogos resolverem.
          </p>
        )}
      </section>

      {/* Wave 5 — IA Recommendations (migration 0022).
          Mede ROI/WR/Brier sobre as recos resolvidas do IA-2 Recomendador.
          Separado de ai_predictions (legado copilot) e fixture_simulations
          (motor estatístico) — três sistemas distintos, três métricas. */}
      <section className="mt-16 border-t border-[var(--color-line-subtle)] pt-10">
        <header className="mb-6">
          <span className="label">IA-2 recomendador</span>
          <h3 className="mt-2 text-base font-semibold">
            performance das recomendações de aposta (resolved)
          </h3>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            ROI cumulativo, Brier do prob_estimated, e quebra por liga/confidence.
            Inclui apenas recos com status=&ldquo;resolved&rdquo;.
          </p>
        </header>

        {/* U.3 — 3 summary cards grandes no topo */}
        <div className="mb-8" data-section="summary-metric-cards">
          <SummaryMetricCards
            brier={{ value: aiRecoBrier.brier, target: 0.25, label: "Brier estimado" }}
            roi={{ value: aiRecoRoi.roiPerUnit, target: 0.0, label: "ROI" }}
            clv={{ value: clvMeanProp, target: CLV_TARGET_PCT, label: "CLV médio" }}
          />
        </div>

        {/* U.3 — CLV gauge (progresso coleta de amostras) */}
        <div className="mb-8" data-section="clv-gauge-top">
          <ClvGauge
            betCount={clvSummary.n}
            targetCount={CLV_TARGET_N}
            clvPct={clvMeanProp ?? 0}
            targetClvPct={CLV_TARGET_PCT}
          />
        </div>

        {aiRecoQueryError && (
          <p
            className="card mb-6 p-4 text-sm"
            style={{ color: "var(--color-vermelho)" }}
            role="alert"
          >
            falha ao ler ai_recommendations: {aiRecoQueryError}
          </p>
        )}

        <details className="mt-4">
          <summary className="cursor-pointer select-none py-2 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            detalhes técnicos — ROI, Brier, por liga/confidence
          </summary>
          <div className="mt-4 flex flex-col gap-10">
            <div data-section="ai-reco-roi">
              <h3 className="mb-4 text-base font-semibold">ROI e P/L (unidades hipotéticas)</h3>
              <AiRecoRoiCards summary={aiRecoRoi} />
            </div>

            <div data-section="ai-reco-brier">
              <h3 className="mb-4 text-base font-semibold">
                brier do prob_estimated (vs resultado real)
              </h3>
              <AiRecoBrierCard brier={aiRecoBrier} />
            </div>

            <div data-section="ai-reco-by-league">
              <h3 className="mb-4 text-base font-semibold">
                por liga (top 5 por volume)
              </h3>
              <AiRecoByLeagueTable rows={aiRecoByLeague} />
            </div>

            <div data-section="ai-reco-by-confidence">
              <h3 className="mb-4 text-base font-semibold">
                por confidence (sanity: alto deve ter WR &gt; medio &gt; baixo)
              </h3>
              <AiRecoByConfidenceTable rows={aiRecoByConfidence} />
            </div>
          </div>
        </details>

        {/* A2 — ROI realizado (bets vinculadas a recos via 0025). */}
        <details className="mt-12 border-t border-[var(--color-line-subtle)] pt-10">
          <summary className="cursor-pointer select-none py-2 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            A2 · ROI realizado — bets vinculadas a recos IA (apostas reais)
          </summary>
          <div className="mt-6">
            <p className="mb-6 text-sm text-[var(--color-ink-muted)]">
              só conta bets criadas via &ldquo;✅ Apostei&rdquo; no AiRecoPanel
              (`bets.ai_recommendation_id IS NOT NULL`). Compare com o ROI
              hipotético acima — o gap mostra quanto da estratégia ficou
              no papel.
            </p>

            {realizedQueryError && (
              <p
                className="card mb-6 p-4 text-sm"
                style={{ color: "var(--color-vermelho)" }}
                role="alert"
              >
                falha ao ler bets realizadas: {realizedQueryError}
              </p>
            )}

            <div data-section="realized-roi">
              <RealizedRoiCards
                summary={realizedRoi}
                penetration={realizedPenetration}
                totalRecoBets={aiRecoRoi.betCount}
              />
            </div>

            <div className="mt-10" data-section="realized-roi-by-league">
              <h3 className="mb-4 text-base font-semibold">
                por liga (top 5 por volume)
              </h3>
              <RealizedRoiByLeagueTable rows={realizedByLeague} />
            </div>

            <div className="mt-10" data-section="realized-roi-by-confidence">
              <h3 className="mb-4 text-base font-semibold">
                por confidence (do reco IA)
              </h3>
              <RealizedRoiByConfidenceTable rows={realizedByConfidence} />
            </div>
          </div>
        </details>
      </section>

      {/* Tarefa A1 — CLV (Closing Line Value).
          Mede valor capturado vs odd que fechou ~30min pré-KO. Métrica
          única que distingue sorte de skill em ~50 bets (vs 300+ pra
          ROI/Brier). Capture: cron 4x/dia (15/17/19/21 UTC) via
          .github/workflows/closing-odds-capture.yml. */}
      <ClvPanel samples={clvSamples} queryError={clvQueryError} />

      {/* Curvas isotônicas ativas — display somente. Ajuste offline via
          `scripts/calibracao/fit-isotonic.ts`. Aplicação na leitura
          fica como follow-up F3-prod. */}
      <section
        className="mt-16 border-t border-[var(--color-line-subtle)] pt-10"
        data-section="sim-active-calibration"
      >
        <header className="mb-6">
          <span className="label">calibração isotônica</span>
          <h3 className="mt-2 text-base font-semibold">curvas ativas (pós-modelo)</h3>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            ajuste isotônico (PAV) das probabilidades por métrica. Aplicado na
            leitura de cada fixture (`getFixtureSimulation`) — badge
            &ldquo;calibrado (isotônica, n=…)&rdquo; no painel SIM sinaliza.
          </p>
        </header>

        {calQueryError && (
          <p
            className="card mb-6 p-4 text-sm"
            style={{ color: "var(--color-vermelho)" }}
            role="alert"
          >
            falha ao ler curvas: {calQueryError}
          </p>
        )}

        {calRows.length === 0 ? (
          <p className="card p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
            nenhuma curva isotônica ajustada ainda — rode{" "}
            <code>scripts/calibracao/fit-isotonic.ts</code> quando houver ≥30
            resolvidas por métrica.
          </p>
        ) : (
          <ActiveCurvesTable rows={calRows} />
        )}
      </section>

      {/* Parâmetros por liga ativos — display somente. Ajuste offline via
          `scripts/calibracao/fit-league-parameters.ts`. Motor Ruby lê
          esses valores no início de cada scrape via
          Simulation::LeagueCalibration.load. */}
      <section
        className="mt-16 border-t border-[var(--color-line-subtle)] pt-10"
        data-section="sim-league-calibration"
      >
        <header className="mb-6">
          <span className="label">parâmetros por liga</span>
          <h3 className="mt-2 text-base font-semibold">ligas calibradas (MoM)</h3>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            ρ (Dixon-Coles) e baselines de gols ajustados por liga via
            Method of Moments. Substitui o NEUTRAL_BASELINE constante no
            motor de simulação.
          </p>
        </header>

        {leagueQueryError && (
          <p
            className="card mb-6 p-4 text-sm"
            style={{ color: "var(--color-vermelho)" }}
            role="alert"
          >
            falha ao ler parâmetros por liga: {leagueQueryError}
          </p>
        )}

        {!leagueQueryError && calibratedLeagues.length === 0 ? (
          <p className="card p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
            nenhuma liga calibrada ainda — rode{" "}
            <code>scripts/calibracao/fit-league-parameters.ts</code> quando
            houver ≥30 resolvidas por liga.
          </p>
        ) : !leagueQueryError && calibratedLeagues.length > 0 ? (
          <CalibratedLeaguesTable rows={calibratedLeagues} />
        ) : null}
      </section>
    </main>
  );
}

// ── componentes ───────────────────────────────────────────────────────────────

function SummaryCards({
  resolved,
  pending,
  unresolvable,
  rates,
}: {
  resolved: number;
  pending: number;
  unresolvable: number;
  rates: ReturnType<typeof hitRate>;
}) {
  const items: Array<{ label: string; value: string }> = [
    {
      label: "resolvidas",
      value: `${resolved}`,
    },
    {
      label: "pendente",
      value: `${pending}`,
    },
    {
      label: "irresolvável",
      value: `${unresolvable}`,
    },
    {
      label: "acerto winner",
      value: rates ? `${Math.round(rates.winner * 100)}%` : "—",
    },
    {
      label: "acerto over/under",
      value: rates ? `${Math.round(rates.overUnder * 100)}%` : "—",
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((it) => (
        <div key={it.label} className="card flex flex-col gap-1 px-4 py-3">
          <dt className="label text-[var(--color-ink-faint)]">{it.label}</dt>
          <dd className="num text-base tabular-nums text-[var(--color-ink)]">
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SimBrierCards({ summary }: { summary: SimBrierSummary }) {
  const fmt = (v: number | null) => (v == null ? "—" : v.toFixed(3));
  const items: Array<{ label: string; value: string }> = [
    { label: "resolvidas", value: `${summary.resolved}` },
    { label: "brier 1X2", value: fmt(summary.brier1x2) },
    { label: "brier over 2.5", value: fmt(summary.brierOver) },
  ];

  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="card flex flex-col gap-1 px-4 py-3">
          <dt className="label text-[var(--color-ink-faint)]">{it.label}</dt>
          <dd className="num text-base tabular-nums text-[var(--color-ink)]">
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ModelBreakdown({
  byModel,
}: {
  byModel: Record<string, { total: number; correct: number }>;
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
            <Th>modelo</Th>
            <Th className="num text-right">predições</Th>
            <Th className="num text-right">acertos</Th>
            <Th className="num text-right">acerto %</Th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(byModel).map(([model, s]) => (
            <tr
              key={model}
              className="border-b border-[var(--color-line-subtle)] last:border-0"
            >
              <Td>{model}</Td>
              <Td className="num text-right tabular-nums">{s.total}</Td>
              <Td className="num text-right tabular-nums">{s.correct}</Td>
              <Td className="num text-right tabular-nums">
                {Math.round((s.correct / s.total) * 100)}%
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalibrationBucketsTable({
  buckets,
}: {
  buckets: ReturnType<typeof calibrationBuckets>;
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
            <Th>faixa confiança</Th>
            <Th className="num text-right">n</Th>
            <Th className="num text-right">previsto (médio)</Th>
            <Th className="num text-right">realizado</Th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b, i) => (
            <tr
              key={i}
              className="border-b border-[var(--color-line-subtle)] last:border-0"
            >
              <Td className="text-[var(--color-ink-muted)]">
                {Math.round(b.range[0] * 100)}%–{Math.round(b.range[1] * 100)}%
              </Td>
              <Td className="num text-right tabular-nums">
                {b.n > 0 ? b.n : "—"}
              </Td>
              <Td className="num text-right tabular-nums">
                {b.n > 0 ? `${Math.round(b.predictedAvg * 100)}%` : "—"}
              </Td>
              <Td className="num text-right tabular-nums">
                {b.n > 0 ? `${Math.round(b.realizedAccuracy * 100)}%` : "—"}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimReliabilityTable({
  bins,
  labelMetric,
}: {
  bins: Array<{ range: [number, number]; n: number; predictedAvg: number | null; observedFreq: number | null }>;
  labelMetric: string;
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
      <table className="w-full text-left text-sm">
        <caption className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
          {labelMetric}
        </caption>
        <thead>
          <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
            <Th>faixa</Th>
            <Th className="num text-right">n</Th>
            <Th className="num text-right">previsto</Th>
            <Th className="num text-right">observado</Th>
          </tr>
        </thead>
        <tbody>
          {bins.map((b, i) => (
            <tr key={i} className="border-b border-[var(--color-line-subtle)] last:border-0">
              <Td className="text-[var(--color-ink-muted)]">
                {Math.round(b.range[0] * 100)}%–{Math.round(b.range[1] * 100)}%
              </Td>
              <Td className="num text-right tabular-nums">{b.n > 0 ? b.n : "—"}</Td>
              <Td className="num text-right tabular-nums">
                {b.predictedAvg == null ? "—" : `${Math.round(b.predictedAvg * 100)}%`}
              </Td>
              <Td className="num text-right tabular-nums">
                {b.observedFreq == null ? "—" : `${Math.round(b.observedFreq * 100)}%`}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimBrierByVersionTable({
  rows,
}: {
  rows: Array<{ model_version: string } & SimBrierSummary>;
}) {
  const fmt = (v: number | null) => (v == null ? "—" : v.toFixed(3));
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
            <Th>model_version</Th>
            <Th className="num text-right">resolvidas</Th>
            <Th className="num text-right">brier 1X2</Th>
            <Th className="num text-right">brier over 2.5</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.model_version}
              className="border-b border-[var(--color-line-subtle)] last:border-0"
            >
              <Td>{r.model_version}</Td>
              <Td className="num text-right tabular-nums">{r.resolved}</Td>
              <Td className="num text-right tabular-nums">{fmt(r.brier1x2)}</Td>
              <Td className="num text-right tabular-nums">{fmt(r.brierOver)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimBrierTimeTable({ buckets }: { buckets: Array<{ bucket: string; n: number; brier1x2: number | null; brierOver: number | null }> }) {
  if (buckets.length === 0) {
    return (
      <p className="card p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
        sem buckets temporais ainda.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
            <Th>semana</Th>
            <Th className="num text-right">n</Th>
            <Th className="num text-right">brier 1X2</Th>
            <Th className="num text-right">brier over 2.5</Th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.bucket} className="border-b border-[var(--color-line-subtle)] last:border-0">
              <Td className="text-[var(--color-ink-muted)]">{b.bucket}</Td>
              <Td className="num text-right tabular-nums">{b.n}</Td>
              <Td className="num text-right tabular-nums">
                {b.brier1x2 == null ? "—" : b.brier1x2.toFixed(3)}
              </Td>
              <Td className="num text-right tabular-nums">
                {b.brierOver == null ? "—" : b.brierOver.toFixed(3)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimMarketDevTable({ rows }: { rows: Array<{ league: string; n: number; mad: number; modelMean: number; marketMean: number }> }) {
  if (rows.length === 0) {
    return (
      <p className="card p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
        sem market_anchor em resoluções ainda.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
            <Th>liga</Th>
            <Th className="num text-right">n</Th>
            <Th className="num text-right">modelo (médio)</Th>
            <Th className="num text-right">mercado (médio)</Th>
            <Th className="num text-right">MAD</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.league} className="border-b border-[var(--color-line-subtle)] last:border-0">
              <Td>{r.league}</Td>
              <Td className="num text-right tabular-nums">{r.n}</Td>
              <Td className="num text-right tabular-nums">{`${Math.round(r.modelMean * 100)}%`}</Td>
              <Td className="num text-right tabular-nums">{`${Math.round(r.marketMean * 100)}%`}</Td>
              <Td className="num text-right tabular-nums">{r.mad.toFixed(3)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActiveCurvesTable({ rows }: { rows: CalibrationRow[] }) {
  function countPoints(pairs: unknown): number {
    if (!Array.isArray(pairs)) return 0;
    return pairs.length;
  }
  function fmtDate(iso: string): string {
    try {
      return new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";
    } catch {
      return iso;
    }
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
            <Th>métrica</Th>
            <Th>modelo</Th>
            <Th className="num text-right">n (amostras)</Th>
            <Th className="num text-right">pontos da curva</Th>
            <Th>ajustada em</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-b border-[var(--color-line-subtle)] last:border-0"
            >
              <Td>{r.metric}</Td>
              <Td>{r.model_version}</Td>
              <Td className="num text-right tabular-nums">{r.n}</Td>
              <Td className="num text-right tabular-nums">
                {countPoints(r.pairs)}
              </Td>
              <Td className="text-[var(--color-ink-muted)]">
                {fmtDate(r.created_at)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalibratedLeaguesTable({ rows }: { rows: CalibratedLeague[] }) {
  function fmt(value: number | undefined, digits = 3): string {
    if (value == null || !Number.isFinite(value)) return "—";
    return value.toFixed(digits);
  }
  function fmtDate(iso: string): string {
    try {
      return new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";
    } catch {
      return iso;
    }
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
            <Th>liga</Th>
            <Th className="num text-right">n</Th>
            <Th className="num text-right">ρ</Th>
            <Th className="num text-right">avg gols mandante</Th>
            <Th className="num text-right">avg gols visitante</Th>
            <Th>atualizada em</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.league}
              className="border-b border-[var(--color-line-subtle)] last:border-0"
            >
              <Td>{r.league}</Td>
              <Td className="num text-right tabular-nums">{r.n}</Td>
              <Td className="num text-right tabular-nums">
                {fmt(r.params.rho, 3)}
              </Td>
              <Td className="num text-right tabular-nums">
                {fmt(r.params.avg_goals_home, 3)}
              </Td>
              <Td className="num text-right tabular-nums">
                {fmt(r.params.avg_goals_away, 3)}
              </Td>
              <Td className="text-[var(--color-ink-muted)]">
                {fmtDate(r.updated_at)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-[11px] font-normal uppercase tracking-[0.12em] ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 align-middle ${className}`}>{children}</td>;
}

function abbreviateModel(model: string): string {
  const parts = model.split("/");
  const last = parts[parts.length - 1] ?? model;
  return last.replace(/^deepseek-/, "").replace(/-/g, " ");
}

// ── Wave 5: IA Recommendations components ────────────────────────────────────

function AiRecoRoiCards({
  summary,
}: {
  summary: ReturnType<typeof summarizeAiRecoRoi>;
}) {
  if (summary.resolvedCount === 0) {
    return (
      <p className="card p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
        sem recomendações resolvidas ainda — o reconciler preenche P/L após os
        jogos terminarem. 0 bets registradas.
      </p>
    );
  }
  const sign = summary.totalPl >= 0 ? "+" : "";
  const items: Array<{ label: string; value: string }> = [
    { label: "n bets", value: `${summary.betCount}` },
    { label: "won / lost", value: `${summary.won} / ${summary.lost}` },
    {
      label: "win rate",
      value:
        summary.winRate == null
          ? "—"
          : `${Math.round(summary.winRate * 100)}%`,
    },
    { label: "P/L total (u)", value: `${sign}${summary.totalPl.toFixed(2)}` },
    {
      label: "units arriscadas",
      value: summary.totalUnitsRisked.toFixed(2),
    },
    {
      label: "ROI por unit",
      value:
        summary.roiPerUnit == null
          ? "—"
          : `${(summary.roiPerUnit * 100).toFixed(1)}%`,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((it) => (
        <div key={it.label} className="card flex flex-col gap-1 px-4 py-3">
          <dt className="label text-[var(--color-ink-faint)]">{it.label}</dt>
          <dd className="num text-base tabular-nums text-[var(--color-ink)]">
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AiRecoBrierCard({
  brier,
}: {
  brier: ReturnType<typeof brierAiReco>;
}) {
  if (brier.n === 0) {
    return (
      <p className="card p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
        sem dados pra Brier — precisamos de recos resolvidas (bet + bet_won
        definido + prob_estimated).
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div className="card flex flex-col gap-1 px-4 py-3">
        <dt className="label text-[var(--color-ink-faint)]">amostra (n)</dt>
        <dd className="num text-base tabular-nums text-[var(--color-ink)]">
          {brier.n}
        </dd>
      </div>
      <div className="card flex flex-col gap-1 px-4 py-3">
        <dt className="label text-[var(--color-ink-faint)]">brier</dt>
        <dd className="num text-base tabular-nums text-[var(--color-ink)]">
          {brier.brier == null ? "—" : brier.brier.toFixed(3)}
        </dd>
      </div>
    </dl>
  );
}

function AiRecoByLeagueTable({
  rows,
}: {
  rows: ReturnType<typeof groupAiRecoByLeague>;
}) {
  if (rows.length === 0) {
    return (
      <p className="card p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
        sem recos resolvidas por liga ainda.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
            <Th>liga</Th>
            <Th className="num text-right">n (total)</Th>
            <Th className="num text-right">bets</Th>
            <Th className="num text-right">P/L (u)</Th>
            <Th className="num text-right">win rate</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.league}
              className="border-b border-[var(--color-line-subtle)] last:border-0"
            >
              <Td>{r.league}</Td>
              <Td className="num text-right tabular-nums">{r.total}</Td>
              <Td className="num text-right tabular-nums">{r.bets}</Td>
              <Td className="num text-right tabular-nums">
                {`${r.totalPl >= 0 ? "+" : ""}${r.totalPl.toFixed(2)}`}
              </Td>
              <Td className="num text-right tabular-nums">
                {r.winRate == null ? "—" : `${Math.round(r.winRate * 100)}%`}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AiRecoByConfidenceTable({
  rows,
}: {
  rows: ReturnType<typeof groupAiRecoByConfidence>;
}) {
  if (rows.length === 0) {
    return (
      <p className="card p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
        sem confidence labels ainda.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
            <Th>confidence</Th>
            <Th className="num text-right">n (total)</Th>
            <Th className="num text-right">bets</Th>
            <Th className="num text-right">P/L (u)</Th>
            <Th className="num text-right">win rate</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.confidence}
              className="border-b border-[var(--color-line-subtle)] last:border-0"
            >
              <Td>{r.confidence}</Td>
              <Td className="num text-right tabular-nums">{r.total}</Td>
              <Td className="num text-right tabular-nums">{r.bets}</Td>
              <Td className="num text-right tabular-nums">
                {`${r.totalPl >= 0 ? "+" : ""}${r.totalPl.toFixed(2)}`}
              </Td>
              <Td className="num text-right tabular-nums">
                {r.winRate == null ? "—" : `${Math.round(r.winRate * 100)}%`}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── A2: Realized ROI components ──────────────────────────────────────────────

function RealizedRoiCards({
  summary,
  penetration,
  totalRecoBets,
}: {
  summary: ReturnType<typeof summarizeRealizedRoi>;
  penetration: number | null;
  totalRecoBets: number;
}) {
  if (summary.betCount === 0) {
    return (
      <p className="card p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
        nenhuma bet vinculada ainda — clique &ldquo;✅ Apostei&rdquo; em alguma
        reco IA pra começar.
      </p>
    );
  }
  const sign = summary.totalPl >= 0 ? "+" : "";
  const items: Array<{ label: string; value: string }> = [
    {
      label: "n bets (vinculadas)",
      value: `${summary.betCount} de ${totalRecoBets}${
        penetration == null ? "" : ` (${Math.round(penetration * 100)}%)`
      }`,
    },
    {
      label: "resolvidas",
      value: `${summary.resolvedCount}`,
    },
    {
      label: "won / lost / void",
      value: `${summary.won} / ${summary.lost} / ${summary.void}`,
    },
    {
      label: "win rate",
      value:
        summary.winRate == null
          ? "—"
          : `${Math.round(summary.winRate * 100)}%`,
    },
    {
      label: "P/L total (R$)",
      value: `${sign}${summary.totalPl.toFixed(2)}`,
    },
    {
      label: "ROI",
      value:
        summary.roi == null
          ? "—"
          : `${(summary.roi * 100).toFixed(1)}%`,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((it) => (
        <div key={it.label} className="card flex flex-col gap-1 px-4 py-3">
          <dt className="label text-[var(--color-ink-faint)]">{it.label}</dt>
          <dd className="num text-base tabular-nums text-[var(--color-ink)]">
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RealizedRoiByLeagueTable({
  rows,
}: {
  rows: ReturnType<typeof groupRealizedRoiByLeague>;
}) {
  if (rows.length === 0) {
    return (
      <p className="card p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
        sem bets resolvidas por liga ainda.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
            <Th>liga</Th>
            <Th className="num text-right">bets</Th>
            <Th className="num text-right">won</Th>
            <Th className="num text-right">P/L (R$)</Th>
            <Th className="num text-right">win rate</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.league}
              className="border-b border-[var(--color-line-subtle)] last:border-0"
            >
              <Td>{r.league}</Td>
              <Td className="num text-right tabular-nums">{r.bets}</Td>
              <Td className="num text-right tabular-nums">{r.won}</Td>
              <Td className="num text-right tabular-nums">
                {`${r.totalPl >= 0 ? "+" : ""}${r.totalPl.toFixed(2)}`}
              </Td>
              <Td className="num text-right tabular-nums">
                {r.winRate == null ? "—" : `${Math.round(r.winRate * 100)}%`}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RealizedRoiByConfidenceTable({
  rows,
}: {
  rows: ReturnType<typeof groupRealizedRoiByConfidence>;
}) {
  if (rows.length === 0) {
    return (
      <p className="card p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
        sem bets resolvidas por confidence ainda.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
            <Th>confidence</Th>
            <Th className="num text-right">bets</Th>
            <Th className="num text-right">won</Th>
            <Th className="num text-right">P/L (R$)</Th>
            <Th className="num text-right">win rate</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.confidence}
              className="border-b border-[var(--color-line-subtle)] last:border-0"
            >
              <Td>{r.confidence}</Td>
              <Td className="num text-right tabular-nums">{r.bets}</Td>
              <Td className="num text-right tabular-nums">{r.won}</Td>
              <Td className="num text-right tabular-nums">
                {`${r.totalPl >= 0 ? "+" : ""}${r.totalPl.toFixed(2)}`}
              </Td>
              <Td className="num text-right tabular-nums">
                {r.winRate == null ? "—" : `${Math.round(r.winRate * 100)}%`}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
