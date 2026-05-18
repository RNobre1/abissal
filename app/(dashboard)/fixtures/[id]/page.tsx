import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatUtcAsBrt, toIsoUtc, trimKoTime } from "@/lib/fixtures/time";
import type { FixtureRow } from "@/lib/fixtures/types";
import type {
  DetailJson,
  NormalizedRecentMatch,
  OddsMarket,
  OddsSummary,
  RefereeRecord,
} from "@/lib/fixtures/stats/detail-json-types";
import { StatsLayout, type PanelSlot } from "@/components/fixtures/stats/stats-layout";
import { Hero, type HeroKpiBundle } from "@/components/fixtures/stats/hero";
import {
  deriveTeamRecord,
  deriveRecentMatchStats,
  deriveSplits1h2h,
  deriveDistributions,
  deriveRadarAxes,
  deriveStreakIndex,
  deriveOddsCategories,
} from "@/lib/fixtures/stats/derive";
import {
  computeCorrelations,
  computeTrends,
  computePatterns,
  computeOutliers,
  rankInsights,
  type Insight,
} from "@/lib/fixtures/stats/insights";
import { TeamRecord } from "@/components/fixtures/stats/panels/team-record";
import { H2H } from "@/components/fixtures/stats/panels/h2h";
import { Splits1h2h } from "@/components/fixtures/stats/panels/splits-1h-2h";
import { Referee } from "@/components/fixtures/stats/panels/referee";
import { Predictions } from "@/components/fixtures/stats/panels/predictions";
import { Distributions } from "@/components/fixtures/stats/panels/distributions";
import { Insights } from "@/components/fixtures/stats/panels/insights";
import {
  MomentumChart,
  type MomentumPoint,
} from "@/components/fixtures/stats/panels/momentum-chart";
import { RecentMatchesPanel } from "@/components/fixtures/stats/panels/recent-matches";
import { RadarComparison } from "@/components/fixtures/stats/panels/radar-comparison";
import { ScatterPlayground } from "@/components/fixtures/stats/panels/scatter-playground";
import { StreaksHeatmap } from "@/components/fixtures/stats/panels/streaks-heatmap";
import { Players } from "@/components/fixtures/stats/panels/players";
import { MarketsBrowser } from "@/components/fixtures/stats/panels/markets-browser";
import { FixtureCopilotDrawer } from "@/components/fixtures/fixture-copilot-drawer";
import { getFixtureSimulation } from "@/lib/fixtures/simulation-repository";
import { SimulationPanel } from "./_components/simulation-panel";

export const dynamic = "force-dynamic";

const FIXTURE_COLUMNS =
  "id, match_date, ko_time, home_team, away_team, league, country, source_url, detail_json, kickoff_utc";

interface StatsPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Picks a decimal odd from a market by trying a list of candidate keys.
 * Tolerant: returns null when the market is missing or no candidate matched.
 */
function pickOdd(market: OddsMarket | undefined, keys: string[]): number | null {
  if (!market) return null;
  for (const k of keys) {
    const outcome = market[k];
    if (outcome && typeof outcome.decimal_odds === "number") {
      return outcome.decimal_odds;
    }
  }
  // Fallback — case-insensitive contains for fuzzy team-name matches.
  const entries = Object.entries(market);
  for (const candidate of keys) {
    const needle = candidate.toLowerCase();
    const hit = entries.find(
      ([name]) => name.toLowerCase().includes(needle) && needle.length >= 3,
    );
    if (hit && typeof hit[1].decimal_odds === "number") {
      return hit[1].decimal_odds;
    }
  }
  return null;
}

/**
 * Finds the Result market entry for the home team. Real choistats payloads
 * key by long team names (e.g. "Tottenham Hotspur" while fixtures.home_team
 * is "Tottenham"), so we accept either an exact match or the first non-Draw
 * key as fallback.
 */
function pickResultOdds(
  market: OddsMarket | undefined,
  homeTeam: string,
  awayTeam: string,
): { home: number | null; draw: number | null; away: number | null } {
  if (!market) return { home: null, draw: null, away: null };

  const direct = (key: string): number | null => {
    const o = market[key];
    return o && typeof o.decimal_odds === "number" ? o.decimal_odds : null;
  };

  const draw = direct("Draw");

  const nonDraw = Object.entries(market).filter(
    ([k]) => k.toLowerCase() !== "draw",
  );

  const matchByContains = (team: string): number | null => {
    const needle = team.toLowerCase();
    const hit = nonDraw.find(
      ([name]) =>
        name.toLowerCase().includes(needle) ||
        needle.includes(name.toLowerCase()),
    );
    return hit && typeof hit[1].decimal_odds === "number"
      ? hit[1].decimal_odds
      : null;
  };

  let home = matchByContains(homeTeam);
  let away = matchByContains(awayTeam);

  // If we couldn't tag by name, fall back to positional (1st non-Draw = home).
  if (home === null && nonDraw.length >= 1) {
    const o = nonDraw[0][1];
    if (typeof o.decimal_odds === "number") home = o.decimal_odds;
  }
  if (away === null && nonDraw.length >= 2) {
    const o = nonDraw[1][1];
    if (typeof o.decimal_odds === "number") away = o.decimal_odds;
  }

  return { home, draw, away };
}

/**
 * Builds a chronological-order MomentumPoint[] from normalized recent matches.
 *
 * `deriveRecentMatchStats` returns newest→oldest (adamchoi convention reversed
 * upstream). lightweight-charts requires ascending timestamps, so we reverse
 * and skip matches without a parseable date or `goals_ft_for` value.
 */
function buildMomentumSeries(
  matches: NormalizedRecentMatch[],
): MomentumPoint[] {
  const out: MomentumPoint[] = [];
  // newest→oldest → flip to oldest→newest for the timescale axis.
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    if (!m.date_iso) continue;
    const v = m.goals_ft_for;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    out.push({ time: m.date_iso, value: v });
  }
  return out;
}

function deriveHeroKpis(
  detail: DetailJson | null,
  homeTeam: string,
  awayTeam: string,
): HeroKpiBundle | null {
  if (!detail) return null;

  const odds = (detail.odds_summary ?? {}) as OddsSummary;
  const result = odds["Result"] as OddsMarket | undefined;
  const goals = odds["Match Goals Overs/Unders"] as OddsMarket | undefined;
  const btts = odds["BTTS"] as OddsMarket | undefined;
  const ref = (detail.referee_record ?? null) as RefereeRecord | null;

  const { home: home_odd, draw: draw_odd, away: away_odd } = pickResultOdds(
    result,
    homeTeam,
    awayTeam,
  );

  return {
    home_odd,
    draw_odd,
    away_odd,
    over25_odd: pickOdd(goals, ["Over 2.5"]),
    btts_yes_odd: pickOdd(btts, ["Yes"]),
    ref_avg_bp:
      ref && typeof ref.avg_total_booking_points === "number"
        ? ref.avg_total_booking_points
        : null,
  };
}

export default async function StatsPage({ params }: StatsPageProps) {
  const { id: rawId } = await params;
  if (!/^\d+$/.test(rawId)) notFound();
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const admin = createAdminClient();
  // The `fixtures` table is not reflected in the generated Database type
  // yet — same escape hatch as app/(dashboard)/fixtures/[id]/page.tsx.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = admin as unknown as { from: (t: string) => any };
  const { data, error } = await untyped
    .from("fixtures")
    .select(FIXTURE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`failed to load fixture ${id}: ${error.message}`);
  }
  if (!data) {
    notFound();
  }

  const row = data as FixtureRow;
  const detail = (row.detail_json ?? null) as DetailJson | null;

  const kickoffIso = toIsoUtc(row.kickoff_utc);
  const kickoffBrt =
    formatUtcAsBrt(kickoffIso) ?? trimKoTime(row.ko_time) ?? null;

  // Pre-game simulation (separate scalar-only table). Degrades to null when
  // the migration/table is absent — the SIM panel shows a graceful
  // "simulação indisponível" state instead of crashing the page.
  const sim = await getFixtureSimulation(row.id, untyped);

  const kpis = deriveHeroKpis(detail, row.home_team, row.away_team);
  const panels = buildPanels(
    detail,
    row.home_team,
    row.away_team,
    sim,
  );

  return (
    <>
      <StatsLayout
        fixtureId={row.id}
        hero={
          <Hero
            homeTeam={row.home_team}
            awayTeam={row.away_team}
            kickoffBrt={kickoffBrt}
            league={row.league}
            country={row.country}
            kpis={kpis}
          />
        }
        panels={panels}
      />
      <FixtureCopilotDrawer
        fixtureId={row.id}
        homeTeam={row.home_team}
        awayTeam={row.away_team}
      />
    </>
  );
}

/**
 * Assembles the 12-column panel grid for the stats page.
 *
 * Returns `[]` when `detail` is null — the layout already shows
 * "painéis em construção" in that case. Optional panels (Referee,
 * Predictions, Insights) self-render `null` when their data is empty;
 * we still mount them so the Suspense slot can stream in if data arrives.
 */
/**
 * Reads the enriched T1 `avgs` foundation field (num_matches per side) off
 * detail_json — the page already holds detail in memory via the existing
 * scalar-safe FIXTURE_COLUMNS path, so this introduces no new heavy select.
 * Used only to honestly surface the model's sample size in the SIM panel.
 */
function readAvgsSampleSize(
  detail: DetailJson | null,
): { home: number | null; away: number | null } {
  const avgs = (detail as unknown as { avgs?: Record<string, unknown> } | null)
    ?.avgs;
  const pick = (block: unknown): number | null => {
    if (!block || typeof block !== "object") return null;
    const n = (block as Record<string, unknown>).num_matches;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };
  return {
    home: pick(avgs?.home_overall) ?? pick(avgs?.home_home),
    away: pick(avgs?.away_overall) ?? pick(avgs?.away_away),
  };
}

function buildPanels(
  detail: DetailJson | null,
  homeTeam: string,
  awayTeam: string,
  sim: Awaited<ReturnType<typeof getFixtureSimulation>>,
): PanelSlot[] {
  const simSlot: PanelSlot = {
    id: "SIM",
    colSpan: "span 12 / span 12",
    label: "simulação pré-jogo",
    node: (
      <SimulationPanel
        sim={sim}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        sampleSize={readAvgsSampleSize(detail)}
      />
    ),
  };

  if (!detail) return [simSlot];

  const homeRecord = deriveTeamRecord(detail.team_record?.home);
  const awayRecord = deriveTeamRecord(detail.team_record?.away);

  const recentHome = deriveRecentMatchStats(
    detail.recent_matches?.home,
    detail.recent_matches?.home,
    homeTeam,
  );
  const recentAway = deriveRecentMatchStats(
    detail.recent_matches?.away,
    detail.recent_matches?.away,
    awayTeam,
  );

  const splitsHome = deriveSplits1h2h(recentHome);
  const distHome = deriveDistributions(recentHome);
  const distAway = deriveDistributions(recentAway);
  const radar = deriveRadarAxes(recentHome, recentAway);

  const momentumHome = buildMomentumSeries(recentHome);
  const momentumAway = buildMomentumSeries(recentAway);

  // Wave 4 derivers — F (streaks), G+ (players), H (markets-browser).
  // Each panel handles empty inputs internally; we always mount the slots
  // so the layout stays stable and URL state survives refresh.
  const streakIndex = deriveStreakIndex([
    ...(detail.streaks?.home ?? []),
    ...(detail.streaks?.away ?? []),
  ]);
  const playersHome = detail.player_stats?.home?.top_players ?? [];
  const playersAway = detail.player_stats?.away?.top_players ?? [];
  const oddsCategories = deriveOddsCategories(detail.odds_summary ?? null);

  // Insights — compute the four kinds across the home team's recent matches
  // (the "fixture perspective" for the upcoming match), then rank.
  const allInsights: Insight[] = [
    ...computeCorrelations(recentHome),
    ...computeTrends(recentHome),
    ...computePatterns({
      streaks: detail.streaks ?? { home: [], away: [] },
      referee: detail.referee_record ?? null,
      matches: recentHome,
    }),
    ...computeOutliers(recentHome),
  ];
  const insights = rankInsights(allInsights);

  return [
    simSlot,
    {
      id: "B",
      colSpan: "span 12 / span 12",
      h: 280,
      label: "momentum",
      node: (
        <MomentumChart
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          home={momentumHome}
          away={momentumAway}
        />
      ),
    },
    {
      id: "A-home",
      colSpan: "span 6 / span 6",
      label: "team record home",
      node: <TeamRecord teamName={homeTeam} data={homeRecord} />,
    },
    {
      id: "A-away",
      colSpan: "span 6 / span 6",
      label: "team record away",
      node: <TeamRecord teamName={awayTeam} data={awayRecord} />,
    },
    {
      id: "D",
      colSpan: "span 6 / span 6",
      label: "h2h",
      node: (
        <H2H
          matches={detail.h2h ?? []}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
        />
      ),
    },
    {
      id: "E",
      colSpan: "span 6 / span 6",
      label: "splits 1h vs 2h",
      node: <Splits1h2h data={splitsHome} />,
    },
    {
      id: "M",
      colSpan: "span 12 / span 12",
      h: 360,
      label: "distributions",
      node: <Distributions home={distHome} away={distAway} />,
    },
    {
      id: "K",
      colSpan: "span 6 / span 6",
      h: 360,
      label: "radar comparison",
      node: (
        <RadarComparison
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          data={radar}
        />
      ),
    },
    {
      id: "L",
      colSpan: "span 6 / span 6",
      h: 360,
      label: "scatter playground",
      node: (
        <ScatterPlayground
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          home={recentHome}
          away={recentAway}
        />
      ),
    },
    {
      id: "I",
      colSpan: "span 6 / span 6",
      label: "referee",
      node: <Referee record={detail.referee_record ?? null} />,
    },
    {
      id: "J",
      colSpan: "span 6 / span 6",
      label: "predictions",
      node: (
        <Predictions
          data={detail.predictions ?? []}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
        />
      ),
    },
    {
      id: "N",
      colSpan: "span 12 / span 12",
      label: "insights",
      node: <Insights insights={insights} />,
    },
    {
      id: "F",
      colSpan: "span 12 / span 12",
      label: "streaks heatmap",
      node: <StreaksHeatmap data={streakIndex} />,
    },
    {
      id: "G+",
      colSpan: "span 12 / span 12",
      label: "players",
      node: (
        <Players
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          home={playersHome}
          away={playersAway}
        />
      ),
    },
    {
      id: "H",
      colSpan: "span 12 / span 12",
      label: "markets browser",
      node: <MarketsBrowser data={oddsCategories} />,
    },
    {
      id: "C-home",
      colSpan: "span 12 / span 12",
      label: "recent matches home",
      node: (
        <RecentMatchesPanel
          matches={recentHome}
          teamName={homeTeam}
          title={`Últimos jogos · ${homeTeam}`}
        />
      ),
    },
    {
      id: "C-away",
      colSpan: "span 12 / span 12",
      label: "recent matches away",
      node: (
        <RecentMatchesPanel
          matches={recentAway}
          teamName={awayTeam}
          title={`Últimos jogos · ${awayTeam}`}
        />
      ),
    },
  ];
}
