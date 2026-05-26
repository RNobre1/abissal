/**
 * lib/bets/csv-export.ts
 *
 * Pure function to convert bet rows to CSV format.
 * No side-effects, no HTTP — used by GET /api/bets/export.
 *
 * Format:
 *   - UTF-8 encoding
 *   - Optional BOM (0xFEFF) for Excel compatibility
 *   - All fields quoted when they contain commas, double-quotes, or newlines
 *   - Double-quotes inside a field are escaped as ""
 *   - Null/undefined → empty string (not the literal "null")
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BetCsvRow {
  id: string;
  placed_at: string;
  resolved_at: string | null;
  house_name: string | null;
  kind: string;
  status: string;
  total_stake: number;
  total_odds: number;
  expected_return: number | null;
  actual_return: number | null;
  pl: number | null;
  note: string | null;
  league: string | null;
  market: string | null;
  sport: string | null;
}

export interface CsvOptions {
  /** Prepend UTF-8 BOM (0xFEFF). Useful for Excel auto-detection. Default: false. */
  bom?: boolean;
}

// ---------------------------------------------------------------------------
// CSV header
// ---------------------------------------------------------------------------

const HEADERS: Array<keyof BetCsvRow> = [
  "id",
  "placed_at",
  "resolved_at",
  "house_name",
  "kind",
  "status",
  "total_stake",
  "total_odds",
  "expected_return",
  "actual_return",
  "pl",
  "note",
  "league",
  "market",
  "sport",
];

// Human-friendly header labels (same order as HEADERS)
const HEADER_LABELS: string[] = [
  "id",
  "placed_at",
  "resolved_at",
  "house",
  "kind",
  "status",
  "stake",
  "odds",
  "expected_return",
  "actual_return",
  "pl",
  "note",
  "league",
  "market",
  "sport",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escapes a value for CSV:
 * - Converts null/undefined to empty string.
 * - Wraps in double-quotes when the value contains a comma, double-quote, or newline.
 * - Escapes internal double-quotes by doubling them.
 */
function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // Needs quoting?
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ---------------------------------------------------------------------------
// buildBetsCsv
// ---------------------------------------------------------------------------

/**
 * Converts an array of BetCsvRow to a CSV string.
 *
 * @param rows    Rows to serialize.
 * @param options Optional BOM flag.
 * @returns       UTF-8 CSV string (optionally BOM-prefixed).
 */
export function buildBetsCsv(
  rows: BetCsvRow[],
  options: CsvOptions = {},
): string {
  const lines: string[] = [];

  // Header row
  lines.push(HEADER_LABELS.map(escapeCsvField).join(","));

  // Data rows
  for (const row of rows) {
    const fields = HEADERS.map((key) => escapeCsvField(row[key]));
    lines.push(fields.join(","));
  }

  const csv = lines.join("\n");
  return options.bom ? "﻿" + csv : csv;
}
