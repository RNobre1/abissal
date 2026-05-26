/**
 * U.1 — Decision Zone tests
 *
 * Verifica que o componente DecisionZone:
 * - Renderiza a estrutura correta (hero + reco + momentum em ordem)
 * - Tem divisor explícito "análise técnica"
 * - Tem o data-section correto
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DecisionZone } from "@/components/fixtures/decision-zone";

describe("<DecisionZone />", () => {
  it("renderiza com data-section='decision-zone'", () => {
    const { container } = render(
      <DecisionZone
        hero={<div data-testid="hero-slot">Hero</div>}
        reco={<div data-testid="reco-slot">Reco</div>}
        momentum={<div data-testid="momentum-slot">Momentum</div>}
      />,
    );
    expect(container.querySelector("[data-section='decision-zone']")).not.toBeNull();
  });

  it("renderiza hero ANTES de reco (ordem DOM)", () => {
    const { container } = render(
      <DecisionZone
        hero={<div data-testid="hero-slot">Hero</div>}
        reco={<div data-testid="reco-slot">Reco</div>}
        momentum={<div data-testid="momentum-slot">Momentum</div>}
      />,
    );
    const zone = container.querySelector("[data-section='decision-zone']")!;
    const nodes = Array.from(zone.querySelectorAll("[data-testid]")).map(
      (el) => el.getAttribute("data-testid"),
    );
    expect(nodes.indexOf("hero-slot")).toBeLessThan(nodes.indexOf("reco-slot"));
  });

  it("renderiza reco ANTES de momentum (ordem DOM)", () => {
    const { container } = render(
      <DecisionZone
        hero={<div data-testid="hero-slot">Hero</div>}
        reco={<div data-testid="reco-slot">Reco</div>}
        momentum={<div data-testid="momentum-slot">Momentum</div>}
      />,
    );
    const zone = container.querySelector("[data-section='decision-zone']")!;
    const nodes = Array.from(zone.querySelectorAll("[data-testid]")).map(
      (el) => el.getAttribute("data-testid"),
    );
    expect(nodes.indexOf("reco-slot")).toBeLessThan(nodes.indexOf("momentum-slot"));
  });

  it("renderiza divisor com texto 'análise técnica'", () => {
    render(
      <DecisionZone
        hero={<div>Hero</div>}
        reco={<div>Reco</div>}
        momentum={<div>Momentum</div>}
      />,
    );
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.getByText(/análise técnica/i)).toBeInTheDocument();
  });

  it("momentum pode ser null (sem crash)", () => {
    expect(() =>
      render(
        <DecisionZone
          hero={<div>Hero</div>}
          reco={<div>Reco</div>}
          momentum={null}
        />,
      ),
    ).not.toThrow();
  });
});
