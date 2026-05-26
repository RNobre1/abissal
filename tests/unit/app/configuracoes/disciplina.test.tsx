/**
 * TDD — /configuracoes/disciplina: form render + submit
 *
 * Testa o componente DisciplinaSettingsForm (Client Component).
 * Server Action é mockada para verificar chamadas corretas.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock da server action
const mockSaveDisciplinaAction = vi.fn();
vi.mock("@/app/(dashboard)/configuracoes/disciplina/actions", () => ({
  saveDisciplinaSettingsAction: (...args: unknown[]) => mockSaveDisciplinaAction(...args),
}));

import { DisciplinaSettingsForm } from "@/app/(dashboard)/configuracoes/disciplina/_components/disciplina-settings-form";

const defaultSettings = {
  stop_loss_daily_pct: 5,
  max_bets_per_day: 5,
  cooldown_after_loss_min: 60,
  quiet_mode_drawdown_pct: 5,
  thesis_gate_enabled: true,
  quiet_mode_enabled: true,
};

describe("DisciplinaSettingsForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveDisciplinaAction.mockResolvedValue({ success: true });
  });

  it("renderiza todos os campos com valores default", () => {
    render(<DisciplinaSettingsForm initialSettings={defaultSettings} />);

    expect(screen.getByLabelText(/stop.loss diário/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/máximo de apostas.dia/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cooldown pós.loss/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/threshold quiet mode/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /salvar/i })).toBeInTheDocument();
  });

  it("renderiza toggles para thesis_gate_enabled e quiet_mode_enabled", () => {
    render(<DisciplinaSettingsForm initialSettings={defaultSettings} />);

    const thesisToggle = screen.getByLabelText(/thesis gate/i);
    // Para quiet mode, usa queryAllByLabelText e pega o checkbox
    const quietToggles = screen.getAllByLabelText(/quiet mode/i);
    expect(thesisToggle).toBeInTheDocument();
    expect(quietToggles.length).toBeGreaterThanOrEqual(1);
  });

  it("pré-preenche campos com os valores initialSettings passados", () => {
    const customSettings = {
      ...defaultSettings,
      stop_loss_daily_pct: 10,
      max_bets_per_day: 3,
      cooldown_after_loss_min: 30,
    };
    render(<DisciplinaSettingsForm initialSettings={customSettings} />);

    const stopLoss = screen.getByLabelText(/stop.loss diário/i) as HTMLInputElement;
    const maxBets = screen.getByLabelText(/máximo de apostas.dia/i) as HTMLInputElement;
    const cooldown = screen.getByLabelText(/cooldown pós.loss/i) as HTMLInputElement;

    expect(Number(stopLoss.value)).toBe(10);
    expect(Number(maxBets.value)).toBe(3);
    expect(Number(cooldown.value)).toBe(30);
  });

  it("renderiza sem crash quando initialSettings é null (novo usuário)", () => {
    expect(() =>
      render(<DisciplinaSettingsForm initialSettings={null} />)
    ).not.toThrow();
  });

  it("campo thesis_gate_enabled inicia marcado quando true", () => {
    render(<DisciplinaSettingsForm initialSettings={defaultSettings} />);
    const toggle = screen.getByLabelText(/thesis gate/i) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it("campo thesis_gate_enabled inicia desmarcado quando false", () => {
    render(<DisciplinaSettingsForm initialSettings={{ ...defaultSettings, thesis_gate_enabled: false }} />);
    const toggle = screen.getByLabelText(/thesis gate/i) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it("campo quiet_mode_enabled inicia marcado quando true (checkbox checked)", () => {
    render(<DisciplinaSettingsForm initialSettings={defaultSettings} />);
    // Filtra apenas o input checkbox
    const quietInputs = screen.getAllByLabelText(/quiet mode/i);
    const quietCheckbox = quietInputs.find(
      (el) => (el as HTMLInputElement).type === "checkbox"
    ) as HTMLInputElement | undefined;
    expect(quietCheckbox).toBeDefined();
    expect(quietCheckbox?.checked).toBe(true);
  });

  it("campo quiet_mode_enabled inicia desmarcado quando false", () => {
    render(<DisciplinaSettingsForm initialSettings={{ ...defaultSettings, quiet_mode_enabled: false }} />);
    const quietInputs = screen.getAllByLabelText(/quiet mode/i);
    const quietCheckbox = quietInputs.find(
      (el) => (el as HTMLInputElement).type === "checkbox"
    ) as HTMLInputElement | undefined;
    expect(quietCheckbox?.checked).toBe(false);
  });
});
