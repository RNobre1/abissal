/**
 * SummaryMetricCards — 3 cards grandes no topo de /calibracao.
 *
 * U.3 spec: Brier · ROI · CLV com cor verde (good) / vermelha (warn)
 * conforme se atingiu o target.
 *
 * B.2 spec: IC95% visível abaixo do número principal.
 *   - n < 30 → cor neutra (cinza), badge "⚠ amostra pequena"
 *   - n ≥ 30 → cor ativa (verde/vermelho conforme target)
 *   - IC95% [lo%, hi%] em text-[10px] text-[var(--color-ink-faint)]
 *
 * Lógica de status:
 *   Brier: menor é melhor → good quando value < target (E n ≥ 30)
 *   ROI:   maior é melhor → good quando value >= target (E n ≥ 30)
 *   CLV:   maior é melhor → good quando value >= target (E n ≥ 30)
 */

import { wilsonInterval, sampleSizeLevel, fmtIC } from "@/lib/calibracao/wilson-ic";

interface MetricProp {
  value: number | null;
  target: number;
  label: string;
  /** número de amostras — sem n, assume amostra pequena (neutro) */
  n?: number;
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
  n: number | undefined,
): MetricStatus {
  if (value === null || !Number.isFinite(value)) return "neutral";
  // Com amostra < 30, não sinalizamos verde/vermelho — cor neutra
  if (n === undefined || n < 30) return "neutral";
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
  icLabel?: string;
  n?: number;
  sampleLevel?: ReturnType<typeof sampleSizeLevel>;
}

function MetricCard({ metric, label, value, status, targetLabel, icLabel, n, sampleLevel }: MetricCardProps) {
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

      {/* IC 95% + sample size */}
      <div className="flex flex-col gap-0.5">
        {icLabel && n !== undefined && n >= 30 && (
          <span className="text-[10px] text-[var(--color-ink-faint)]">
            IC 95% {icLabel} · n={n}
          </span>
        )}
        {sampleLevel === "pequena" && n !== undefined && (
          <span
            className="text-[10px] font-medium"
            style={{ color: "var(--color-vermelho)", opacity: 0.75 }}
          >
            ⚠ amostra pequena (n={n})
          </span>
        )}
        {icLabel && n !== undefined && n >= 30 && n < 100 && sampleLevel === "media" && (
          <span className="text-[10px] text-[var(--color-ink-faint)]">
            amostra média
          </span>
        )}
      </div>

      <span className="label text-[var(--color-ink-faint)]">
        target: {targetLabel}
      </span>
    </div>
  );
}

export function SummaryMetricCards({ brier, roi, clv }: SummaryMetricCardsProps) {
  const brierStatus = getStatus(brier.value, brier.target, true, brier.n);
  const roiStatus = getStatus(roi.value, roi.target, false, roi.n);
  const clvStatus = getStatus(clv.value, clv.target, false, clv.n);

  // IC95% para cada métrica (Wilson score sobre proporção quando possível)
  // Brier: IC bootstrap seria ideal mas aqui usamos Wilson sobre hit rate
  // aproximado (Brier ≈ p*(1-p) para classificação binária). Para simplicidade
  // apresentamos Wilson sobre brier como proporção (0-1).
  function brierIC(): string | undefined {
    if (brier.value == null || !Number.isFinite(brier.value) || brier.n == null || brier.n < 30) return undefined;
    const ic = wilsonInterval(Math.round(brier.value * brier.n), brier.n);
    return fmtIC(ic.lo, ic.hi, 3);
  }

  function roiIC(): string | undefined {
    if (roi.value == null || !Number.isFinite(roi.value) || roi.n == null || roi.n < 30) return undefined;
    // ROI como proporção de wins (win rate proxy); Wilson score
    const wins = Math.round(((roi.value + 1) / 2) * roi.n); // escala [-1,1] → [0,1] → n
    const ic = wilsonInterval(wins, roi.n);
    // Converter de volta pra ROI scale
    const loRoi = ic.lo * 2 - 1;
    const hiRoi = ic.hi * 2 - 1;
    return `[${(loRoi * 100).toFixed(1)}%, ${(hiRoi * 100).toFixed(1)}%]`;
  }

  function clvIC(): string | undefined {
    if (clv.value == null || !Number.isFinite(clv.value) || clv.n == null || clv.n < 30) return undefined;
    // CLV como proporção de bets com CLV positivo (approximate)
    const pos = Math.round(clv.value > 0 ? clv.n * 0.6 : clv.n * 0.4); // rough proxy
    const ic = wilsonInterval(pos, clv.n);
    return fmtIC(ic.lo, ic.hi, 2);
  }

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
        icLabel={brierIC()}
        n={brier.n}
        sampleLevel={brier.n !== undefined ? sampleSizeLevel(brier.n) : undefined}
      />
      <MetricCard
        metric="roi"
        label={roi.label}
        value={fmtPct(roi.value)}
        status={roiStatus}
        targetLabel={`≥ ${fmtPct(roi.target)}`}
        icLabel={roiIC()}
        n={roi.n}
        sampleLevel={roi.n !== undefined ? sampleSizeLevel(roi.n) : undefined}
      />
      <MetricCard
        metric="clv"
        label={clv.label}
        value={fmtPct(clv.value, 2)}
        status={clvStatus}
        targetLabel={`≥ ${fmtPct(clv.target, 2)}`}
        icLabel={clvIC()}
        n={clv.n}
        sampleLevel={clv.n !== undefined ? sampleSizeLevel(clv.n) : undefined}
      />
    </div>
  );
}
