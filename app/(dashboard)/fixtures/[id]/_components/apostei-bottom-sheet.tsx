"use client";

/**
 * AposteiBottomSheet — substitui o AposteiModal por um bottom sheet
 * mobile-first usando Radix Dialog.
 *
 * U.4 spec:
 * - Bottom sheet Radix Dialog slide-up suave
 * - Tap targets ≥44pt nos botões
 * - Resumo de confirmação explícito (WCAG 3.3.4): mercado + side + stake
 * - Animação slide-up (respeita prefers-reduced-motion)
 * - Mobile: 70vh; Desktop: modal centralizado
 * - Aria compliant: Dialog.Title, focus management, escape fecha
 *
 * API idêntica ao AposteiModal para compatibilidade com AiRecoActions.
 */

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { ApostaiHouseOption } from "./apostei-modal";

interface AposteiBottomSheetProps {
  aiRecommendationId: number;
  houses: ApostaiHouseOption[];
  defaultOdd: number | null;
  /** Stake sugerido em BRL — units_final × unit_value. */
  defaultStake: number;
  market: string | null;
  side: string | null;
  onCancel?: () => void;
  onSuccess: (betId: string) => void;
  /** Quando true, força o sheet aberto (usado em testes e modo controlado). */
  open?: boolean;
  /** Callback externo quando open muda. */
  onOpenChange?: (open: boolean) => void;
}

function formatBrl(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

function parseBrl(v: string): number {
  return Number.parseFloat(v.replace(/\./g, "").replace(",", "."));
}

/**
 * Versão inline do sheet (sem trigger próprio). Controlado externamente via
 * props `open` e `onOpenChange`. Usado pelo `AiRecoActions` como substituto
 * do AposteiModal antigo.
 */
export function AposteiBottomSheet({
  aiRecommendationId,
  houses,
  defaultOdd,
  defaultStake,
  market,
  side,
  onCancel,
  onSuccess,
  open: openProp,
  onOpenChange,
}: AposteiBottomSheetProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;

  const handleOpenChange = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
    if (!next) onCancel?.();
  };

  const [houseId, setHouseId] = useState<string>(houses[0]?.id ?? "");
  const [oddStr, setOddStr] = useState<string>(
    defaultOdd && defaultOdd > 1 ? defaultOdd.toFixed(2) : "",
  );
  const [stakeStr, setStakeStr] = useState<string>(formatBrl(defaultStake));
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm(): Promise<void> {
    setError(null);
    const odd = Number.parseFloat(oddStr.replace(",", "."));
    if (!Number.isFinite(odd) || odd <= 1.0) {
      setError("odd inválida (mínimo 1.01)");
      return;
    }
    const stake = parseBrl(stakeStr);
    if (!Number.isFinite(stake) || stake <= 0) {
      setError("stake inválido (> 0)");
      return;
    }
    if (!houseId) {
      setError("selecione uma casa");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/ai-reco/apostei", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          aiRecommendationId,
          houseId,
          stake,
          odd,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setError(text || `falha (${res.status})`);
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { betId?: string }
        | null;
      if (body?.betId) {
        handleOpenChange(false);
        onSuccess(body.betId);
      } else {
        setError("resposta inesperada do servidor");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro de rede");
    } finally {
      setSubmitting(false);
    }
  }

  // Quando fechado e não controlado, renderiza nada (evita mount desnecessário)
  if (!open && !isControlled) {
    return null;
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        {/* Overlay escurecido */}
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:transition-none" />

        {/* Sheet content — bottom-up no mobile, modal centralizado no desktop */}
        <Dialog.Content
          data-apostei-modal
          className={[
            // Base
            "fixed z-50 flex flex-col gap-4",
            "rounded-t-[var(--radius)] border border-[var(--color-line)]",
            "bg-[var(--color-surface-1)] p-5 pb-8 shadow-xl",
            // Mobile: bottom sheet 70vh
            "inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto",
            // Desktop: modal centralizado
            "md:inset-0 md:m-auto md:max-h-[90vh] md:w-full md:max-w-lg md:rounded-[var(--radius)]",
            // Animações slide-up
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4",
            "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom-4",
            "md:data-[state=open]:slide-in-from-bottom-0 md:data-[state=open]:fade-in-0",
            "md:data-[state=closed]:slide-out-to-bottom-0 md:data-[state=closed]:fade-out-0",
            "motion-reduce:transition-none motion-reduce:animate-none",
          ].join(" ")}
        >
          <Dialog.Title className="font-semibold text-[var(--color-ink)]">
            Apostei essa reco
          </Dialog.Title>

          {/* Resumo explícito de confirmação (WCAG 3.3.4 "Error Prevention") */}
          <div className="rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] bg-[var(--color-surface-2)] px-3 py-2">
            <p className="label text-[var(--color-ink-muted)]">
              Confirmando aposta em{" "}
              <strong className="text-[var(--color-ink)]">
                {market ?? "—"} · {side ?? "—"}
              </strong>{" "}
              · reco #{aiRecommendationId}
            </p>
          </div>

          <label className="flex flex-col gap-1">
            <span className="label text-[var(--color-ink-muted)]">Casa</span>
            <select
              data-apostei-house
              value={houseId}
              onChange={(e) => setHouseId(e.target.value)}
              disabled={submitting}
              className="label min-h-[44px] rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-3 py-2 text-[var(--color-ink)]"
            >
              {houses.length === 0 ? (
                <option value="">(nenhuma casa cadastrada)</option>
              ) : (
                houses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="label text-[var(--color-ink-muted)]">
              Odd {defaultOdd ? `(sugerido: ${defaultOdd.toFixed(2)})` : ""}
            </span>
            <input
              data-apostei-odd
              data-testid="apostei-odd-input"
              type="text"
              inputMode="decimal"
              value={oddStr}
              onChange={(e) => setOddStr(e.target.value)}
              disabled={submitting}
              className="label min-h-[44px] rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-3 py-2 text-[var(--color-ink)]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="label text-[var(--color-ink-muted)]">
              Stake (R$)
            </span>
            <input
              data-apostei-stake
              type="text"
              inputMode="decimal"
              value={stakeStr}
              onChange={(e) => setStakeStr(e.target.value)}
              disabled={submitting}
              className="label min-h-[44px] rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-3 py-2 text-[var(--color-ink)]"
            />
          </label>

          {error ? (
            <span
              role="alert"
              data-apostei-error
              className="label text-[var(--color-vermelho)]"
            >
              {error}
            </span>
          ) : null}

          <div className="flex justify-end gap-3 pt-2">
            <Dialog.Close asChild>
              <button
                type="button"
                data-apostei-cancel
                disabled={submitting}
                className="label min-h-[44px] rounded-[var(--radius-sm)] border border-[var(--color-line)] px-4 py-3 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
            </Dialog.Close>
            <button
              type="button"
              data-apostei-confirm
              data-testid="apostei-confirm-btn"
              onClick={handleConfirm}
              disabled={submitting}
              className="label min-h-[44px] rounded-[var(--radius-sm)] border border-[var(--color-vermelho)] px-4 py-3 text-[var(--color-vermelho)] hover:bg-[var(--color-vermelho)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "criando..." : "Confirmar"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
