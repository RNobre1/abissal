/**
 * Tests for setAiEnabledAction — Server Action do kill switch global de IA.
 *
 * Verifica: nega sem sessão (não escreve), grava a flag com o userId quando
 * autenticado, e propaga erro de escrita como { error }.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockSetAiEnabled = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mockGetUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ __admin: true }),
}));
vi.mock("@/lib/settings/ai-toggle", () => ({
  setAiEnabled: (...args: unknown[]) => mockSetAiEnabled(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { setAiEnabledAction } from "@/app/(dashboard)/configuracoes/ia/actions";

describe("setAiEnabledAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("nega quando não autenticado e NÃO escreve", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await setAiEnabledAction(false);
    expect(res.error).toBeDefined();
    expect(res.success).toBeUndefined();
    expect(mockSetAiEnabled).not.toHaveBeenCalled();
  });

  it("grava a flag com o userId quando autenticado", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockSetAiEnabled.mockResolvedValue(undefined);
    const res = await setAiEnabledAction(false);
    expect(res.success).toBe(true);
    expect(res.enabled).toBe(false);
    expect(mockSetAiEnabled).toHaveBeenCalledWith(expect.anything(), false, "u1");
  });

  it("propaga erro de escrita como { error }", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockSetAiEnabled.mockRejectedValue(new Error("rls denied"));
    const res = await setAiEnabledAction(true);
    expect(res.error).toContain("rls denied");
    expect(res.success).toBeUndefined();
  });
});
