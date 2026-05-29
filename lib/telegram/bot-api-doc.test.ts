import { describe, it, expect } from "vitest";
import {
  renderBotApiMarkdown,
  PROJECT_USED_METHODS,
  type BotApiSpec,
} from "./bot-api-doc";

// Fixture mínima no shape do spec PaulSonOfLars/telegram-bot-api-spec (api.json).
function fixtureSpec(overrides: Partial<BotApiSpec> = {}): BotApiSpec {
  return {
    version: "10.0",
    release_date: "May 8, 2026",
    changelog: "https://core.telegram.org/bots/api-changelog#may-8-2026",
    methods: {
      sendMessage: {
        name: "sendMessage",
        href: "https://core.telegram.org/bots/api#sendmessage",
        description: ["Use this method to send text messages."],
        returns: ["Message"],
        fields: [
          { name: "chat_id", types: ["Integer", "String"], required: true, description: "Target chat." },
          { name: "text", types: ["String"], required: true, description: "Message text." },
          { name: "parse_mode", types: ["String"], required: false, description: "Formatting." },
        ],
      },
      getMe: {
        name: "getMe",
        href: "https://core.telegram.org/bots/api#getme",
        description: ["A simple method for testing your bot's auth token."],
        returns: ["User"],
        fields: [],
      },
      sendDice: {
        name: "sendDice",
        href: "https://core.telegram.org/bots/api#senddice",
        description: ["Use this method to send an animated emoji."],
        returns: ["Message"],
        fields: [],
      },
    },
    types: {
      Message: {
        name: "Message",
        href: "https://core.telegram.org/bots/api#message",
        description: ["This object represents a message."],
        fields: [
          { name: "message_id", types: ["Integer"], required: true, description: "Unique id." },
        ],
      },
      User: {
        name: "User",
        href: "https://core.telegram.org/bots/api#user",
        description: ["This object represents a Telegram user or bot."],
        fields: [],
      },
    },
    ...overrides,
  };
}

describe("PROJECT_USED_METHODS", () => {
  it("inclui os métodos centrais do projeto com uma nota de uso", () => {
    const names = PROJECT_USED_METHODS.map((m) => m.name);
    expect(names).toContain("sendMessage");
    expect(names).toContain("setWebhook");
    expect(names).toContain("getMe");
    for (const m of PROJECT_USED_METHODS) {
      expect(m.use.length).toBeGreaterThan(0);
    }
  });
});

describe("renderBotApiMarkdown", () => {
  it("cabeçalho traz versão, release date e link do changelog", () => {
    const md = renderBotApiMarkdown(fixtureSpec());
    expect(md).toContain("10.0");
    expect(md).toContain("May 8, 2026");
    expect(md).toContain("api-changelog");
  });

  it("destaca os métodos usados pelo projeto com params required + returns", () => {
    const md = renderBotApiMarkdown(fixtureSpec());
    // seção dedicada
    expect(md).toMatch(/##.*Abissal usa/i);
    // sendMessage detalhado: required params e returns
    expect(md).toContain("sendMessage");
    expect(md).toContain("chat_id");
    expect(md).toContain("Message"); // returns
    // a nota de uso curada aparece
    const note = PROJECT_USED_METHODS.find((m) => m.name === "sendMessage")!.use;
    expect(md).toContain(note);
  });

  it("lista o catálogo COMPLETO de métodos e tipos (tudo)", () => {
    const md = renderBotApiMarkdown(fixtureSpec());
    // método NÃO-usado também aparece no catálogo completo
    expect(md).toContain("sendDice");
    // tipos
    expect(md).toMatch(/##.*Tipos/i);
    expect(md).toContain("Message");
    expect(md).toContain("User");
  });

  it("detecta DRIFT: método que o projeto usa mas sumiu da spec é sinalizado", () => {
    // spec sem setWebhook (que está em PROJECT_USED_METHODS)
    const md = renderBotApiMarkdown(fixtureSpec());
    expect(md).toMatch(/setWebhook.*(ausente|⚠)/i);
  });

  it("inclui proveniência + como regenerar (doc viva)", () => {
    const md = renderBotApiMarkdown(fixtureSpec());
    expect(md).toMatch(/gerad[oa]/i); // nota de "gerado por…"
    expect(md).toContain("document-bot-api");
    // fonte canônica autoritativa
    expect(md).toContain("core.telegram.org/bots/api");
  });

  it("não quebra quando methods/types vêm vazios", () => {
    const empty = fixtureSpec({ methods: {}, types: {} });
    expect(() => renderBotApiMarkdown(empty)).not.toThrow();
  });
});
