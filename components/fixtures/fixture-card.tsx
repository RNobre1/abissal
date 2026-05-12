import Link from "next/link";
import type { FixtureDTO } from "@/lib/fixtures/types";
import { formatUtcAsBrt } from "@/lib/fixtures/time";

interface FixtureCardProps {
  fixture: FixtureDTO;
}

/**
 * Single-fixture row inside a league section on /fixtures. Server Component —
 * no interactivity needed beyond the link to the analyze page. Clicking the
 * row navigates to /fixtures/[id], which is where the LLM streaming UI lives.
 *
 * Layout: ko time on the left (mono, BRT), home/away in the middle, "OFF"
 * badge on the right when the row has no detail_json cached yet. The badge
 * uses --color-vermelho per the spec; the rest follows the same .card /
 * .card-hover / .label / .num conventions as the banca pages.
 */
export function FixtureCard({ fixture }: FixtureCardProps) {
  const ko = formatUtcAsBrt(fixture.kickoff_utc) ?? fixture.ko_time ?? "TBD";

  return (
    <Link
      href={`/fixtures/${fixture.id}`}
      className="card card-hover flex items-center gap-3 px-3 py-2.5 lg:gap-4 lg:px-4 lg:py-3"
      aria-label={`Analisar ${fixture.home_team} vs ${fixture.away_team}`}
    >
      <span
        className="num shrink-0 text-sm tabular-nums text-[var(--color-ink)]"
        aria-label="Horário de Brasília"
      >
        {ko}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-right text-sm text-[var(--color-ink)]">
          {fixture.home_team}
        </span>
        <span className="label shrink-0 text-[var(--color-ink-faint)]">vs</span>
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-ink)]">
          {fixture.away_team}
        </span>
      </span>
      {!fixture.has_detail ? (
        <span
          className="label shrink-0 rounded-[var(--radius-sm)] border px-2 py-0.5"
          style={{
            color: "var(--color-vermelho)",
            borderColor: "var(--color-vermelho-low)",
          }}
          title="Sem detail em cache — clique para forçar refresh antes da análise."
        >
          OFF
        </span>
      ) : null}
    </Link>
  );
}
