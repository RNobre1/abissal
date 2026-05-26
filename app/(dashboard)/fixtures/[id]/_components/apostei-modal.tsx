"use client";

/**
 * AposteiModal — pop-up de confirmação que abre quando o Pilot clica
 * "✅ Apostei" no AiRecoPanel. Substitui o POST direto ao endpoint
 * /api/ai-reco/feedback do loop antigo: agora o clique cria de fato uma
 * `bets` row vinculada à `ai_recommendation` (migration 0025).
 *
 * Layout (compact drawer):
 *   ┌─ Apostei essa reco ───────────┐
 *   │ Casa:    [Bet365 ▼]           │
 *   │ Odd:     [2.10] (sugerido)    │
 *   │ Stake:   R$ [21,00] (= 1.5u)  │
 *   │ Mercado: 1x2 / home (locked)  │
 *   │                                │
 *   │ [ Cancelar ]   [ Confirmar ]  │
 *   └────────────────────────────────┘
 *
 * - Casa: dropdown populado de `houses` (passado via prop).
 * - Odd:  editável; default = reco.odd_captured.
 * - Stake: editável (BRL); default = units_final × unit_value (1.0 default
 *   localmente — ajustável quando o usuário tiver `bankroll_settings`).
 * - Market/side: locked (vem da reco — Pilot discorda via outro botão).
 *
 * Confirmar → POST /api/ai-reco/apostei → onSuccess(betId) → fecha modal.
 *
 * Auth: o endpoint usa session cookies (createClient server-side), então
 * o componente cliente apenas faz `fetch(...)` confiando no cookie do user.
 */

import { useState } from "react";

export interface ApostaiHouseOption {
  id: string;
  name: string;
}

interface ApostaiModalProps {
  aiRecommendationId: number;
  houses: ApostaiHouseOption[];
  defaultOdd: number | null;
  /** Stake sugerido em BRL — caller calcula via `units_final × unit_value`. */
  defaultStake: number;
  market: string | null;
  side: string | null;
  onCancel: () => void;
  onSuccess: (betId: string) => void;
}

function formatBrl(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

function parseBrl(v: string): number {
  return Number.parseFloat(v.replace(/\./g, "").replace(",", "."));
}

export function ApostaiModal({
  aiRecommendationId,
  houses,
  defaultOdd,
  defaultStake,
  market,
  side,
  onCancel,
  onSuccess,
}: ApostaiModalProps) {
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

  return (
    <div
      data-apostei-modal
      className="card mt-3 flex flex-col gap-3 border-2 border-[var(--color-vermelho)] p-4"
      role="dialog"
      aria-label="confirmar aposta"
    >
      <header className="flex items-baseline justify-between">
        <span className="font-semibold text-[var(--color-ink)]">
          Apostei essa reco
        </span>
        <span className="label text-[var(--color-ink-faint)]">
          reco #{aiRecommendationId}
        </span>
      </header>

      <label className="flex flex-col gap-1">
        <span className="label text-[var(--color-ink-muted)]">Casa</span>
        <select
          data-apostei-house
          value={houseId}
          onChange={(e) => setHouseId(e.target.value)}
          disabled={submitting}
          className="label rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-2 py-1.5 text-[var(--color-ink)]"
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
          type="text"
          inputMode="decimal"
          value={oddStr}
          onChange={(e) => setOddStr(e.target.value)}
          disabled={submitting}
          autoFocus
          className="label rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-2 py-1.5 text-[var(--color-ink)]"
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
          className="label rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-2 py-1.5 text-[var(--color-ink)]"
        />
      </label>

      <div className="label text-[var(--color-ink-muted)]">
        Mercado:{" "}
        <span className="font-semibold text-[var(--color-ink)]">
          {market ?? "—"} / {side ?? "—"}
        </span>{" "}
        <span className="text-[var(--color-ink-faint)]">(travado)</span>
      </div>

      {/* aria-live="polite" garante que screen readers anunciem erros + confirmação de sucesso */}
      <div aria-live="polite" aria-atomic="true">
        {error ? (
          <span
            role="alert"
            data-apostei-error
            className="label text-[var(--color-vermelho)]"
          >
            {error}
          </span>
        ) : null}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          data-apostei-cancel
          onClick={onCancel}
          disabled={submitting}
          className="label rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-1.5 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancelar
        </button>
        <button
          type="button"
          data-apostei-confirm
          onClick={handleConfirm}
          disabled={submitting}
          className="label rounded-[var(--radius-sm)] border border-[var(--color-vermelho)] px-3 py-1.5 text-[var(--color-vermelho)] hover:bg-[var(--color-vermelho)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "criando..." : "Confirmar"}
        </button>
      </div>
    </div>
  );
}
