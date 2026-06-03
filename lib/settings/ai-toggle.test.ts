import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAiEnabled, setAiEnabled } from "./ai-toggle";

/** Client mínimo encadeável (from→select→eq→maybeSingle / from→upsert). */
function readClient(result: { data: { value: unknown } | null; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as unknown as SupabaseClient, from, select, eq };
}

function writeClient(error: { message?: string } | null = null) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const from = vi.fn().mockReturnValue({ upsert });
  return { client: { from } as unknown as SupabaseClient, from, upsert };
}

describe("isAiEnabled", () => {
  it("retorna true quando a flag é true", async () => {
    const { client } = readClient({ data: { value: true }, error: null });
    await expect(isAiEnabled(client)).resolves.toBe(true);
  });

  it("retorna false APENAS quando a flag é explicitamente false", async () => {
    const { client } = readClient({ data: { value: false }, error: null });
    await expect(isAiEnabled(client)).resolves.toBe(false);
  });

  it("default LIGADO quando a flag não existe (data null)", async () => {
    const { client } = readClient({ data: null, error: null });
    await expect(isAiEnabled(client)).resolves.toBe(true);
  });

  it("default LIGADO (graceful) quando a leitura dá erro", async () => {
    const { client } = readClient({ data: null, error: { message: "boom" } });
    await expect(isAiEnabled(client)).resolves.toBe(true);
  });

  it("default LIGADO (graceful) quando o client lança", async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error("conn down");
      }),
    } as unknown as SupabaseClient;
    await expect(isAiEnabled(client)).resolves.toBe(true);
  });

  it("consulta a chave ai_enabled em app_settings", async () => {
    const { client, from, select, eq } = readClient({ data: { value: true }, error: null });
    await isAiEnabled(client);
    expect(from).toHaveBeenCalledWith("app_settings");
    expect(select).toHaveBeenCalledWith("value");
    expect(eq).toHaveBeenCalledWith("key", "ai_enabled");
  });
});

describe("setAiEnabled", () => {
  it("faz upsert da flag com onConflict=key e o user que mudou", async () => {
    const { client, from, upsert } = writeClient();
    await setAiEnabled(client, false, "user-123");
    expect(from).toHaveBeenCalledWith("app_settings");
    const [row, opts] = upsert.mock.calls[0];
    expect(row).toMatchObject({ key: "ai_enabled", value: false, updated_by: "user-123" });
    expect(row.updated_at).toEqual(expect.any(String));
    expect(opts).toEqual({ onConflict: "key" });
  });

  it("aceita userId null (escrita por service_role sem sessão)", async () => {
    const { client, upsert } = writeClient();
    await setAiEnabled(client, true, null);
    expect(upsert.mock.calls[0][0]).toMatchObject({ value: true, updated_by: null });
  });

  it("propaga erro quando o upsert falha", async () => {
    const { client } = writeClient({ message: "rls denied" });
    await expect(setAiEnabled(client, true, null)).rejects.toThrow("rls denied");
  });
});
