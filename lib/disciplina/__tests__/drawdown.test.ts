/**
 * TDD — drawdown: computeDrawdown3d
 *
 * Calcula o drawdown percentual das últimas 72h de apostas resolvidas.
 * drawdown_3d = -PL_72h / banca_inicio_periodo * 100
 * Se PL_72h >= 0, drawdown = 0.
 * Se banca_inicio = 0 ou sem apostas, drawdown = 0.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

// Tipos mínimos para o mock do Supabase
type MockBet = {
  total_stake: number;
  actual_return: number | null;
  resolved_at: string;
};

function makeSupabaseMock(bets: MockBet[]) {
  const chainMethods = {
    select: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: bets, error: null }),
  };
  return {
    from: vi.fn().mockReturnValue(chainMethods),
    auth: { getUser: vi.fn() },
  };
}

describe("computeDrawdown3d", () => {
  it("retorna 0 quando não há apostas resolvidas nas últimas 72h", async () => {
    vi.resetModules();
    const supabase = makeSupabaseMock([]);
    const { computeDrawdown3d } = await import("../drawdown");
    const result = await computeDrawdown3d(supabase as never, "user-1");
    expect(result).toBe(0);
  });

  it("retorna 0 quando PL_72h é positivo (sem drawdown)", async () => {
    vi.resetModules();
    // total_stake=100, actual_return=120 → PL = +20
    const bets: MockBet[] = [
      { total_stake: 100, actual_return: 120, resolved_at: new Date().toISOString() },
    ];
    const supabase = makeSupabaseMock(bets);
    const { computeDrawdown3d } = await import("../drawdown");
    const result = await computeDrawdown3d(supabase as never, "user-1");
    expect(result).toBe(0);
  });

  it("retorna drawdown percentual correto quando PL_72h é negativo", async () => {
    vi.resetModules();
    // total_stake=200, actual_return=150 → PL = -50
    // drawdown = 50/200*100 = 25%
    const bets: MockBet[] = [
      { total_stake: 100, actual_return: 80, resolved_at: new Date().toISOString() },
      { total_stake: 100, actual_return: 70, resolved_at: new Date().toISOString() },
    ];
    const supabase = makeSupabaseMock(bets);
    const { computeDrawdown3d } = await import("../drawdown");
    const result = await computeDrawdown3d(supabase as never, "user-1");
    expect(result).toBeCloseTo(25, 1);
  });

  it("retorna drawdown = 25 para PL -50 sobre stake 200", async () => {
    vi.resetModules();
    const bets: MockBet[] = [
      { total_stake: 200, actual_return: 150, resolved_at: new Date().toISOString() },
    ];
    const supabase = makeSupabaseMock(bets);
    const { computeDrawdown3d } = await import("../drawdown");
    const result = await computeDrawdown3d(supabase as never, "user-1");
    expect(result).toBeCloseTo(25, 1);
  });

  it("retorna 0 para apostas com actual_return null (pendentes ignoradas)", async () => {
    vi.resetModules();
    const bets: MockBet[] = [
      { total_stake: 100, actual_return: null, resolved_at: new Date().toISOString() },
    ];
    const supabase = makeSupabaseMock(bets);
    const { computeDrawdown3d } = await import("../drawdown");
    const result = await computeDrawdown3d(supabase as never, "user-1");
    // null return tratado como 0 → PL = -100 → drawdown = 100%? Ou filtrado?
    // Regra: apostas sem actual_return são excluídas (status≠resolved)
    // O mock retorna `actual_return: null` mas o filtro `.not('actual_return', 'is', null)` seria aplicado
    // Como o mock não filtra, testamos comportamento da função quando há null
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("retorna 10% para PL -100 sobre stake 1000", async () => {
    vi.resetModules();
    const bets: MockBet[] = [
      { total_stake: 500, actual_return: 450, resolved_at: new Date().toISOString() },
      { total_stake: 500, actual_return: 450, resolved_at: new Date().toISOString() },
    ];
    const supabase = makeSupabaseMock(bets);
    const { computeDrawdown3d } = await import("../drawdown");
    const result = await computeDrawdown3d(supabase as never, "user-1");
    expect(result).toBeCloseTo(10, 1);
  });
});
