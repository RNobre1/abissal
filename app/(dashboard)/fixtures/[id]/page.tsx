import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatUtcAsBrt, trimKoTime, toIsoUtc } from "@/lib/fixtures/time";
import { countryToFlag } from "@/lib/fixtures/leagues";
import { AnalyzePanel } from "@/components/fixtures/analyze-panel";
import type { FixtureDTO, FixtureRow } from "@/lib/fixtures/types";

interface AnalyzePageProps {
  params: Promise<{ id: string }>;
}

const FIXTURE_COLUMNS =
  "id, match_date, ko_time, home_team, away_team, league, country, source_url, detail_json, kickoff_utc";

export default async function AnalyzePage({ params }: AnalyzePageProps) {
  const { id: rawId } = await params;
  if (!/^\d+$/.test(rawId)) notFound();
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  // The `fixtures` table isn't reflected in the generated Database type yet
  // (the rest of the codebase uses the same untyped escape hatch). Auth is
  // enforced by the (dashboard) layout one level up.
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = admin as unknown as { from: (t: string) => any };
  const { data, error } = await untyped
    .from("fixtures")
    .select(FIXTURE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`failed to load fixture ${id}: ${error.message}`);
  }
  if (!data) {
    notFound();
  }

  const row = data as FixtureRow;
  const fixture: FixtureDTO = {
    id: row.id,
    match_date: row.match_date,
    ko_time: trimKoTime(row.ko_time),
    home_team: row.home_team,
    away_team: row.away_team,
    league: row.league,
    country: row.country,
    source_url: row.source_url,
    has_detail: row.detail_json !== null && row.detail_json !== undefined,
    kickoff_utc: toIsoUtc(row.kickoff_utc),
  };

  const ko = formatUtcAsBrt(fixture.kickoff_utc) ?? fixture.ko_time ?? "TBD";
  const flag = countryToFlag(fixture.country);
  const countryLabel = fixture.country
    ? fixture.country.charAt(0).toUpperCase() + fixture.country.slice(1)
    : null;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
      <Link
        href="/fixtures"
        className="label inline-flex items-center gap-2 hover:text-[var(--color-ink)]"
      >
        ← voltar
      </Link>

      <header className="mt-6 mb-8 border-b border-[var(--color-line-subtle)] pb-6">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-base leading-none">
            {flag}
          </span>
          <span className="label">
            {fixture.league ?? "—"}
            {countryLabel ? ` · ${countryLabel}` : ""}
          </span>
          <span className="label num text-[var(--color-ink-faint)]">{ko} BRT</span>
        </div>
        {/* Inline span so very long team names wrap on word boundaries
            instead of overflowing horizontally on narrow phones. */}
        <h2 className="mt-3 leading-tight">
          {fixture.home_team}{" "}
          <span className="label whitespace-nowrap text-[var(--color-ink-faint)]">
            vs
          </span>{" "}
          {fixture.away_team}
        </h2>
      </header>

      <AnalyzePanel fixture={fixture} />
    </main>
  );
}
