/**
 * TDD — Parte D: rename "fixtures" → "jogos" + safe-area mobile nav
 *
 * (D1) MobileBottomNav: label do tab /fixtures deve ser "jogos" (não "fixtures").
 * (D2) MobileBottomNav: o <nav> deve conter pb-[env(safe-area-inset-bottom,0px)]
 *      em sua className para suporte a iPhone notch/home bar.
 */
import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import React from "react";

// usePathname mock para evitar runtime error
import { vi } from "vitest";
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { MobileBottomNav } from "@/components/mobile-bottom-nav";

describe("MobileBottomNav — rename + safe-area (Parte D)", () => {
  it('label do link /fixtures é "jogos" (não "fixtures")', () => {
    const { container } = render(React.createElement(MobileBottomNav));
    const nav = container.querySelector('nav[aria-label="Navegação principal"]');
    expect(nav).not.toBeNull();

    // Não deve ter o texto literal "fixtures" nos labels primários
    const labels = Array.from(nav!.querySelectorAll(".label")).map(
      (el) => el.textContent,
    );
    expect(labels).not.toContain("fixtures");
    expect(labels).toContain("jogos");
  });

  it("o <nav> contém safe-area-inset-bottom na className", () => {
    const { container } = render(React.createElement(MobileBottomNav));
    const nav = container.querySelector('nav[aria-label="Navegação principal"]');
    expect(nav).not.toBeNull();
    expect(nav!.className).toContain("safe-area-inset-bottom");
  });
});
