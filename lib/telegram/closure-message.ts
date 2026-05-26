/**
 * lib/telegram/closure-message.ts
 *
 * Pure functions for building the nightly Telegram closure message.
 * No side-effects, no HTTP — easy to test and portable between
 * GitHub Actions and Cloudflare Workers.
 *
 * Format:
 *   📊 hoje (25/05): 2W-1L · +1,20u · IA acertou 67% · CLV -0,3%
 *
 * Sharp veto (per plan): NO morning message, only 23h BRT (02:00 UTC).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClosureMessageInput {
  /** Number of won bets resolved today. */
  wins: number;
  /** Number of lost bets resolved today. */
  losses: number;
  /** Net P/L in units (can be negative). */
  plUnits: number;
  /** AI accuracy percentage (0-100), or null if no resolved recos. */
  aiAccuracyPct: number | null;
  /**
   * Closing Line Value as a percentage differential.
   * Positive = we beat the line (good), negative = line moved against us.
   * Null when not enough data.
   */
  clvPct: number | null;
  /** Date label, e.g. "25/05". */
  date: string;
}

export interface DailySummaryInput {
  bets: Array<{ status: string; pl_units: number }>;
  recos: Array<{ resolved: boolean; correct: boolean }>;
}

export interface DailySummary {
  wins: number;
  losses: number;
  plUnits: number;
  aiAccuracyPct: number | null;
}

// ---------------------------------------------------------------------------
// formatClosureMessage
// ---------------------------------------------------------------------------

/**
 * Builds the Telegram notification text for the 23h BRT daily closure.
 *
 * Rules:
 * - Always shows: date, W-L record, P/L in units.
 * - Shows AI accuracy only when aiAccuracyPct is not null.
 * - Shows CLV only when clvPct is not null.
 * - Numbers formatted with pt-BR decimals (comma separator) for readability.
 */
export function formatClosureMessage({
  wins,
  losses,
  plUnits,
  aiAccuracyPct,
  clvPct,
  date,
}: ClosureMessageInput): string {
  const record = `${wins}W-${losses}L`;
  const plFormatted = formatUnits(plUnits);

  const parts: string[] = [`📊 hoje (${date}): ${record} · ${plFormatted}u`];

  if (aiAccuracyPct !== null) {
    parts.push(`IA acertou ${Math.round(aiAccuracyPct)}%`);
  }

  if (clvPct !== null) {
    const clvFormatted = formatPct(clvPct);
    parts.push(`CLV ${clvFormatted}%`);
  }

  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// buildDailySummary
// ---------------------------------------------------------------------------

/**
 * Aggregates raw DB rows into the summary needed by formatClosureMessage.
 * Called by the GitHub Actions workflow script with data already fetched
 * from Supabase.
 */
export function buildDailySummary({
  bets,
  recos,
}: DailySummaryInput): DailySummary {
  let wins = 0;
  let losses = 0;
  let plUnits = 0;

  for (const bet of bets) {
    if (bet.status === "won" || bet.status === "half_won") {
      wins++;
    } else if (bet.status === "lost" || bet.status === "half_lost") {
      losses++;
    }
    plUnits += bet.pl_units ?? 0;
  }

  const resolvedRecos = recos.filter((r) => r.resolved);
  let aiAccuracyPct: number | null = null;
  if (resolvedRecos.length > 0) {
    const correctCount = resolvedRecos.filter((r) => r.correct).length;
    aiAccuracyPct = (correctCount / resolvedRecos.length) * 100;
  }

  return { wins, losses, plUnits, aiAccuracyPct };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Formats a number with pt-BR comma decimal, sign-prefixed, 2 decimals. */
function formatUnits(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return sign + value.toFixed(2).replace(".", ",");
}

/** Formats a CLV/percentage with pt-BR comma decimal, 1 decimal, sign. */
function formatPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return sign + value.toFixed(1).replace(".", ",");
}
