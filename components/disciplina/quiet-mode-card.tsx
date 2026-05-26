/**
 * QuietModeCard — exibido no "/" quando quiet mode está ativo.
 * Substitui temporariamente o OportunidadesIa por um card informativo
 * com resumo da banca e mensagem de cooldown.
 *
 * Server Component — recebe dados via props do OverviewPage.
 */

import Link from "next/link";
import { fmt } from "@/lib/format";

interface QuietModeCardProps {
  /** Timestamp UTC de quando o quiet mode expira */
  until: Date;
  /** Banca total atual em BRL */
  totalBalance: number;
  /** P/L acumulado em BRL */
  cumulativePl: number;
}

function formatTimeRemaining(until: Date): string {
  const msRemaining = until.getTime() - Date.now();
  if (msRemaining <= 0) return "0 min";

  const totalMinutes = Math.ceil(msRemaining / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}min`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}min`;
}

export function QuietModeCard({ until, totalBalance, cumulativePl }: QuietModeCardProps) {
  const timeRemaining = formatTimeRemaining(until);
  const plPositive = cumulativePl >= 0;

  return (
    <section
      data-section="quiet-mode"
      className="card mb-8 flex flex-col gap-3 border border-[var(--color-vermelho)] p-4 lg:p-5"
      role="status"
      aria-label="quiet mode ativo"
    >
      <header className="flex items-baseline justify-between gap-2">
        <span className="label" style={{ color: "var(--color-vermelho)" }}>
          quiet mode ativo
        </span>
        <span className="label text-[var(--color-ink-faint)]">
          {timeRemaining} restante(s)
        </span>
      </header>

      <p className="text-sm text-[var(--color-ink-muted)]">
        Resultado negativo recente detectado. Oportunidades IA pausadas por{" "}
        <span className="font-semibold text-[var(--color-ink)]">
          {timeRemaining}
        </span>{" "}
        para evitar decisões impulsivas.
      </p>

      <div className="mt-1 flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] p-3">
        <span className="label text-[var(--color-ink-muted)]">
          resumo da banca
        </span>
        <div className="flex items-baseline gap-3">
          <span
            className="num text-2xl"
            style={{ color: "var(--color-ink-display)" }}
          >
            {fmt.currency(totalBalance)}
          </span>
          <span
            className="num text-sm"
            style={{
              color: plPositive
                ? "var(--color-depth-hi)"
                : "var(--color-vermelho-hi)",
            }}
          >
            <span aria-hidden="true">{plPositive ? "▲ " : "▼ "}</span>
            {fmt.signed(cumulativePl)}
          </span>
        </div>
      </div>

      <Link
        href="/configuracoes/disciplina"
        className="label self-start text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
      >
        configurar disciplina →
      </Link>
    </section>
  );
}
