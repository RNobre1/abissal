import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard de contraste WCAG 2.2 AA sobre os tokens do tema.
 *
 * POR QUE (revisão por personas, 2026-07-30): `--color-ink-faint` media
 * **4,45:1** sobre `--color-surface-3` — abaixo do mínimo 4,5:1 para texto
 * normal. É a cor da classe `.label` (10px), usada em dezenas de lugares,
 * incluindo os cabeçalhos da tabela de simulação, que é a tela mais vista do
 * produto.
 *
 * O axe-core dos E2E não pegava: ele avalia as combinações que encontra
 * montadas na página, e essa em particular passava despercebida. Um cálculo
 * direto sobre os tokens cobre todas as combinações possíveis, inclusive as
 * que ainda não existem na UI.
 *
 * O conserto foi de +1 no canal (imperceptível): o objetivo não é redesenhar a
 * paleta, é ficar do lado certo do limite.
 */

const CSS = readFileSync(
  join(import.meta.dirname, "..", "..", "app", "globals.css"),
  "utf8",
);

function token(nome: string): string {
  const m = new RegExp(`--${nome}\\s*:\\s*(#[0-9a-f]{6})`, "i").exec(CSS);
  if (!m) throw new Error(`token --${nome} não encontrado em globals.css`);
  return m[1];
}

/** Luminância relativa (WCAG 2.x). */
function luminancia(hex: string): number {
  const c = hex.replace("#", "");
  const canais = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
}

function razao(a: string, b: string): number {
  const l1 = luminancia(a);
  const l2 = luminancia(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Superfícies onde texto pode aparecer. */
const FUNDOS = ["color-void", "color-surface-1", "color-surface-2", "color-surface-3"];

/** Tokens usados como cor de TEXTO. */
const TEXTOS = ["color-ink", "color-ink-display", "color-ink-muted", "color-ink-faint"];

describe("contraste dos tokens (WCAG 2.2 AA)", () => {
  it("todo token de texto atinge 4.5:1 sobre TODA superfície", () => {
    const falhas: string[] = [];
    for (const t of TEXTOS) {
      for (const f of FUNDOS) {
        const r = razao(token(t), token(f));
        if (r < 4.5) falhas.push(`--${t} sobre --${f}: ${r.toFixed(2)}:1`);
      }
    }
    expect(
      falhas,
      `Contraste abaixo do mínimo AA para texto normal (4.5:1):\n${falhas.join("\n")}`,
    ).toEqual([]);
  });

  it("o vermelho de identidade continua legível como texto sobre o fundo base", () => {
    // Vermelho Garantido é identidade, não erro (decisão de produto). Ele não
    // precisa passar em toda superfície, mas precisa ser legível no fundo
    // principal onde de fato aparece como texto.
    expect(razao(token("color-vermelho"), token("color-void"))).toBeGreaterThanOrEqual(3);
  });
});
