/**
 * Tests for GET /api/bets/export — auth gate.
 *
 * Regressão (Lição B22): esta rota tinha `runtime = "edge"`, incompatível com
 * o OpenNext/Cloudflare — retornava 500 em prod (mesmo deslogado, ANTES do auth
 * gate), independente de getUser/getClaims. O edge runtime foi removido (roda
 * no Node.js do Worker). Não havia teste do handler, então o 500 vazou pra
 * prod. Este teste fixa o contrato: deslogado → 401, NUNCA 500 nem vazamento.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState: { user: { id: string } | null } = { user: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: mockState.user },
        error: null,
      })),
    },
    // Deslogado o handler deve retornar ANTES de qualquer query.
    from: () => {
      throw new Error("não deveria consultar o banco sem sessão");
    },
  })),
}));

const { GET } = await import("@/app/api/bets/export/route");

beforeEach(() => {
  mockState.user = null;
});

describe("GET /api/bets/export — auth gate", () => {
  it("deslogado → 401 (não 500, sem tocar o banco)", async () => {
    const res = await GET(new Request("http://localhost/api/bets/export"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });
});
