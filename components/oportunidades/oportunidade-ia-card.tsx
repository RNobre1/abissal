"use client";

/**
 * OportunidadeIaCard — card individual de oportunidade IA no dashboard.
 *
 * U.5 spec: botão "+ bilhete" por card. A Wave M (addLegToSlip +
 * AddToSlipButton) está mergeada — o botão adiciona a seleção da reco ao
 * draft slip via a infra real. Quando a reco não tem odd/mercado capturados,
 * o botão fica desabilitado com o motivo verdadeiro.
 *
 * Card enriquecido: além do summary_line, mostra edge %, odd capturada e
 * units sugeridas (campos já retornados por fetchTopOpportunities).
 */

import { AddToSlipButton } from "@/components/bet-slip/add-to-slip-button";

interface RecoItem {
  id: number;
  fixture_id: number | null;
  home_team: string;
  away_team: string;
  summary_line: string | null;
  market?: string | null;
  side?: string | null;
  odd_captured?: number | null;
  edge_pct?: number | null;
  units_final?: number | null;
  league?: string | null;
  kickoff_utc?: string | null;
}

interface OportunidadeIaCardProps {
  reco: RecoItem;
}

export function OportunidadeIaCard({ reco }: OportunidadeIaCardProps) {
  const { market, side, odd_captured } = reco;
  const canAddToSlip =
    typeof market === "string" &&
    market.length > 0 &&
    typeof side === "string" &&
    side.length > 0 &&
    typeof odd_captured === "number" &&
    odd_captured > 1;

  const enriched: string[] = [];
  if (typeof reco.edge_pct === "number") {
    // Recos forced podem ter edge negativo — sem o sinal condicional sairia "+-3.2%".
    const sinal = reco.edge_pct >= 0 ? "+" : "";
    enriched.push(`${sinal}${reco.edge_pct.toFixed(1)}%`);
  }
  if (typeof odd_captured === "number") {
    enriched.push(`@${odd_captured.toFixed(2)}`);
  }
  if (typeof reco.units_final === "number") {
    enriched.push(`${reco.units_final}u`);
  }

  return (
    <li className="flex items-center gap-2">
      <a
        href={`/fixtures/${reco.fixture_id ?? ""}`}
        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-[var(--radius-sm)] border border-transparent px-2 py-1 transition-colors hover:border-[var(--color-line)] hover:text-[var(--color-ink)] sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
      >
        <span className="min-w-0 truncate text-sm text-[var(--color-ink)]">
          {reco.home_team} vs {reco.away_team}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 sm:shrink-0 sm:flex-row sm:items-baseline sm:gap-2">
          <span className="num min-w-0 truncate text-xs tabular-nums text-[var(--color-ink-muted)] sm:text-sm">
            {reco.summary_line ?? "—"}
          </span>
          {enriched.length > 0 && (
            <span className="num shrink-0 text-xs tabular-nums text-[var(--color-ink-faint)]">
              {enriched.join(" · ")}
            </span>
          )}
        </span>
      </a>
      {canAddToSlip ? (
        <AddToSlipButton
          input={{
            ai_recommendation_id: reco.id,
            fixture_id: reco.fixture_id,
            home_team: reco.home_team,
            away_team: reco.away_team,
            market: market,
            side: side,
            odd_taken: odd_captured,
            league: reco.league ?? null,
            kickoff_utc: reco.kickoff_utc ?? null,
          }}
          ariaLabel={`${reco.home_team} vs ${reco.away_team} — ${market}/${side}`}
          className="label min-h-[44px] shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-1 text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
        />
      ) : (
        <button
          type="button"
          disabled
          title="sem odd/mercado capturados nesta recomendação"
          className="label min-h-[44px] shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-1 text-[var(--color-ink-faint)] opacity-40 cursor-not-allowed"
          aria-label="+ bilhete (indisponível — sem odd capturada)"
        >
          + bilhete
        </button>
      )}
    </li>
  );
}
