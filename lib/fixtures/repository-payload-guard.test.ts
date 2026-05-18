import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Payload guard (outage 1101 / B12 / B14 regression — broad, all repositories).
 *
 * The Cloudflare Worker crashes (Error 1101) when a query against `fixtures`
 * pulls the heavy `detail_json` blob or its big sub-paths (`streaks`,
 * `referee_record`). The first B12 fix only protected `fixturesForBrtDay`;
 * the earlier guard scanned ONLY `lib/fixtures/repository.ts`.
 *
 * Now that `lib/fixtures/simulation-repository.ts` (T2/T3, scalar-only by
 * construction) and other repository readers exist, this guard statically
 * scans EVERY `lib/**\/*repository*.ts` file (excluding test/spec files) so a
 * future PR re-introducing a heavy blob select in ANY repository reader is
 * caught statically.
 *
 * Allowed: the scalar presence probe `detail_json->>team_record` (a single
 * jsonb scalar, validated against prod as 0 false-negatives) and computed
 * scalars exposed by the Postgres `fixture_badges_view` (badges text[],
 * high_signal boolean) — those never cross the wire as the blob.
 */

// Repo root: this file is at <root>/lib/fixtures/, so go up two levels.
const REPO_ROOT = join(__dirname, "..", "..");
const LIB_DIR = join(REPO_ROOT, "lib");

/**
 * Dependency-free recursive walk: collects every `*.ts` file under `lib/`
 * whose basename contains `repository`, EXCLUDING `*.test.ts`/`*.spec.ts`.
 * Returns repo-root-relative POSIX-style paths (stable across OSes).
 */
function findRepositorySources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findRepositorySources(full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) continue;
    if (!entry.includes("repository")) continue;
    out.push(relative(REPO_ROOT, full).split(sep).join("/"));
  }
  return out.sort();
}

const SELECT_CALL = ".select";

/**
 * Extracts every string literal passed to a `.select(` call in the source,
 * including multi-line concatenated string chains (`"a, " + "b"`). Uses a
 * simple paren-matching scan (regex alone can't span the concatenation).
 */
function extractSelectArguments(src: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\${SELECT_CALL}\\s*\\(`, "g");
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

/**
 * The single source of truth for "is this `.select(...)` argument unsafe?".
 * Returns a non-empty reason string when the literal references the heavy
 * `detail_json` blob / heavy sub-paths in any disallowed way, else null.
 * Centralised so the negative self-test exercises the EXACT same predicate
 * the per-file scan uses (guard is demonstrably non-tautological).
 */
function selectViolation(sel: string): string | null {
  // Bare `detail_json` NOT immediately followed by `->` (the whole blob).
  if (/detail_json(?!->)/.test(sel)) {
    return `bare detail_json blob in select: "${sel}"`;
  }
  if (sel.includes("detail_json->streaks")) {
    return `detail_json->streaks in select: "${sel}"`;
  }
  if (sel.includes("detail_json->referee_record")) {
    return `detail_json->referee_record in select: "${sel}"`;
  }
  // Any remaining detail_json reference must be exactly the scalar probe.
  const occurrences = sel.match(/detail_json[^,)\s]*/g) ?? [];
  for (const occ of occurrences) {
    if (occ !== "detail_json->>team_record") {
      return `unexpected detail_json reference "${occ}" in select: "${sel}"`;
    }
  }
  return null;
}

const REPO_SOURCES = findRepositorySources(LIB_DIR);
const SCANNED = REPO_SOURCES.map((rel) => ({
  rel,
  src: readFileSync(join(REPO_ROOT, rel), "utf8"),
}));

describe("repository payload guard — no heavy detail_json in ANY repository reader", () => {
  it("globs >=2 lib/**/*repository*.ts files, excluding test/spec files", () => {
    expect(REPO_SOURCES.length).toBeGreaterThanOrEqual(2);
    // The new scalar-only reader MUST be in scope (RED proof vs the old
    // single-file reader, which only ever read repository.ts).
    expect(REPO_SOURCES).toContain("lib/fixtures/simulation-repository.ts");
    expect(REPO_SOURCES).toContain("lib/fixtures/repository.ts");
    for (const rel of REPO_SOURCES) {
      expect(rel, `test/spec file leaked into glob: "${rel}"`).not.toMatch(
        /\.(test|spec)\.ts$/,
      );
      expect(rel, `non-repository file in glob: "${rel}"`).toMatch(
        /repository.*\.ts$/,
      );
    }
  });

  it("the glob is not vacuous — finds at least one select() call to scan", () => {
    const total = SCANNED.reduce(
      (n, f) => n + extractSelectArguments(f.src).length,
      0,
    );
    expect(
      total,
      "no select() found in any repository source — glob may have gone stale",
    ).toBeGreaterThan(0);
  });

  it("no repository select() references the heavy detail_json blob", () => {
    for (const { rel, src } of SCANNED) {
      for (const sel of extractSelectArguments(src)) {
        const reason = selectViolation(sel);
        expect(reason, `${rel}: ${reason ?? ""}`).toBeNull();
      }
    }
  });

  it("BADGE_COLUMNS heavy constant is fully removed from lib/fixtures/repository.ts", () => {
    const repo = SCANNED.find((f) => f.rel === "lib/fixtures/repository.ts");
    expect(repo, "lib/fixtures/repository.ts not scanned").toBeTruthy();
    const src = repo!.src;
    expect(src).not.toContain("BADGE_COLUMNS");
    expect(src).not.toContain("ref_record:detail_json");
    expect(src).not.toContain("streaks:detail_json");
  });

  // Non-tautological proof: the SAME predicate used above flags a synthetic
  // violating source. No real violating file is added to the repo. The
  // synthetic select() token is assembled at runtime so it is exercised by
  // extractSelectArguments without embedding a literal call in this file.
  it("negative self-test: selectViolation flags a synthetic heavy select", () => {
    const synthetic = `supabase.from("fixtures")${SELECT_CALL}("id, detail_json")`;
    const args = extractSelectArguments(synthetic);
    expect(args).toEqual(["id, detail_json"]);
    expect(selectViolation(args[0])).not.toBeNull();

    // And it stays quiet on the allowed scalar probe (no false positive).
    expect(selectViolation("id, detail_json->>team_record")).toBeNull();
    // ...and on a heavy sub-path too.
    expect(selectViolation("id, detail_json->streaks")).not.toBeNull();
  });
});
