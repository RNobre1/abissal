/**
 * ClvGauge — progress bar visual para CLV (Closing Line Value).
 *
 * U.3 spec: "186/300 bets · CLV +0.8% · falta 0.7pp pro target +1.5%"
 * Mostra progresso de coleta de amostras + CLV atual vs target.
 */

interface ClvGaugeProps {
  betCount: number;
  targetCount: number;
  clvPct: number;
  targetClvPct: number;
}

export function ClvGauge({ betCount, targetCount, clvPct, targetClvPct }: ClvGaugeProps) {
  const progressRatio = targetCount > 0 ? Math.min(betCount / targetCount, 1) : 0;
  const progressPct = Math.round(progressRatio * 100);

  const gapToTarget = targetClvPct - clvPct;
  const isAboveTarget = clvPct >= targetClvPct;

  const clvDisplay = `${clvPct >= 0 ? "+" : ""}${(clvPct * 100).toFixed(1)}%`;
  const targetDisplay = `+${(targetClvPct * 100).toFixed(1)}%`;

  return (
    <div data-section="clv-gauge" className="card flex flex-col gap-3 p-4 lg:p-5">
      <header className="flex items-baseline justify-between gap-2">
        <span className="label text-[var(--color-ink-muted)]">CLV — progresso da coleta</span>
        <span className="label text-[var(--color-ink-faint)]">
          target {targetDisplay}
        </span>
      </header>

      <div className="flex flex-wrap items-baseline gap-2">
        <span className="num text-2xl font-bold tabular-nums text-[var(--color-ink-display)]">
          {clvDisplay}
        </span>
        <span className="label text-[var(--color-ink-muted)]">
          CLV médio · {betCount}/{targetCount} bets
        </span>
        {!isAboveTarget && (
          <span className="label text-[var(--color-ink-faint)]">
            · falta {(gapToTarget * 100).toFixed(1)}pp pro target
          </span>
        )}
        {isAboveTarget && (
          <span className="label" style={{ color: "var(--color-success)" }}>
            · acima do target ✓
          </span>
        )}
      </div>

      {/* Progress bar de amostras */}
      <div className="flex flex-col gap-1">
        <div
          className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]"
          role="progressbar"
          aria-valuenow={betCount}
          aria-valuemin={0}
          aria-valuemax={targetCount}
          aria-label={`${betCount} de ${targetCount} bets coletadas`}
        >
          <div
            data-gauge
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progressPct}%`,
              background: isAboveTarget
                ? "var(--color-success)"
                : "var(--color-vermelho)",
            }}
          />
        </div>
        <span className="label text-right text-[var(--color-ink-faint)]">
          {progressPct}% do objetivo ({targetCount} bets)
        </span>
      </div>
    </div>
  );
}
