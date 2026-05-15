"use client";

/**
 * Painel G+ · players ranking + mini scatter.
 *
 * Top 5 home + top 5 away por critério configurável (goals, cards, first_cards,
 * sot, assists). Estado serializado em `?player_rank=`. Abaixo, scatter
 * recharts X=minutos × Y=eficiência ((goals+assists)*90/minutes), dots
 * coloridos por lado.
 */

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  CartesianGrid,
  Label,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { derivePlayerRankings } from "@/lib/fixtures/stats/derive";
import type {
  Player,
  PlayerRankingCriterion,
  PlayerRanked,
} from "@/lib/fixtures/stats/detail-json-types";
import { fmtInt, fmtNum } from "@/lib/fixtures/stats/format";
import { useUrlPatcher } from "@/lib/fixtures/stats/use-url-state";
import { InfoPopover } from "@/components/fixtures/stats/_primitives/info-popover";
import { RichTooltipCard } from "@/components/fixtures/stats/_primitives/rich-tooltip";
import { TeamLegend } from "@/components/fixtures/stats/_primitives/team-legend";

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

interface PlayersProps {
  homeTeam: string;
  awayTeam: string;
  home: Player[];
  away: Player[];
  /** Fixed width for tests; omit in prod → ResponsiveContainer. */
  width?: number;
  height?: number;
}

const CRITERIA: Array<{ key: PlayerRankingCriterion; label: string }> = [
  { key: "goals", label: "goals" },
  { key: "cards", label: "cards" },
  { key: "first_cards", label: "first cards" },
  { key: "sot", label: "sot" },
  { key: "assists", label: "assists" },
];

function isCriterion(v: string | null): v is PlayerRankingCriterion {
  return v === "goals" || v === "cards" || v === "first_cards" || v === "sot" || v === "assists";
}

function valueFor(p: PlayerRanked, criterion: PlayerRankingCriterion): number {
  switch (criterion) {
    case "goals":
      return p.goals;
    case "cards":
      return p.card_score ?? p.yellows + p.reds * 2;
    case "first_cards":
      return p.first_cards;
    case "sot":
      return p.shots_on_target;
    case "assists":
      return p.assists;
  }
}

function efficiencyPer90(p: Player): number {
  if (p.minutes <= 0) return 0;
  return ((p.goals + p.assists) * 90) / p.minutes;
}

const URL_DEFAULTS = { player_rank: "goals" };

export function Players({
  homeTeam,
  awayTeam,
  home,
  away,
  width,
  height = 220,
}: PlayersProps) {
  const searchParams = useSearchParams();
  const patchUrl = useUrlPatcher(URL_DEFAULTS);

  const initialCriterion = useMemo<PlayerRankingCriterion>(() => {
    const raw = searchParams.get("player_rank");
    return isCriterion(raw) ? raw : "goals";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [criterion, setCriterion] = useState<PlayerRankingCriterion>(initialCriterion);

  const setAndSync = useCallback(
    (c: PlayerRankingCriterion) => {
      setCriterion(c);
      patchUrl({ player_rank: c });
    },
    [patchUrl],
  );

  const rankedHome = useMemo(() => derivePlayerRankings(home, criterion).slice(0, 5), [home, criterion]);
  const rankedAway = useMemo(() => derivePlayerRankings(away, criterion).slice(0, 5), [away, criterion]);

  const empty = home.length === 0 && away.length === 0;

  if (empty) {
    return (
      <div
        className="card flex items-center justify-center p-4"
        style={{ height: height + 200 }}
      >
        <span className="label text-[var(--color-ink-faint)]">sem dados</span>
      </div>
    );
  }

  return (
    <div className="card @container/card flex flex-col gap-4 p-4 lg:p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg text-[var(--color-ink-display)]">
          Players
        </h3>
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="critério de ranking"
        >
          {CRITERIA.map((c) => {
            const active = criterion === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setAndSync(c.key)}
                aria-pressed={active}
                className={[
                  "label rounded-[var(--radius-sm)] border px-2 py-1 transition-colors",
                  active
                    ? "border-[var(--color-vermelho-low)] bg-[color-mix(in_srgb,var(--color-vermelho)_15%,transparent)] text-[var(--color-vermelho)]"
                    : "border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]",
                ].join(" ")}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RankColumn
          testid="players-home"
          teamLabel={homeTeam}
          accent="var(--color-vermelho)"
          players={rankedHome}
          criterion={criterion}
        />
        <RankColumn
          testid="players-away"
          teamLabel={awayTeam}
          accent="var(--color-depth)"
          players={rankedAway}
          criterion={criterion}
        />
      </div>

      <ScatterEfficiency
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        home={home}
        away={away}
        width={width}
        height={height}
      />
    </div>
  );
}

interface RankColumnProps {
  testid: string;
  teamLabel: string;
  accent: string;
  players: PlayerRanked[];
  criterion: PlayerRankingCriterion;
}

function RankColumn({ testid, teamLabel, accent, players, criterion }: RankColumnProps) {
  return (
    <div data-testid={testid} className="flex flex-col gap-1">
      <span className="label" style={{ color: accent }}>
        {teamLabel}
      </span>
      {players.length === 0 ? (
        <p className="label text-[var(--color-ink-faint)]">sem dados</p>
      ) : (
        <ul className="flex flex-col">
          {players.map((p, idx) => (
            <li
              key={`${p.name}-${idx}`}
              data-testid="player-row"
              className="flex items-center justify-between border-b border-[var(--color-line)] py-1.5 last:border-b-0"
            >
              <span className="flex items-center gap-2 truncate text-sm text-[var(--color-ink-display)]">
                {p.injured ? (
                  <span
                    data-testid="injury-icon"
                    aria-label="lesionado"
                    title="lesionado"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: "var(--color-vermelho)" }}
                  />
                ) : null}
                <span className="truncate">{p.name}</span>
              </span>
              <span
                className="num text-base font-semibold"
                style={{ color: accent }}
              >
                {valueFor(p, criterion)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ScatterEfficiencyProps {
  homeTeam: string;
  awayTeam: string;
  home: Player[];
  away: Player[];
  width?: number;
  height?: number;
}

interface ScatterDot {
  x: number;
  y: number;
  name: string;
  sideName: string;
}

interface ScatterTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ScatterDot }>;
}

/**
 * Adaptador recharts → RichTooltipCard. Valores SEMPRE via fmt* (minutos
 * com fmtInt — "2.480"; eff com fmtNum — "0.45", nunca o float cru).
 */
export function PlayerScatterTooltip({ active, payload }: ScatterTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <RichTooltipCard
      title={`${d.name} · ${d.sideName}`}
      rows={[
        { k: "Minutos", v: fmtInt(d.x) },
        { k: "G+A /90", v: fmtNum(d.y) },
      ]}
      reading={
        d.y >= 0.5
          ? "Decisivo: gera gol/assistência acima da média."
          : "Baixo retorno ofensivo por 90min jogados."
      }
    />
  );
}

function ScatterEfficiency({
  homeTeam,
  awayTeam,
  home,
  away,
  width,
  height = 220,
}: ScatterEfficiencyProps) {
  const homeDots = useMemo<ScatterDot[]>(
    () =>
      home
        .filter((p) => p.minutes > 0)
        .map((p) => ({
          x: p.minutes,
          y: efficiencyPer90(p),
          name: p.name,
          sideName: homeTeam,
        })),
    [home, homeTeam],
  );
  const awayDots = useMemo<ScatterDot[]>(
    () =>
      away
        .filter((p) => p.minutes > 0)
        .map((p) => ({
          x: p.minutes,
          y: efficiencyPer90(p),
          name: p.name,
          sideName: awayTeam,
        })),
    [away, awayTeam],
  );

  const { medX, medY } = useMemo(() => {
    const all = [...homeDots, ...awayDots];
    return {
      medX: median(all.map((d) => d.x)),
      medY: median(all.map((d) => d.y)),
    };
  }, [homeDots, awayDots]);

  if (homeDots.length === 0 && awayDots.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label flex items-center gap-1.5 text-[var(--color-ink-muted)]">
          minutos × decisivo /90min
          <InfoPopover label="como ler o gráfico de jogadores">
            <p>
              Cada ponto é um jogador. Eixo X = minutos jogados (volume); eixo Y
              = (gols + assistências) por 90min (eficiência). As linhas marcam a
              mediana de cada eixo — quem cai no canto superior direito é{" "}
              <strong>titular decisivo</strong> (joga muito e produz muito).
            </p>
          </InfoPopover>
        </span>
        <TeamLegend home={homeTeam} away={awayTeam} />
      </div>
      {width !== undefined ? (
        <div style={{ width, height }}>
          <ScatterBody
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            homeDots={homeDots}
            awayDots={awayDots}
            medX={medX}
            medY={medY}
            width={width}
            height={height}
          />
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <ScatterBody
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            homeDots={homeDots}
            awayDots={awayDots}
            medX={medX}
            medY={medY}
          />
        </ResponsiveContainer>
      )}
      <p className="text-xs text-[var(--color-ink-faint)]">
        Canto superior direito = mais minutos e mais decisivo.
      </p>
    </div>
  );
}

interface ScatterBodyProps {
  homeTeam: string;
  awayTeam: string;
  homeDots: ScatterDot[];
  awayDots: ScatterDot[];
  medX: number;
  medY: number;
  width?: number;
  height?: number;
}

function ScatterBody({
  homeTeam,
  awayTeam,
  homeDots,
  awayDots,
  medX,
  medY,
  width,
  height,
}: ScatterBodyProps) {
  return (
    <ScatterChart
      margin={{ top: 12, right: 16, left: 4, bottom: 16 }}
      {...(width !== undefined ? { width } : {})}
      {...(height !== undefined ? { height } : {})}
    >
      <CartesianGrid stroke="var(--color-ink-faint)" strokeOpacity={0.15} />
      <XAxis
        type="number"
        dataKey="x"
        name="minutos"
        tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
        stroke="var(--color-ink-faint)"
      >
        <Label
          value="Minutos jogados"
          position="insideBottom"
          offset={-10}
          style={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
        />
      </XAxis>
      <YAxis
        type="number"
        dataKey="y"
        name="eff/90"
        tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
        stroke="var(--color-ink-faint)"
      >
        <Label
          value="Decisivo /90min"
          angle={-90}
          position="insideLeft"
          style={{ fill: "var(--color-ink-muted)", fontSize: 11, textAnchor: "middle" }}
        />
      </YAxis>
      <ReferenceLine
        x={medX}
        stroke="var(--color-ink-faint)"
        strokeDasharray="4 4"
      />
      <ReferenceLine
        y={medY}
        stroke="var(--color-ink-faint)"
        strokeDasharray="4 4"
      >
        <Label
          value="titular decisivo"
          position="insideTopRight"
          style={{ fill: "var(--color-ink-muted)", fontSize: 10 }}
        />
      </ReferenceLine>
      <Tooltip
        cursor={{ strokeDasharray: "3 3" }}
        content={<PlayerScatterTooltip />}
      />
      <Scatter
        name={homeTeam}
        data={homeDots}
        fill="#c42b2b"
        isAnimationActive={false}
      />
      <Scatter
        name={awayTeam}
        data={awayDots}
        fill="#1a5fad"
        isAnimationActive={false}
      />
    </ScatterChart>
  );
}
