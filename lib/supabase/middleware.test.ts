// @vitest-environment node
/**
 * Tests for `updateSession` (middleware de sessão Supabase).
 *
 * Foco da mudança (B21 follow-up): a sessão é validada via `getClaims()`
 * — que, com chaves JWT assimétricas (ES256), verifica a assinatura
 * LOCALMENTE sem round-trip à Auth do Supabase — e NÃO via `getUser()`,
 * que sempre faz um POST a /auth/v1/user (round-trip de rede por navegação).
 *
 * A matriz de decisão login↔painel já é coberta por `redirect-policy.test.ts`;
 * aqui verificamos só a INTEGRAÇÃO: getClaims → Boolean(claims) → decideRedirect.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// --- mock do client SSR -----------------------------------------------------
const mockState: { claims: Record<string, unknown> | null } = { claims: null };

const mockClient = {
  auth: {
    // getClaims: null quando sem sessão; { claims } quando logado (shape real do auth-js).
    getClaims: vi.fn(async () => ({
      data: mockState.claims ? { claims: mockState.claims } : null,
      error: null,
    })),
    // getUser NÃO deve ser chamado (é o round-trip que estamos removendo).
    getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
  },
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => mockClient),
}));

// import lazy: depois do mock estar registrado.
const { updateSession } = await import("@/lib/supabase/middleware");

function makeRequest(pathname: string): NextRequest {
  return new NextRequest(new URL(`https://abissal.rnobre.dev${pathname}`));
}

beforeEach(() => {
  mockState.claims = null;
  mockClient.auth.getClaims.mockClear();
  mockClient.auth.getUser.mockClear();
});

describe("updateSession — validação de sessão", () => {
  it("valida via getClaims (local), NUNCA via getUser (round-trip)", async () => {
    await updateSession(makeRequest("/painel"));
    expect(mockClient.auth.getClaims).toHaveBeenCalledTimes(1);
    expect(mockClient.auth.getUser).not.toHaveBeenCalled();
  });

  it("logado acessando /login → redireciona para /painel", async () => {
    mockState.claims = { sub: "user-1", role: "authenticated" };
    const res = await updateSession(makeRequest("/login"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/painel");
  });

  it("deslogado em rota protegida → redireciona para /login", async () => {
    mockState.claims = null;
    const res = await updateSession(makeRequest("/painel"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("logado em rota do app → segue a request (sem redirect)", async () => {
    mockState.claims = { sub: "user-1" };
    const res = await updateSession(makeRequest("/painel"));
    expect(res.status).not.toBe(307);
  });
});
