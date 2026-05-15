"use client";

import { useEffect, useMemo, useRef } from "react";
import { createChart } from "lightweight-charts";
import type { ISeriesApi, IChartApi } from "lightweight-charts";
import { ChartFrame } from "@/components/fixtures/stats/_primitives/chart-frame";
import { TeamLegend } from "@/components/fixtures/stats/_primitives/team-legend";

/**
 * One point on a momentum line. `time` is an ISO date ("YYYY-MM-DD") —
 * lightweight-charts accepts that natively. `value` is the rolling
 * average (goals/sot/whatever) the parent picked.
 */
export interface MomentumPoint {
  time: string;
  value: number;
}

interface MomentumChartProps {
  homeTeam: string;
  awayTeam: string;
  home: MomentumPoint[];
  away: MomentumPoint[];
  height?: number;
}

/** Build up to 3 ascending Y ticks (0 · mid · top) from the value domain. */
function deriveYTicks(home: MomentumPoint[], away: MomentumPoint[]): number[] {
  const vals = [...home, ...away]
    .map((p) => p.value)
    .filter((v) => Number.isFinite(v));
  const max = vals.length ? Math.max(...vals) : 1;
  const top = Math.max(1, Math.ceil(max));
  const ticks = new Set<number>([0, top]);
  if (top >= 2) ticks.add(Math.round(top / 2));
  return [...ticks].sort((a, b) => a - b);
}

/**
 * Painel B · momentum trend (lightweight-charts canvas).
 *
 * Renders two line series — home (vermelho) and away (depth blue) — on
 * a single chart so the visual rhythm of "who is climbing" reads at a
 * glance. lightweight-charts (over recharts) because canvas-based
 * rendering stays smooth past ~10 points where SVG-per-dot degrades.
 *
 * The chart instance is created in a useEffect cleanup pair so a remount
 * (StrictMode dev double-render) does not leak a Chromium canvas. The
 * canvas itself is the body of a `<ChartFrame>` that contributes the Y
 * scale, and a `<TeamLegend>` documents the color↔team mapping.
 */
export function MomentumChart({
  homeTeam,
  awayTeam,
  home,
  away,
  height = 240,
}: MomentumChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isEmpty = home.length === 0 && away.length === 0;
  const yTicks = useMemo(() => deriveYTicks(home, away), [home, away]);

  useEffect(() => {
    if (isEmpty) return;
    const container = containerRef.current;
    if (!container) return;

    const chart: IChartApi = createChart(container, {
      width: container.clientWidth || 480,
      height: Math.max(height - 24, 60),
      layout: {
        background: { color: "transparent" },
        textColor: "#7a7872", // --color-ink-muted
      },
      grid: {
        vertLines: { color: "rgba(63, 61, 58, 0.25)" },
        horzLines: { color: "rgba(63, 61, 58, 0.25)" },
      },
      rightPriceScale: { borderColor: "rgba(63, 61, 58, 0.4)" },
      timeScale: { borderColor: "rgba(63, 61, 58, 0.4)" },
      crosshair: { mode: 1 },
    });

    if (home.length > 0) {
      const homeSeries: ISeriesApi<"Line"> = chart.addLineSeries({
        color: "#c42b2b", // --color-vermelho
        lineWidth: 2,
        title: homeTeam,
      });
      homeSeries.setData(home);
    }

    if (away.length > 0) {
      const awaySeries: ISeriesApi<"Line"> = chart.addLineSeries({
        color: "#1a5fad", // --color-depth
        lineWidth: 2,
        title: awayTeam,
      });
      awaySeries.setData(away);
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
    // We intentionally depend on the team names + raw series; if the parent
    // swaps fixtures the whole chart is rebuilt.
  }, [home, away, homeTeam, awayTeam, height, isEmpty]);

  if (isEmpty) {
    return (
      <div
        className="card flex items-center justify-center"
        style={{ height }}
      >
        <span className="label text-[var(--color-ink-faint)]">sem dados</span>
      </div>
    );
  }

  return (
    <div className="card @container/card overflow-hidden p-3">
      <div className="mb-2 flex items-center gap-3">
        <span className="label">momentum</span>
        <TeamLegend home={homeTeam} away={awayTeam} />
      </div>
      <ChartFrame
        yTicks={yTicks}
        xLabels={[]}
        height={Math.max(height, 120)}
      >
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      </ChartFrame>
    </div>
  );
}
