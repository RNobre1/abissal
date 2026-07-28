/**
 * Panel J — choistats predictions (OPTIONAL).
 *
 * choistats supplies `predictions[]` for ~11% of fixtures, ordered as-is.
 * We sort by `chance` DESC so the highest-confidence pick floats to the top.
 * Returns `null` when the array is empty (no placeholder; the slot
 * disappears upstream).
 *
 * The chip color is bucketed by confidence (`strengthColor`): ≥90 verde,
 * 70–89 âmbar, <70 neutro — exposed via `data-strength` for tests/CSS.
 * Each evidence column is headed with the team name + a swatch matching
 * `teamColor("home"|"away")` so the reader knows which side the bullets
 * describe.
 */

import { PanelShell } from "@/components/fixtures/stats/panels/_shell";
import {
  TeamLegend,
  teamColor,
} from "@/components/fixtures/stats/_primitives/team-legend";
import { InfoPopover } from "@/components/fixtures/stats/_primitives/info-popover";
import type { Prediction } from "@/lib/fixtures/stats/detail-json-types";

interface PredictionsProps {
  data: Prediction[];
  homeTeam: string;
  awayTeam: string;
}

type StrengthBucket = "high" | "mid" | "low";

/** Maps a chance % to a confidence bucket + token color. */
function strengthColor(chance: number): {
  bucket: StrengthBucket;
  bg: string;
  fg: string;
} {
  if (chance >= 90) {
    return {
      bucket: "high",
      bg: "var(--color-success)",
      fg: "var(--color-ink-display)",
    };
  }
  if (chance >= 70) {
    return {
      bucket: "mid",
      bg: "var(--color-warning)",
      fg: "var(--color-ink-display)",
    };
  }
  return {
    bucket: "low",
    bg: "var(--color-surface-3)",
    fg: "var(--color-ink-muted)",
  };
}

function EvidenceColumn({
  side,
  team,
  stats,
}: {
  side: "home" | "away";
  team: string;
  stats: string[];
}) {
  if (stats.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div
        data-evidence-head
        className="flex items-center gap-1.5 text-[var(--color-ink-faint)]"
      >
        <span
          data-swatch
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: teamColor(side) }}
        />
        <span className="label">{team}</span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {stats.map((s, i) => (
          <li key={i} className="text-[var(--color-ink-muted)]">
            • {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Predictions({ data, homeTeam, awayTeam }: PredictionsProps) {
  if (!Array.isArray(data) || data.length === 0) return null;

  const sorted = [...data].sort((a, b) => b.chance - a.chance);

  return (
    <PanelShell
      title="Predictions"
      eyebrow={
        <span className="inline-flex items-center gap-1.5">
          choistats
          <InfoPopover label="como ler predições">
            <p>
              Predição é do <strong>JOGO</strong>. Bullets = evidência da forma
              recente de cada lado.
            </p>
          </InfoPopover>
        </span>
      }
    >
      <TeamLegend home={homeTeam} away={awayTeam} className="mb-1" />
      <ul className="flex flex-col gap-3">
        {sorted.map((p, idx) => {
          const strength = strengthColor(p.chance);
          return (
            <li
              key={`${p.stat_type}-${idx}`}
              data-prediction
              className="flex flex-col gap-2 rounded-md bg-[var(--color-surface-2)] p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span
                  data-strength={strength.bucket}
                  className="rounded-full px-2 py-0.5 text-sm font-medium"
                  style={{
                    backgroundColor: strength.bg,
                    color: strength.fg,
                  }}
                >
                  {Math.round(p.chance)}% {p.stat_type}
                </span>
                {p.best_odds !== null ? (
                  <span className="num text-sm text-[var(--color-ink-display)]">
                    {p.best_odds.toFixed(2)}
                    {p.best_odds_bookmaker ? (
                      <span className="label ml-1 text-[var(--color-ink-faint)]">
                        {p.best_odds_bookmaker}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>

              {p.home_stats.length > 0 || p.away_stats.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  <EvidenceColumn
                    side="home"
                    team={homeTeam}
                    stats={p.home_stats}
                  />
                  <EvidenceColumn
                    side="away"
                    team={awayTeam}
                    stats={p.away_stats}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </PanelShell>
  );
}
