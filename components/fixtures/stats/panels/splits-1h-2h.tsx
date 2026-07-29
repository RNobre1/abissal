/**
 * Panel E — 1H vs 2H splits.
 *
 * 6 horizontal CSS bars (no chart lib): goals/corners/cards × 1T/2T.
 * Each bar's width is proportional to the max across all 6 metrics, so the
 * tallest one sits at 100% and the others scale down. Empty/zero data
 * collapses gracefully (no division-by-zero — width = "0%").
 */

import { PanelShell } from "@/components/fixtures/stats/panels/_shell";
import type { Splits1h2h as SplitsData } from "@/lib/fixtures/stats/detail-json-types";

interface SplitsProps {
  data: SplitsData;
}

interface Row {
  label: string;
  half: "1T" | "2T";
  /** `null` = o choistats não forneceu o dado. Renderiza "—", nunca "0.00". */
  value: number | null;
}

function buildRows(d: SplitsData): Row[] {
  return [
    { label: "Gols", half: "1T", value: d.goals_1h_avg },
    { label: "Gols", half: "2T", value: d.goals_2h_avg },
    { label: "Cantos", half: "1T", value: d.corners_1h_avg },
    { label: "Cantos", half: "2T", value: d.corners_2h_avg },
    { label: "Cartões", half: "1T", value: d.cards_1h_avg },
    { label: "Cartões", half: "2T", value: d.cards_2h_avg },
  ];
}

export function Splits1h2h({ data }: SplitsProps) {
  const rows = buildRows(data);
  const max = rows.reduce((m, r) => (r.value !== null && r.value > m ? r.value : m), 0);

  return (
    <PanelShell title="1T vs 2T" eyebrow="médias">
      <ul className="flex flex-col gap-2">
        {rows.map((r, idx) => {
          // Compact percent: 0 → "0%", 100 → "100%", 14.545 → "14.5%".
          // Stripping the trailing ".0" keeps tests honest and the DOM
          // smaller without changing visual result.
          // Sem dado ⇒ barra vazia. Antes o null virava 0 e a barra some do
          // mesmo jeito, mas o número ao lado mentia "0.00".
          const raw = max > 0 && r.value !== null ? (r.value / max) * 100 : 0;
          const rounded = Math.round(raw * 10) / 10;
          const widthStr = Number.isInteger(rounded)
            ? `${rounded}%`
            : `${rounded.toFixed(1)}%`;
          return (
            <li
              key={idx}
              data-bar-row
              className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2 text-sm"
            >
              <span className="label text-[var(--color-ink-faint)]">
                {r.label} {r.half}
              </span>
              <span className="relative block h-3 overflow-hidden rounded-sm bg-[var(--color-surface-2)]">
                <span
                  data-bar-fill
                  className="block h-full rounded-sm"
                  style={{
                    width: widthStr,
                    backgroundColor: "var(--color-vermelho)",
                  }}
                />
              </span>
              <span
                className={`num text-right ${
                  r.value === null
                    ? "text-[var(--color-ink-faint)]"
                    : "text-[var(--color-ink-display)]"
                }`}
                title={r.value === null ? "dado não fornecido pela fonte" : undefined}
              >
                {r.value === null ? "—" : r.value.toFixed(2)}
              </span>
            </li>
          );
        })}
      </ul>
    </PanelShell>
  );
}
