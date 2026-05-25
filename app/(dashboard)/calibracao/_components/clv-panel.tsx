import {
  summarizeClv,
  groupClvByLeague,
  groupClvByMarket,
  type ClvSample,
} from "@/lib/calibracao/clv-metrics";

// Target Wave C: +1.5% sustentado em >=300 bets = sinal real de skill.
const CLV_TARGET_PCT = 1.5;
const CLV_TARGET_N = 300;

interface ClvPanelProps {
  samples: ClvSample[];
  queryError: string | null;
}

/**
 * Painel CLV (Closing Line Value) — tarefa A1.
 *
 * CLV% = (odd_taken / odd_close - 1) * 100. Métrica única que sobrevive a
 * small-sample: distingue sorte de skill em ~50 bets (vs 300+ pra ROI/Brier).
 *
 * Target visual: **+1.5% sustentado em ≥300 bets = liberar Wave C**.
 */
export function ClvPanel({ samples, queryError }: ClvPanelProps) {
  const summary = summarizeClv(samples);
  const byLeague = groupClvByLeague(samples).slice(0, 5);
  const byMarket = groupClvByMarket(samples);

  return (
    <section
      className="mt-16 border-t border-[var(--color-line-subtle)] pt-10"
      data-section="clv-tracking"
    >
      <header className="mb-6">
        <span className="label">CLV (closing line value)</span>
        <h3 className="mt-2 text-base font-semibold">
          valor vs odd de fechamento (closing line)
        </h3>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          (odd_taken / odd_close − 1) × 100. Métrica única que distingue
          sorte de skill em ~50 bets — antecede ROI/Brier. Target Wave C:{" "}
          <strong>+{CLV_TARGET_PCT.toFixed(1)}%</strong> sustentado em ≥
          {CLV_TARGET_N} bets.
        </p>
      </header>

      {queryError && (
        <p
          className="card mb-6 p-4 text-sm"
          style={{ color: "var(--color-vermelho)" }}
          role="alert"
        >
          falha ao ler closing_odds: {queryError}
        </p>
      )}

      <div data-section="clv-summary">
        <ClvSummaryCards summary={summary} />
        <ClvTargetIndicator summary={summary} />
      </div>

      <div className="mt-10" data-section="clv-by-market">
        <h3 className="mb-4 text-base font-semibold">por mercado</h3>
        <ClvByMarketTable rows={byMarket} />
      </div>

      <div className="mt-10" data-section="clv-by-league">
        <h3 className="mb-4 text-base font-semibold">
          por liga (top 5 por volume)
        </h3>
        <ClvByLeagueTable rows={byLeague} />
      </div>
    </section>
  );
}

function ClvSummaryCards({
  summary,
}: {
  summary: ReturnType<typeof summarizeClv>;
}) {
  if (summary.n === 0) {
    return (
      <p className="card p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
        sem amostras de CLV ainda — capture diário roda 4×/dia (15/17/19/21
        UTC) e pega odds ~30min antes do KO pra recos `bet`.
      </p>
    );
  }
  const fmtPct = (v: number | null) =>
    v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
  const ic =
    summary.ci95Lower == null || summary.ci95Upper == null
      ? "—"
      : `[${fmtPct(summary.ci95Lower)}, ${fmtPct(summary.ci95Upper)}]`;
  const items: Array<{ label: string; value: string }> = [
    { label: "amostra (n)", value: `${summary.n}` },
    { label: "CLV médio", value: fmtPct(summary.mean) },
    { label: "IC 95%", value: ic },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="card flex flex-col gap-1 px-4 py-3">
          <dt className="label text-[var(--color-ink-faint)]">{it.label}</dt>
          <dd className="num text-base tabular-nums text-[var(--color-ink)]">
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ClvTargetIndicator({
  summary,
}: {
  summary: ReturnType<typeof summarizeClv>;
}) {
  if (summary.n === 0) return null;
  const meetsTarget =
    summary.mean != null &&
    summary.mean >= CLV_TARGET_PCT &&
    summary.n >= CLV_TARGET_N;
  const hasVolume = summary.n >= CLV_TARGET_N;
  const tone = meetsTarget
    ? "var(--color-verde, #16a34a)"
    : hasVolume
      ? "var(--color-vermelho)"
      : "var(--color-ink-muted)";
  const status = meetsTarget
    ? `liberado — CLV ${summary.mean!.toFixed(2)}% em ${summary.n} bets (≥ ${CLV_TARGET_PCT}% × ${CLV_TARGET_N}).`
    : hasVolume
      ? `volume atingido (${summary.n}) mas CLV ${summary.mean?.toFixed(2) ?? "—"}% < target ${CLV_TARGET_PCT}%.`
      : `progresso: ${summary.n}/${CLV_TARGET_N} bets (${Math.round(
          (summary.n / CLV_TARGET_N) * 100,
        )}%). CLV atual: ${summary.mean?.toFixed(2) ?? "—"}%.`;
  return (
    <p
      className="card mt-4 p-3 text-xs"
      style={{ color: tone }}
      data-clv-target-status
    >
      <strong>target Wave C:</strong> {status}
    </p>
  );
}

function ClvByMarketTable({
  rows,
}: {
  rows: ReturnType<typeof groupClvByMarket>;
}) {
  if (rows.length === 0) {
    return (
      <p className="card p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
        sem amostras por mercado ainda.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
            <Th>mercado</Th>
            <Th className="num text-right">n</Th>
            <Th className="num text-right">CLV médio</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.market}
              className="border-b border-[var(--color-line-subtle)] last:border-0"
            >
              <Td>{r.market}</Td>
              <Td className="num text-right tabular-nums">{r.n}</Td>
              <Td className="num text-right tabular-nums">
                {r.mean == null
                  ? "—"
                  : `${r.mean >= 0 ? "+" : ""}${r.mean.toFixed(2)}%`}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClvByLeagueTable({
  rows,
}: {
  rows: ReturnType<typeof groupClvByLeague>;
}) {
  if (rows.length === 0) {
    return (
      <p className="card p-6 text-center text-sm italic text-[var(--color-ink-muted)]">
        sem amostras por liga ainda.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line-subtle)]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line-subtle)] text-[var(--color-ink-faint)]">
            <Th>liga</Th>
            <Th className="num text-right">n</Th>
            <Th className="num text-right">CLV médio</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.league}
              className="border-b border-[var(--color-line-subtle)] last:border-0"
            >
              <Td>{r.league}</Td>
              <Td className="num text-right tabular-nums">{r.n}</Td>
              <Td className="num text-right tabular-nums">
                {r.mean == null
                  ? "—"
                  : `${r.mean >= 0 ? "+" : ""}${r.mean.toFixed(2)}%`}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-[11px] font-normal uppercase tracking-[0.12em] ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 align-middle ${className}`}>{children}</td>;
}
