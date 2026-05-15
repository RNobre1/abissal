"use client";

import { useMemo, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import regression from "regression";
import type { NormalizedRecentMatch } from "@/lib/fixtures/stats/detail-json-types";
import { deriveRecentSeries } from "@/lib/fixtures/stats/derive";
import { fmtNum } from "@/lib/fixtures/stats/format";
import { ChartFrame } from "@/components/fixtures/stats/_primitives/chart-frame";
import {
  TeamLegend,
  teamColor,
} from "@/components/fixtures/stats/_primitives/team-legend";
import { RichTooltipCard } from "@/components/fixtures/stats/_primitives/rich-tooltip";
import { InfoPopover } from "@/components/fixtures/stats/_primitives/info-popover";

/**
 * Stat keys exposed in the toggle. Each maps to a numeric field on
 * NormalizedRecentMatch. `deriveRecentSeries` returns `null` (not 0) when
 * the source field is null/undefined — recharts skips null on `<Line>`
 * (default `connectNulls=false`) and the trend regression filters
 * non-finite values before fitting, so leagues that don't publish e.g.
 * SOT no longer drag the trend toward zero silently.
 */
type ToggleKey = "goals_ft" | "sot" | "corners" | "booking_points";

const CHIPS: Array<{ key: ToggleKey; label: string }> = [
  { key: "goals_ft", label: "gols FT" },
  { key: "sot", label: "SOT" },
  { key: "corners", label: "cantos" },
  { key: "booking_points", label: "booking" },
];

/** Map a toggle key to the matching `NormalizedRecentMatch` "for" field. */
const METRIC_BY_KEY: Record<ToggleKey, keyof NormalizedRecentMatch> = {
  goals_ft: "goals_ft_for",
  sot: "sot_for",
  corners: "corners_for",
  booking_points: "booking_points_for",
};

interface RecentMatchesPanelProps {
  matches: NormalizedRecentMatch[];
  title: string;
  /** Team this single series belongs to — shown in the legend. */
  teamName?: string;
  /** Fixed chart width for tests; omit in prod for ResponsiveContainer. */
  width?: number;
  height?: number;
}

interface ChartRow {
  label: string;
  opponent: string;
  value: number | null;
  trend: number | null;
}

/** recharts Tooltip adapter → RichTooltipCard. */
function RecentTooltip({
  active,
  payload,
  metricLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
  metricLabel: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <RichTooltipCard
      title={`vs ${row.opponent}`}
      rows={[
        { k: metricLabel, v: fmtNum(row.value) },
        { k: "tendência", v: fmtNum(row.trend) },
      ]}
    />
  );
}

/**
 * Painel C+ · recent matches — uma série numérica por chip selecionável,
 * com sobreposição de uma trend line dashed via regressão linear.
 *
 * Os dados vêm já ordenados (newest → oldest do derive); pra plotar
 * cronologicamente reverte o array antes de pôr na chart. O eixo X usa
 * a abreviação do adversário (`deriveRecentSeries.xLabels`) e uma linha
 * de referência marca a média do período.
 */
export function RecentMatchesPanel({
  matches,
  title,
  teamName,
  width,
  height = 240,
}: RecentMatchesPanelProps) {
  const [active, setActive] = useState<ToggleKey>("goals_ft");

  const chrono = useMemo(() => [...matches].reverse(), [matches]);

  const series = useMemo(
    () => deriveRecentSeries(chrono, METRIC_BY_KEY[active]),
    [chrono, active],
  );

  const chartData = useMemo<ChartRow[]>(() => {
    if (chrono.length === 0) return [];
    const values = series.values;
    const finitePoints: Array<[number, number]> = [];
    values.forEach((v, i) => {
      if (typeof v === "number" && Number.isFinite(v))
        finitePoints.push([i, v]);
    });
    let predictAt: ((i: number) => number | null) | null = null;
    if (finitePoints.length >= 2) {
      const fit = regression.linear(finitePoints, { precision: 6 });
      const slope = fit.equation[0];
      const intercept = fit.equation[1];
      if (Number.isFinite(slope) && Number.isFinite(intercept)) {
        predictAt = (i: number) => slope * i + intercept;
      }
    }
    return chrono.map((m, i) => ({
      label: series.xLabels[i],
      opponent: m.opponent ?? "?",
      value: values[i],
      trend: predictAt ? predictAt(i) : null,
    }));
  }, [chrono, series]);

  const yTicks = useMemo(() => {
    const finite = series.values.filter(
      (v): v is number => v != null && Number.isFinite(v),
    );
    const max = finite.length ? Math.max(...finite) : 1;
    const top = Math.max(1, Math.ceil(max));
    const ticks = new Set<number>([0, top]);
    if (top >= 2) ticks.add(Math.round(top / 2));
    return [...ticks].sort((a, b) => a - b);
  }, [series]);

  if (matches.length === 0) {
    return (
      <div
        className="card flex items-center justify-center p-4"
        style={{ height }}
      >
        <span className="label text-[var(--color-ink-faint)]">sem dados</span>
      </div>
    );
  }

  const metricLabel = CHIPS.find((c) => c.key === active)!.label;
  const yMax = Math.max(...yTicks, series.referenceValue, 1);

  const chart = (
    <div
      style={{ position: "absolute", inset: 0 }}
      data-testid="recent-chart-body"
    >
      {width !== undefined ? (
        <LineChart
          width={width}
          height={Math.max(height - 34, 40)}
          data={chartData}
          margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
        >
          <XAxis dataKey="label" hide />
          <YAxis domain={[0, yMax]} hide />
          <Tooltip
            content={<RecentTooltip metricLabel={metricLabel} />}
            cursor={{ stroke: "var(--color-ink-faint)" }}
          />
          <Line
            type="linear"
            dataKey="value"
            name={metricLabel}
            stroke={teamColor("home")}
            strokeWidth={2}
            dot={{ r: 3, fill: teamColor("home") }}
            label={{ fontSize: 9, fill: "var(--color-ink-muted)" }}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="trend"
            name="tendência"
            stroke="var(--color-ink-faint)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
          >
            <XAxis dataKey="label" hide />
            <YAxis domain={[0, yMax]} hide />
            <Tooltip
              content={<RecentTooltip metricLabel={metricLabel} />}
              cursor={{ stroke: "var(--color-ink-faint)" }}
            />
            <Line
              type="linear"
              dataKey="value"
              name={metricLabel}
              stroke={teamColor("home")}
              strokeWidth={2}
              dot={{ r: 3, fill: teamColor("home") }}
              label={{ fontSize: 9, fill: "var(--color-ink-muted)" }}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="trend"
              name="tendência"
              stroke="var(--color-ink-faint)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );

  return (
    <div className="card @container/card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3 @max-[480px]/card:flex-col @max-[480px]/card:items-start">
        <span className="label">{title}</span>
        <InfoPopover label="como ler">
          <p>
            Cada ponto é um jogo recente (mais antigo → mais recente). A
            linha cheia é {metricLabel}; a tracejada é a tendência linear. A
            linha &ldquo;média&rdquo; marca a referência do período — pontos
            acima dela são jogos acima da média deste time.
          </p>
        </InfoPopover>
        <div className="flex flex-wrap gap-1 @max-[480px]/card:w-full @max-[480px]/card:overflow-x-auto @max-[480px]/card:flex-nowrap @max-[480px]/card:pb-1 @max-[480px]/card:[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CHIPS.map((c) => {
            const isActive = c.key === active;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActive(c.key)}
                className="label shrink-0 px-2 py-1 transition"
                style={{
                  background: isActive
                    ? "var(--color-vermelho)"
                    : "var(--color-surface-2)",
                  color: isActive
                    ? "var(--color-ink-display)"
                    : "var(--color-ink-muted)",
                  border: "1px solid var(--color-ink-faint)",
                  borderRadius: 4,
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>
      <TeamLegend
        home={teamName ?? "time"}
        away="tendência"
        className="mb-2"
      />
      <ChartFrame
        yTicks={yTicks}
        xLabels={series.xLabels}
        referenceLines={[
          {
            value: series.referenceValue,
            label: `média ${fmtNum(series.referenceValue)}`,
            color: "var(--color-ink-faint)",
          },
        ]}
        yMax={yMax}
        height={Math.max(height, 120)}
      >
        {chart}
      </ChartFrame>
    </div>
  );
}
