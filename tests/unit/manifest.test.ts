import { describe, it, expect } from "vitest";
import manifest from "@/app/manifest";

describe("PWA manifest", () => {
  const m = manifest();

  it("é instalável: campos mínimos presentes", () => {
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
  });

  it("usa as cores do design system (fundo escuro)", () => {
    expect(m.background_color).toBe("#111118");
    expect(m.theme_color).toBe("#111118");
  });

  it("tem ícones 192 e 512 (requisito de instalação) + um maskable", () => {
    const icons = m.icons ?? [];
    const sizes = icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("aponta para arquivos de ícone sob /icons", () => {
    for (const icon of m.icons ?? []) {
      expect(icon.src).toMatch(/^\/icons\/.+\.png$/);
    }
  });
});
