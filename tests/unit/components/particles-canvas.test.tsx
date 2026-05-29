/**
 * Testes unitários para ParticlesCanvas.
 *
 * happy-dom não tem canvas 2D real nem IntersectionObserver — ambos são
 * mockados antes de qualquer import do componente.
 *
 * Cobertura:
 *  - monta sem lançar erro
 *  - renderiza um <canvas> com aria-hidden
 *  - aplica a className recebida via prop
 *  - desmonta sem lançar erro (cleanup)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// ── mock IntersectionObserver ─────────────────────────────────────────────────
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

class MockIntersectionObserver {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(..._args: unknown[]) {}
  observe = mockObserve;
  unobserve = vi.fn();
  disconnect = mockDisconnect;
}

// ── mock requestAnimationFrame / cancelAnimationFrame ─────────────────────────
let rafId = 0;
const mockRaf = vi.fn(() => ++rafId);
const mockCaf = vi.fn();

// ── mock canvas getContext ────────────────────────────────────────────────────
// Retorna null para simular ambiente sem canvas 2D (happy-dom).
const mockGetContext = vi.fn(() => null);

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  vi.stubGlobal("requestAnimationFrame", mockRaf);
  vi.stubGlobal("cancelAnimationFrame", mockCaf);

  // Sobrescreve getContext em toda instância de HTMLCanvasElement criada
  // durante o teste via prototype, ANTES do render.
  HTMLCanvasElement.prototype.getContext = mockGetContext as unknown as typeof HTMLCanvasElement.prototype.getContext;

  mockObserve.mockClear();
  mockDisconnect.mockClear();
  mockRaf.mockClear();
  mockCaf.mockClear();
  mockGetContext.mockClear();
});

afterEach(cleanup);

// Importação lazy para garantir que os stubs acima estejam ativos.
async function getComponent() {
  const mod = await import("@/components/marketing/particles-canvas");
  return mod.ParticlesCanvas;
}

describe("ParticlesCanvas", () => {
  it("monta sem lançar erro mesmo com getContext retornando null", async () => {
    const ParticlesCanvas = await getComponent();
    expect(() => render(<ParticlesCanvas />)).not.toThrow();
  });

  it("renderiza um <canvas> com aria-hidden", async () => {
    const ParticlesCanvas = await getComponent();
    const { container } = render(<ParticlesCanvas />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.getAttribute("aria-hidden")).toBe("true");
  });

  it("aplica a className recebida via prop", async () => {
    const ParticlesCanvas = await getComponent();
    const { container } = render(
      <ParticlesCanvas className="absolute inset-0" />,
    );
    const canvas = container.querySelector("canvas");
    expect(canvas!.getAttribute("class")).toContain("absolute inset-0");
  });

  it("desmonta sem lançar erro (cleanup)", async () => {
    const ParticlesCanvas = await getComponent();
    const { unmount } = render(<ParticlesCanvas />);
    expect(() => unmount()).not.toThrow();
  });
});
