import type { SupabaseClient } from "@supabase/supabase-js";
import { applyIsotonic } from "@/lib/calibracao/isotonic";
import {
  getActiveCurves,
  type ActiveCurves,
} from "@/lib/calibracao/active-curves-repository";
import { parseChoistatsId } from "@/lib/fixtures/choistats-id";

/**
 * Reader for the `fixture_simulations` table (migration 0018, created by T2
 * in parallel — this module MOCKS records of that exact shape).
 *
 * Scalar-only / Worker constraint (B12/B14/outage 1101): the Cloudflare
 * Worker isolate crashes (Error 1101) when a query pulls the heavy
 * `fixtures.detail_json` blob. `fixture_simulations` is a SEPARATE table
 * whose jsonb fields (`top_scorelines`, `sim_stats`, `market_anchor`,
 * `player_events`) ARE the small pre-computed simulation result itself —
 * selecting them is fine and intentional. What is forbidden is ever
 * referencing `detail_json`. The static guard (T5,
 * `repository-payload-guard.test.ts`) will scan this file's `.select(...)`
 * literal — it must contain no `detail_json` token at all.
 *
 * Defensive like `lib/fixtures/repository.ts`: every failure path
 * (table/migration absent, transient error, malformed row) degrades to
 * `null` instead of crashing the stats page.
 */

/**
 * Exact column list — scalars + the small jsonb simulation-result fields.
 * Inlined into the `.select(...)` call below so the static payload guard
 * (T5) can see the literal; it must never contain `detail_json`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any> | any;

export interface SimScoreline {
  score: string;
  prob: number;
}

/** Per-metric scalar summary (p10/p50/p90) per team/half. */
export type SimStatMetric = Record<string, number>;
export type SimTeamStats = Record<string, SimStatMetric>;
export interface SimStats {
  home: SimTeamStats;
  away: SimTeamStats;
}

export interface SimPlayerEvent {
  id?: string | number;
  name: string;
  p_goal: number;
  expected_goals: number;
  p_card: number;
  p_sot: number;
  provavel_titular: boolean;
  confidence: "baixo" | "médio" | "alto" | string;
}

export type SimMarketAnchor = Record<string, unknown>;

export type SimStatus =
  | "simulated"
  | "unsimulable"
  | "pending"
  | "resolved"
  | string;

export interface FixtureSimulationDTO {
  id: number;
  created_at: string | null;
  fixture_id: number | null;
  home_team: string;
  away_team: string;
  league: string | null;
  kickoff_utc: string | null;
  model_version: string | null;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  p_btts: number | null;
  p_over_25: number | null;
  top_scorelines: SimScoreline[];
  sim_stats: SimStats | null;
  per_half_available: boolean;
  market_anchor: SimMarketAnchor | null;
  player_events: SimPlayerEvent[];
  status: SimStatus;
  actual_home_goals: number | null;
  actual_away_goals: number | null;
  correct_winner: boolean | null;
  correct_over_under: boolean | null;
  actual_resolved_at: string | null;
  /**
   * F3-prod: true sse PELO MENOS UMA das 3 curvas isotônicas 1X2
   * (`1x2-home`/`draw`/`away`) ativa em `model_calibration` para o
   * `model_version` desta sim row foi aplicada. Over25 sozinho NÃO
   * flipa o flag (over25 é side-prob no painel; o flag rastreia se o
   * mercado 1X2 — o ângulo principal — foi recalibrado).
   *
   * Quando true, as probs do DTO JÁ vêm calibradas + 1X2 renormalizado
   * para somar 1.0. O caller pode tratar `p_home`/`p_draw`/`p_away`
   * indistintamente do flag (são sempre o "melhor valor disponível").
   */
  calibrated_via_isotonic: boolean;
  /**
   * Quando `calibrated_via_isotonic = true`, o número de amostras de
   * treino reportado pelas curvas ativas (max(n) das devolvidas). UI usa
   * pra mostrar "calibrado (isotônica, n=<n>)". `null` caso contrário.
   */
  calibration_n: number | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function mapRow(row: Record<string, unknown>): FixtureSimulationDTO {
  return {
    id: Number(row.id),
    created_at: (row.created_at as string | null) ?? null,
    fixture_id:
      row.fixture_id == null ? null : Number(row.fixture_id),
    home_team: String(row.home_team ?? ""),
    away_team: String(row.away_team ?? ""),
    league: (row.league as string | null) ?? null,
    kickoff_utc: (row.kickoff_utc as string | null) ?? null,
    model_version: (row.model_version as string | null) ?? null,
    p_home: num(row.p_home),
    p_draw: num(row.p_draw),
    p_away: num(row.p_away),
    p_btts: num(row.p_btts),
    p_over_25: num(row.p_over_25),
    top_scorelines: asArray<SimScoreline>(row.top_scorelines),
    sim_stats:
      row.sim_stats && typeof row.sim_stats === "object"
        ? (row.sim_stats as SimStats)
        : null,
    per_half_available: row.per_half_available === true,
    market_anchor:
      row.market_anchor && typeof row.market_anchor === "object"
        ? (row.market_anchor as SimMarketAnchor)
        : null,
    player_events: asArray<SimPlayerEvent>(row.player_events),
    status: String(row.status ?? "pending"),
    actual_home_goals: num(row.actual_home_goals),
    actual_away_goals: num(row.actual_away_goals),
    correct_winner:
      typeof row.correct_winner === "boolean" ? row.correct_winner : null,
    correct_over_under:
      typeof row.correct_over_under === "boolean"
        ? row.correct_over_under
        : null,
    actual_resolved_at: (row.actual_resolved_at as string | null) ?? null,
    // F3-prod: defaults; podem ser sobrescritos por applyCalibration() abaixo.
    calibrated_via_isotonic: false,
    calibration_n: null,
  };
}

/**
 * F3-prod: aplica as curvas isotônicas ativas (`model_calibration`) sobre o
 * DTO. Mutação local (DTO recém-construído por mapRow, sem aliases externos).
 *
 * Regras:
 *  - cada curva existente é aplicada à sua métrica (4 independentes);
 *  - 1X2 é re-normalizado pra somar 1.0 mantendo razões; over25 é
 *    independente (mercado separado);
 *  - `calibrated_via_isotonic = true` sse ≥1 das 3 curvas 1X2 foi aplicada;
 *  - `calibration_n` = `meta.n` quando flag for true.
 *
 * Nunca lança — falha em getActiveCurves devolve `{}` e o DTO segue intacto.
 */
async function applyCalibration(
  dto: FixtureSimulationDTO,
  supabase: AnySupabase,
): Promise<FixtureSimulationDTO> {
  // Short-circuit: sem model_version OU sem prob 1X2 não há o que calibrar.
  if (!dto.model_version) return dto;
  if (dto.p_home === null && dto.p_draw === null && dto.p_away === null) {
    return dto;
  }

  const { curves, meta } = await getActiveCurves(dto.model_version, supabase);

  let oneX2Applied = false;

  // 1X2 — aplicar curvas existentes, depois renormalizar.
  const apply1X2 = (
    v: number | null,
    curve: Array<[number, number]> | undefined,
  ): number | null => {
    if (v === null || !Number.isFinite(v)) return v;
    if (!curve || curve.length === 0) return v;
    oneX2Applied = true;
    return applyIsotonic(curve, v);
  };

  const newHome = apply1X2(dto.p_home, curves.oneX2Home);
  const newDraw = apply1X2(dto.p_draw, curves.draw);
  const newAway = apply1X2(dto.p_away, curves.away);

  // Renormalizar 1X2 mantendo razões. Só faz sentido se as 3 são números
  // finitos e a soma > 0.
  if (
    typeof newHome === "number" &&
    typeof newDraw === "number" &&
    typeof newAway === "number"
  ) {
    const S = newHome + newDraw + newAway;
    if (S > 0) {
      dto.p_home = newHome / S;
      dto.p_draw = newDraw / S;
      dto.p_away = newAway / S;
    } else {
      // Soma colapsou para 0 — preserva o melhor que tem (não corrompe).
      dto.p_home = newHome;
      dto.p_draw = newDraw;
      dto.p_away = newAway;
    }
  } else {
    // Alguma prob é null — atribui per-campo sem normalizar.
    dto.p_home = newHome;
    dto.p_draw = newDraw;
    dto.p_away = newAway;
  }

  // Over25 — independente, sem renormalização.
  if (
    curves.over25 &&
    curves.over25.length > 0 &&
    typeof dto.p_over_25 === "number" &&
    Number.isFinite(dto.p_over_25)
  ) {
    dto.p_over_25 = applyIsotonic(curves.over25, dto.p_over_25);
  }

  if (oneX2Applied) {
    dto.calibrated_via_isotonic = true;
    dto.calibration_n = meta.n;
  }
  // Se SÓ over25 foi aplicado: flag fica false (decisão deliberada — over25
  // é side-prob; o flag rastreia o mercado 1X2). Coberto em testes.
  void (curves as ActiveCurves); // pin import (active-curves-repository) caso lint reclame

  return dto;
}

/**
 * The fixture identity needed to locate its pre-computed simulation.
 *
 * Why not the `fixtures` table PK? The Ruby scrape hook
 * (`scripts/scraper/lib/scraper/orchestrator.rb#fixture_api_id`) stores
 * `fixture_simulations.fixture_id` = the **choistats numeric id** parsed from
 * `source_url` (`/fixture/<id>`), NOT the `fixtures` row id. Passing the route
 * id here matched 0 rows → every fixture showed "simulação indisponível"
 * despite a fully-populated table (id-space mismatch). Both producer and
 * consumer now derive the SAME id from the SAME `source_url`.
 */
export interface FixtureSimulationKey {
  sourceUrl: string | null;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string | null;
}

/**
 * Fetches the pre-computed simulation for a fixture. Returns `null` (never
 * throws) when there is no row, the query errors, or the table/migration is
 * not yet applied — the dashboard treats `null` as "simulação indisponível".
 *
 * Lookup strategy:
 *   1. PRIMARY — when `source_url` yields a choistats id, filter
 *      `fixture_id = <parsedId>`. Exact: producer and consumer derive it
 *      from the identical `source_url`, so this matches ~100% of rows.
 *   2. FALLBACK — no parsed id OR primary miss: match by `home_team` +
 *      `away_team`, constrained to the same `kickoff_utc` calendar day (the
 *      same teams can recur within retention, so this DOES constrain by
 *      kickoff), newest `created_at` first, `limit 1`. The day-bucket avoids
 *      timestamptz equality fragility between the Ruby
 *      `strftime('%Y-%m-%d %H:%M:%S UTC')` write and the column.
 *
 * F5 — multi model_version coexistência (migration 0021): a mesma fixture
 * pode ter VÁRIAS linhas distintas por `model_version` (histórico ao longo
 * de bumps do motor). Ambos os paths ordenam por `created_at desc` + limit 1
 * para retornar SEMPRE a versão MAIS RECENTE. /calibracao continua agrupando
 * por model_version separadamente; este reader é o "single-fixture display"
 * que sempre mostra a versão corrente.
 */
export async function getFixtureSimulation(
  key: FixtureSimulationKey,
  supabase: AnySupabase,
): Promise<FixtureSimulationDTO | null> {
  try {
    const apiId = parseChoistatsId(key.sourceUrl);

    if (apiId != null) {
      // F5: pode haver N linhas (uma por model_version); ordenar e pegar a
      // mais recente. .limit(1).maybeSingle() casa com o contrato do mock e
      // do PostgREST (1 row → data; 0 rows → null; sem error).
      const { data, error } = await supabase
        .from("fixture_simulations")
        .select(
          "id, created_at, fixture_id, home_team, away_team, league, " +
            "kickoff_utc, model_version, p_home, p_draw, p_away, p_btts, " +
            "p_over_25, top_scorelines, sim_stats, per_half_available, " +
            "market_anchor, player_events, status, actual_home_goals, " +
            "actual_away_goals, correct_winner, correct_over_under, " +
            "actual_resolved_at",
        )
        .eq("fixture_id", apiId)
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (!error && data) {
        const dto = mapRow(data as Record<string, unknown>);
        return await applyCalibration(dto, supabase);
      }
      // No exact id hit → fall through to the teams/kickoff fallback.
    }

    let q = supabase
      .from("fixture_simulations")
      .select(
        "id, created_at, fixture_id, home_team, away_team, league, " +
          "kickoff_utc, model_version, p_home, p_draw, p_away, p_btts, " +
          "p_over_25, top_scorelines, sim_stats, per_half_available, " +
          "market_anchor, player_events, status, actual_home_goals, " +
          "actual_away_goals, correct_winner, correct_over_under, " +
          "actual_resolved_at",
      )
      .eq("home_team", key.homeTeam)
      .eq("away_team", key.awayTeam);

    if (key.kickoffUtc) {
      const day = key.kickoffUtc.slice(0, 10); // YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        // Match on the kickoff calendar day (UTC) — robust against the Ruby
        // write format vs the timestamptz column.
        q = q
          .gte("kickoff_utc", `${day}T00:00:00Z`)
          .lt("kickoff_utc", `${day}T23:59:59.999Z`);
      }
    }

    const { data, error } = await q
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    const dto = mapRow(data as Record<string, unknown>);
    return await applyCalibration(dto, supabase);
  } catch {
    // Table/migration absent or transient client error → graceful null.
    return null;
  }
}
