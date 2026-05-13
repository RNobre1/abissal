"use client";

/**
 * Painel F · streaks heatmap.
 *
 * 3 camadas de filtro (AND entre camadas, OR dentro de cada):
 *   1. Chips de grupo (multi-select)
 *   2. Slider min_perc (default 60, step 5, range 0-100)
 *   3. Busca textual cmdk (fuzzy em `desc` + `stat_type`) — aberta via
 *      botão local "buscar streak" no header do painel.
 *
 * O estado é serializado em searchParams (?streaks=…&min_perc=…) via
 * `router.replace`, garantindo deep-link compartilhável e refresh-safe.
 *
 * Layout:
 *   - Header com label + botão "buscar streak" + botão "limpar filtros"
 *   - Linha de chips horizontal-scroll mobile
 *   - Slider Radix
 *   - Heatmap CSS Grid (cores derivadas de overall_perc)
 *   - Lista virtualizada (TanStack Virtual) com top streaks ordenados
 *   - Empty state quando nenhum streak passa nos filtros
 *   - Modal cmdk sobreposto pra busca textual (Esc fecha)
 *
 * Importante: o atalho global ⌘K é hijackado pelo CommandPalette do
 * dashboard (`components/command-palette.tsx`, montado em
 * `app/(dashboard)/layout.tsx`). Este painel NÃO registra listener próprio
 * pra ⌘K — caso contrário ambos os dialogs abririam ao mesmo tempo.
 */

import * as Slider from "@radix-ui/react-slider";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Streak, StreakIndex } from "@/lib/fixtures/stats/detail-json-types";
import { useUrlPatcher } from "@/lib/fixtures/stats/use-url-state";

interface StreaksHeatmapProps {
  data: StreakIndex;
}

const DEFAULT_MIN_PERC = 60;

/**
 * Mapa hsl(0, S%, L%) a partir de overall_perc (0-100):
 *   - perc baixo → cinza desbotado (var(--color-ink-faint))
 *   - perc alto → vermelho saturado (var(--color-vermelho))
 *
 * Saturação cresce com perc; lightness diminui (cores mais densas no topo).
 */
function heatColor(perc: number): string {
  const clamped = Math.min(100, Math.max(0, perc));
  // Saturation cresce 30 → 85; lightness baixa 50 → 32.
  const s = 30 + (clamped / 100) * 55;
  const l = 50 - (clamped / 100) * 18;
  return `hsl(0, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;
}

const URL_DEFAULTS = { min_perc: String(DEFAULT_MIN_PERC) };

export function StreaksHeatmap({ data }: StreaksHeatmapProps) {
  const searchParams = useSearchParams();
  const patchUrl = useUrlPatcher(URL_DEFAULTS);

  // ─ Hidratação inicial a partir da URL ───────────────────────────────
  const initialGroups = useMemo(() => {
    const raw = searchParams.get("streaks");
    if (!raw) return new Set<string>();
    return new Set(raw.split(",").filter(Boolean));
    // searchParams é estável dentro de um render do Next; reagir só na
    // primeira montagem evita over-write quando o user toggla um chip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const initialMinPerc = useMemo(() => {
    const raw = searchParams.get("min_perc");
    if (raw === null || raw === "") return DEFAULT_MIN_PERC;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
    return DEFAULT_MIN_PERC;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(initialGroups);
  const [minPerc, setMinPerc] = useState<number>(initialMinPerc);
  const [cmdkOpen, setCmdkOpen] = useState(false);

  // ─ Lista de grupos disponíveis (do índice) ──────────────────────────
  const allGroups = useMemo(() => Object.keys(data.by_group).sort(), [data.by_group]);

  // ─ Streaks filtradas (AND camadas, OR dentro de chips) ──────────────
  const filtered = useMemo(() => {
    return data.all.filter((s) => {
      if (s.overall_perc < minPerc) return false;
      if (selectedGroups.size > 0 && !selectedGroups.has(s.group)) return false;
      return true;
    });
  }, [data.all, minPerc, selectedGroups]);

  const hasActiveFilters = selectedGroups.size > 0 || minPerc !== DEFAULT_MIN_PERC;

  // ─ Handlers ─────────────────────────────────────────────────────────
  const toggleGroup = useCallback(
    (group: string) => {
      setSelectedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(group)) next.delete(group);
        else next.add(group);
        patchUrl({ streaks: next.size === 0 ? null : Array.from(next).join(",") });
        return next;
      });
    },
    [patchUrl],
  );

  const handleSlider = useCallback(
    (values: number[]) => {
      const v = values[0] ?? DEFAULT_MIN_PERC;
      setMinPerc(v);
      patchUrl({ min_perc: String(v) });
    },
    [patchUrl],
  );

  const clearFilters = useCallback(() => {
    setSelectedGroups(new Set());
    setMinPerc(DEFAULT_MIN_PERC);
    patchUrl({ streaks: null, min_perc: String(DEFAULT_MIN_PERC) });
  }, [patchUrl]);

  // ─ Virtualizer ──────────────────────────────────────────────────────
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 5,
  });

  // ─ Render ───────────────────────────────────────────────────────────
  return (
    <div className="card flex flex-col gap-3 p-4 lg:p-5">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-lg text-[var(--color-ink-display)]">
          Streaks
        </h3>
        <div className="flex items-center gap-3">
          <span className="label text-[var(--color-ink-faint)]">
            {filtered.length} de {data.all.length}
          </span>
          <button
            type="button"
            onClick={() => setCmdkOpen(true)}
            aria-label="buscar streak"
            className="label inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1 text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
          >
            <Search className="h-3 w-3" aria-hidden="true" />
            <span>buscar streak</span>
          </button>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="label text-[var(--color-vermelho)] hover:underline"
            >
              limpar filtros
            </button>
          ) : null}
        </div>
      </header>

      {/* Chips de grupo — horizontal scroll mobile */}
      <div
        className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="filtros por grupo de streak"
      >
        {allGroups.map((g) => {
          const active = selectedGroups.has(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => toggleGroup(g)}
              aria-pressed={active}
              className={[
                "label shrink-0 snap-start rounded-[var(--radius-sm)] border px-3 py-1 transition-colors",
                active
                  ? "border-[var(--color-vermelho-low)] bg-[color-mix(in_srgb,var(--color-vermelho)_15%,transparent)] text-[var(--color-vermelho)]"
                  : "border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]",
              ].join(" ")}
            >
              {g}
            </button>
          );
        })}
      </div>

      {/* Slider min_perc */}
      <div className="flex items-center gap-3">
        <span className="label w-12 shrink-0 text-[var(--color-ink-muted)]">≥ {minPerc}%</span>
        <Slider.Root
          className="relative flex h-5 w-full grow touch-none select-none items-center"
          value={[minPerc]}
          onValueChange={handleSlider}
          min={0}
          max={100}
          step={5}
          aria-label="percentil mínimo"
        >
          <Slider.Track className="relative h-1 grow rounded-full bg-[var(--color-line)]">
            <Slider.Range className="absolute h-full rounded-full bg-[var(--color-vermelho-low)]" />
          </Slider.Track>
          <Slider.Thumb
            className="block h-4 w-4 rounded-full border border-[var(--color-vermelho)] bg-[var(--color-surface-1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-vermelho)]"
            aria-label="percentil mínimo"
          />
        </Slider.Root>
      </div>

      {/* Heatmap CSS Grid OR empty state */}
      {filtered.length === 0 ? (
        <p
          className="label py-6 text-center text-[var(--color-ink-faint)]"
          data-testid="streaks-empty"
        >
          Nenhuma streak ≥ {minPerc}%
          {selectedGroups.size > 0 ? " nos grupos selecionados" : ""}.
        </p>
      ) : (
        <>
          <div
            data-testid="streaks-heatmap-grid"
            className="grid gap-1"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))" }}
          >
            {filtered.map((s, i) => (
              <div
                key={`${s.stat_type}-${i}`}
                data-testid="streak-cell"
                className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-[var(--radius-sm)] p-1 text-center"
                style={{
                  background: heatColor(s.overall_perc),
                  color: s.overall_perc >= 70 ? "#fff" : "var(--color-ink-display)",
                }}
                title={`${s.desc} · home ${s.home_perc}% · away ${s.away_perc}% · ${s.overall_count}/${s.overall_fixtures}`}
              >
                <span className="num text-xs font-semibold">
                  {s.overall_perc}%
                </span>
                <span className="line-clamp-2 text-[9px] leading-tight opacity-90">
                  {s.desc}
                </span>
                <span className="label text-[8px] opacity-70">
                  {s.group}
                </span>
              </div>
            ))}
          </div>

          {/* Lista virtualizada */}
          <div
            ref={parentRef}
            data-testid="streaks-virtual-list"
            className="max-h-[320px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--color-line)]"
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((vi) => {
                const s = filtered[vi.index];
                return (
                  <StreakRow
                    key={vi.key}
                    streak={s}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vi.start}px)`,
                      height: `${vi.size}px`,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* cmdk modal (busca textual) */}
      {cmdkOpen ? (
        <StreaksCmdk
          streaks={data.all}
          onClose={() => setCmdkOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ─── StreakRow ──────────────────────────────────────────────────────────

function StreakRow({
  streak,
  style,
}: {
  streak: Streak;
  style: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-3 py-2 text-sm"
    >
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[var(--color-ink-display)]">
          {streak.desc}
        </span>
        <span className="label text-[var(--color-ink-faint)]">
          {streak.group} · {streak.stat_type}
        </span>
      </div>
      <div className="flex shrink-0 items-baseline gap-3">
        <span
          className="num text-base font-semibold"
          style={{ color: heatColor(streak.overall_perc) }}
        >
          {streak.overall_perc}%
        </span>
        <span className="label text-[var(--color-ink-muted)]">
          h {streak.home_perc}% · a {streak.away_perc}%
        </span>
      </div>
    </div>
  );
}

// ─── StreaksCmdk ────────────────────────────────────────────────────────

function StreaksCmdk({
  streaks,
  onClose,
}: {
  streaks: Streak[];
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="buscar streak"
      className="fixed inset-0 z-[100] flex items-start justify-center bg-[color-mix(in_srgb,var(--color-void)_70%,transparent)] px-4 pt-[15vh] backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-[var(--radius)] border border-[var(--color-line-strong)] bg-[var(--color-surface-1)] shadow-2xl"
      >
        <Command label="buscar streak" className="flex flex-col">
          <Command.Input
            autoFocus
            placeholder="buscar streak…"
            className="h-12 w-full border-b border-[var(--color-line-subtle)] bg-transparent px-4 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)]"
          />
          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-xs text-[var(--color-ink-muted)]">
              nada por aqui.
            </Command.Empty>
            {streaks.map((s, i) => (
              <Command.Item
                key={`${s.stat_type}-${i}`}
                value={`${s.desc} ${s.stat_type} ${s.group}`}
                onSelect={onClose}
                className="flex cursor-pointer items-center justify-between rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--color-ink)] aria-selected:bg-[var(--color-surface-2)]"
              >
                <span>{s.desc}</span>
                <span className="num text-xs text-[var(--color-ink-muted)]">
                  {s.overall_perc}%
                </span>
              </Command.Item>
            ))}
          </Command.List>
          <div className="flex items-center justify-between border-t border-[var(--color-line-subtle)] px-3 py-2 text-[10px] text-[var(--color-ink-faint)]">
            <span className="num">↵ fechar · esc cancelar</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
