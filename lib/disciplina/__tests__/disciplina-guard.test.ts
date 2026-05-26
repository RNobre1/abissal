/**
 * TDD — disciplina-guard: checkDisciplinaLimits
 *
 * Valida bloqueios server-side antes de confirmar aposta:
 *   - stop_loss_daily_pct: se PL_hoje <= -X% da banca, bloqueia
 *   - max_bets_per_day: se apostas_hoje >= N, bloqueia
 *   - cooldown_after_loss_min: se última aposta resolvida como loss < N minutos atrás, bloqueia
 *   - sem settings: nenhum bloqueio (graceful degradation)
 */
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

type MockBet = {
  id: string;
  status: string;
  total_stake: number;
  actual_return: number | null;
  placed_at: string;
  resolved_at: string | null;
};

function makeGuardMock(opts: {
  settings?: Record<string, unknown> | null;
  settingsError?: boolean;
  bets?: MockBet[];
  totalBalance?: number;
}) {
  const bets = opts.bets ?? [];
  const totalBalance = opts.totalBalance ?? 1000;

  const settingsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: opts.settings ?? null,
      error: opts.settingsError ? { message: "table not found" } : null,
    }),
  };

  // mock for bets query
  const betsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: bets, error: null }),
  };

  // mock for house_balance_view
  const balanceChain = {
    select: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({
      data: [{ balance: totalBalance }],
      error: null,
    }),
  };

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "disciplina_settings") return settingsChain;
      if (table === "bets") return betsChain;
      if (table === "house_balance_view") return balanceChain;
      return { select: vi.fn().mockReturnThis() };
    }),
  };
}

describe("checkDisciplinaLimits", () => {
  it("retorna allowed=true quando não há settings (graceful degradation)", async () => {
    vi.resetModules();
    const supabase = makeGuardMock({ settingsError: true });
    const { checkDisciplinaLimits } = await import("../disciplina-guard");
    const result = await checkDisciplinaLimits(supabase as never, "user-1");
    expect(result.allowed).toBe(true);
  });

  it("retorna allowed=true quando settings null (usuário sem configuração)", async () => {
    vi.resetModules();
    const supabase = makeGuardMock({ settings: null });
    const { checkDisciplinaLimits } = await import("../disciplina-guard");
    const result = await checkDisciplinaLimits(supabase as never, "user-1");
    expect(result.allowed).toBe(true);
  });

  it("bloqueia quando stop_loss_daily_pct atingido", async () => {
    vi.resetModules();
    const today = new Date().toISOString();
    // PL hoje = -100 com banca 1000 → 10% drawdown
    // stop_loss = 5% → bloqueia
    const bets: MockBet[] = [
      { id: "1", status: "lost", total_stake: 100, actual_return: 0, placed_at: today, resolved_at: today },
    ];
    const supabase = makeGuardMock({
      settings: { stop_loss_daily_pct: 5, max_bets_per_day: null, cooldown_after_loss_min: 0 },
      bets,
      totalBalance: 1000,
    });
    const { checkDisciplinaLimits } = await import("../disciplina-guard");
    const result = await checkDisciplinaLimits(supabase as never, "user-1");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/stop.loss/i);
  });

  it("retorna allowed=true quando PL está dentro do stop-loss", async () => {
    vi.resetModules();
    const today = new Date().toISOString();
    // PL hoje = -10 com banca 1000 → 1% → dentro do stop_loss 5%
    const bets: MockBet[] = [
      { id: "1", status: "lost", total_stake: 10, actual_return: 0, placed_at: today, resolved_at: today },
    ];
    const supabase = makeGuardMock({
      settings: { stop_loss_daily_pct: 5, max_bets_per_day: null, cooldown_after_loss_min: 0 },
      bets,
      totalBalance: 1000,
    });
    const { checkDisciplinaLimits } = await import("../disciplina-guard");
    const result = await checkDisciplinaLimits(supabase as never, "user-1");
    expect(result.allowed).toBe(true);
  });

  it("bloqueia quando max_bets_per_day atingido", async () => {
    vi.resetModules();
    const today = new Date().toISOString();
    const bets: MockBet[] = Array.from({ length: 3 }, (_, i) => ({
      id: String(i),
      status: "pending",
      total_stake: 10,
      actual_return: null,
      placed_at: today,
      resolved_at: null,
    }));
    const supabase = makeGuardMock({
      settings: { stop_loss_daily_pct: null, max_bets_per_day: 3, cooldown_after_loss_min: 0 },
      bets,
    });
    const { checkDisciplinaLimits } = await import("../disciplina-guard");
    const result = await checkDisciplinaLimits(supabase as never, "user-1");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/máximo/i);
  });

  it("bloqueia quando cooldown pós-loss ativo", async () => {
    vi.resetModules();
    // Loss há 30 minutos → cooldown 60 min → bloqueia
    const lossTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const bets: MockBet[] = [
      { id: "1", status: "lost", total_stake: 10, actual_return: 0, placed_at: lossTime, resolved_at: lossTime },
    ];
    const supabase = makeGuardMock({
      settings: { stop_loss_daily_pct: null, max_bets_per_day: null, cooldown_after_loss_min: 60 },
      bets,
    });
    const { checkDisciplinaLimits } = await import("../disciplina-guard");
    const result = await checkDisciplinaLimits(supabase as never, "user-1");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/cooldown/i);
  });

  it("permite quando cooldown expirou", async () => {
    vi.resetModules();
    // Loss há 90 minutos → cooldown 60 min → liberado
    const lossTime = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const bets: MockBet[] = [
      { id: "1", status: "lost", total_stake: 10, actual_return: 0, placed_at: lossTime, resolved_at: lossTime },
    ];
    const supabase = makeGuardMock({
      settings: { stop_loss_daily_pct: null, max_bets_per_day: null, cooldown_after_loss_min: 60 },
      bets,
    });
    const { checkDisciplinaLimits } = await import("../disciplina-guard");
    const result = await checkDisciplinaLimits(supabase as never, "user-1");
    expect(result.allowed).toBe(true);
  });
});
