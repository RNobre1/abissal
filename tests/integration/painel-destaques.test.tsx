/**
 * Fiação do /painel: BriefingDoDia (F4).
 *
 * F4 (2026-07-30, decisão do Pilot): o BriefingDoDia SUBSTITUI a lista
 * <OportunidadesIa /> no topo do painel — o componente antigo continua no
 * repo, mas a página não o renderiza mais (as top 3 oportunidades + ação
 * "+ bilhete" agora vivem dentro do card de briefing).
 * 31/07 (decisão do Pilot): <DestaquesDoDia /> também SAIU do painel
 * (ocupava espaço demais) — componente segue no repo, desfiado. Contrato:
 * - /painel renderiza <BriefingDoDia /> quando quiet mode está inativo;
 * - quiet mode ativo suprime o briefing (contém sugestão de aposta);
 * - a página NÃO referencia OportunidadesIa NEM DestaquesDoDia.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

// Os Server Components async viram marcadores síncronos — o objeto do
// teste é a FIAÇÃO na página, não o conteúdo deles.
vi.mock("@/components/painel/briefing-do-dia", () => ({
  BriefingDoDia: () => <div data-testid="briefing-do-dia" />,
}));

import OverviewPage from "@/app/(dashboard)/painel/page";

beforeEach(() => {
  vi.clearAllMocks();
  mockQuietActive = false;
});

describe("/painel — fiação do BriefingDoDia", () => {
  it("renderiza BriefingDoDia quando quiet mode está inativo", async () => {
    const element = await OverviewPage();
    render(element);

    expect(screen.getByTestId("briefing-do-dia")).toBeInTheDocument();
    expect(screen.queryByTestId("quiet-mode-card")).toBeNull();
    expect(screen.queryByTestId("oportunidades-ia")).toBeNull();
  });

  it("quiet mode ativo suprime o briefing (mesmo gating)", async () => {
    mockQuietActive = true;
    const element = await OverviewPage();
    render(element);

    expect(screen.queryByTestId("briefing-do-dia")).toBeNull();
    expect(screen.getByTestId("quiet-mode-card")).toBeInTheDocument();
  });

  it("a página não referencia OportunidadesIa nem DestaquesDoDia (decisões do Pilot)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../app/(dashboard)/painel/page.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/OportunidadesIa/);
    expect(src).not.toMatch(/DestaquesDoDia/);
    expect(src).toMatch(/BriefingDoDia/);
  });
});
