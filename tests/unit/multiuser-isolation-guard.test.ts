import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard estático de isolamento entre usuários.
 *
 * POR QUE (2026-07-30): o sistema passou de single-user para dois usuários
 * reais. A RLS do banco está correta — todas as tabelas com `user_id` têm
 * política em `auth.uid()`, e todas as views são `security_invoker` (auditado
 * no Postgres de produção). **Mas isso não protege nada quando o código usa
 * `createAdminClient()`**, que é `service_role` e ignora RLS por completo.
 *
 * Dois vazamentos reais foram encontrados assim:
 *   • `fixtures/[id]` — `fetchLinkedBet` buscava `bets` por
 *     `ai_recommendation_id` sem `user_id`. Como as recomendações são
 *     compartilhadas, abrir o jogo mostrava a aposta do OUTRO usuário
 *     (stake, odd, casa, status).
 *   • `/calibracao` — somava todas as `bets` com `ai_recommendation_id` sem
 *     filtrar por dono, misturando o ROI dos dois.
 *
 * Regra fixada aqui: qualquer arquivo que use o client admin E leia uma tabela
 * user-scoped precisa também filtrar por `user_id`. É grosso de propósito —
 * um guard que erra para o lado de exigir o filtro explícito.
 */

const RAIZ = join(import.meta.dirname, "..", "..");

/** Tabelas cujo conteúdo pertence a UM usuário. */
const TABELAS_DE_USUARIO = [
  "bets",
  "bet_selections",
  "bet_slips",
  "bet_slip_legs",
  "transactions",
  "houses",
  "balance_snapshots",
  "disciplina_settings",
  "audit_log",
  "bet_events",
];

function arquivosDe(dir: string): string[] {
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
    if (statSync(caminho).isDirectory()) out.push(...arquivosDe(caminho));
    else if (nome.endsWith(".ts") || nome.endsWith(".tsx")) out.push(caminho);
  }
  return out;
}

describe("guard de isolamento entre usuários", () => {
  it("todo uso do client admin sobre tabela de usuário filtra por user_id", () => {
    const arquivos = [...arquivosDe(join(RAIZ, "app")), ...arquivosDe(join(RAIZ, "lib"))]
      // o próprio helper do admin não conta
      .filter((f) => !f.endsWith(join("lib", "supabase", "admin.ts")));

    const infratores: string[] = [];
    for (const arquivo of arquivos) {
      const src = readFileSync(arquivo, "utf8");
      if (!src.includes("createAdminClient")) continue;

      for (const tabela of TABELAS_DE_USUARIO) {
        if (!src.includes(`.from("${tabela}")`)) continue;
        // o arquivo lê uma tabela de usuário com poder de service_role:
        // exige menção explícita a user_id em algum filtro.
        if (!/\.eq\(\s*["']user_id["']/.test(src)) {
          infratores.push(`${arquivo.replace(RAIZ + "/", "")} → .from("${tabela}")`);
        }
      }
    }

    expect(
      infratores,
      `Leitura de tabela user-scoped com createAdminClient (ignora RLS) sem ` +
        `filtro .eq("user_id", ...). Com mais de um usuário isso vaza dados ` +
        `entre contas:\n` +
        infratores.join("\n"),
    ).toEqual([]);
  });
});
