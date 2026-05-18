import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Payload guard (outage 1101 / B12 regression — broad).
 *
 * The Cloudflare Worker crashes (Error 1101) when a query against `fixtures`
 * pulls the heavy `detail_json` blob or its big sub-paths (`streaks`,
 * `referee_record`). The first B12 fix only protected `fixturesForBrtDay`;
 * this guard protects EVERY exported repository function by statically
 * scanning the source for any `.select(...)` literal and forbidding heavy
 * `detail_json` sub-paths anywhere in it.
 *
 * Allowed: the scalar presence probe `detail_json->>team_record` (a single
 * jsonb scalar, validated against prod as 0 false-negatives) and computed
 * scalars exposed by the Postgres `fixture_badges_view` (badges text[],
 * high_signal boolean) — those never cross the wire as the blob.
 */

const SOURCE = readFileSync(join(__dirname, "repository.ts"), "utf8");

/**
 * Extracts every string literal passed to a `.select(` call in the source,
 * including multi-line concatenated string chains (`"a, " + "b"`). Uses a
 * simple paren-matching scan (regex alone can't span the concatenation).
 */
function extractSelectArguments(src: string): string[] {
  const out: string[] = [];
  const re = /\.select\s*\(/g;
  while (re.exec(src) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    let buf = "";
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        const quote = ch;
        i++;
        while (i < src.length && src[i] !== quote) {
          if (src[i] === "\\") i++;
          buf += src[i];
          i++;
        }
      }
      i++;
    }
    out.push(buf);
  }
  return out;
}

describe("repository payload guard — no heavy detail_json anywhere", () => {
  const selects = extractSelectArguments(SOURCE);

  it("finds at least one .select(...) call to scan", () => {
    expect(selects.length).toBeGreaterThan(0);
  });

  it("no .select() pulls the bare detail_json blob", () => {
    for (const sel of selects) {
      // `detail_json` NOT immediately followed by `->` (a path) — i.e. the
      // whole blob. `detail_json->>team_record` (probe) is allowed.
      expect(sel, `forbidden bare detail_json in select: "${sel}"`).not.toMatch(
        /detail_json(?!->)/,
      );
    }
  });

  it("no .select() pulls detail_json->streaks", () => {
    for (const sel of selects) {
      expect(
        sel,
        `forbidden detail_json->streaks in select: "${sel}"`,
      ).not.toContain("detail_json->streaks");
    }
  });

  it("no .select() pulls detail_json->referee_record", () => {
    for (const sel of selects) {
      expect(
        sel,
        `forbidden detail_json->referee_record in select: "${sel}"`,
      ).not.toContain("detail_json->referee_record");
    }
  });

  it("the only allowed detail_json reference is the scalar probe ->>team_record", () => {
    for (const sel of selects) {
      const occurrences = sel.match(/detail_json[^,)\s]*/g) ?? [];
      for (const occ of occurrences) {
        expect(
          occ,
          `unexpected detail_json reference "${occ}" in select: "${sel}"`,
        ).toBe("detail_json->>team_record");
      }
    }
  });

  it("BADGE_COLUMNS heavy constant is fully removed from the repository", () => {
    expect(SOURCE).not.toContain("BADGE_COLUMNS");
    expect(SOURCE).not.toContain("ref_record:detail_json");
    expect(SOURCE).not.toContain("streaks:detail_json");
  });
});
