"use client";

/**
 * OportunidadeIaCard — card individual de oportunidade IA no dashboard.
 *
 * U.5 spec: botão "+ bilhete" por card. DISABLED enquanto Wave M
 * (addLegToSlip server action) não estiver mergeada.
 *
 * Quando Wave M for mergeada:
 * 1. Remover `disabled` e `title` do botão
 * 2. Importar e invocar `addLegToSlip` com `{ recoId: reco.id }`
 */

interface RecoItem {
  id: number;
  fixture_id: number | null;
  home_team: string;
  away_team: string;
  summary_line: string | null;
}

interface OportunidadeIaCardProps {
  reco: RecoItem;
}

export function OportunidadeIaCard({ reco }: OportunidadeIaCardProps) {
  return (
    <li className="flex items-center gap-2">
      <a
        href={`/fixtures/${reco.fixture_id ?? ""}`}
        className="flex min-w-0 flex-1 items-baseline justify-between gap-3 rounded-[var(--radius-sm)] border border-transparent px-2 py-1 transition-colors hover:border-[var(--color-line)] hover:text-[var(--color-ink)]"
      >
        <span className="min-w-0 truncate text-sm text-[var(--color-ink)]">
          {reco.home_team} vs {reco.away_team}
        </span>
        <span className="num shrink-0 text-sm tabular-nums text-[var(--color-ink-muted)]">
          {reco.summary_line ?? "—"}
        </span>
      </a>
      {/* U.5: "+ bilhete" — DISABLED até Wave M (addLegToSlip) ser mergeada */}
      <button
        type="button"
        disabled
        title="disponível quando bilhete (Wave M) for mergeado"
        className="label min-h-[44px] shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-1 text-[var(--color-ink-faint)] opacity-40 cursor-not-allowed"
        aria-label="+ bilhete (indisponível — aguardando Wave M)"
      >
        + bilhete
      </button>
    </li>
  );
}
