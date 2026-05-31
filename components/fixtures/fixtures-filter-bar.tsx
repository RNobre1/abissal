"use client";

import { useState } from "react";
import type {
  FilterState,
  IaFilter,
  LeagueOption,
  SortMode,
  ViewMode,
} from "@/lib/fixtures/filter-sort";

/**
 * Barra de filtros/ordenação/busca da tela de jogos (presentacional).
 * Sem estado de domínio — recebe `state` + `onChange(patch)` do FixturesBrowser.
 * Linha compacta sempre visível (busca · view · sort · IA · limpar · contador);
 * o resto (ligas, edge, destaques, OFF) vive num painel recolhível que, no
 * mobile (S23 FE), vira bottom-sheet via CSS.
 */

export interface FixturesFilterBarProps {
  state: FilterState;
  leagues: LeagueOption[];
  resultCount: number;
  totalCount: number;
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
}

const IA_LABELS: ReadonlyArray<{ value: IaFilter; label: string }> = [
  { value: "bet", label: "aposta" },
  { value: "novalue", label: "sem valor" },
  { value: "unanalyzed", label: "não analisado" },
];

const SORT_LABELS: ReadonlyArray<{ value: SortMode; label: string }> = [
  { value: "kickoff", label: "horário" },
  { value: "edge", label: "maior edge" },
  { value: "signal", label: "destaques" },
];

function isDirty(s: FilterState): boolean {
  return (
    s.leagues.length > 0 ||
    s.ia.length > 0 ||
    s.minEdge != null ||
    s.highSignalOnly ||
    s.hideOff ||
    s.query.trim().length > 0
  );
}

function activeCount(s: FilterState): number {
  return (
    (s.leagues.length > 0 ? 1 : 0) +
    (s.ia.length > 0 ? 1 : 0) +
    (s.minEdge != null ? 1 : 0) +
    (s.highSignalOnly ? 1 : 0) +
    (s.hideOff ? 1 : 0) +
    (s.query.trim().length > 0 ? 1 : 0)
  );
}

const chipBase =
  "label inline-flex items-center rounded-[var(--radius-sm)] border px-2 py-1 text-[11px] transition-colors";

export function FixturesFilterBar({
  state,
  leagues,
  resultCount,
  totalCount,
  onChange,
  onReset,
}: FixturesFilterBarProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const dirty = isDirty(state);
  const panelCount = activeCount(state) - (state.query.trim().length > 0 ? 1 : 0);

  function toggleIa(v: IaFilter) {
    const next = state.ia.includes(v)
      ? state.ia.filter((x) => x !== v)
      : [...state.ia, v];
    onChange({ ia: next });
  }

  function toggleLeague(key: string) {
    const next = state.leagues.includes(key)
      ? state.leagues.filter((x) => x !== key)
      : [...state.leagues, key];
    onChange({ leagues: next });
  }

  return (
    <div className="mb-6 flex flex-col gap-3">
      {/* linha compacta */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Buscar time"
          placeholder="buscar time…"
          value={state.query}
          onChange={(e) => onChange({ query: e.target.value })}
          className="num min-w-[8rem] flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-1)] px-2 py-1 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-vermelho)]"
        />

        {/* view toggle */}
        <div role="group" aria-label="Agrupamento" className="flex gap-1">
          {(["grouped", "flat"] as ViewMode[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={state.view === v}
              onClick={() => onChange({ view: v })}
              className={`${chipBase} ${state.view === v ? "border-[var(--color-vermelho-low)] text-[var(--color-vermelho)]" : "border-[var(--color-line)] text-[var(--color-ink-muted)]"}`}
            >
              {v === "grouped" ? "agrupar" : "tempo"}
            </button>
          ))}
        </div>

        {/* sort */}
        <label className="flex items-center gap-1">
          <span className="sr-only">Ordenar</span>
          <select
            aria-label="Ordenar"
            value={state.sort}
            onChange={(e) => onChange({ sort: e.target.value as SortMode })}
            className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-1)] px-2 py-1 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-vermelho)]"
          >
            {SORT_LABELS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {/* IA chips */}
        <div role="group" aria-label="Filtro de IA" className="flex flex-wrap gap-1">
          {IA_LABELS.map((o) => {
            const on = state.ia.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggleIa(o.value)}
                className={`${chipBase} ${on ? "border-[var(--color-vermelho-low)] text-[var(--color-vermelho)]" : "border-[var(--color-line)] text-[var(--color-ink-muted)]"}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((o) => !o)}
          className={`${chipBase} border-[var(--color-line)] text-[var(--color-ink-muted)]`}
        >
          ⚙ filtros{panelCount > 0 ? ` (${panelCount})` : ""}
        </button>

        {dirty ? (
          <button
            type="button"
            onClick={onReset}
            className={`${chipBase} border-[var(--color-line)] text-[var(--color-ink-faint)]`}
          >
            limpar
          </button>
        ) : null}

        <span className="num ml-auto text-[11px] tabular-nums text-[var(--color-ink-faint)]">
          {resultCount} de {totalCount}
        </span>
      </div>

      {/* painel recolhível (mobile: bottom-sheet via CSS data-attr) */}
      {panelOpen ? (
        <div
          data-fixtures-filter-panel="true"
          className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-1)] p-4"
        >
          {/* edge + toggles */}
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
              edge mínimo
              <input
                type="number"
                aria-label="Edge mínimo"
                inputMode="numeric"
                step={1}
                value={state.minEdge ?? ""}
                onChange={(e) =>
                  onChange({
                    minEdge: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                className="num w-16 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-1)] px-2 py-1 text-xs tabular-nums text-[var(--color-ink)] outline-none focus:border-[var(--color-vermelho)]"
              />
              %
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
              <input
                type="checkbox"
                checked={state.highSignalOnly}
                onChange={(e) => onChange({ highSignalOnly: e.target.checked })}
              />
              só destaques
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
              <input
                type="checkbox"
                checked={state.hideOff}
                onChange={(e) => onChange({ hideOff: e.target.checked })}
              />
              esconder sem dados
            </label>
          </div>

          {/* ligas do dia */}
          {leagues.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="label mb-1 text-[var(--color-ink-muted)]">
                ligas ({leagues.length})
              </legend>
              <div className="flex flex-wrap gap-2">
                {leagues.map((lg) => {
                  const on = state.leagues.includes(lg.key);
                  return (
                    <button
                      key={lg.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleLeague(lg.key)}
                      className={`${chipBase} ${on ? "border-[var(--color-vermelho-low)] text-[var(--color-vermelho)]" : "border-[var(--color-line)] text-[var(--color-ink-muted)]"}`}
                    >
                      <span aria-hidden className="mr-1">
                        {lg.flag}
                      </span>
                      {lg.league}
                      <span className="num ml-1 text-[var(--color-ink-faint)]">
                        {lg.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
