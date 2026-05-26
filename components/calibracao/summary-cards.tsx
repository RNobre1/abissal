/**
 * SummaryMetricCards — 3 cards grandes no topo de /calibracao.
 *
 * U.3 spec: Brier · ROI · CLV com cor verde (good) / vermelha (warn)
 * conforme se atingiu o target.
 *
 * Lógica de status:
 *   Brier: menor é melhor → good quando value < target
 *   ROI:   maior é melhor → good quando value >= target
 *   CLV:   maior é melhor → good quando value >= target
 */

interface MetricProp {
  value: number | null;
  target: number;
  label: string;
}

interface SummaryMetricCardsProps {
  brier: MetricProp;
  roi: MetricProp;
  clv: MetricProp;
}

type MetricStatus = "good" | "warn" | "neutral";

function getStatus(
  value: number | null,
  target: number,
  lowerIsBetter: boolean,
): MetricStatus {
  if (value === null || !Number.isFinite(value)) return "neutral";
  if (lowerIsBetter) {
    return value <= target ? "good" : "warn";
  }
  return value >= target ? "good" : "warn";
}

function fmtBrier(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return v.toFixed(3);
}

function fmtPct(v: number | null, digits = 1): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

interface MetricCardProps {
  metric: "brier" | "roi" | "clv";
  label: string;
  value: string;
  status: MetricStatus;
  targetLabel: string;
}

function MetricCard({ metric, label, value, status, targetLabel }: MetricCardProps) {
  const colorClass =
    status === "good"
      ? "text-[var(--color-green,#22c55e)]"
      : status === "warn"
        ? "text-[var(--color-vermelho)]"
        : "text-[var(--color-ink)]";

  const bgClass =
    status === "good"
      ? "border-[color-mix(in_srgb,var(--color-green,#22c55e)_30%,transparent)]"
      : status === "warn"
        ? "border-[color-mix(in_srgb,var(--color-vermelho)_30%,transparent)]"
        : "border-[var(--color-line)]";

  return (
    <div
      data-metric={metric}
      data-status={status}
      className={`card flex flex-col gap-2 p-5 lg:p-6 border-2 ${bgClass}`}
    >
      <span className="label text-[var(--color-ink-muted)]">{label}</span>
      <span className={`num text-3xl font-bold tabular-nums lg:text-4xl ${colorClass}`}>
        {value}
      </span>
      <span className="label text-[var(--color-ink-faint)]">
        target: {targetLabel}
      </span>
    </div>
  );
}

export function SummaryMetricCards({ brier, roi, clv }: SummaryMetricCardsProps) {
  const brierStatus = getStatus(brier.value, brier.target, true);
  const roiStatus = getStatus(roi.value, roi.target, false);
  const clvStatus = getStatus(clv.value, clv.target, false);

  return (
    <div
      data-section="summary-metric-cards"
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      <MetricCard
        metric="brier"
        label={brier.label}
        value={fmtBrier(brier.value)}
        status={brierStatus}
        targetLabel={`< ${fmtBrier(brier.target)}`}
      />
      <MetricCard
        metric="roi"
        label={roi.label}
        value={fmtPct(roi.value)}
        status={roiStatus}
        targetLabel={`≥ ${fmtPct(roi.target)}`}
      />
      <MetricCard
        metric="clv"
        label={clv.label}
        value={fmtPct(clv.value, 2)}
        status={clvStatus}
        targetLabel={`≥ ${fmtPct(clv.target, 2)}`}
      />
    </div>
  );
}
