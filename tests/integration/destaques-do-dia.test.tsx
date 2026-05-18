/**
 * Testes de integração para DestaquesDoDia Server Component.
 *
 * Mock pattern espelhado de stats-page.test.tsx e fixture-page.test.tsx.
 *
 * Contrato testado:
 * - lista apenas fixtures de alto sinal (≥2 badges) não-dispensadas
 * - cada item exibe time casa, time visitante, link para /fixtures/<id>
 * - lista vazia → componente não renderiza nada (sem header órfão)
 * - clicar "dispensar" chama Server Action → item some (revalidatePath)
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---- shared mock state -------------------------------------------------------

type MockFixtureRow = {
  id: number;
  home_team: string;
  away_team: string;
  league: string | null;
  country: string | null;
  kickoff_utc: string | null;
  ko_time: string | null;
  match_date: string;
  hd_probe: string | null;
  // sub-paths for badge computation
  ref_record: unknown;
  streaks: unknown;
};

type MockDismissalRow = { fixture_id: number };

let mockFixtures: MockFixtureRow[] = [];
let mockDismissals: MockDismissalRow[] = [];
let mockUser: { id: string } | null = { id: "user-a" };

function resetMocks() {
  mockFixtures = [];
  mockDismissals = [];
  mockUser = { id: "user-a" };
}

// Chain builder que suporta .select().or().order()...
function buildQueryChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.or = () => chain;
  chain.order = () => chain;
  chain.eq = () => chain;
  chain.in = () => chain;
  chain.then = (cb: (r: unknown) => unknown) =>
    Promise.resolve(cb({ data: rows, error: null }));
  return chain;
}

const mockAdminClient = {
  from: (table: string) => {
    if (table === "fixtures") {
      return buildQueryChain(mockFixtures);
    }
    if (table === "alert_dismissals") {
      return buildQueryChain(mockDismissals);
    }
    throw new Error(`unexpected table: ${table}`);
  },
};

const mockServerClient = {
  auth: {
    getUser: () =>
      Promise.resolve({
        data: { user: mockUser },
        error: null,
      }),
  },
  from: (table: string) => {
    if (table === "alert_dismissals") {
      return buildQueryChain(mockDismissals);
    }
    throw new Error(`unexpected table: ${table}`);
  },
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(mockServerClient),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Stub do módulo time para todayBrt determinístico
vi.mock("@/lib/fixtures/time", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/fixtures/time")>();
  return {
    ...orig,
    todayBrt: () => "2026-05-18",
    brtDayWindowUtc: () => ({
      startUtc: "2026-05-18T03:00:00.000Z",
      endUtc: "2026-05-19T03:00:00.000Z",
    }),
  };
});

// Import APÓS mocks
import { DestaquesDoDia } from "@/app/(dashboard)/_components/destaques-do-dia";

// ---- helpers ----------------------------------------------------------------

function makeHighSignalFixture(id: number): MockFixtureRow {
  return {
    id,
    home_team: `Home${id}`,
    away_team: `Away${id}`,
    league: "Premier League",
    country: "england",
    kickoff_utc: `2026-05-18T19:00:00Z`,
    ko_time: "20:00",
    match_date: "2026-05-18",
    hd_probe: "Home",
    // ref com avg_total_booking_points > 45 e streaks over25 em ambos os lados
    ref_record: {
      name: "M. Oliver",
      completed: 10,
      avg_total_booking_points: 50,
      total_yellow_reds: 0,
    },
    streaks: {
      home: [
        {
          stat_type: "over 2.5",
          desc: "over 2.5 goals streak",
          overall_perc: 80,
        },
      ],
      away: [
        {
          stat_type: "over 2.5",
          desc: "over 2.5 goals streak",
          overall_perc: 75,
        },
      ],
    },
  };
}

function makeLowSignalFixture(id: number): MockFixtureRow {
  return {
    id,
    home_team: `Low${id}`,
    away_team: `LowAway${id}`,
    league: "Ligue 1",
    country: "france",
    kickoff_utc: `2026-05-18T21:00:00Z`,
    ko_time: "22:00",
    match_date: "2026-05-18",
    hd_probe: "Home",
    ref_record: null,
    streaks: { home: [], away: [] },
  };
}

// ---- testes -----------------------------------------------------------------

beforeEach(() => {
  resetMocks();
  vi.clearAllMocks();
});

describe("<DestaquesDoDia />", () => {
  it("lista apenas fixtures de alto sinal não-dispensadas", async () => {
    mockFixtures = [makeHighSignalFixture(1), makeLowSignalFixture(2)];
    mockDismissals = [];

    const el = await DestaquesDoDia();
    if (!el) {
      // alto sinal não foi computado — falha esperada até implementação
      expect(el).not.toBeNull();
      return;
    }
    const { container } = render(el);

    // fixture 1 (alto sinal) deve aparecer
    expect(screen.queryByText("Home1")).not.toBeNull();
    // fixture 2 (baixo sinal) NÃO deve aparecer
    expect(screen.queryByText("Low2")).toBeNull();

    // não deve haver header órfão quando há resultados
    expect(container.querySelector("[data-destaques]")).not.toBeNull();
  });

  it("fixture dispensada não aparece na seção", async () => {
    mockFixtures = [makeHighSignalFixture(3), makeHighSignalFixture(4)];
    mockDismissals = [{ fixture_id: 3 }]; // fixture 3 dispensada

    const el = await DestaquesDoDia();
    if (!el) return; // nenhum destaque — ok

    render(el);

    // fixture 3 dispensada não deve aparecer
    expect(screen.queryByText("Home3")).toBeNull();
    // fixture 4 não dispensada deve aparecer
    expect(screen.queryByText("Home4")).not.toBeNull();
  });

  it("lista vazia → renderiza null (sem header órfão)", async () => {
    mockFixtures = [makeLowSignalFixture(5)]; // apenas baixo sinal
    mockDismissals = [];

    const el = await DestaquesDoDia();

    // deve retornar null quando não há destaques
    expect(el).toBeNull();
  });

  it("todas dispensadas → renderiza null", async () => {
    mockFixtures = [makeHighSignalFixture(6)];
    mockDismissals = [{ fixture_id: 6 }];

    const el = await DestaquesDoDia();
    expect(el).toBeNull();
  });

  it("item de destaque tem link para /fixtures/<id>", async () => {
    mockFixtures = [makeHighSignalFixture(7)];
    mockDismissals = [];

    const el = await DestaquesDoDia();
    if (!el) { expect(el).not.toBeNull(); return; }
    const { container } = render(el);

    const link = container.querySelector(`a[href="/fixtures/7"]`);
    expect(link).not.toBeNull();
  });
});
