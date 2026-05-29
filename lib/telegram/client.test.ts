import { describe, it, expect, vi, afterEach } from "vitest";
import { sendTelegramMessage } from "./client";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

const OK_BODY = JSON.stringify({ ok: true, result: { message_id: 1 } });

describe("sendTelegramMessage", () => {
  it("faz POST pro endpoint sendMessage do token com chat_id + text", async () => {
    const spy = mockFetch(() => new Response(OK_BODY, { status: 200 }));
    await sendTelegramMessage({ token: "T0KEN", chatId: "123", text: "oi" });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toContain("https://api.telegram.org/botT0KEN/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.chat_id).toBe("123");
    expect(body.text).toBe("oi");
  });

  it("retorna ok:true quando a API responde 200 ok", async () => {
    mockFetch(() => new Response(OK_BODY, { status: 200 }));
    const res = await sendTelegramMessage({ token: "T", chatId: "1", text: "x" });
    expect(res.ok).toBe(true);
  });

  it("retorna ok:false (sem lançar) quando a API responde erro HTTP", async () => {
    mockFetch(() => new Response(JSON.stringify({ ok: false, description: "Bad Request" }), { status: 400 }));
    const res = await sendTelegramMessage({ token: "T", chatId: "1", text: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/400|Bad Request/i);
  });

  it("retorna ok:false (sem lançar) quando fetch rejeita (rede)", async () => {
    mockFetch(() => {
      throw new Error("network down");
    });
    const res = await sendTelegramMessage({ token: "T", chatId: "1", text: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/network down/i);
  });

  it("passa parse_mode quando fornecido", async () => {
    const spy = mockFetch(() => new Response(OK_BODY, { status: 200 }));
    await sendTelegramMessage({ token: "T", chatId: "1", text: "*b*", parseMode: "Markdown" });
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.parse_mode).toBe("Markdown");
  });
});
