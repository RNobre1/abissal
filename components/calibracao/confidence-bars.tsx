"use client";

/**
 * ConfidenceBarsChart — acerto por nível de confidence (alto / medio / baixo).
 *
 * C.3 spec:
 *   - BarChart horizontal com ROI% por nível
 *   - Cor da barra: verde se ROI ≥ +1.5%, neutro se 0 a +1.5%, vermelho se < 0
 *   - n<30 → barra cinza (ambíguo), label "?"
 *   - Label: "n=X · IC95% [Y, Z]%"
 *   - Sem animação (prefers-reduced-motion)
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
  ResponsiveContainer,
} from "recharts";

export interface ConfidenceSummary {
  confidence: "alto" | "medio" | "baixo";
  n: number;
  roiPct: number;
  /** IC95% lower bound em % */
  icLo: number;
  /** IC95% upper bound em % */
  icHi: number;
}

const LABEL_MAP: Record<string, string> = {
  alto: "alta",
  medio: "média",
  baixo: "baixa",
};

const ROI_GREEN_THRESHOLD = 1.5; // %
const MIN_N = 30;

function barColor(n: number, roiPct: number): string {
  if (n < MIN_N) return "var(--color-ink-faint)";
  if (roiPct >= ROI_GREEN_THRESHOLD) return "var(--color-green,#22c55e)";
  if (roiPct >= 0) return "var(--color-ink-muted)";
  return "var(--color-vermelho)";
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: ConfidenceSummary;
  }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const isAmbiguous = d.n < MIN_N;
  return (
    <div className="rounded border border-[var(--color-line)] bg-[var(--color-surface-1)] px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-[var(--color-ink)]">
        Confidence {LABEL_MAP[d.confidence] ?? d.confidence}
      </p>
      <p className="text-[var(--color-ink-muted)]">
        ROI: {isAmbiguous ? "?" : `${d.roiPct >= 0 ? "+" : ""}${d.roiPct.toFixed(1)}%`}
      </p>
      <p className="text-[var(--color-ink-faint)]">
        n={d.n} · IC95% [{d.icLo.toFixed(1)}%, {d.icHi.toFixed(1)}%]
      </p>
      {isAmbiguous && (
        <p className="text-[var(--color-ink-faint)]">
          ⚠ amostra pequena — cor neutra
        </p>
      )}
    </div>
  );
}

interface ConfidenceBarsChartProps {
  data: ConfidenceSummary[];
}

export function ConfidenceBarsChart({ data }: ConfidenceBarsChartProps) {
  if (data.length === 0) {
    return (
      <div className="card flex items-center justify-center p-8">
        <span className="label text-[var(--color-ink-faint)]">sem dados de confidence ainda</span>
      </div>
    );
  }

  // Sort: alto → medio → baixo
  const ordered = [...data].sort((a, b) => {
    const ord = { alto: 0, medio: 1, baixo: 2 };
    return (ord[a.confidence] ?? 3) - (ord[b.confidence] ?? 3);
  });

  return (
    <div className="flex flex-col gap-3">
      {/* Custom labels above chart */}
      <div className="grid grid-cols-3 gap-2 text-center text-[10px] text-[var(--color-ink-faint)]">
        {ordered.map((d) => (
          <div key={d.confidence} className="flex flex-col gap-0.5">
            <span className="font-medium text-[var(--color-ink-muted)]">
              {LABEL_MAP[d.confidence] ?? d.confidence}
            </span>
            <span>n={d.n}</span>
            <span className="truncate">
              IC [{d.icLo.toFixed(1)}%, {d.icHi.toFixed(1)}%]
            </span>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={ordered} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid
            strokeDasharray="2 4"
            stroke="var(--color-line)"
            strokeOpacity={0.4}
          />
          <XAxis
            dataKey="confidence"
            tickFormatter={(v: string) => LABEL_MAP[v] ?? v}
            tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--color-ink-faint)" }}
            tickLine={false}
            width={40}
            tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
          />
          <Tooltip content={<CustomTooltip />} isAnimationActive={false} />
          <ReferenceLine y={0} stroke="var(--color-line)" strokeWidth={1.5} />
          <Bar dataKey="roiPct" name="ROI%" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {ordered.map((d) => (
              <Cell
                key={d.confidence}
                fill={barColor(d.n, d.roiPct)}
                fillOpacity={d.n < MIN_N ? 0.4 : 0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
