/**
 * Fiação do DestaquesDoDia no /painel (Pacote A item 2).
 *
 * O componente (destaques-do-dia.tsx + dismissAlert + alert_dismissals 0015 +
 * high_signal da fixture_badges_view 0017/0043) estava completo mas NUNCA
 * fora importado em lugar nenhum. Contrato:
 * - /painel renderiza <DestaquesDoDia /> quando quiet mode está inativo;
 * - quiet mode ativo suprime destaques E oportunidades (mesmo gating).
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let mockQuietActive = false;

const quietState = () =>
  mockQuietActive
    ? { active: true, until: "2026-07-31T12:00:00Z" }
    : { active: false };

// ── mocks (mesma malha do dashboard-metrics-regression) ──────────────────────

function buildQueryBuilder() {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.is = () => builder;
  builder.order = () => builder;
  builder.limit = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
  builder.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => buildQueryBuilder(),
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      getClaims: vi
        .fn()
        .mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null }),
    },
  })),
}));

vi.mock("@/lib/disciplina/quiet-mode", () => ({
  isQuietModeActive: vi.fn(async () => quietState()),
}));

vi.mock("@/components/disciplina/quiet-mode-card", () => ({
  QuietModeCard: () => <div data-testid="quiet-mode-card" />,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/painel",
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Os dois Server Components async viram marcadores síncronos — o objeto do
// teste é a FIAÇÃO na página, não o conteúdo deles.
vi.mock("@/app/(dashboard)/_components/destaques-do-dia", () => ({
  DestaquesDoDia: () => <div data-testid="destaques-do-dia" />,
}));

vi.mock("@/app/(dashboard)/_components/oportunidades-ia", () => ({
  OportunidadesIa: () => <div data-testid="oportunidades-ia" />,
}));

import OverviewPage from "@/app/(dashboard)/painel/page";

beforeEach(() => {
  vi.clearAllMocks();
  mockQuietActive = false;
});

describe("/painel — fiação do DestaquesDoDia", () => {
  it("renderiza DestaquesDoDia quando quiet mode está inativo", async () => {
    const element = await OverviewPage();
    render(element);

    expect(screen.getByTestId("destaques-do-dia")).toBeInTheDocument();
    expect(screen.getByTestId("oportunidades-ia")).toBeInTheDocument();
    expect(screen.queryByTestId("quiet-mode-card")).toBeNull();
  });

  it("quiet mode ativo suprime destaques e oportunidades (mesmo gating)", async () => {
    mockQuietActive = true;
    const element = await OverviewPage();
    render(element);

    expect(screen.queryByTestId("destaques-do-dia")).toBeNull();
    expect(screen.queryByTestId("oportunidades-ia")).toBeNull();
    expect(screen.getByTestId("quiet-mode-card")).toBeInTheDocument();
  });
});
