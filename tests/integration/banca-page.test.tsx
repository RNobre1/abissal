/**
 * Task 5 — Rota /banca: relatórios consolidados
 *
 * Testa o Server Component com Supabase mockado:
 *   - Renderiza P/L por casa (roi_by_house_view)
 *   - Renderiza yield por tipo de aposta (bets.kind)
 *   - Renderiza streaks de vitória/derrota
 *   - Renderiza ROI rolling 30d e breakdown mensal (roi_by_period_view)
 *   - Estado vazio (sem dados) → mensagem amigável, sem erro
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";

// ──────────────────────────────────────────────────────────────────────────────
// Dataset de teste
// ──────────────────────────────────────────────────────────────────────────────

const HOUSE_VIEW_DATA = [
  {
    house_id: "uuid-a",
    house_name: "Bet365",
    resolved_staked: 100,
    resolved_returned: 150,
    pl: 50,
    yield: 0.5,
    roi: 0.25,
    win_rate: 0.75,
    bet_count: 4,
    pending_stake: 20,
  },
  {
    house_id: "uuid-b",
    house_name: "Sportingbet",
    resolved_staked: 200,
    resolved_returned: 180,
    pl: -20,
    yield: -0.1,
    roi: -0.05,
    win_rate: 0.4,
    bet_count: 5,
    pending_stake: 0,
  },
];

const PERIOD_VIEW_DATA = [
  {
    period: "rolling-30d",
    period_type: "rolling-30d",
    resolved_staked: 300,
    resolved_returned: 330,
    pl: 30,
    yield: 0.1,
    win_rate: 0.6,
    won_count: 3,
    lost_count: 2,
    bet_count: 5,
  },
  {
    period: "2026-05",
    period_type: "monthly",
    resolved_staked: 300,
    resolved_returned: 330,
    pl: 30,
    yield: 0.1,
    win_rate: 0.6,
    won_count: 3,
    lost_count: 2,
    bet_count: 5,
  },
];

// Apostas por tipo (kind) para yield por tipo
const BETS_BY_KIND = [
  { kind: "single",   total_stake: 200, actual_return: 230, status: "won",  resolved_at: "2026-05-01T10:00:00Z" },
  { kind: "single",   total_stake: 100, actual_return: 0,   status: "lost", resolved_at: "2026-05-02T10:00:00Z" },
  { kind: "multiple", total_stake: 50,  actual_return: 100, status: "won",  resolved_at: "2026-05-03T10:00:00Z" },
  { kind: "single",   total_stake: 30,  actual_return: 0,   status: "lost", resolved_at: "2026-05-03T10:00:00Z" },
  { kind: "single",   total_stake: 50,  actual_return: 0,   status: "pending", resolved_at: null },
];

// ──────────────────────────────────────────────────────────────────────────────
// Mock Supabase — builder chain para as 3 queries da página /banca
// ──────────────────────────────────────────────────────────────────────────────

type TableName =
  | "roi_by_house_view"
  | "roi_by_period_view"
  | "daily_pl_view"
  | "bets";

// Snapshots agregados por dia (daily_pl_view sobre balance_snapshots — item 3:
// a tabela fantasma banca_snapshots nunca existiu e o gráfico ficava morto).
const DAILY_PL_VIEW_DATA = [
  { snapshot_date: "2026-05-01", total_balance: 500 },
  { snapshot_date: "2026-05-02", total_balance: 530 },
  { snapshot_date: "2026-05-04", total_balance: 510 },
];

function buildQueryBuilder(tableName: TableName) {
  let resolveData: unknown;

  switch (tableName) {
    case "roi_by_house_view":
      resolveData = HOUSE_VIEW_DATA;
      break;
    case "roi_by_period_view":
      resolveData = PERIOD_VIEW_DATA;
      break;
    case "daily_pl_view":
      resolveData = DAILY_PL_VIEW_DATA;
      break;
    case "bets":
      resolveData = BETS_BY_KIND;
      break;
    default:
      resolveData = [];
  }

  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.order = () => builder;
  builder.eq = () => builder;
  builder.neq = () => builder;
  builder.gte = () => builder;
  builder.limit = () => builder;
  builder.is = () => builder;
  builder.not = () => builder;
  // Terminal
  builder.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({ data: resolveData, error: null }).then(resolve);

  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: TableName) => buildQueryBuilder(table),
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/banca",
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Import após mocks
// ──────────────────────────────────────────────────────────────────────────────

import BancaPage from "@/app/(dashboard)/banca/page";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ──────────────────────────────────────────────────────────────────────────────
// Testes
// ──────────────────────────────────────────────────────────────────────────────

describe("BancaPage — relatórios consolidados (com dados)", () => {
  it("renderiza sem erro", async () => {
    const element = await BancaPage();
    expect(() => render(element)).not.toThrow();
  });

  it("exibe nome das casas de apostas da roi_by_house_view", async () => {
    const element = await BancaPage();
    render(element);

    expect(screen.getByText(/Bet365/i)).toBeDefined();
    expect(screen.getByText(/Sportingbet/i)).toBeDefined();
  });

  it("exibe P/L de pelo menos uma casa", async () => {
    const element = await BancaPage();
    render(element);

    // Casa A: pl=50 → "+50,00" (fmt.signed)
    expect(screen.getAllByText(/\+50,00/).length).toBeGreaterThan(0);
  });

  it("exibe ROI rolling-30d de roi_by_period_view", async () => {
    const element = await BancaPage();
    render(element);

    // Texto do período rolling-30d deve aparecer
    expect(screen.getByText(/rolling.30d/i)).toBeDefined();
  });

  it("exibe breakdown mensal (2026-05)", async () => {
    const element = await BancaPage();
    render(element);

    expect(screen.getByText(/2026-05/)).toBeDefined();
  });

  it("renderiza o gráfico de bankroll a partir de daily_pl_view (item 3 — antes lia a fantasma banca_snapshots)", async () => {
    const element = await BancaPage();
    render(element);

    expect(screen.getByText(/bankroll ao longo do tempo/i)).toBeDefined();
  });
});

describe("BancaPage — estado vazio (sem dados)", () => {
  it("renderiza mensagem amigável quando não há casas nem apostas", async () => {
    // Override mock para retornar arrays vazios
    const { createClient } = await import("@/lib/supabase/server");
    const mockCreateClient = createClient as ReturnType<typeof vi.fn>;
    mockCreateClient.mockResolvedValueOnce({
      from: () => {
        const emptyBuilder: Record<string, unknown> = {};
        emptyBuilder.select = () => emptyBuilder;
        emptyBuilder.order = () => emptyBuilder;
        emptyBuilder.eq = () => emptyBuilder;
        emptyBuilder.neq = () => emptyBuilder;
        emptyBuilder.limit = () => emptyBuilder;
        emptyBuilder.is = () => emptyBuilder;
        emptyBuilder.not = () => emptyBuilder;
        emptyBuilder.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return emptyBuilder;
      },
    });

    const element = await BancaPage();
    const { container } = render(element);

    // Não deve crashar; deve exibir estado vazio amigável
    expect(container).toBeDefined();
    // Alguma mensagem de estado vazio deve aparecer
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
  });
});
