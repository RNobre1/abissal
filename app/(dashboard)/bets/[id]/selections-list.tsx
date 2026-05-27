import { fmt } from "@/lib/format";
import type { Database } from "@/lib/supabase/types";

type BetKind = Database["public"]["Enums"]["bet_kind"];
type BetStatus = Database["public"]["Enums"]["bet_status"];
type SelectionRow = Database["public"]["Tables"]["bet_selections"]["Row"];

const STATUS_LABEL: Record<BetStatus, string> = {
  pending: "pendente",
  won: "ganha",
  lost: "perdida",
  void: "anulada",
  cashed_out: "cash-out",
  half_won: "meia ganha",
  half_lost: "meia perdida",
  partially_void: "parcial anulada",
};

function statusColor(s: BetStatus): string {
  if (s === "won" || s === "half_won" || s === "cashed_out")
    return "var(--color-depth-hi)";
  if (s === "lost" || s === "half_lost") return "var(--color-vermelho-hi)";
  if (s === "void" || s === "partially_void") return "var(--color-ink-muted)";
  return "var(--color-ink-display)";
}

interface SelectionsListProps {
  selections: SelectionRow[];
  kind: BetKind;
}

/**
 * Renders the bet_selections list with two display modes:
 *
 * - bet_builder: all legs belong to the same game; show one shared event_label
 *   header and hide individual odds (combined odd lives in bets.total_odds).
 * - everything else (single, multiple, system): original layout — event_label
 *   per row + individual odd column.
 */
export function SelectionsList({ selections, kind }: SelectionsListProps) {
  const isBetBuilder =
    kind === "bet_builder" &&
    selections.length > 0 &&
    selections.every((s) => s.event_label === selections[0]?.event_label);

  if (isBetBuilder) {
    const eventLabel = selections[0]?.event_label ?? "jogo";
    return (
      <div>
        <p className="mb-2 text-sm font-medium text-[var(--color-ink)]">
          {eventLabel}
        </p>
        <ol className="flex flex-col gap-[2px] overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-line)]">
          {selections.map((s, i) => (
            <li
              key={s.id}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-4 bg-[var(--color-surface-2)] px-4 py-3"
            >
              <span className="num text-[10px] text-[var(--color-ink-faint)]">
                #{i + 1}
              </span>
              <span className="truncate text-sm text-[var(--color-ink)]">
                {s.selection_label}
              </span>
              <span
                className="num text-[10px] uppercase tracking-[0.18em]"
                style={{ color: statusColor(s.status) }}
              >
                {STATUS_LABEL[s.status]}
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  // Regular (single / multiple / system) layout
  return (
    <ol className="flex flex-col gap-[2px] overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-line)]">
      {selections.map((s, i) => (
        <li
          key={s.id}
          className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 bg-[var(--color-surface-2)] px-4 py-3"
        >
          <span className="num text-[10px] text-[var(--color-ink-faint)]">
            #{i + 1}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm text-[var(--color-ink)]">
              {s.event_label}
            </span>
            <span className="truncate text-xs text-[var(--color-ink-muted)]">
              {s.selection_label}
            </span>
          </div>
          <span
            className="num text-[10px] uppercase tracking-[0.18em]"
            style={{ color: statusColor(s.status) }}
          >
            {STATUS_LABEL[s.status]}
          </span>
          <span
            className="num text-sm"
            style={{ color: "var(--color-ink-display)" }}
          >
            @ {fmt.number(Number(s.odds))}
          </span>
        </li>
      ))}
    </ol>
  );
}
