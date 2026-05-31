import { describe, expect, it, vi } from "vitest";
import { authedUserId } from "@/lib/supabase/auth";

type Arg = Parameters<typeof authedUserId>[0];
function client(getClaims: () => Promise<unknown>): Arg {
  return { auth: { getClaims } } as unknown as Arg;
}

describe("authedUserId", () => {
  it("retorna o sub do JWT quando há sessão válida (validação local via getClaims)", async () => {
    const getClaims = vi.fn(async () => ({
      data: { claims: { sub: "user-1", role: "authenticated" } },
      error: null,
    }));
    const id = await authedUserId(client(getClaims));
    expect(id).toBe("user-1");
    expect(getClaims).toHaveBeenCalledTimes(1);
  });

  it("retorna null quando não há sessão (data null)", async () => {
    const id = await authedUserId(client(async () => ({ data: null, error: null })));
    expect(id).toBeNull();
  });

  it("retorna null quando o sub está ausente ou vazio", async () => {
    expect(
      await authedUserId(client(async () => ({ data: { claims: {} }, error: null }))),
    ).toBeNull();
    expect(
      await authedUserId(
        client(async () => ({ data: { claims: { sub: "" } }, error: null })),
      ),
    ).toBeNull();
  });
});
