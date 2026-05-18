/**
 * Task 4 — Views roi_by_house_view + roi_by_period_view
 *
 * Padrão real (igual a stats-page.test.tsx / dashboard-metrics-regression.test.tsx):
 * mock do client Supabase retornando linhas no formato das views; assert de
 * render/derivação na página /banca; edge cases de valores null.
 *
 * NOTA: testes SQL de integração real (assert de linha nas views contra Postgres real)
 * dependem de harness Supabase local inexistente — documentado como exceção em
 * CLAUDE.md (Lesson B13) e follow-up em docs/tasks/loop-banca/01-followup-sql-harness.md.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";

// ──────────────────────────────────────────────────────────────────────────────
// Datasets
// ──────────────────────────────────────────────────────────────────────────────

/** Dataset happy-path: duas casas com todos os campos preenchidos */
const HOUSE_ROWS_FULL = [
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

/** Dataset edge-case: casa sem apostas (yield/roi/win_rate null) */
const HOUSE_ROWS_NULL_METRICS = [
  {
    house_id: "uuid-c",
    house_name: "Casa Vazia",
    resolved_staked: 0,
    resolved_returned: 0,
    pl: 0,
    yield: null,
    roi: null,
    win_rate: null,
    bet_count: 0,
    pending_stake: 50,
  },
];

const PERIOD_ROWS = [
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

const PERIOD_ROWS_NULL_YIELD = [
  {
    period: "rolling-30d",
    period_type: "rolling-30d",
    resolved_staked: 0,
    resolved_returned: 0,
    pl: 0,
    yield: null,
    win_rate: null,
    won_count: 0,
    lost_count: 0,
    bet_count: 0,
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Mock Supabase
// ──────────────────────────────────────────────────────────────────────────────

type TableName = "roi_by_house_view" | "roi_by_period_view" | "bets";

function buildQueryBuilder(houseData: unknown, periodData: unknown, betsData: unknown) {
  return (table: TableName) => {
    let resolveData: unknown;
    switch (table) {
      case "roi_by_house_view":
        resolveData = houseData;
        break;
      case "roi_by_period_view":
        resolveData = periodData;
        break;
      case "bets":
        resolveData = betsData;
        break;
      default:
        resolveData = [];
    }
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.order = () => b;
    b.eq = () => b;
    b.neq = () => b;
    b.limit = () => b;
    b.is = () => b;
    b.not = () => b;
    b.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: resolveData, error: null }).then(resolve);
    return b;
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: buildQueryBuilder(HOUSE_ROWS_FULL, PERIOD_ROWS, []),
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

import BancaPage from "@/app/(dashboard)/banca/page";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ──────────────────────────────────────────────────────────────────────────────
// Testes happy-path: consumo correto de roi_by_house_view
// ──────────────────────────────────────────────────────────────────────────────

describe("BancaPage — consume roi_by_house_view (happy-path)", () => {
  it("renderiza sem erro com dados completos", async () => {
    const element = await BancaPage();
    expect(() => render(element)).not.toThrow();
  });

  it("exibe nome das duas casas retornadas pela view", async () => {
    const element = await BancaPage();
    render(element);

    expect(screen.getByText(/Bet365/i)).toBeDefined();
    expect(screen.getByText(/Sportingbet/i)).toBeDefined();
  });

  it("exibe P/L positivo da Casa A (+50,00)", async () => {
    const element = await BancaPage();
    render(element);

    // fmt.signed(50) → "+50,00"
    const hits = screen.getAllByText(/\+50,00/);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("exibe P/L negativo da Casa B (-20,00)", async () => {
    const element = await BancaPage();
    render(element);

    // fmt.signed(-20) → "-20,00" (happy-dom usa hífen-menos padrão)
    const hits = screen.getAllByText(/-20,00/);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("exibe yield e ROI formatados como % (Casa A: +50,00% e +25,00%)", async () => {
    const element = await BancaPage();
    render(element);

    // yield = 0.5 → "+50,00%"
    expect(screen.getAllByText(/\+50,00%/).length).toBeGreaterThan(0);
    // roi = 0.25 → "+25,00%"
    expect(screen.getAllByText(/\+25,00%/).length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Testes happy-path: consumo correto de roi_by_period_view
// ──────────────────────────────────────────────────────────────────────────────

describe("BancaPage — consume roi_by_period_view (happy-path)", () => {
  it("exibe seção rolling-30d", async () => {
    const element = await BancaPage();
    render(element);

    expect(screen.getByText(/rolling.30d/i)).toBeDefined();
  });

  it("exibe breakdown mensal com período '2026-05'", async () => {
    const element = await BancaPage();
    render(element);

    expect(screen.getByText(/2026-05/)).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Edge case: casa sem apostas — yield/roi/win_rate null → exibe "—"
// ──────────────────────────────────────────────────────────────────────────────

describe("BancaPage — edge case: yield/roi/win_rate null (casa sem apostas resolvidas)", () => {
  it("exibe '—' para win_rate null em casa sem apostas", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      from: buildQueryBuilder(HOUSE_ROWS_NULL_METRICS, [], []),
    });

    const element = await BancaPage();
    render(element);

    // A página exibe `h.win_rate !== null ? fmt.percent(...) : "—"`
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("exibe nome da casa mesmo quando todas as métricas são null", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      from: buildQueryBuilder(HOUSE_ROWS_NULL_METRICS, [], []),
    });

    const element = await BancaPage();
    render(element);

    expect(screen.getByText(/Casa Vazia/i)).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Edge case: roi_by_period_view com yield null → exibe "—" no rolling-30d
// ──────────────────────────────────────────────────────────────────────────────

describe("BancaPage — edge case: yield null em roi_by_period_view", () => {
  it("exibe '—' no yield do rolling-30d quando yield é null", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      from: buildQueryBuilder(HOUSE_ROWS_FULL, PERIOD_ROWS_NULL_YIELD, []),
    });

    const element = await BancaPage();
    render(element);

    // fmtPct(null) → "—"
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// C1 — Change-detector: security_invoker = true nas DUAS views novas (C1/OWASP A01)
// Garante que a migration 0014 não pode ser mergeada sem o ALTER VIEW que
// impede RLS bypass / vazamento cross-tenant.
// ──────────────────────────────────────────────────────────────────────────────

describe("migration 0014 — security_invoker nas views ROI (change-detector C1)", () => {
  const migrationPath = join(
    __dirname,
    "../../supabase/migrations/0014_banca_loop.sql",
  );
  const sql = readFileSync(migrationPath, "utf-8");

  it("roi_by_house_view possui ALTER VIEW ... security_invoker = true (RLS isolation)", () => {
    // Regex aceita qualquer whitespace entre tokens — tolerante a formatação.
    expect(sql).toMatch(
      /alter\s+view\s+public\.roi_by_house_view\s+set\s*\(\s*security_invoker\s*=\s*true\s*\)/i,
    );
  });

  it("roi_by_period_view possui ALTER VIEW ... security_invoker = true (RLS isolation)", () => {
    expect(sql).toMatch(
      /alter\s+view\s+public\.roi_by_period_view\s+set\s*\(\s*security_invoker\s*=\s*true\s*\)/i,
    );
  });
});
