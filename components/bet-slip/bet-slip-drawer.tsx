"use client";

/**
 * BetSlipDrawer — painel de bilhete múltipla (Wave M).
 *
 * Renderizado como um painel deslizante fixo no lado direito (desktop) ou
 * bottom sheet (mobile). Mostra:
 *  - Lista de legs com botão [✕] remover
 *  - Input de stake total
 *  - Odd combinada + retorno potencial
 *  - Avisos de conflitos
 *  - Link "revisar bilhete" → /bilhete
 *  - Botão fechar
 *
 * Props stateless — o estado de UI (openModal, etc.) fica no container.
 */

import Link from "next/link";
import type { Conflict, SlipLeg } from "@/lib/bet-slip/compute";
import { BetSlipPhotoImport } from "./bet-slip-photo-import";

interface HouseOption {
  id: string;
  name: string;
}

interface BetSlipDrawerProps {
  legs: SlipLeg[];
  oddCombined: number;
  stakeTotal: number | null;
  potentialReturn: number | null;
  conflicts: Conflict[];
  removing: number | null; // legId being removed (for loading state)
  committing: boolean;
  onRemoveLeg: (legId: number) => void;
  onStakeChange: (value: number | null) => void;
  onClose: () => void;
  houses: HouseOption[];
  onCommit: (houseId: string) => void;
  onCancel: () => void;
  onLegsAdded?: () => void;
}

function fmtOdd(v: number): string {
  return v.toFixed(2);
}

function fmtBrl(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

export function BetSlipDrawer({
  legs,
  oddCombined,
  stakeTotal,
  potentialReturn,
  conflicts,
  removing,
  committing,
  onRemoveLeg,
  onStakeChange,
  onClose,
  houses,
  onCommit,
  onCancel,
  onLegsAdded,
}: BetSlipDrawerProps) {
  function handleStakeInput(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw === "" || raw === "0") {
      onStakeChange(null);
      return;
    }
    const parsed = Number.parseFloat(raw);
    onStakeChange(Number.isFinite(parsed) ? parsed : null);
  }

  return (
    <div
      data-bet-slip-drawer
      className="card fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-b-none border-t-2 border-t-[var(--color-vermelho)] sm:bottom-auto sm:right-4 sm:top-16 sm:w-80 sm:rounded-[var(--radius)]"
      role="dialog"
      aria-label="Bilhete múltipla"
    >
      {/* Header */}
      <header className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
        <span className="font-display text-lg font-medium text-[var(--color-ink-display)]">
          Bilhete
        </span>
        <div className="flex items-center gap-2">
          <span className="num label text-[var(--color-ink-muted)] tabular-nums">
            {legs.length} {legs.length === 1 ? "seleção" : "seleções"}
          </span>
          {onLegsAdded ? (
            <BetSlipPhotoImport onLegsAdded={onLegsAdded} />
          ) : null}
          <button
            type="button"
            aria-label="Fechar bilhete"
            onClick={onClose}
            className="label rounded-[var(--radius-sm)] px-2 py-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            ✕
          </button>
        </div>
      </header>

      {/* Conflicts */}
      {conflicts.length > 0 ? (
        <ul
          role="alert"
          data-bet-slip-conflicts
          className="flex flex-col gap-1 bg-[color-mix(in_oklch,var(--color-warning)_15%,transparent)] px-4 py-2"
        >
          {conflicts.map((c, i) => (
            <li
              key={i}
              className="label text-[var(--color-warning)]"
              data-conflict-type={c.type}
            >
              ⚠ {c.message}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Legs list */}
      <ul className="flex flex-col divide-y divide-[var(--color-line)] overflow-y-auto">
        {legs.map((leg) => (
          <li
            key={leg.id}
            data-bet-slip-leg={leg.id}
            className="flex items-start gap-2 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="label font-semibold text-[var(--color-ink)] truncate">
                {leg.home_team} × {leg.away_team}
              </div>
              <div className="label text-[var(--color-ink-muted)]">
                {leg.market} / {leg.side}
              </div>
              {leg.league ? (
                <div className="label text-[var(--color-ink-faint)] text-xs">
                  {leg.league}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="num font-semibold text-[var(--color-ink)] tabular-nums">
                {fmtOdd(leg.odd_taken)}
              </span>
              <button
                type="button"
                aria-label={`Remover ${leg.home_team} × ${leg.away_team}`}
                onClick={() => onRemoveLeg(leg.id)}
                disabled={removing === leg.id || committing}
                className="label text-[var(--color-ink-faint)] hover:text-[var(--color-vermelho)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/* Stake + odds summary */}
      <div className="border-t border-[var(--color-line)] px-4 py-3 flex flex-col gap-3">
        {/* Combined odd */}
        <div className="flex items-baseline justify-between">
          <span className="label text-[var(--color-ink-muted)]">Odd combinada</span>
          <span className="num font-bold text-[var(--color-ink-display)] tabular-nums">
            {fmtOdd(oddCombined)}
          </span>
        </div>

        {/* Stake input */}
        <label className="flex flex-col gap-1">
          <span className="label text-[var(--color-ink-muted)]">Stake total (R$)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={stakeTotal ?? ""}
            onChange={handleStakeInput}
            disabled={committing}
            placeholder="0,00"
            className="label rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-3 py-2 text-[var(--color-ink)] tabular-nums placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-vermelho)] focus:outline-none disabled:opacity-60"
          />
        </label>

        {/* Potential return */}
        {potentialReturn != null && potentialReturn > 0 ? (
          <div className="flex items-baseline justify-between">
            <span className="label text-[var(--color-ink-muted)]">Retorno potencial</span>
            <span className="num font-bold text-[var(--color-success)] tabular-nums">
              R$ {fmtBrl(potentialReturn)}
            </span>
          </div>
        ) : null}
      </div>

      {/* Actions */}
      <div className="border-t border-[var(--color-line)] px-4 py-3 flex flex-col gap-2">
        {/* Revisar bilhete link */}
        <Link
          href="/bilhete"
          className="label block text-center rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-2 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:border-[var(--color-line-strong)]"
        >
          Revisar bilhete
        </Link>

        {/* Commit — pick house then commit */}
        <div className="flex gap-2">
          <select
            disabled={committing || legs.length < 2}
            defaultValue={houses[0]?.id ?? ""}
            aria-label="Casa para commit"
            id="drawer-house-select"
            className="label flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-2 py-2 text-[var(--color-ink)] disabled:opacity-60"
          >
            {houses.length === 0 ? (
              <option value="">(nenhuma casa)</option>
            ) : (
              houses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            disabled={committing || legs.length < 2 || !stakeTotal}
            onClick={() => {
              const sel = document.getElementById("drawer-house-select") as HTMLSelectElement | null;
              onCommit(sel?.value ?? houses[0]?.id ?? "");
            }}
            className="label rounded-[var(--radius-sm)] border border-[var(--color-vermelho)] px-3 py-2 text-[var(--color-vermelho)] hover:bg-[var(--color-vermelho)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {committing ? "confirmando..." : "Commitar"}
          </button>
        </div>

        {/* Cancel slip */}
        <button
          type="button"
          onClick={onCancel}
          disabled={committing}
          className="label text-center text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)] disabled:opacity-60"
        >
          Cancelar bilhete
        </button>
      </div>
    </div>
  );
}
