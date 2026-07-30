import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard estático: nenhum componente pode usar `var(--color-X)` para um token
 * que não existe em `globals.css`.
 *
 * POR QUE (revisão por personas, 2026-07-30): `--color-positive`,
 * `--color-green` e `--color-amarelo` eram usados em 20 lugares e NENHUM dos
 * três existia no tema. Como o código escrevia `var(--token, #hex)`, o hex de
 * fallback é que renderizava — sempre. Não era um fallback, era o valor real
 * disfarçado de token, e o defeito é invisível: não quebra build, não quebra
 * teste, só faz a tela de calibração inteira rodar numa paleta paralela
 * (verde/amarelo genéricos do Tailwind) enquanto o resto do app usa os tons
 * certos de Abismo Habitado.
 *
 * O tema JÁ tinha `--color-success` e `--color-warning` para exatamente isso.
 *
 * Este teste é o mesmo padrão do guard de payload do repositório: uma regra
 * que o compilador não pega, fixada em teste para não voltar.
 */

const RAIZ = join(import.meta.dirname, "..", "..");

function arquivosDe(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  let entradas: string[];
  try {
    entradas = readdirSync(dir);
  } catch {
    return out;
  }
  for (const nome of entradas) {
    if (nome === "node_modules" || nome === ".next" || nome === ".git") continue;
    const caminho = join(dir, nome);
    const st = statSync(caminho);
    if (st.isDirectory()) out.push(...arquivosDe(caminho, exts));
    else if (exts.some((e) => nome.endsWith(e))) out.push(caminho);
  }
  return out;
}

/** Tokens de cor declarados no tema. */
function tokensDeclarados(): Set<string> {
  const css = readFileSync(join(RAIZ, "app", "globals.css"), "utf8");
  const out = new Set<string>();
  for (const m of css.matchAll(/(--color-[a-z0-9-]+)\s*:/gi)) out.add(m[1]);
  return out;
}

describe("guard de tokens de cor", () => {
  it("todo var(--color-*) usado no código existe em globals.css", () => {
    const declarados = tokensDeclarados();
    // sanidade: se a extração falhar, o teste passaria vazio e não guardaria nada
    expect(declarados.size).toBeGreaterThan(5);

    const arquivos = [
      ...arquivosDe(join(RAIZ, "app"), [".tsx", ".ts"]),
      ...arquivosDe(join(RAIZ, "components"), [".tsx", ".ts"]),
      ...arquivosDe(join(RAIZ, "lib"), [".tsx", ".ts"]),
    ];

    const infratores: string[] = [];
    for (const arquivo of arquivos) {
      const src = readFileSync(arquivo, "utf8");
      for (const m of src.matchAll(/var\(\s*(--color-[a-z0-9-]+)/gi)) {
        const token = m[1];
        if (!declarados.has(token)) {
          infratores.push(`${arquivo.replace(RAIZ + "/", "")} → ${token}`);
        }
      }
    }

    expect(
      infratores,
      `Tokens de cor inexistentes (o hex de fallback é que renderiza — use ` +
        `--color-success / --color-warning / --color-vermelho):\n` +
        infratores.join("\n"),
    ).toEqual([]);
  });
});
