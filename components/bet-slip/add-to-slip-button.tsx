"use client";

/**
 * AddToSlipButton — botão "+ bilhete" que adiciona uma seleção ao draft slip.
 *
 * Cliente Component. Chama addLegToSlip server action via fetch.
 * Após adicionar, emite um CustomEvent 'slip-leg-added' para o
 * BetSlipProvider escutar e re-hidratr (router.refresh()).
 *
 * Props mapeadas diretamente do AiRecommendationDTO.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addLegToSlip, type AddLegInput } from "@/lib/bet-slip/actions";
import { useTelemetry } from "@/lib/telemetry/use-telemetry";

interface AddToSlipButtonProps {
  input: AddLegInput;
  /** Label extra para acessibilidade (e.g. "home vs away") */
  ariaLabel?: string;
  className?: string;
}

export function AddToSlipButton({ input, ariaLabel, className }: AddToSlipButtonProps) {
  const router = useRouter();
  const track = useTelemetry();
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await addLegToSlip(input);
      if (result.error) {
        setError(result.error);
        return;
      }
      track("bilhete_leg_added", {
        fixture_id: input.fixture_id ?? undefined,
        market: input.market,
        side: input.side,
      });
      setAdded(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        data-add-to-slip
        onClick={handleClick}
        disabled={pending || added}
        aria-label={ariaLabel ? `+ bilhete: ${ariaLabel}` : "+ bilhete"}
        className={
          className ??
          `label rounded-[var(--radius-sm)] border px-3 py-1.5 transition-colors
          ${
            added
              ? "border-[var(--color-success)] text-[var(--color-success)] cursor-default"
              : "border-[var(--color-line)] text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
          }
          disabled:cursor-not-allowed disabled:opacity-60`
        }
      >
        {pending ? "adicionando…" : added ? "✓ no bilhete" : "+ bilhete"}
      </button>
      {error ? (
        <span role="alert" className="label text-[var(--color-vermelho)]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
