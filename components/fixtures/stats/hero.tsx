import { countryToFlag } from "@/lib/fixtures/leagues";

/**
 * Pre-computed numbers passed from the Server page to the Client hero.
 *
 * Keeping the maths server-side means the hero stays trivial: it just
 * renders strings and applies the LED-style glow. All `null` slots are
 * rendered as an em-dash so the layout is stable across fixtures with
 * partial data.
 */
export interface HeroKpiBundle {
  /** 1X2 decimal odds from odds_summary.Result. */
  home_odd: number | null;
  draw_odd: number | null;
  away_odd: number | null;
  /** Over 2.5 decimal odd from odds_summary["Match Goals Overs/Unders"]. */
  over25_odd: number | null;
  /** BTTS Yes decimal odd from odds_summary.BTTS. */
  btts_yes_odd: number | null;
  /** Average total booking points from referee_record. */
  ref_avg_bp: number | null;
}

export interface HeroProps {
  homeTeam: string;
  awayTeam: string;
  /** Pre-formatted kickoff in BRT, e.g. "16:00". */
  kickoffBrt: string | null;
  league: string | null;
  /** Country slug from fixtures.country. */
  country: string | null;
  /** Pre-computed KPI bundle; null when detail_json is null/missing. */
  kpis: HeroKpiBundle | null;
}

function fmt(value: number | null, digits: number = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function fmt1(value: number | null): string {
  return fmt(value, 1);
}

function KpiTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      className="card relative flex flex-col items-center gap-1 px-2 py-2 sm:px-4 sm:py-3 lg:px-5 lg:py-4"
      style={{
        boxShadow: "var(--shadow-glow-vermelho), var(--shadow-card)",
      }}
    >
      <span className="label" style={{ letterSpacing: "0.22em" }}>
        {label}
      </span>
      <span
        className="num text-xl sm:text-2xl lg:text-3xl"
        style={{
          color: "var(--color-ink-display)",
          textShadow:
            "0 0 14px rgba(196, 43, 43, 0.35), 0 0 2px rgba(196, 43, 43, 0.5)",
        }}
      >
        {value}
      </span>
      {hint ? (
        <span className="label text-[var(--color-ink-faint)]">{hint}</span>
      ) : null}
    </div>
  );
}

export function Hero({
  homeTeam,
  awayTeam,
  kickoffBrt,
  league,
  country,
  kpis,
}: HeroProps) {
  const flag = countryToFlag(country);
  const ko = kickoffBrt ?? "TBD";
  const countryLabel = country
    ? country.charAt(0).toUpperCase() + country.slice(1)
    : null;

  return (
    <div
      className="card strata @container/hero relative overflow-hidden px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-12"
      style={{ boxShadow: "var(--shadow-glow-vermelho), var(--shadow-card)" }}
    >
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span aria-hidden className="text-base leading-none">
          {flag}
        </span>
        <span className="label">
          {league ?? "—"}
          {countryLabel ? ` · ${countryLabel}` : ""}
        </span>
        <span className="label num text-[var(--color-ink-faint)]">
          {ko} BRT
        </span>
      </div>

      <h1
        className="font-display"
        style={{
          fontSize: "clamp(2.5rem, 6vw, 5rem)",
          lineHeight: 0.95,
          letterSpacing: "-0.04em",
          color: "var(--color-ink-display)",
          textShadow: "0 0 32px rgba(196, 43, 43, 0.12)",
        }}
      >
        {homeTeam}{" "}
        <span
          className="label whitespace-nowrap align-middle"
          style={{ color: "var(--color-ink-faint)" }}
        >
          vs
        </span>{" "}
        {awayTeam}
      </h1>

      {kpis ? (
        <div className="mt-6 grid grid-cols-3 gap-2 sm:mt-8 sm:gap-3 @md/hero:grid-cols-3 @2xl/hero:grid-cols-6">
          <KpiTile label="1" value={fmt(kpis.home_odd)} />
          <KpiTile label="X" value={fmt(kpis.draw_odd)} />
          <KpiTile label="2" value={fmt(kpis.away_odd)} />
          <KpiTile label="Over 2.5" value={fmt(kpis.over25_odd)} />
          <KpiTile label="BTTS Yes" value={fmt(kpis.btts_yes_odd)} />
          <KpiTile label="Ref BP" value={fmt1(kpis.ref_avg_bp)} hint="avg" />
        </div>
      ) : (
        <p className="mt-6 text-[var(--color-ink-muted)]">
          stats em breve — scraper atualiza diariamente
        </p>
      )}
    </div>
  );
}
