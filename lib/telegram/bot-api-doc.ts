/**
 * Render de doc viva da Telegram **Bot API** (NÃO a MTProto/`core.telegram.org/api`).
 *
 * Espelha o padrão do scraper `bin/document_choistats_api` → docs/external-apis/:
 * o script `scripts/telegram/document-bot-api.ts` busca a spec estruturada e
 * chama `renderBotApiMarkdown` (puro, testável) pra emitir o markdown. Re-rode
 * pra detectar drift (versão nova da Bot API, método que sumiu, etc.).
 *
 * A Bot API é o que o projeto consome (api.telegram.org/bot<token>/METHOD —
 * sendMessage hoje; webhook/comandos nas próximas waves). MTProto (cliente de
 * conta de usuário) está fora de escopo de propósito.
 */

export interface BotApiField {
  name: string;
  types: string[];
  required: boolean;
  description: string;
}

export interface BotApiMethod {
  name: string;
  href: string;
  description?: string[];
  returns?: string[];
  fields?: BotApiField[];
}

export interface BotApiType {
  name: string;
  href: string;
  description?: string[];
  fields?: BotApiField[];
}

export interface BotApiSpec {
  version: string;
  release_date: string;
  changelog: string;
  methods: Record<string, BotApiMethod>;
  types: Record<string, BotApiType>;
}

/** Métodos que o Abissal usa (ou vai usar nas waves do bot) + a razão. */
export const PROJECT_USED_METHODS: { name: string; use: string }[] = [
  { name: "sendMessage", use: "resumo de fechamento diário + alertas proativos one-way" },
  { name: "getMe", use: "health-check do token (valida o bot ao configurar)" },
  { name: "setWebhook", use: "registrar o endpoint /api/telegram/webhook (Wave 2)" },
  { name: "deleteWebhook", use: "desregistrar/limpar o webhook" },
  { name: "getWebhookInfo", use: "diagnosticar webhook (URL, pending_update_count, last_error)" },
  { name: "getUpdates", use: "alternativa de polling ao webhook (dev/local)" },
  { name: "setMyCommands", use: "registrar /jogos /reco /banca no menu do bot (Wave 2)" },
  { name: "answerCallbackQuery", use: "responder cliques de botão inline (Wave 2/3)" },
  { name: "sendChatAction", use: "indicador 'digitando…' enquanto a IA-2 processa (Wave 3)" },
];

const AUTHORITATIVE_URL = "https://core.telegram.org/bots/api";

function esc(s: string): string {
  // Escapa pipes pra não quebrar tabelas markdown; colapsa espaços.
  return (s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function firstLine(desc?: string[]): string {
  if (!desc || desc.length === 0) return "";
  return esc(desc[0]);
}

function requiredParams(m: BotApiMethod): BotApiField[] {
  return (m.fields ?? []).filter((f) => f.required);
}

function renderUsedMethod(name: string, use: string, spec: BotApiSpec): string {
  const m = spec.methods[name];
  if (!m) {
    // DRIFT: método que o projeto usa sumiu da spec atual.
    return `### \`${name}\` — ⚠ AUSENTE na spec atual\n\n` +
      `**Uso no projeto:** ${use}\n\n` +
      `> ⚠ Este método está em \`PROJECT_USED_METHODS\` mas não aparece na Bot API ` +
      `v${spec.version}. Possível remoção/renome — revisar o código que o chama.\n`;
  }
  const lines: string[] = [];
  lines.push(`### \`${m.name}\` → ${(m.returns ?? ["—"]).join(" | ")}`);
  lines.push("");
  lines.push(`**Uso no projeto:** ${use}`);
  lines.push("");
  if (firstLine(m.description)) lines.push(firstLine(m.description));
  lines.push("");
  const req = requiredParams(m);
  if (req.length > 0) {
    lines.push("| param (required) | tipos | descrição |");
    lines.push("|---|---|---|");
    for (const f of req) {
      lines.push(`| \`${f.name}\` | ${f.types.map((t) => `\`${t}\``).join(", ")} | ${esc(f.description)} |`);
    }
  } else {
    lines.push("_Sem parâmetros obrigatórios._");
  }
  lines.push("");
  lines.push(`[doc oficial](${m.href})`);
  lines.push("");
  return lines.join("\n");
}

function renderCatalogTable(
  entries: { name: string; href: string; col2: string; col3: string }[],
  headers: [string, string, string],
): string {
  const lines: string[] = [];
  lines.push(`| ${headers[0]} | ${headers[1]} | ${headers[2]} |`);
  lines.push("|---|---|---|");
  for (const e of entries) {
    lines.push(`| [\`${e.name}\`](${e.href}) | ${e.col2} | ${e.col3} |`);
  }
  return lines.join("\n");
}

/** Renderiza o markdown completo da doc da Bot API a partir da spec. Puro. */
export function renderBotApiMarkdown(
  spec: BotApiSpec,
  opts: { sourceUrl?: string } = {},
): string {
  const out: string[] = [];

  out.push("# Telegram Bot API — referência viva");
  out.push("");
  out.push(
    "> **Gerado** por `scripts/telegram/document-bot-api.ts` " +
      "(`pnpm telegram:document-api`). Re-rode pra detectar drift — versão nova " +
      "da Bot API, método/tipo que sumiu, etc. **NÃO editar à mão.**",
  );
  out.push(">");
  out.push(
    `> Esta é a **Bot API** (\`${AUTHORITATIVE_URL}\` — \`api.telegram.org/bot<token>/METHOD\`), ` +
      "o que o Abissal consome. **NÃO** é a MTProto/`core.telegram.org/api` (cliente de " +
      "conta de usuário), que está fora de escopo de propósito.",
  );
  out.push("");
  out.push(`- **Versão da Bot API:** \`${spec.version}\``);
  out.push(`- **Release:** ${spec.release_date}`);
  out.push(`- **Changelog:** ${spec.changelog}`);
  if (opts.sourceUrl) out.push(`- **Fonte estruturada:** ${opts.sourceUrl}`);
  out.push(`- **Doc autoritativa:** ${AUTHORITATIVE_URL}`);
  out.push(
    `- **Catálogo:** ${Object.keys(spec.methods).length} métodos · ` +
      `${Object.keys(spec.types).length} tipos`,
  );
  out.push("");

  // ── Métodos usados pelo projeto (detalhados) ──────────────────────────────
  out.push("## Métodos que o Abissal usa (ou vai usar)");
  out.push("");
  out.push(
    "Subconjunto curado com detalhe (params obrigatórios + returns). O catálogo " +
      "completo vem depois.",
  );
  out.push("");
  for (const { name, use } of PROJECT_USED_METHODS) {
    out.push(renderUsedMethod(name, use, spec));
  }

  // ── Catálogo completo: métodos ────────────────────────────────────────────
  out.push("## Referência completa — Métodos");
  out.push("");
  const methodNames = Object.keys(spec.methods).sort();
  if (methodNames.length === 0) {
    out.push("_Nenhum método na spec._");
  } else {
    out.push(
      renderCatalogTable(
        methodNames.map((n) => {
          const m = spec.methods[n];
          return {
            name: m.name,
            href: m.href,
            col2: (m.returns ?? ["—"]).map((r) => `\`${r}\``).join(" \\| "),
            col3: firstLine(m.description),
          };
        }),
        ["método", "retorna", "descrição"],
      ),
    );
  }
  out.push("");

  // ── Catálogo completo: tipos ──────────────────────────────────────────────
  out.push("## Referência completa — Tipos");
  out.push("");
  const typeNames = Object.keys(spec.types).sort();
  if (typeNames.length === 0) {
    out.push("_Nenhum tipo na spec._");
  } else {
    out.push(
      renderCatalogTable(
        typeNames.map((n) => {
          const t = spec.types[n];
          return {
            name: t.name,
            href: t.href,
            col2: String((t.fields ?? []).length),
            col3: firstLine(t.description),
          };
        }),
        ["tipo", "nº campos", "descrição"],
      ),
    );
  }
  out.push("");

  return out.join("\n");
}
