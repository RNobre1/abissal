"use client";

/**
 * BetSlipPageClient — Client Component da página /bilhete.
 *
 * Gerencia estado interativo:
 *  - Lista editável de legs (remoção individual)
 *  - Input de stake total com retorno calculado em tempo real
 *  - Seleção de casa + botão Commitar
 *  - Cancelar bilhete inteiro
 *  - Conflitos detectados em tempo real
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  computeOddCombined,
  computePotentialReturn,
  detectConflicts,
  type BetSlip,
  type SlipLeg,
} from "@/lib/bet-slip/compute";
import {
  removeLegFromSlip,
  updateSlipStake,
  commitSlip,
  cancelSlip,
} from "@/lib/bet-slip/actions";
import { BetSlipPhotoImport } from "@/components/bet-slip/bet-slip-photo-import";

interface HouseOption {
  id: string;
  name: string;
}

interface BetSlipPageClientProps {
  initialSlip: BetSlip | null;
  houses: HouseOption[];
}

function fmtOdd(v: number): string {
  return v.toFixed(2);
}

function fmtBrl(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

export function BetSlipPageClient({ initialSlip, houses }: BetSlipPageClientProps) {
  const router = useRouter();
  const [slip, setSlip] = useState<BetSlip | null>(initialSlip);
  const [houseId, setHouseId] = useState<string>(houses[0]?.id ?? "");
  const [isFreeBet, setIsFreeBet] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [committing, startCommitting] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  const legs: SlipLeg[] = slip?.bet_slip_legs ?? [];
  const stakeTotal = slip?.stake_total ?? null;
  const oddCombined = computeOddCombined(legs);
  const potentialReturn =
    stakeTotal != null ? computePotentialReturn(stakeTotal, oddCombined) : null;
  const conflicts = detectConflicts(legs);

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!slip || legs.length === 0) {
    return (
      <section
        data-bilhete-empty
        className="card flex flex-col items-center gap-4 p-8 text-center"
      >
        <span className="font-display text-4xl text-[var(--color-ink-faint)]">
          —
        </span>
        <p className="text-[var(--color-ink-muted)]">
          Nenhuma seleção no bilhete.
        </p>
        <p className="label text-[var(--color-ink-faint)]">
          Clique em <strong>+ bilhete</strong> em qualquer fixture para começar
          a montar, ou importe uma foto de cupom de outra casa.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/fixtures"
            className="label rounded-[var(--radius-sm)] border border-[var(--color-line)] px-4 py-2 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            Ver fixtures
          </Link>
          <BetSlipPhotoImport onLegsAdded={() => router.refresh()} />
          <Link
            href="/bilhete/builder"
            data-bet-builder-entry
            className="label rounded-[var(--radius-sm)] border border-[var(--color-line)] px-4 py-2 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            ⚡ Bet Builder
          </Link>
        </div>
      </section>
    );
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────

  async function handleRemoveLeg(legId: number) {
    setRemovingId(legId);
    setSlip((prev) =>
      prev
        ? { ...prev, bet_slip_legs: prev.bet_slip_legs.filter((l) => l.id !== legId) }
        : prev,
    );
    await removeLegFromSlip(legId);
    setRemovingId(null);
    startRefresh(() => router.refresh());
  }

  async function handleStakeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const parsed = Number.parseFloat(raw);
    const value = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

    setSlip((prev) =>
      prev
        ? {
            ...prev,
            stake_total: value,
            potential_return:
              value != null ? computePotentialReturn(value, oddCombined) : null,
          }
        : prev,
    );

    if (slip && value != null) {
      await updateSlipStake(slip.id, value);
    }
  }

  function handleCommit() {
    if (!slip || !houseId) return;
    setError(null);
    startCommitting(async () => {
      const result = await commitSlip(slip.id, houseId, isFreeBet);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSlip(null);
      router.push(`/bets/${result.betId}`);
    });
  }

  async function handleCancel() {
    if (!slip) return;
    await cancelSlip(slip.id);
    setSlip(null);
    router.refresh();
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Conflict warnings */}
      {conflicts.length > 0 ? (
        <ul
          role="alert"
          data-bilhete-conflicts
          className="card flex flex-col gap-2 border-[var(--color-warning)] p-4"
        >
          <li className="label font-semibold text-[var(--color-warning)]">
            ⚠ Conflitos detectados
          </li>
          {conflicts.map((c, i) => (
            <li
              key={i}
              className="label text-[var(--color-ink-muted)]"
              data-conflict-type={c.type}
            >
              • {c.message}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Legs list */}
      <section className="card flex flex-col divide-y divide-[var(--color-line)]">
        {legs.map((leg) => (
          <div
            key={leg.id}
            data-bilhete-leg={leg.id}
            className="flex items-start gap-3 p-4"
          >
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-[var(--color-ink)] truncate">
                {leg.home_team} × {leg.away_team}
              </div>
              <div className="label text-[var(--color-ink-muted)]">
                {leg.market} / {leg.side}
              </div>
              {leg.league ? (
                <div className="label text-xs text-[var(--color-ink-faint)]">
                  {leg.league}
                </div>
              ) : null}
              {leg.kickoff_utc ? (
                <div className="label text-xs text-[var(--color-ink-faint)] tabular-nums">
                  {new Date(leg.kickoff_utc).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="num text-lg font-bold text-[var(--color-ink-display)] tabular-nums">
                {fmtOdd(leg.odd_taken)}
              </span>
              <button
                type="button"
                onClick={() => handleRemoveLeg(leg.id)}
                disabled={removingId === leg.id || committing}
                aria-label={`Remover ${leg.home_team} × ${leg.away_team} do bilhete`}
                className="label text-[var(--color-ink-faint)] hover:text-[var(--color-vermelho)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                remover
              </button>
            </div>
          </div>
        ))}
      </section>

      {/* Summary + stake + commit */}
      <section className="card flex flex-col gap-4 p-4">
        {/* Combined odd */}
        <div className="flex items-baseline justify-between">
          <span className="label text-[var(--color-ink-muted)]">Odd combinada</span>
          <span className="num text-2xl font-bold text-[var(--color-ink-display)] tabular-nums">
            {fmtOdd(oddCombined)}
          </span>
        </div>

        {/* Stake input */}
        <label className="flex flex-col gap-1.5">
          <span className="label text-[var(--color-ink-muted)]">Stake total (R$)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={stakeTotal ?? ""}
            onChange={handleStakeChange}
            disabled={committing}
            placeholder="0,00"
            className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-3 py-2 text-[var(--color-ink)] tabular-nums placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-vermelho)] focus:outline-none disabled:opacity-60"
          />
        </label>

        {/* Potential return */}
        {potentialReturn != null && potentialReturn > 0 ? (
          <div className="flex items-baseline justify-between">
            <span className="label text-[var(--color-ink-muted)]">Retorno potencial</span>
            <span className="num text-xl font-bold text-[var(--color-success)] tabular-nums">
              R$ {fmtBrl(potentialReturn)}
            </span>
          </div>
        ) : null}

        {/* House select */}
        <label className="flex flex-col gap-1.5">
          <span className="label text-[var(--color-ink-muted)]">Casa</span>
          <select
            value={houseId}
            onChange={(e) => setHouseId(e.target.value)}
            disabled={committing}
            className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-3 py-2 text-[var(--color-ink)] disabled:opacity-60"
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

        {/* Free bet checkbox */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isFreeBet}
            onChange={(e) => setIsFreeBet(e.target.checked)}
            disabled={committing}
            className="h-4 w-4 accent-[var(--color-vermelho)]"
            aria-label="Aposta grátis (não desconta da banca)"
          />
          <span className="label text-[var(--color-ink-muted)]">
            🎁 Aposta grátis (não desconta da banca)
          </span>
        </label>

        {/* Error */}
        {error ? (
          <p role="alert" className="label text-[var(--color-vermelho)]">
            {error}
          </p>
        ) : null}

        {/* Commit button */}
        <button
          type="button"
          data-bilhete-commit
          onClick={handleCommit}
          disabled={
            committing ||
            legs.length < 2 ||
            !houseId ||
            !stakeTotal ||
            stakeTotal <= 0
          }
          className="label rounded-[var(--radius)] border-2 border-[var(--color-vermelho)] px-4 py-3 font-semibold text-[var(--color-vermelho)] hover:bg-[var(--color-vermelho)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {committing
            ? "confirmando…"
            : legs.length < 2
              ? `adicione ao menos ${2 - legs.length} jogo${2 - legs.length !== 1 ? "s" : ""} mais`
              : "Commitar aposta múltipla"}
        </button>

        {/* Cancel */}
        <button
          type="button"
          data-bilhete-cancel
          onClick={handleCancel}
          disabled={committing}
          className="label text-center text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)] disabled:opacity-60"
        >
          Cancelar bilhete
        </button>
      </section>
    </div>
  );
}
