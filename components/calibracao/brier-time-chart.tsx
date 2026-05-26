"use client";

/**
 * BrierTimeChart — Brier semanal (1X2 + over 2.5) ao longo do tempo.
 *
 * C.1 spec:
 *   - LineChart recharts com 2 paths: 1x2 (vermelho) + over25 (azul/cinza)
 *   - Eixo X: semana ISO; Eixo Y: Brier (0-0.5)
 *   - Tooltip: "Semana W42 · Brier 1x2: 0.22 · n=12"
 *   - Peer-link "ver dados" aponta para tabela (data-section="sim-brier-time")
 *   - Respeita prefers-reduced-motion (sem animação)
 *
 * Substitui visualmente SimBrierTimeTable; a tabela continua no DOM como peer.
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type React from "react";

export interface BrierTimeBucket {
  bucket: string;
  n: number;
  brier1x2: number | null;
  brierOver: number | null;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number | null;
    payload: BrierTimeBucket;
  }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded border border-[var(--color-line)] bg-[var(--color-surface-1)] px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-[var(--color-ink)]">Semana {label}</p>
      {payload.map((p) => (
        <p key={p.name} className="text-[var(--color-ink-muted)]">
          {p.name}: {p.value == null ? "—" : p.value.toFixed(3)}
        </p>
      ))}
      <p className="text-[var(--color-ink-faint)]">n={row.n}</p>
    </div>
  );
}

interface BrierTimeChartProps {
  data: BrierTimeBucket[];
  /** href para a tabela peer (default: #sim-brier-time) */
  tableHref?: string;
}

export function BrierTimeChart({
  data,
  tableHref = "#sim-brier-time",
}: BrierTimeChartProps) {
  if (data.length === 0) {
    return (
      <div className="card flex items-center justify-center p-8">
        <span className="label text-[var(--color-ink-faint)]">sem buckets temporais ainda</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-4 text-xs text-[var(--color-ink-faint)]">
          <span className="flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-6 rounded"
              style={{ backgroundColor: "var(--color-vermelho)" }}
            />
            Brier 1X2
          </span>
          <span className="flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-6 rounded opacity-60"
              style={{ backgroundColor: "var(--color-vermelho)" }}
            />
            Brier over 2.5
          </span>
        </div>
        <a
          href={tableHref}
          className="text-xs text-[var(--color-ink-faint)] underline hover:text-[var(--color-ink)]"
        >
          ver dados (tabela)
        </a>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid
            strokeDasharray="2 4"
            stroke="var(--color-line)"
            strokeOpacity={0.4}
          />
          <XAxis
            dataKey="bucket"
            tick={{ fontSize: 10, fill: "var(--color-ink-faint)" }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 0.5]}
            tick={{ fontSize: 10, fill: "var(--color-ink-faint)" }}
            tickLine={false}
            width={36}
          />
          <Tooltip
            content={<CustomTooltip />}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="brier1x2"
            name="Brier 1X2"
            stroke="var(--color-vermelho)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--color-vermelho)" }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="brierOver"
            name="Brier over 2.5"
            stroke="var(--color-vermelho)"
            strokeWidth={2}
            strokeOpacity={0.5}
            strokeDasharray="4 2"
            dot={{ r: 3, fill: "var(--color-vermelho)", fillOpacity: 0.5 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
