"use client";

/**
 * DisciplinaSettingsForm — formulário de configuração de fricção ética.
 *
 * Campos:
 *   - stop_loss_daily_pct: stop-loss diário (% da banca). 0 = desabilitado.
 *   - max_bets_per_day: máximo de apostas por dia. 0 = sem limite.
 *   - cooldown_after_loss_min: cooldown após loss em minutos. 0 = off.
 *   - quiet_mode_drawdown_pct: threshold % drawdown 24h para quiet mode.
 *   - thesis_gate_enabled: toggle — ativa thesis gate (kill switch UI).
 *   - quiet_mode_enabled: toggle — ativa quiet mode (kill switch UI).
 *
 * Kill switch env FRICAO_THESIS_GATE_ENABLED e FRICAO_QUIET_MODE_ENABLED
 * sobrepõem esses toggles quando = "false".
 */

import { useActionState } from "react";
import { saveDisciplinaSettingsAction, type DisciplinaSettingsState } from "../actions";

const initial: DisciplinaSettingsState = {};

export type DisciplinaSettingsValues = {
  stop_loss_daily_pct: number | null;
  max_bets_per_day: number | null;
  cooldown_after_loss_min: number;
  quiet_mode_drawdown_pct: number;
  thesis_gate_enabled: boolean;
  quiet_mode_enabled: boolean;
} | null;

export function DisciplinaSettingsForm({
  initialSettings,
}: {
  initialSettings: DisciplinaSettingsValues;
}) {
  const [state, action] = useActionState(saveDisciplinaSettingsAction, initial);

  const defaults = {
    stop_loss_daily_pct: initialSettings?.stop_loss_daily_pct ?? null,
    max_bets_per_day: initialSettings?.max_bets_per_day ?? null,
    cooldown_after_loss_min: initialSettings?.cooldown_after_loss_min ?? 60,
    quiet_mode_drawdown_pct: initialSettings?.quiet_mode_drawdown_pct ?? 5,
    thesis_gate_enabled: initialSettings?.thesis_gate_enabled ?? true,
    quiet_mode_enabled: initialSettings?.quiet_mode_enabled ?? true,
  };

  const inputClass =
    "label rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-2 py-1.5 text-[var(--color-ink)] w-full";

  return (
    <form action={action} className="flex flex-col gap-6">
      {/* Stop-loss diário */}
      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-1">limites de perda</legend>

        <label className="flex flex-col gap-1">
          <span className="label text-[var(--color-ink-muted)]">
            Stop-loss diário (% da banca) — 0 = desabilitado
          </span>
          <input
            type="number"
            name="stop_loss_daily_pct"
            defaultValue={defaults.stop_loss_daily_pct ?? 0}
            min={0}
            max={100}
            step={0.5}
            className={inputClass}
            aria-label="stop-loss diário"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="label text-[var(--color-ink-muted)]">
            Máximo de apostas/dia — 0 = sem limite
          </span>
          <input
            type="number"
            name="max_bets_per_day"
            defaultValue={defaults.max_bets_per_day ?? 0}
            min={0}
            max={50}
            step={1}
            className={inputClass}
            aria-label="máximo de apostas/dia"
          />
        </label>
      </fieldset>

      {/* Cooldown pós-loss */}
      <label className="flex flex-col gap-1">
        <span className="label text-[var(--color-ink-muted)]">
          Cooldown pós-loss (minutos) — 0 = desabilitado
        </span>
        <input
          type="number"
          name="cooldown_after_loss_min"
          defaultValue={defaults.cooldown_after_loss_min}
          min={0}
          max={1440}
          step={5}
          className={inputClass}
          aria-label="cooldown pós-loss"
        />
      </label>

      {/* Quiet mode */}
      <label className="flex flex-col gap-1">
        <span className="label text-[var(--color-ink-muted)]">
          Threshold quiet mode (% drawdown 24h)
        </span>
        <input
          type="number"
          name="quiet_mode_drawdown_pct"
          defaultValue={defaults.quiet_mode_drawdown_pct}
          min={0}
          max={100}
          step={0.5}
          className={inputClass}
          aria-label="threshold quiet mode"
        />
      </label>

      {/* Toggles */}
      <fieldset className="flex flex-col gap-3">
        <legend className="label mb-1">ativar funcionalidades</legend>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="thesis_gate_enabled"
            value="on"
            defaultChecked={defaults.thesis_gate_enabled}
            className="h-4 w-4 rounded border-[var(--color-line)] bg-transparent accent-[var(--color-vermelho)]"
            aria-label="thesis gate"
          />
          <span className="text-sm text-[var(--color-ink)]">
            Thesis gate — exige tese escrita tarde da noite ou com drawdown alto
          </span>
        </label>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="quiet_mode_enabled"
            value="on"
            defaultChecked={defaults.quiet_mode_enabled}
            className="h-4 w-4 rounded border-[var(--color-line)] bg-transparent accent-[var(--color-vermelho)]"
            aria-label="quiet mode"
          />
          <span className="text-sm text-[var(--color-ink)]">
            Quiet mode — oculta oportunidades IA após drawdown significativo
          </span>
        </label>
      </fieldset>

      {state.success && (
        <p
          role="status"
          className="label text-[var(--color-depth-hi)]"
        >
          Configurações salvas.
        </p>
      )}
      {state.error && (
        <p
          role="alert"
          className="label text-[var(--color-vermelho)]"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        className="label self-start rounded-[var(--radius-sm)] border border-[var(--color-line)] px-4 py-2 text-[var(--color-ink)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink-display)]"
      >
        salvar configurações
      </button>
    </form>
  );
}
