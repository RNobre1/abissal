/**
 * ScorelineAccuracyCard — torna VISÍVEL a acurácia de PLACAR (item 1 / B28) e a
 * calibração de forma aplicada. Antes: nunca media a acurácia de placar. Agora:
 * mostra o que a sim previa pro top-1 vs o que cravou de verdade, o viés de
 * empate, e o efeito da calibração (achata o pico superconfiante).
 *
 * Display-only (Server Component) — derivado da linha `scoreline-cal` de
 * model_calibration (sem query extra). Barras CSS (sem recharts → zero bundle).
 */

import type { ScorelineCalSummary } from "@/lib/calibracao/scoreline-cal-repository";

function p1(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

interface BarProps {
  label: string;
  value: number;
  scale: number;
  color: string;
  emphasis?: boolean;
  tag?: string;
}

function Bar({ label, value, scale, color, emphasis, tag }: BarProps) {
  const widthPct = Math.max(0, Math.min(100, (value / scale) * 100));
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-[11px] text-[var(--color-ink-faint)]">{label}</span>
      <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-[var(--color-line)]">
        <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${widthPct}%`, background: color }} />
      </div>
      <span
        className="num w-12 shrink-0 text-right text-xs tabular-nums"
        style={{ color: emphasis ? "var(--color-ink)" : "var(--color-ink-muted)", fontWeight: emphasis ? 600 : 400 }}
      >
        {p1(value)}
      </span>
      {tag ? <span className="w-12 shrink-0 text-[10px] text-[var(--color-ink-faint)]">{tag}</span> : <span className="w-12 shrink-0" />}
    </div>
  );
}

interface Props {
  summary: ScorelineCalSummary | null;
}

export function ScorelineAccuracyCard({ summary }: Props) {
  if (!summary) {
    return (
      <div data-section="scoreline-accuracy" className="card flex flex-col gap-2 p-5">
        <span className="label text-[var(--color-ink-muted)]">Acurácia de placar</span>
        <p className="text-sm text-[var(--color-ink-faint)]">
          Sem medição de placar ainda — precisa de ≥30 jogos resolvidos. Refit
          semanal via <code className="text-xs">fit-scoreline-cal.ts</code>.
        </p>
      </div>
    );
  }

  const { raw, cal, temperature, drawFactor, n } = summary;
  // Escala comum pras barras de top-1 e de empate (o maior valor + folga).
  const top1Scale = Math.max(raw.top1Pred, cal.top1Pred, raw.top1Hit) * 1.1 || 0.2;
  const drawScale = Math.max(raw.drawPred, raw.drawReal) * 1.1 || 0.3;

  return (
    <div data-section="scoreline-accuracy" className="card flex flex-col gap-5 p-5 lg:p-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="label text-[var(--color-ink-muted)]">Acurácia de placar (item 1 / B28)</span>
          <span className="label text-[10px] text-[var(--color-ink-faint)]">n={n}</span>
        </div>
        <p className="text-xs text-[var(--color-ink-faint)]">
          Mede quão bem a sim acerta o placar — o que nunca tínhamos. O placar exato
          mais provável é intrinsecamente incerto (~10%); a sim era{" "}
          <strong>superconfiante</strong> nele. Calibramos a FORMA do top-6
          (display-only, sem mexer no gerador nem nas probs de aposta).
        </p>
      </div>

      {/* Placar mais provável (top-1): previa vs calibrado vs real */}
      <div className="flex flex-col gap-1.5">
        <span className="label text-[11px] text-[var(--color-ink-muted)]">
          Placar mais provável (top-1) — probabilidade
        </span>
        <Bar label="a sim previa" value={raw.top1Pred} scale={top1Scale} color="var(--color-vermelho)" tag="cru" />
        <Bar label="calibrado" value={cal.top1Pred} scale={top1Scale} color="var(--color-ink-muted)" tag={`T${temperature.toFixed(1)}`} />
        <Bar label="real (cravou)" value={raw.top1Hit} scale={top1Scale} color="var(--color-green,#22c55e)" emphasis tag="alvo" />
        <span className="text-[10px] text-[var(--color-ink-faint)]">
          a sim dizia {p1(raw.top1Pred)} mas o top-1 só crava {p1(raw.top1Hit)} → calibração aproxima do real.
        </span>
      </div>

      {/* Empate: previsto vs real */}
      <div className="flex flex-col gap-1.5">
        <span className="label text-[11px] text-[var(--color-ink-muted)]">
          Taxa de empate — viés diagnosticado (B28)
        </span>
        <Bar label="previsto" value={raw.drawPred} scale={drawScale} color="var(--color-vermelho)" tag="cru" />
        <Bar label="real" value={raw.drawReal} scale={drawScale} color="var(--color-green,#22c55e)" emphasis tag="alvo" />
        <span className="text-[10px] text-[var(--color-ink-faint)]">
          inflação de +{p1(raw.drawPred - raw.drawReal)} (δ={drawFactor.toFixed(2)} deflaciona o grid; a barra de Empate usa a isotônica 1x2-draw).
        </span>
      </div>

      {/* Cobertura (informativo) */}
      {raw.top3Hit != null && raw.top6Hit != null ? (
        <div className="flex items-baseline gap-4 border-t border-[var(--color-line-subtle)] pt-3">
          <span className="text-[11px] text-[var(--color-ink-faint)]">cobertura:</span>
          <span className="num text-xs tabular-nums text-[var(--color-ink-muted)]">top-3 {p1(raw.top3Hit)}</span>
          <span className="num text-xs tabular-nums text-[var(--color-ink-muted)]">top-6 {p1(raw.top6Hit)}</span>
          {raw.rps != null ? (
            <span className="num text-xs tabular-nums text-[var(--color-ink-faint)]">RPS {raw.rps.toFixed(3)}</span>
          ) : null}
        </div>
      ) : null}

      <p className="text-[10px] text-[var(--color-ink-faint)]">
        Calibração de forma (T={temperature.toFixed(2)}, δ={drawFactor.toFixed(2)}) por log-loss,
        validada out-of-sample. Refit mecânico semanal (B24) — NÃO bumpa model_version.
      </p>
    </div>
  );
}
