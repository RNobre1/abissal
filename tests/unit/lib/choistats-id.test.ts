/**
 * Unit tests for the extracted `parseChoistatsId` pure function.
 *
 * Regression coverage for all known source_url formats observed in prod:
 *   - Full URL with slug:  https://www.adamchoi.co.uk/fixture/12345/england-premier-league-...
 *   - Path-only with slug: /fixture/12345/england-premier-league-...
 *   - Path-only bare:      /fixture/12345
 *   - Bare numeric string: "12345" (no /fixture/ prefix) → null
 *   - null/empty:          → null
 */

import { describe, expect, it } from "vitest";
import { parseChoistatsId } from "@/lib/fixtures/choistats-id";

describe("parseChoistatsId", () => {
  it("parses a full URL with trailing slug", () => {
    expect(
      parseChoistatsId(
        "https://www.adamchoi.co.uk/fixture/19427226/england-premier-league-liverpool-vs-tottenham",
      ),
    ).toBe(19427226);
  });

  it("parses a path-only source_url with trailing slug", () => {
    expect(
      parseChoistatsId("/fixture/42/england-premier-league-arsenal-vs-chelsea"),
    ).toBe(42);
  });

  it("parses a bare path without trailing slug", () => {
    expect(parseChoistatsId("/fixture/12345")).toBe(12345);
  });

  it("returns null for a bare numeric string (no /fixture/ prefix)", () => {
    expect(parseChoistatsId("12345")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseChoistatsId(null)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseChoistatsId("")).toBeNull();
  });

  it("returns null for an unrelated URL", () => {
    expect(parseChoistatsId("https://example.com/foo/bar")).toBeNull();
  });

  it("handles large numeric ids without integer overflow", () => {
    expect(parseChoistatsId("/fixture/999999999")).toBe(999999999);
  });
});
