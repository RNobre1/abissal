/**
 * TDD — quiet-mode: isQuietModeActive
 *
 * Regras:
 *   - Lê disciplina_settings (graceful degradation se tabela ausente)
 *   - Se quiet_mode_enabled=false → active=false
 *   - Se FRICAO_QUIET_MODE_ENABLED=false → active=false
 *   - Se quiet_mode_until > now → active=true (já foi ativado, cooldown ativo)
 *   - Se PL_24h < -threshold% → active=true, persiste quiet_mode_until = now + 4h
 *   - Se PL_24h >= -threshold% e sem quiet_mode_until futuro → active=false
 */
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

type MockRow = Record<string, unknown>;

function makeSupabaseMock(opts: {
  settings?: MockRow | null;
  settingsError?: boolean;
  bets?: MockRow[];
  upsertError?: boolean;
}) {
  const settingsSelect = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: opts.settings ?? null,
      error: opts.settingsError ? { message: "table not found" } : null,
    }),
    upsert: vi.fn().mockResolvedValue({
      error: opts.upsertError ? { message: "upsert error" } : null,
    }),
  };

  const betsChain = {
    select: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({
      data: opts.bets ?? [],
      error: null,
    }),
  };

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "disciplina_settings") return settingsSelect;
      if (table === "bets") return betsChain;
      return {
        upsert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn().mockReturnThis(),
      };
    }),
    auth: { getUser: vi.fn() },
  };
}

describe("isQuietModeActive", () => {
  it("retorna active=false quando disciplina_settings não existe (graceful degradation)", async () => {
    vi.resetModules();
    vi.stubEnv("FRICAO_QUIET_MODE_ENABLED", "true");
    const supabase = makeSupabaseMock({ settingsError: true });
    const { isQuietModeActive } = await import("../quiet-mode");
    const result = await isQuietModeActive(supabase as never, "user-1");
    expect(result.active).toBe(false);
  });

  it("retorna active=false quando kill switch env FRICAO_QUIET_MODE_ENABLED=false", async () => {
    vi.stubEnv("FRICAO_QUIET_MODE_ENABLED", "false");
    vi.resetModules();
    const supabase = makeSupabaseMock({
      settings: { quiet_mode_enabled: true, quiet_mode_drawdown_pct: 5, quiet_mode_until: null },
    });
    const { isQuietModeActive } = await import("../quiet-mode");
    const result = await isQuietModeActive(supabase as never, "user-1");
    expect(result.active).toBe(false);
  });

  it("retorna active=false quando quiet_mode_enabled=false nas settings", async () => {
    vi.stubEnv("FRICAO_QUIET_MODE_ENABLED", "true");
    vi.resetModules();
    const supabase = makeSupabaseMock({
      settings: { quiet_mode_enabled: false, quiet_mode_drawdown_pct: 5, quiet_mode_until: null },
      bets: [],
    });
    const { isQuietModeActive } = await import("../quiet-mode");
    const result = await isQuietModeActive(supabase as never, "user-1");
    expect(result.active).toBe(false);
  });

  it("retorna active=true quando quiet_mode_until está no futuro", async () => {
    vi.stubEnv("FRICAO_QUIET_MODE_ENABLED", "true");
    vi.resetModules();
    const futureDate = new Date(Date.now() + 3_600_000).toISOString();
    const supabase = makeSupabaseMock({
      settings: {
        quiet_mode_enabled: true,
        quiet_mode_drawdown_pct: 5,
        quiet_mode_until: futureDate,
      },
      bets: [],
    });
    const { isQuietModeActive } = await import("../quiet-mode");
    const result = await isQuietModeActive(supabase as never, "user-1");
    expect(result.active).toBe(true);
    expect(result.until).toBeDefined();
  });

  it("retorna active=false quando quiet_mode_until está no passado", async () => {
    vi.stubEnv("FRICAO_QUIET_MODE_ENABLED", "true");
    vi.resetModules();
    const pastDate = new Date(Date.now() - 3_600_000).toISOString();
    const supabase = makeSupabaseMock({
      settings: {
        quiet_mode_enabled: true,
        quiet_mode_drawdown_pct: 5,
        quiet_mode_until: pastDate,
      },
      bets: [],
    });
    const { isQuietModeActive } = await import("../quiet-mode");
    const result = await isQuietModeActive(supabase as never, "user-1");
    expect(result.active).toBe(false);
  });

  it("retorna active=true e razão 'loss' quando PL_24h < -threshold e ativa quiet_mode", async () => {
    vi.stubEnv("FRICAO_QUIET_MODE_ENABLED", "true");
    vi.resetModules();
    const now = new Date();
    // PL negativo: stake=100, retorno=80 → PL=-20 → drawdown 20% > threshold 5%
    const supabase = makeSupabaseMock({
      settings: {
        quiet_mode_enabled: true,
        quiet_mode_drawdown_pct: 5,
        quiet_mode_until: null,
      },
      bets: [
        { total_stake: 100, actual_return: 80, resolved_at: now.toISOString() },
      ],
    });
    const { isQuietModeActive } = await import("../quiet-mode");
    const result = await isQuietModeActive(supabase as never, "user-1");
    expect(result.active).toBe(true);
    expect(result.reason).toBe("loss");
  });

  it("retorna active=false quando PL_24h positivo e sem cooldown ativo", async () => {
    vi.stubEnv("FRICAO_QUIET_MODE_ENABLED", "true");
    vi.resetModules();
    const now = new Date();
    // PL positivo
    const supabase = makeSupabaseMock({
      settings: {
        quiet_mode_enabled: true,
        quiet_mode_drawdown_pct: 5,
        quiet_mode_until: null,
      },
      bets: [
        { total_stake: 100, actual_return: 120, resolved_at: now.toISOString() },
      ],
    });
    const { isQuietModeActive } = await import("../quiet-mode");
    const result = await isQuietModeActive(supabase as never, "user-1");
    expect(result.active).toBe(false);
  });
});
