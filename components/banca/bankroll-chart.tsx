"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BankrollPoint {
  date: string;     // YYYY-MM-DD
  balance: number;  // bankroll balance (cumulative)
  drawdown: number; // absolute drawdown from peak (>=0)
}

interface BankrollChartProps {
  data: BankrollPoint[];
  /** Show drawdown area overlay. Default: false. */
  showDrawdown?: boolean;
  /** Fixed width in px — set this in tests to avoid ResponsiveContainer width:0. */
  width?: number;
  /** Chart height in px. Default: 260. */
  height?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * BankrollChart — linha cumulativa de bankroll ao longo do tempo.
 *
 * Subplot/overlay: área de drawdown (em vermelho, invertida) quando
 * showDrawdown=true.
 *
 * Library: recharts (already in project, matches TimeSeriesLine pattern).
 * Note: lightweight-charts is also available, but recharts is already wired
 * in components/charts/ and avoids a duplicate charting dependency.
 */
export function BankrollChart({
  data,
  showDrawdown = false,
  width,
  height = 260,
}: BankrollChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="label flex items-center justify-center text-[var(--color-ink-faint)]"
        style={{ height }}
        data-testid="bankroll-chart"
      >
        sem dados
      </div>
    );
  }

  const commonProps = {
    data,
    margin: { top: 8, right: 16, left: -16, bottom: 0 },
  } as const;

  const decorations = (
    <>
      <CartesianGrid stroke="var(--color-ink-faint)" strokeOpacity={0.12} />
      <XAxis
        dataKey="date"
        tick={{ fill: "var(--color-ink-muted)", fontSize: 10 }}
        stroke="var(--color-ink-faint)"
        tickFormatter={(v: string) => {
          // "2026-05-25" → "25/05"
          const parts = v.split("-");
          return parts.length === 3 ? `${parts[2]}/${parts[1]}` : v;
        }}
        interval="preserveStartEnd"
      />
      <YAxis
        tick={{ fill: "var(--color-ink-muted)", fontSize: 10 }}
        stroke="var(--color-ink-faint)"
        tickFormatter={(v: number) => v.toFixed(0)}
      />
      <Tooltip
        contentStyle={{
          background: "var(--color-surface-2)",
          border: "1px solid var(--color-ink-faint)",
          color: "var(--color-ink-display)",
          fontSize: 12,
        }}
        labelStyle={{ color: "var(--color-ink-muted)", marginBottom: 4 }}
        formatter={(value: number, name: string) => {
          if (name === "drawdown") return [`-${value.toFixed(2)}`, "drawdown"];
          return [value.toFixed(2), "bankroll"];
        }}
      />
    </>
  );

  const series = (
    <>
      {showDrawdown && (
        <Area
          type="monotone"
          dataKey="drawdown"
          name="drawdown"
          stroke="var(--color-vermelho)"
          strokeWidth={1}
          fill="color-mix(in srgb, var(--color-vermelho) 18%, transparent)"
          dot={false}
          isAnimationActive={false}
          yAxisId={0}
        />
      )}
      <Line
        type="monotone"
        dataKey="balance"
        name="bankroll"
        stroke="var(--color-depth-hi)"
        strokeWidth={2}
        dot={false}
        activeDot={{ r: 4 }}
        isAnimationActive={false}
        yAxisId={0}
      />
    </>
  );

  if (width !== undefined) {
    return (
      <div data-testid="bankroll-chart">
        <ComposedChart width={width} height={height} {...commonProps}>
          {decorations}
          {series}
        </ComposedChart>
      </div>
    );
  }

  return (
    <div data-testid="bankroll-chart">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart {...commonProps}>
          {decorations}
          {series}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
