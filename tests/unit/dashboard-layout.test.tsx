/**
 * TDD — dashboard layout auth round-trip
 *
 * Garante que DashboardLayout:
 *  (a) NÃO chama auth.getUser() — getUser() é o único primitivo que faz
 *      round-trip de rede; sua ausência é a afirmação mais forte possível
 *      num unit test de que não há chamada de rede no layout.
 *  (b) SIM chama auth.getClaims() para verificar o JWT localmente via JWKS
 *      (sem round-trip de rede após o fetch inicial cacheado).
 *  (c) Usuário autenticado renderiza o sidebar com o display name correto.
 *  (d) Usuário sem claims válidos é redirecionado para /login (gate defensivo).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";

// ──────────────────────────────────────────────────────────────────────────────
// Mocks de dependências Next.js e Supabase
// ──────────────────────────────────────────────────────────────────────────────

const redirectMock = vi.fn((path: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${path}` });
});

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

// CommandPalette e MobileBottomNav são Client Components — stub mínimo.
vi.mock("@/components/command-palette", () => ({
  CommandPalette: () => null,
}));

vi.mock("@/components/mobile-bottom-nav", () => ({
  MobileBottomNav: () => null,
}));

// logoutAction é Server Action — stub para não disparar nada.
vi.mock("@/app/(auth)/login/actions", () => ({
  logoutAction: vi.fn(),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Estado controlável do mock Supabase
// ──────────────────────────────────────────────────────────────────────────────

const getUserMock = vi.fn();
const getClaimsMock = vi.fn();

// Mock houses query used by layout (Wave M BetSlipProvider)
const mockHousesChain = {
  select: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  order: vi.fn().mockResolvedValue({ data: [], error: null }),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: getUserMock,
      getClaims: getClaimsMock,
    },
    from: vi.fn(() => mockHousesChain),
  })),
}));

// getDraftSlip uses createClient internally — stub it to avoid nested from() calls
vi.mock("@/lib/bet-slip/actions", () => ({
  getDraftSlip: vi.fn().mockResolvedValue(null),
}));

// BetSlipProvider is a Client Component — stub to null in this test
vi.mock("@/components/bet-slip/bet-slip-provider", () => ({
  BetSlipProvider: () => null,
}));

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function setAuthenticatedClaims(
  email = "user@example.com",
  display_name?: string,
) {
  const claims = {
    email,
    user_metadata: display_name ? { display_name } : {},
  };
  getClaimsMock.mockResolvedValue({ data: { claims }, error: null });
  getUserMock.mockResolvedValue({ data: { user: null }, error: null });
}

function setUnauthenticated() {
  getClaimsMock.mockResolvedValue({ data: null, error: null });
  getUserMock.mockResolvedValue({ data: { user: null }, error: null });
}

// ──────────────────────────────────────────────────────────────────────────────
// Import após mocks — deve usar as versões mockadas
// ──────────────────────────────────────────────────────────────────────────────

// Import dinâmico para garantir que os mocks já estejam registrados.
// Tipado como função async diretamente (Server Component) para evitar o erro
// TS2349 que React.ComponentType traz ao incluir ComponentClass no union.
let DashboardLayout: (props: { children: React.ReactNode }) => Promise<React.ReactElement>;

beforeEach(async () => {
  vi.clearAllMocks();
  redirectMock.mockClear();
  const mod = await import("@/app/(dashboard)/layout");
  DashboardLayout = mod.default as (props: { children: React.ReactNode }) => Promise<React.ReactElement>;
});

afterEach(() => {
  vi.resetModules();
});

// ──────────────────────────────────────────────────────────────────────────────
// Testes
// ──────────────────────────────────────────────────────────────────────────────

describe("DashboardLayout — eliminação do round-trip de rede redundante", () => {
  it("(a) NÃO chama auth.getUser() — getUser() é o único primitivo de rede; sua ausência prova ausência de round-trip no layout", async () => {
    setAuthenticatedClaims("rafael@example.com", "Rafael");

    const element = await DashboardLayout({ children: <div>content</div> });
    render(element);

    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("(b) chama auth.getClaims() para verificar o JWT localmente via JWKS (sem round-trip de rede após cache)", async () => {
    setAuthenticatedClaims("rafael@example.com", "Rafael");

    const element = await DashboardLayout({ children: <div>content</div> });
    render(element);

    expect(getClaimsMock).toHaveBeenCalledOnce();
  });

  it("(c) renderiza o display_name no sidebar quando user_metadata o contém", async () => {
    setAuthenticatedClaims("rafael@example.com", "Rafael Nobre");

    const element = await DashboardLayout({ children: <div>page content</div> });
    render(element);

    expect(screen.getByText("Rafael Nobre")).toBeDefined();
  });

  it("(c2) faz fallback para a parte local do email quando não há display_name", async () => {
    setAuthenticatedClaims("myname@example.com");

    const element = await DashboardLayout({ children: <div>page content</div> });
    render(element);

    expect(screen.getByText("myname")).toBeDefined();
  });

  it('(c3) faz fallback para "you" quando não há email nem display_name nas claims', async () => {
    const claims = { user_metadata: {} };
    getClaimsMock.mockResolvedValue({ data: { claims }, error: null });
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const element = await DashboardLayout({ children: <div>content</div> });
    render(element);

    expect(screen.getByText("you")).toBeDefined();
  });

  it("(d) redireciona para /login quando claims é null/ausente (gate defensivo mantido)", async () => {
    setUnauthenticated();

    await expect(
      DashboardLayout({ children: <div>content</div> }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });

    expect(redirectMock).toHaveBeenCalledWith("/login");
  });
});
