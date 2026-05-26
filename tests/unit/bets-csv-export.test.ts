import { describe, expect, it } from "vitest";
import { buildBetsCsv, type BetCsvRow } from "@/lib/bets/csv-export";

const SAMPLE_ROWS: BetCsvRow[] = [
  {
    id: "bet-1",
    placed_at: "2026-05-01T12:00:00Z",
    resolved_at: "2026-05-01T22:00:00Z",
    house_name: "Bet365",
    kind: "single",
    status: "won",
    total_stake: 20,
    total_odds: 2.1,
    expected_return: 42,
    actual_return: 42,
    pl: 22,
    note: "Premier League fixture",
    league: "Premier League",
    market: "1x2",
    sport: "Futebol",
  },
  {
    id: "bet-2",
    placed_at: "2026-05-02T15:00:00Z",
    resolved_at: null,
    house_name: 'Bet"special"',
    kind: "multiple",
    status: "pending",
    total_stake: 15,
    total_odds: 5.5,
    expected_return: 82.5,
    actual_return: null,
    pl: null,
    note: "two, games",
    league: null,
    market: "btts",
    sport: "Futebol",
  },
];

describe("buildBetsCsv", () => {
  it("outputs correct CSV header", () => {
    const csv = buildBetsCsv([]);
    const firstLine = csv.split("\n")[0];
    expect(firstLine).toContain("id");
    expect(firstLine).toContain("placed_at");
    expect(firstLine).toContain("house");
    expect(firstLine).toContain("status");
    expect(firstLine).toContain("stake");
    expect(firstLine).toContain("pl");
  });

  it("returns only header for empty rows", () => {
    const csv = buildBetsCsv([]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(1);
  });

  it("outputs one data row per bet", () => {
    const csv = buildBetsCsv(SAMPLE_ROWS);
    const lines = csv.trim().split("\n");
    // header + 2 data rows
    expect(lines).toHaveLength(3);
  });

  it("escapes double-quotes in fields", () => {
    const csv = buildBetsCsv(SAMPLE_ROWS);
    // 'Bet"special"' should become 'Bet""special""' inside quotes
    expect(csv).toContain('Bet""special""');
  });

  it("wraps fields with commas in double quotes", () => {
    const csv = buildBetsCsv(SAMPLE_ROWS);
    expect(csv).toContain('"two, games"');
  });

  it("outputs null fields as empty strings", () => {
    const csv = buildBetsCsv(SAMPLE_ROWS);
    const lines = csv.trim().split("\n");
    const row2 = lines[2]!;
    // actual_return and pl are null in row 2 — should not have 'null' literal
    expect(row2).not.toContain("null");
  });

  it("includes numeric values correctly", () => {
    const csv = buildBetsCsv([SAMPLE_ROWS[0]!]);
    expect(csv).toContain("20");
    expect(csv).toContain("2.1");
    expect(csv).toContain("22");
  });
});

describe("buildBetsCsv BOM", () => {
  it("starts with UTF-8 BOM when bom option is true", () => {
    const csv = buildBetsCsv(SAMPLE_ROWS, { bom: true });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("does not include BOM when bom option is false (default)", () => {
    const csv = buildBetsCsv(SAMPLE_ROWS, { bom: false });
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });
});
