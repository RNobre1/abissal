"use client";

/**
 * BetSlipFAB — Floating Action Button para o bilhete múltipla (Wave M).
 *
 * - Invisível quando não há legs (retorna null).
 * - Posição: fixed bottom-right (mobile: bottom-center com z-50).
 * - Mostra contagem de jogos, odd combinada, e stake total se informado.
 * - Click → chama onOpen para abrir o drawer.
 * - Respeita prefers-reduced-motion para a animação de entrada.
 */

import type { SlipLeg } from "@/lib/bet-slip/compute";

interface BetSlipFABProps {
  legs: SlipLeg[];
  oddCombined: number;
  stakeTotal?: number | null;
  onOpen: () => void;
}

export function BetSlipFAB({ legs, oddCombined, stakeTotal, onOpen }: BetSlipFABProps) {
  if (legs.length === 0) return null;

  const legCount = legs.length;
  const oddDisplay = oddCombined.toFixed(2);

  return (
    <div
      data-bet-slip-fab
      className="fixed bottom-5 right-4 z-50 sm:right-6"
    >
      <button
        type="button"
        aria-label={`Bilhete · ${legCount} ${legCount === 1 ? "jogo" : "jogos"} · odd ${oddDisplay}`}
        onClick={onOpen}
        className="
          flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-vermelho)]
          bg-[var(--color-surface-2)] px-4 py-3 shadow-lg
          hover:bg-[var(--color-surface-3)]
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-vermelho)]
          active:scale-95 transition-transform motion-reduce:transition-none
        "
      >
        <span
          className="num flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-vermelho)] text-xs font-bold text-white tabular-nums"
          aria-hidden="true"
        >
          {legCount}
        </span>
        <span className="label font-semibold text-[var(--color-ink)]">
          Bilhete
        </span>
        <span
          aria-hidden="true"
          className="num text-[var(--color-ink-muted)] tabular-nums text-sm"
        >
          ×{oddDisplay}
        </span>
        {stakeTotal != null && stakeTotal > 0 ? (
          <span
            aria-hidden="true"
            className="num text-[var(--color-ink-muted)] tabular-nums text-sm"
          >
            · R$ {stakeTotal.toFixed(2).replace(".", ",")}
          </span>
        ) : null}
      </button>
    </div>
  );
}
