"use client";

/**
 * RoiCumulativeChart — ROI cumulativo (P/L acumulado) por bet.
 *
 * C.2 spec:
 *   - LineChart cumulativo de pl_units ordenado por placed_at/resolved_at
 *   - ReferenceLine y=0 em cinza
 *   - Tooltip: "Aposta #42 · 25/05 · PL acumulado: +1.69u"
 *   - Sem animação (prefers-reduced-motion)
 *
 * Decide: sem drawdown subplot (mantém simples — drawdown via tooltip).
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

export interface RoiBet {
  id: string;
  /** ISO date string */
  placedAt: string;
  plUnits: number;
}

interface CumulativePoint {
  idx: number;
  date: string;
  plCumulative: number;
  plUnits: number;
  id: string;
}

function toCumulativeData(bets: RoiBet[]): CumulativePoint[] {
  let cum = 0;
  return bets
    .slice()
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt))
    .map((b, i) => {
      cum += b.plUnits;
      return {
        idx: i + 1,
        date: b.placedAt.slice(0, 10),
        plCumulative: Math.round(cum * 1000) / 1000,
        plUnits: b.plUnits,
        id: b.id,
      };
    });
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: CumulativePoint;
  }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const sign = d.plCumulative >= 0 ? "+" : "";
  return (
    <div className="rounded border border-[var(--color-line)] bg-[var(--color-surface-1)] px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-[var(--color-ink)]">Aposta #{d.idx}</p>
      <p className="text-[var(--color-ink-muted)]">{d.date}</p>
      <p className="text-[var(--color-ink)]">
        P/L acumulado: {sign}{d.plCumulative.toFixed(2)}u
      </p>
      <p className="text-[var(--color-ink-faint)]">
        esta bet: {d.plUnits >= 0 ? "+" : ""}{d.plUnits.toFixed(2)}u
      </p>
    </div>
  );
}

interface RoiCumulativeChartProps {
  bets: RoiBet[];
}

export function RoiCumulativeChart({ bets }: RoiCumulativeChartProps) {
  if (bets.length === 0) {
    return (
      <div className="card flex items-center justify-center p-8">
        <span className="label text-[var(--color-ink-faint)]">sem apostas registradas ainda</span>
      </div>
    );
  }

  const data = toCumulativeData(bets);
  const lastPl = data[data.length - 1]?.plCumulative ?? 0;
  const isPositive = lastPl >= 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-xs text-[var(--color-ink-faint)]">
        <span>P/L cumulativo ({bets.length} apostas)</span>
        <span
          className="font-semibold num"
          style={{ color: isPositive ? "var(--color-success)" : "var(--color-vermelho)" }}
        >
          {isPositive ? "+" : ""}{lastPl.toFixed(2)}u
        </span>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid
            strokeDasharray="2 4"
            stroke="var(--color-line)"
            strokeOpacity={0.4}
          />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "var(--color-ink-faint)" }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--color-ink-faint)" }}
            tickLine={false}
            width={40}
            tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`}
          />
          <Tooltip content={<CustomTooltip />} isAnimationActive={false} />
          <ReferenceLine y={0} stroke="var(--color-line)" strokeWidth={1.5} />
          <Line
            type="monotone"
            dataKey="plCumulative"
            name="P/L acumulado"
            stroke="var(--color-vermelho)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, fill: "var(--color-vermelho)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
