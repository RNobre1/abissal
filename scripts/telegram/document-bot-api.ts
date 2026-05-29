/**
 * document-bot-api — doc viva da Telegram **Bot API** (não a MTProto).
 *
 * Busca a spec estruturada da Bot API e emite
 * `docs/external-apis/telegram/telegram-bot-api.md`. Re-rode pra detectar drift
 * (versão nova, método/tipo removido). Espelha `bin/document_choistats_api`.
 *
 * Uso:
 *   pnpm telegram:document-api
 *   pnpm exec tsx scripts/telegram/document-bot-api.ts [OUT_PATH]
 *   TELEGRAM_BOTAPI_SPEC_URL=<url> pnpm telegram:document-api   # override da fonte
 *
 * Fonte (estruturada, machine-readable): o spec da comunidade
 * PaulSonOfLars/telegram-bot-api-spec, gerado a partir da doc HTML oficial e
 * atualizado a cada release da Bot API. Lê-se só DADOS (JSON) — nenhum código de
 * terceiro é executado. Autoridade final: https://core.telegram.org/bots/api
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { renderBotApiMarkdown, type BotApiSpec } from "../../lib/telegram/bot-api-doc";

const DEFAULT_SPEC_URL =
  "https://raw.githubusercontent.com/PaulSonOfLars/telegram-bot-api-spec/main/api.json";

const SPEC_URL = process.env.TELEGRAM_BOTAPI_SPEC_URL?.trim() || DEFAULT_SPEC_URL;
const REPO_ROOT = resolve(import.meta.dirname, "../..");
const OUT_PATH =
  process.argv[2] || resolve(REPO_ROOT, "docs/external-apis/telegram/telegram-bot-api.md");

async function fetchSpec(url: string): Promise<BotApiSpec> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`fetch da spec falhou: HTTP ${res.status} ${res.statusText} (${url})`);
  }
  const json = (await res.json()) as Partial<BotApiSpec>;
  if (!json || typeof json !== "object" || !json.methods || !json.types) {
    throw new Error(
      `spec inesperada em ${url}: faltam 'methods'/'types' (a fonte mudou de shape?)`,
    );
  }
  return json as BotApiSpec;
}

async function main(): Promise<void> {
  console.log(`[telegram-doc] buscando spec da Bot API: ${SPEC_URL}`);
  const spec = await fetchSpec(SPEC_URL);
  const md = renderBotApiMarkdown(spec, { sourceUrl: SPEC_URL });

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");

  const methods = Object.keys(spec.methods).length;
  const types = Object.keys(spec.types).length;
  console.log(
    `[telegram-doc] OK → ${OUT_PATH}\n` +
      `[telegram-doc]   ${spec.version} (${spec.release_date}) · ` +
      `${methods} métodos · ${types} tipos`,
  );
}

main().catch((err) => {
  console.error(`[telegram-doc] FALHOU: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
