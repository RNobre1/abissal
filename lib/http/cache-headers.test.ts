import { describe, it, expect } from "vitest";
import { IMMUTABLE_CACHE_CONTROL, staticAssetHeaders } from "./cache-headers";

describe("cache-headers — assets estáticos imutáveis (B21 favicon)", () => {
  it("IMMUTABLE_CACHE_CONTROL é público, 1 ano, immutable", () => {
    expect(IMMUTABLE_CACHE_CONTROL).toContain("public");
    expect(IMMUTABLE_CACHE_CONTROL).toContain("immutable");
    expect(IMMUTABLE_CACHE_CONTROL).toContain("max-age=31536000");
    // NÃO pode conter must-revalidate / max-age=0 (o bug que causou 74 refetches)
    expect(IMMUTABLE_CACHE_CONTROL).not.toContain("must-revalidate");
    expect(IMMUTABLE_CACHE_CONTROL).not.toContain("max-age=0");
  });

  it("inclui uma regra para /favicon.ico com Cache-Control imutável", () => {
    const rules = staticAssetHeaders();
    const favicon = rules.find((r) => r.source === "/favicon.ico");
    expect(favicon).toBeDefined();
    const cc = favicon!.headers.find((h) => h.key === "Cache-Control");
    expect(cc?.value).toBe(IMMUTABLE_CACHE_CONTROL);
  });

  it("toda regra tem source e ao menos um header key/value", () => {
    for (const r of staticAssetHeaders()) {
      expect(typeof r.source).toBe("string");
      expect(r.source.length).toBeGreaterThan(0);
      expect(r.headers.length).toBeGreaterThan(0);
      for (const h of r.headers) {
        expect(h.key.length).toBeGreaterThan(0);
        expect(h.value.length).toBeGreaterThan(0);
      }
    }
  });
});
