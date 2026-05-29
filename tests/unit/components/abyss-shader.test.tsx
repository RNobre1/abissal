/**
 * AbyssShader — testes em happy-dom (sem WebGL disponível).
 *
 * Em happy-dom `canvas.getContext("webgl2"|"webgl")` retorna null,
 * então o componente SEMPRE cai no fallback CSS. Verificamos:
 * 1. Monta sem lançar erro.
 * 2. Renderiza o container de fallback (div com aria-hidden + gradiente CSS).
 * 3. Não há canvas WebGL no DOM.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

// ── IntersectionObserver mock ─────────────────────────────────────────────────
// happy-dom pode não ter IntersectionObserver; garantimos que existe.

class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(..._args: unknown[]) {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── Testes ────────────────────────────────────────────────────────────────────

describe("AbyssShader — fallback em happy-dom (sem WebGL)", () => {
  it("monta sem lançar erro", async () => {
    const { AbyssShader } = await import("@/components/marketing/abyss-shader");
    expect(() => render(<AbyssShader />)).not.toThrow();
  });

  it("renderiza um div decorativo com aria-hidden", async () => {
    const { AbyssShader } = await import("@/components/marketing/abyss-shader");
    const { container } = render(<AbyssShader />);

    // Deve existir pelo menos um elemento com aria-hidden no fallback
    const hiddenEl = container.querySelector("[aria-hidden]");
    expect(hiddenEl).not.toBeNull();
  });

  it("o fallback é um <div> (não um <canvas>)", async () => {
    const { AbyssShader } = await import("@/components/marketing/abyss-shader");
    const { container } = render(<AbyssShader />);

    // Sem WebGL, não deve haver nenhum canvas no DOM
    const canvas = container.querySelector("canvas");
    expect(canvas).toBeNull();

    // O elemento decorativo deve ser uma div
    const hiddenEl = container.querySelector("[aria-hidden]");
    expect(hiddenEl?.tagName.toLowerCase()).toBe("div");
  });

  it("aceita e aplica className extra", async () => {
    const { AbyssShader } = await import("@/components/marketing/abyss-shader");
    const { container } = render(<AbyssShader className="absolute inset-0" />);

    const hiddenEl = container.querySelector("[aria-hidden]");
    expect(hiddenEl?.className).toContain("absolute");
    expect(hiddenEl?.className).toContain("inset-0");
  });

  it("fallback tem pointer-events-none (não intercepta cliques)", async () => {
    const { AbyssShader } = await import("@/components/marketing/abyss-shader");
    const { container } = render(<AbyssShader />);

    const hiddenEl = container.querySelector("[aria-hidden]");
    expect(hiddenEl?.className).toContain("pointer-events-none");
  });
});
