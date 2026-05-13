"use client";

import { useMemo, useState } from "react";
import regression from "regression";
import { sampleCorrelation } from "simple-statistics";
import {
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { NormalizedRecentMatch } from "@/lib/fixtures/stats/detail-json-types";

/**
 * Stats users can plot on either axis. Every NormalizedRecentMatch field
 * exposed here is `number | null` → null gets coerced to 0 because
 * regression/correlation cannot eat null and tossing rows would hide
 * structurally-meaningful blanks (e.g. corners unavailable in a league).
 */
type AxisKey =
  | "goals_ft_for"
  | "goals_ft_against"
  | "sot_for"
  | "shots_for"
  | "corners_for"
  | "cards_for"
  | "booking_points_for"
  | "fouls_for";

const OPTIONS: Array<{ key: AxisKey; label: string }> = [
  { key: "goals_ft_for", label: "Gols FT (pró)" },
  { key: "goals_ft_against", label: "Gols sofridos" },
  { key: "sot_for", label: "Chutes no gol" },
  { key: "shots_for", label: "Chutes totais" },
  { key: "corners_for", label: "Cantos" },
  { key: "cards_for", label: "Cartões" },
  { key: "booking_points_for", label: "Booking points" },
  { key: "fouls_for", label: "Faltas" },
];

function pick(m: NormalizedRecentMatch, k: AxisKey): number {
  return (m[k] ?? 0) as number;
}

interface ScatterPlaygroundProps {
  homeTeam: string;
  awayTeam: string;
  home: NormalizedRecentMatch[];
  away: NormalizedRecentMatch[];
  /** Fixed width for tests; omit in prod for ResponsiveContainer. */
  width?: number;
  height?: number;
}

interface DotPoint {
  x: number;
  y: number;
  label: string;
}

/**
 * Painel L · scatter playground — usuário pega quaisquer 2 stats, dot
 * por jogo recente colorido por lado, trend line (regression.linear)
 * e correlação de Pearson sobre TODOS os jogos (home + away combinados).
 */
export function ScatterPlayground({
  homeTeam,
  awayTeam,
  home,
  away,
  width,
  height = 320,
}: ScatterPlaygroundProps) {
  const [xKey, setXKey] = useState<AxisKey>("sot_for");
  const [yKey, setYKey] = useState<AxisKey>("goals_ft_for");

  const { homeDots, awayDots, trendLine, pearson } = useMemo(() => {
    const hd: DotPoint[] = home.map((m) => ({
      x: pick(m, xKey),
      y: pick(m, yKey),
      label: m.date_iso,
    }));
    const ad: DotPoint[] = away.map((m) => ({
      x: pick(m, xKey),
      y: pick(m, yKey),
      label: m.date_iso,
    }));
    const all = [...hd, ...ad];
    if (all.length < 2) {
      return { homeDots: hd, awayDots: ad, trendLine: [], pearson: null };
    }
    // Pearson r — sampleCorrelation throws when variance is 0.
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const xVar = Math.max(...xs) - Math.min(...xs);
    const yVar = Math.max(...ys) - Math.min(...ys);
    let r: number | null = null;
    if (xVar > 0 && yVar > 0) {
      try {
        r = sampleCorrelation(xs, ys);
      } catch {
        r = null;
      }
    }
    // Linear fit drawn as 2 endpoints (min/max x).
    let trend: Array<{ x: number; y: number }> = [];
    if (xVar > 0) {
      const points: Array<[number, number]> = all.map((p) => [p.x, p.y]);
      const fit = regression.linear(points, { precision: 6 });
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      trend = [
        { x: minX, y: fit.predict(minX)[1] },
        { x: maxX, y: fit.predict(maxX)[1] },
      ];
    }
    return { homeDots: hd, awayDots: ad, trendLine: trend, pearson: r };
  }, [home, away, xKey, yKey]);

  if (home.length === 0 && away.length === 0) {
    return (
      <div
        className="card flex items-center justify-center p-4"
        style={{ height }}
      >
        <span className="label text-[var(--color-ink-faint)]">sem dados</span>
      </div>
    );
  }

  const xLabel = OPTIONS.find((o) => o.key === xKey)!.label;
  const yLabel = OPTIONS.find((o) => o.key === yKey)!.label;

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="label">scatter playground</span>
        <span
          className="label num text-xs text-[var(--color-ink-muted)]"
          data-testid="scatter-pearson"
        >
          r = {pearson === null ? "—" : pearson.toFixed(3)}
        </span>
      </div>
      <div className="mb-3 flex flex-wrap gap-3">
        <label className="label flex items-center gap-1 text-[var(--color-ink-muted)]">
          eixo X
          <select
            value={xKey}
            onChange={(e) => setXKey(e.target.value as AxisKey)}
            className="num text-xs"
            style={{
              background: "var(--color-surface-2)",
              color: "var(--color-ink-display)",
              border: "1px solid var(--color-ink-faint)",
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            {OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="label flex items-center gap-1 text-[var(--color-ink-muted)]">
          eixo Y
          <select
            value={yKey}
            onChange={(e) => setYKey(e.target.value as AxisKey)}
            className="num text-xs"
            style={{
              background: "var(--color-surface-2)",
              color: "var(--color-ink-display)",
              border: "1px solid var(--color-ink-faint)",
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            {OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {width !== undefined ? (
        <ScatterBody
          xLabel={xLabel}
          yLabel={yLabel}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          homeDots={homeDots}
          awayDots={awayDots}
          trendLine={trendLine}
          width={width}
          height={height}
        />
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <ScatterBody
            xLabel={xLabel}
            yLabel={yLabel}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            homeDots={homeDots}
            awayDots={awayDots}
            trendLine={trendLine}
          />
        </ResponsiveContainer>
      )}
    </div>
  );
}

/**
 * Inner-only component. Splits the ComposedChart JSX into one place so the
 * "fixed-width" (tests) and "ResponsiveContainer" (prod) branches don't
 * diverge. `width`/`height` propagate through only when explicitly passed —
 * inside <ResponsiveContainer> recharts itself supplies them.
 */
interface ScatterBodyProps {
  xLabel: string;
  yLabel: string;
  homeTeam: string;
  awayTeam: string;
  homeDots: DotPoint[];
  awayDots: DotPoint[];
  trendLine: Array<{ x: number; y: number }>;
  width?: number;
  height?: number;
}

function ScatterBody({
  xLabel,
  yLabel,
  homeTeam,
  awayTeam,
  homeDots,
  awayDots,
  trendLine,
  width,
  height,
}: ScatterBodyProps) {
  return (
    <ComposedChart
      margin={{ top: 8, right: 16, left: -16, bottom: 0 }}
      {...(width !== undefined ? { width } : {})}
      {...(height !== undefined ? { height } : {})}
    >
      <CartesianGrid stroke="var(--color-ink-faint)" strokeOpacity={0.15} />
      <XAxis
        type="number"
        dataKey="x"
        name={xLabel}
        tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
        stroke="var(--color-ink-faint)"
      />
      <YAxis
        type="number"
        dataKey="y"
        name={yLabel}
        tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
        stroke="var(--color-ink-faint)"
      />
      <Tooltip
        contentStyle={{
          background: "var(--color-surface-2)",
          border: "1px solid var(--color-ink-faint)",
          color: "var(--color-ink-display)",
          fontSize: 12,
        }}
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
      {trendLine.length > 0 ? (
        <Line
          data={trendLine}
          dataKey="y"
          type="linear"
          stroke="#7a7872"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
          isAnimationActive={false}
          legendType="none"
        />
      ) : null}
    </ComposedChart>
  );
}
