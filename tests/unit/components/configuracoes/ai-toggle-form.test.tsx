/**
 * Tests for AiToggleForm — kill switch global de IA.
 *
 * Verifica: render reflete o estado inicial (on/off), clicar chama a Server
 * Action com o valor invertido e atualiza o estado, e erro da action mostra
 * alerta sem mudar o estado.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AiToggleForm } from "@/app/(dashboard)/configuracoes/ia/_components/ai-toggle-form";

const mockSetAiEnabledAction =
  vi.fn<(enabled: boolean) => Promise<{ success?: boolean; error?: string; enabled?: boolean }>>();

vi.mock("@/app/(dashboard)/configuracoes/ia/actions", () => ({
  setAiEnabledAction: (enabled: boolean) => mockSetAiEnabledAction(enabled),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function state(container: HTMLElement): string | null {
  return container.querySelector("[data-ai-state]")?.getAttribute("data-ai-state") ?? null;
}
function toggleButton(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector("[data-testid='ai-toggle'] button") as HTMLButtonElement | null;
  if (!btn) throw new Error("toggle button not found");
  return btn;
}

describe("AiToggleForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ligado: mostra 'IA ativa' e botão 'desativar IA'", () => {
    const { container } = render(<AiToggleForm initialEnabled={true} />);
    expect(state(container)).toBe("on");
    expect(container.querySelector("[data-ai-state]")?.textContent).toBe("IA ativa");
    expect(toggleButton(container).textContent).toMatch(/desativar IA/i);
  });

  it("desligado: mostra 'IA desativada' e botão 'ativar IA'", () => {
    const { container } = render(<AiToggleForm initialEnabled={false} />);
    expect(state(container)).toBe("off");
    expect(container.querySelector("[data-ai-state]")?.textContent).toBe("IA desativada");
    expect(toggleButton(container).textContent).toMatch(/ativar IA/i);
  });

  it("clicar desativar chama a action com false e reflete o novo estado", async () => {
    mockSetAiEnabledAction.mockResolvedValue({ success: true, enabled: false });
    const { container } = render(<AiToggleForm initialEnabled={true} />);
    fireEvent.click(toggleButton(container));
    await waitFor(() => {
      expect(mockSetAiEnabledAction).toHaveBeenCalledWith(false);
      expect(state(container)).toBe("off");
    });
  });

  it("erro na action mostra alerta e mantém o estado anterior", async () => {
    mockSetAiEnabledAction.mockResolvedValue({ error: "Não autenticado." });
    const { container } = render(<AiToggleForm initialEnabled={true} />);
    fireEvent.click(toggleButton(container));
    await waitFor(() => {
      const alert = container.querySelector("[role='alert']");
      expect(alert?.textContent).toContain("Não autenticado.");
      expect(state(container)).toBe("on");
    });
  });
});
