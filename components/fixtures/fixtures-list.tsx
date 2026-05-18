import type { FixtureDTO } from "@/lib/fixtures/types";
import { groupFixturesByLeague } from "@/lib/fixtures/leagues";
import { FixtureCard } from "./fixture-card";
import { isHighSignal } from "@/lib/alerts/is-high-signal";

interface FixturesListProps {
  fixtures: FixtureDTO[];
}

/**
 * Renders fixtures grouped by league + country. Server Component — pure
 * transform of the input array; collapse/expand interactivity is not in
 * the spec, so this stays plain (the URL-driven date selector is the only
 * interaction needed on /fixtures).
 */
export function FixturesList({ fixtures }: FixturesListProps) {
  const groups = groupFixturesByLeague(fixtures);

  if (groups.length === 0) {
    return (
      <div className="card flex flex-col items-start gap-3 p-8">
        <span
          className="font-[var(--font-display)] text-2xl italic"
          style={{ color: "var(--color-ink-muted)" }}
        >
          sem jogos.
        </span>
        <p className="max-w-prose text-sm text-[var(--color-ink-muted)]">
          Nenhum jogo no scraper para esta data. Tente outro dia.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => {
        const countryLabel = group.country
          ? group.country.charAt(0).toUpperCase() + group.country.slice(1)
          : null;
        return (
          <section key={group.key} aria-labelledby={`league-${group.key}`}>
            <header className="mb-3 flex items-baseline gap-3">
              <span aria-hidden className="text-base leading-none">
                {group.flag}
              </span>
              <h3 id={`league-${group.key}`} className="label text-[var(--color-ink-muted)]">
                {group.league}
                {countryLabel ? ` (${countryLabel})` : ""}
              </h3>
              <span className="label num text-[var(--color-ink-faint)]">
                {group.fixtures.length}
              </span>
            </header>
            <ul className="flex flex-col gap-2">
              {group.fixtures.map((fixture) => (
                <li key={fixture.id}>
                  <FixtureCard
                    fixture={fixture}
                    highSignal={isHighSignal(fixture.badges ?? [])}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
