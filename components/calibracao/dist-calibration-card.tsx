/**
 * DistCalibrationCard — calibração de DISTRIBUIÇÃO dos mercados de contagem.
 *
 * Torna VISÍVEL o que descobrimos e corrigimos: a simulação SUBESTIMA o total de
 * escanteios/cartões/finalizações no alvo. Por stat, mostra o fator `k`, a média
 * que a sim previa vs a média real observada (barras), e o `n` do fit.
 *
 * Display-only (Server Component) — derivado das linhas `*-dist` de
 * model_calibration (sem query extra). Ver docs/tasks/calibracao-distribuicao.
 */

import type { DistCalibrationRow } from "@/lib/calibracao/dist-calibration";

const STAT_LABEL: Record<string, string> = {
  corners: "Escanteios",
  sot: "Finalizações no alvo",
  cards: "Cartões",
  goals: "Gols",
};

function fmtK(k: number): string {
  return `×${k.toFixed(3)}`;
}

function fmtMean(v: number): string {
  return v.toFixed(2);
}

interface Props {
  rows: DistCalibrationRow[];
}

export function DistCalibrationCard({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div data-section="dist-calibration" className="card flex flex-col gap-2 p-5">
        <span className="label text-[var(--color-ink-muted)]">
          Calibração de distribuição
        </span>
        <p className="text-sm text-[var(--color-ink-faint)]">
          Sem fatores de distribuição ativos ainda — precisa de ≥30 jogos
          resolvidos por mercado. Refit semanal (mecânico) via{" "}
          <code className="text-xs">fit-dist.ts</code>.
        </p>
      </div>
    );
  }

  // Escala das barras: maior média (prevista ou real) entre todos os stats.
  const maxMean = Math.max(...rows.flatMap((r) => [r.meanPred, r.meanActual]), 1);

  return (
    <div data-section="dist-calibration" className="card flex flex-col gap-4 p-5 lg:p-6">
      <div className="flex flex-col gap-1">
        <span className="label text-[var(--color-ink-muted)]">
          Calibração de distribuição — mercados de contagem
        </span>
        <p className="text-xs text-[var(--color-ink-faint)]">
          A simulação subestima o total no alvo. Corrigimos a média do Poisson por
          um fator <code>k</code> (= média real ÷ média prevista), que calibra
          TODAS as linhas de uma vez. As 3 linhas centrais usam a isotônica (melhor);
          as demais herdam o <code>k</code>.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {rows.map((r) => {
          const predPct = (r.meanPred / maxMean) * 100;
          const actualPct = (r.meanActual / maxMean) * 100;
          const underestimates = r.k > 1.0;
          return (
            <div key={r.stat} data-stat={r.stat} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-[var(--color-ink)]">
                  {STAT_LABEL[r.stat] ?? r.stat}
                </span>
                <span className="flex items-baseline gap-2">
                  <span
                    className="num rounded px-1.5 py-0.5 text-xs font-bold tabular-nums"
                    style={{
                      color: underestimates
                        ? "var(--color-success)"
                        : "var(--color-ink)",
                      background: underestimates
                        ? "color-mix(in srgb, var(--color-success) 14%, transparent)"
                        : "var(--color-surface-2, transparent)",
                    }}
                    title="fator de calibração da média (k)"
                  >
                    {fmtK(r.k)}
                  </span>
                  <span className="label text-[10px] text-[var(--color-ink-faint)]">
                    n={r.n}
                  </span>
                </span>
              </div>

              {/* Barras: média prevista (sim) vs média real (observada) */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[10px] text-[var(--color-ink-faint)]">
                    previa
                  </span>
                  <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-[var(--color-line)]">
                    <div
                      className="absolute inset-y-0 left-0 rounded-sm bg-[var(--color-ink-muted)]"
                      style={{ width: `${predPct}%` }}
                    />
                  </div>
                  <span className="num w-10 shrink-0 text-right text-xs tabular-nums text-[var(--color-ink-muted)]">
                    {fmtMean(r.meanPred)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[10px] text-[var(--color-ink-faint)]">
                    real
                  </span>
                  <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-[var(--color-line)]">
                    <div
                      className="absolute inset-y-0 left-0 rounded-sm"
                      style={{
                        width: `${actualPct}%`,
                        background: "var(--color-success)",
                      }}
                    />
                  </div>
                  <span className="num w-10 shrink-0 text-right text-xs font-medium tabular-nums text-[var(--color-ink)]">
                    {fmtMean(r.meanActual)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-[var(--color-ink-faint)]">
        Refit mecânico semanal (B24) — não mexe em prompt/threshold. Validado em
        held-out: o <code>k</code> melhora o Brier vs Poisson cru em todas as linhas
        sem curva.
      </p>
    </div>
  );
}
