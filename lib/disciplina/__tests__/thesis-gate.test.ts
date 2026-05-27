/**
 * TDD — thesis-gate: shouldRequireThesis
 *
 * Regras:
 *   - hora BRT >= 22:00  → true
 *   - hora BRT <= 21:59  → false (limite abaixo do gatilho)
 *   - drawdown_3d >= 10% → true
 *   - drawdown_3d  < 10% → false
 *   - kill switch FRICAO_THESIS_GATE_ENABLED=false → sempre false
 *   - combinações: hora alta + drawdown baixo → true; hora baixa + drawdown alto → true
 */
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

// Import AFTER env stubs são configurados individualmente em cada test
// Para evitar cache de módulo, usamos importação dinâmica isolada.

describe("shouldRequireThesis — hora BRT", () => {
  it("retorna false para hora 21:59 (abaixo do gatilho)", async () => {
    vi.stubEnv("FRICAO_THESIS_GATE_ENABLED", "true");
    const { shouldRequireThesis } = await import("../thesis-gate");
    expect(shouldRequireThesis({ hourBrt: 21, drawdown3d: 0 })).toBe(false);
  });

  it("retorna true para hora 22:00 (exato gatilho)", async () => {
    vi.stubEnv("FRICAO_THESIS_GATE_ENABLED", "true");
    const { shouldRequireThesis } = await import("../thesis-gate");
    expect(shouldRequireThesis({ hourBrt: 22, drawdown3d: 0 })).toBe(true);
  });

  it("retorna true para hora 23:00", async () => {
    vi.stubEnv("FRICAO_THESIS_GATE_ENABLED", "true");
    const { shouldRequireThesis } = await import("../thesis-gate");
    expect(shouldRequireThesis({ hourBrt: 23, drawdown3d: 0 })).toBe(true);
  });

  it("retorna true para hora 0 (meia-noite, wrap-around não muda regra)", async () => {
    vi.stubEnv("FRICAO_THESIS_GATE_ENABLED", "true");
    const { shouldRequireThesis } = await import("../thesis-gate");
    // 0h BRT = ainda "noite" do dia anterior — >= 22 não, mas drawdown 0
    // Logo false (sem drawdown alto)
    expect(shouldRequireThesis({ hourBrt: 0, drawdown3d: 0 })).toBe(false);
  });
});

describe("shouldRequireThesis — drawdown 3d", () => {
  it("retorna false para drawdown 9% (abaixo do gatilho)", async () => {
    vi.stubEnv("FRICAO_THESIS_GATE_ENABLED", "true");
    const { shouldRequireThesis } = await import("../thesis-gate");
    expect(shouldRequireThesis({ hourBrt: 10, drawdown3d: 9 })).toBe(false);
  });

  it("retorna true para drawdown 10% (exato gatilho)", async () => {
    vi.stubEnv("FRICAO_THESIS_GATE_ENABLED", "true");
    const { shouldRequireThesis } = await import("../thesis-gate");
    expect(shouldRequireThesis({ hourBrt: 10, drawdown3d: 10 })).toBe(true);
  });

  it("retorna true para drawdown 25%", async () => {
    vi.stubEnv("FRICAO_THESIS_GATE_ENABLED", "true");
    const { shouldRequireThesis } = await import("../thesis-gate");
    expect(shouldRequireThesis({ hourBrt: 10, drawdown3d: 25 })).toBe(true);
  });
});

describe("shouldRequireThesis — kill switch", () => {
  it("retorna false quando FRICAO_THESIS_GATE_ENABLED=false, mesmo com hora alta", async () => {
    vi.stubEnv("FRICAO_THESIS_GATE_ENABLED", "false");
    vi.resetModules();
    const { shouldRequireThesis } = await import("../thesis-gate");
    expect(shouldRequireThesis({ hourBrt: 23, drawdown3d: 50 })).toBe(false);
  });

  it("retorna true quando FRICAO_THESIS_GATE_ENABLED não definido (default true)", async () => {
    // sem stubEnv → env var ausente → default habilitado
    vi.resetModules();
    const { shouldRequireThesis } = await import("../thesis-gate");
    expect(shouldRequireThesis({ hourBrt: 22, drawdown3d: 0 })).toBe(true);
  });
});

describe("shouldRequireThesis — combinações", () => {
  it("hora baixa + drawdown alto → true", async () => {
    vi.stubEnv("FRICAO_THESIS_GATE_ENABLED", "true");
    const { shouldRequireThesis } = await import("../thesis-gate");
    expect(shouldRequireThesis({ hourBrt: 14, drawdown3d: 15 })).toBe(true);
  });

  it("hora alta + drawdown baixo → true", async () => {
    vi.stubEnv("FRICAO_THESIS_GATE_ENABLED", "true");
    const { shouldRequireThesis } = await import("../thesis-gate");
    expect(shouldRequireThesis({ hourBrt: 22, drawdown3d: 2 })).toBe(true);
  });

  it("hora baixa + drawdown baixo → false", async () => {
    vi.stubEnv("FRICAO_THESIS_GATE_ENABLED", "true");
    const { shouldRequireThesis } = await import("../thesis-gate");
    expect(shouldRequireThesis({ hourBrt: 14, drawdown3d: 5 })).toBe(false);
  });
});

describe("shouldRequireThesis — userEnabled (disciplina_settings)", () => {
  it("userEnabled=false desliga mesmo se hora alta", async () => {
    vi.stubEnv("FRICAO_THESIS_GATE_ENABLED", "true");
    const { shouldRequireThesis } = await import("../thesis-gate");
    expect(shouldRequireThesis({ hourBrt: 23, drawdown3d: 0, userEnabled: false })).toBe(false);
  });

  it("userEnabled=false desliga mesmo se drawdown alto", async () => {
    vi.stubEnv("FRICAO_THESIS_GATE_ENABLED", "true");
    const { shouldRequireThesis } = await import("../thesis-gate");
    expect(shouldRequireThesis({ hourBrt: 14, drawdown3d: 50, userEnabled: false })).toBe(false);
  });

  it("userEnabled=true respeita gatilhos (hora alta → true)", async () => {
    vi.stubEnv("FRICAO_THESIS_GATE_ENABLED", "true");
    const { shouldRequireThesis } = await import("../thesis-gate");
    expect(shouldRequireThesis({ hourBrt: 22, drawdown3d: 0, userEnabled: true })).toBe(true);
  });

  it("userEnabled=undefined trata como ligado (compat)", async () => {
    vi.stubEnv("FRICAO_THESIS_GATE_ENABLED", "true");
    const { shouldRequireThesis } = await import("../thesis-gate");
    expect(shouldRequireThesis({ hourBrt: 22, drawdown3d: 0 })).toBe(true);
  });
});
