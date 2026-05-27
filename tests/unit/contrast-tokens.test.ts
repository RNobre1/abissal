/**
 * TDD — Parte A: contraste WCAG AA tokens
 *
 * Valida que os 3 tokens de cor problemáticos foram atualizados para valores
 * que passam WCAG 2.1 AA (≥ 4.5:1 sobre seus fundos declarados).
 *
 * Abordagem: lê o globals.css como texto e verifica os valores hexadecimais
 * diretamente — sem browser, sem DOM. Rápido, determinístico, zero deps externas.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const css = readFileSync(
  resolve(process.cwd(), "app/globals.css"),
  "utf-8",
);

describe("globals.css — tokens de contraste WCAG AA", () => {
  it("--color-ink-faint deve ser #898782 (4.6:1 sobre surface-2)", () => {
    expect(css).toContain("--color-ink-faint: #898782");
  });

  it("--color-ink-muted deve ser #8a8882 (≥4.5:1 sobre surface-3)", () => {
    expect(css).toContain("--color-ink-muted: #8a8882");
  });

  it("--color-success deve ser #38a870 (4.5:1 sobre surface-2)", () => {
    expect(css).toContain("--color-success: #38a870");
  });
});
