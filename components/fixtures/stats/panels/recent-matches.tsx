"use client";

import { useMemo, useState } from "react";
import regression from "regression";
import type { NormalizedRecentMatch } from "@/lib/fixtures/stats/detail-json-types";
import { TimeSeriesLine } from "@/components/charts/time-series-line";

/**
 * Stat keys exposed in the toggle. Each maps to a numeric field on
 * NormalizedRecentMatch. `valueOf` returns `null` (not 0) when the source
 * field is null/undefined — recharts skips null on `<Line>` (default
 * `connectNulls=false`) and the trend regression filters non-finite values
 * before fitting, so leagues that don't publish e.g. SOT no longer drag the
 * trend toward zero silently.
 */
type ToggleKey = "goals_ft" | "sot" | "corners" | "booking_points";

const CHIPS: Array<{ key: ToggleKey; label: string }> = [
  { key: "goals_ft", label: "gols FT" },
  { key: "sot", label: "SOT" },
  { key: "corners", label: "cantos" },
  { key: "booking_points", label: "booking" },
];

function valueOf(m: NormalizedRecentMatch, key: ToggleKey): number | null {
  let raw: number | null;
  switch (key) {
    case "goals_ft":
      raw = m.goals_ft_for;
      break;
    case "sot":
      raw = m.sot_for;
      break;
    case "corners":
      raw = m.corners_for;
      break;
    case "booking_points":
      raw = m.booking_points_for;
      break;
  }
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

interface RecentMatchesPanelProps {
  matches: NormalizedRecentMatch[];
  title: string;
  /** Fixed chart width for tests; omit in prod for ResponsiveContainer. */
  width?: number;
  height?: number;
}

/**
 * Painel C+ · recent matches — uma série numérica por chip selecionável,
 * com sobreposição de uma trend line dashed via regressão linear.
 *
 * Os dados vêm já ordenados (newest → oldest do derive); pra plotar
 * cronologicamente reverso o array antes de pôr na chart.
 */
export function RecentMatchesPanel({
  matches,
  title,
  width,
  height = 240,
}: RecentMatchesPanelProps) {
  const [active, setActive] = useState<ToggleKey>("goals_ft");

  const chrono = useMemo(() => [...matches].reverse(), [matches]);

  const chartData = useMemo(() => {
    if (chrono.length === 0) return [];
    // Build a regression input from ONLY the finite values so leagues that
    // don't publish a stat (null) don't drag the trend toward 0. We still
    // emit `null` in `value` so recharts skips the gap on the data line.
    const finitePoints: Array<[number, number]> = [];
    const values: Array<number | null> = chrono.map((m) => valueOf(m, active));
    values.forEach((v, i) => {
      if (typeof v === "number" && Number.isFinite(v)) finitePoints.push([i, v]);
    });
    // Need at least 2 finite points to fit a line; otherwise no trend.
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
      label: m.date_iso || `J${i + 1}`,
      value: values[i],
      trend: predictAt ? predictAt(i) : null,
    }));
  }, [chrono, active]);

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

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="label">{title}</span>
        <div className="flex flex-wrap gap-1">
          {CHIPS.map((c) => {
            const isActive = c.key === active;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActive(c.key)}
                className="label px-2 py-1 transition"
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
      <TimeSeriesLine
        data={chartData}
        xKey="label"
        series={[
          {
            key: "value",
            label: CHIPS.find((c) => c.key === active)!.label,
            color: "#c42b2b",
          },
          {
            key: "trend",
            label: "tendência",
            color: "#7a7872",
            dashed: true,
          },
        ]}
        width={width}
        height={height}
      />
    </div>
  );
}
