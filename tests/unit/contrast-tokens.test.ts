/**
 * Contraste WCAG AA — valores travados dos tokens.
 *
 * Este arquivo trava os hexadecimais exatos; quem CALCULA a razão de contraste
 * contra todas as superfícies é `contrast-tokens-wcag.test.ts`. Os dois juntos:
 * um garante que a razão é suficiente, o outro que ninguém mudou o valor sem
 * perceber.
 *
 * Histórico (2026-07-30): este teste sozinho dava falsa segurança. Ele afirmava
 * que `--color-ink-faint: #898782` valia "4.6:1 sobre surface-2" — verdade, mas
 * incompleta: sobre `surface-3`, a superfície mais clara, o mesmo token dava
 * **4,45:1**, abaixo do mínimo AA. Travar o valor sem calcular a razão contra
 * TODOS os fundos é o mesmo erro de fixar o sintoma em vez do requisito.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf-8");

describe("globals.css — tokens de contraste WCAG AA", () => {
  it("--color-ink-faint é #8a8883 (4.51:1 no pior fundo, surface-3)", () => {
    expect(css).toContain("--color-ink-faint: #8a8883");
  });

  it("--color-ink-muted é #8a8882 (≥4.5:1 sobre surface-3)", () => {
    expect(css).toContain("--color-ink-muted: #8a8882");
  });

  it("--color-success é #38a870 (4.5:1 sobre surface-2)", () => {
    expect(css).toContain("--color-success: #38a870");
  });
});
