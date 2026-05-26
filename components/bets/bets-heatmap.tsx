"use client";

/**
 * BetsHeatmap — day × league grid showing bet count or P/L per cell.
 *
 * Displayed in /bets page. Shows last 30 days × top 10 leagues.
 * Empty cells = no bets that day/league. Cells colored by intensity:
 *   - winColor (depth) for positive P/L
 *   - lossColor (vermelho) for negative P/L
 *   - neutralColor for pending/zero
 */

export interface HeatmapCell {
  date: string;    // YYYY-MM-DD
  league: string;
  count: number;
  pl: number | null;
}

interface BetsHeatmapProps {
  cells: HeatmapCell[];
  /** Ordered list of dates to display on X axis (YYYY-MM-DD). */
  dates: string[];
  /** Ordered list of leagues to display on Y axis. */
  leagues: string[];
}

function cellColor(pl: number | null, count: number): string {
  if (count === 0) return "transparent";
  if (pl === null) return "var(--color-surface-3, var(--color-surface-2))";
  if (pl > 0) return "color-mix(in srgb, var(--color-depth) 60%, transparent)";
  if (pl < 0) return "color-mix(in srgb, var(--color-vermelho) 50%, transparent)";
  return "var(--color-surface-3, var(--color-surface-2))";
}

function shortDate(date: string): string {
  // "2026-05-25" → "25/05"
  const parts = date.split("-");
  if (parts.length < 3) return date;
  return `${parts[2]}/${parts[1]}`;
}

function shortLeague(league: string): string {
  // Abbreviate long names: "Premier League" → "PL"
  return league
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 4);
}

export function BetsHeatmap({ cells, dates, leagues }: BetsHeatmapProps) {
  if (dates.length === 0 || leagues.length === 0) {
    return (
      <p className="label text-[var(--color-ink-faint)]">sem dados para heatmap</p>
    );
  }

  // Build lookup: "date|league" → cell
  const lookup = new Map<string, HeatmapCell>();
  for (const cell of cells) {
    lookup.set(`${cell.date}|${cell.league}`, cell);
  }

  return (
    <div
      className="overflow-x-auto"
      role="img"
      aria-label="heatmap de apostas por dia e liga"
    >
      <table className="border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="w-10 py-1 pr-2 text-right text-[var(--color-ink-faint)]" />
            {dates.map((d) => (
              <th
                key={d}
                className="num w-8 py-1 text-center text-[var(--color-ink-muted)]"
                title={d}
              >
                {shortDate(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leagues.map((league) => (
            <tr key={league}>
              <td
                className="num py-0.5 pr-2 text-right text-[var(--color-ink-muted)]"
                title={league}
              >
                {shortLeague(league)}
              </td>
              {dates.map((date) => {
                const cell = lookup.get(`${date}|${league}`);
                const count = cell?.count ?? 0;
                const pl = cell?.pl ?? null;
                const bg = cellColor(pl, count);
                return (
                  <td
                    key={date}
                    className="p-0.5"
                    title={
                      count > 0
                        ? `${date} · ${league}: ${count} aposta(s), P/L ${pl !== null ? pl.toFixed(2) : "—"}`
                        : `${date} · ${league}: sem apostas`
                    }
                  >
                    <div
                      className="h-5 w-7 rounded-[2px]"
                      style={{ backgroundColor: bg }}
                      aria-hidden="true"
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
