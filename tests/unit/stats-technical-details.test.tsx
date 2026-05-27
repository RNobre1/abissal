/**
 * TDD — Parte C: painéis técnicos wrapped em <details>
 *
 * Garante que StatsLayoutResponsive no modo desktop envolve os painéis técnicos
 * dentro de um elemento <details> recolhido por default, com <summary> legível.
 *
 * Contexto: painéis de decisão (SIM) ficam fora do <details>;
 * os demais 13+ painéis ficam dentro — reduz cognitive overload.
 */
import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { StatsLayoutResponsive } from "@/components/fixtures/stats/stats-layout-responsive";
import type { PanelSlot } from "@/components/fixtures/stats/stats-layout";
import React from "react";

// Simula os painéis de decisão + técnicos como page.tsx os passa
const DECISION_PANELS: PanelSlot[] = [
  { id: "SIM", node: React.createElement("div", null, "sim") },
];

const TECHNICAL_PANELS: PanelSlot[] = [
  { id: "A-home", node: React.createElement("div", null, "team home") },
  { id: "A-away", node: React.createElement("div", null, "team away") },
  { id: "D", node: React.createElement("div", null, "h2h") },
  { id: "E", node: React.createElement("div", null, "splits") },
  { id: "M", node: React.createElement("div", null, "distributions") },
  { id: "K", node: React.createElement("div", null, "radar") },
  { id: "L", node: React.createElement("div", null, "scatter") },
  { id: "I", node: React.createElement("div", null, "referee") },
  { id: "J", node: React.createElement("div", null, "predictions") },
  { id: "N", node: React.createElement("div", null, "insights") },
  { id: "F", node: React.createElement("div", null, "streaks") },
  { id: "G+", node: React.createElement("div", null, "players") },
  { id: "H", node: React.createElement("div", null, "markets") },
  { id: "C-home", node: React.createElement("div", null, "recent home") },
  { id: "C-away", node: React.createElement("div", null, "recent away") },
];

const ALL_PANELS = [...DECISION_PANELS, ...TECHNICAL_PANELS];

describe("StatsLayoutResponsive — <details> para painéis técnicos (desktop)", () => {
  it("renderiza um elemento <details> não aberto por default", () => {
    const { container } = render(
      React.createElement(StatsLayoutResponsive, { panels: ALL_PANELS }),
    );
    const details = container.querySelector("details[data-technical-panels]");
    expect(details).not.toBeNull();
    // Por default open não está presente (recolhido)
    expect(details).not.toHaveAttribute("open");
  });

  it("o <summary> contém o texto 'análise técnica'", () => {
    const { container } = render(
      React.createElement(StatsLayoutResponsive, { panels: ALL_PANELS }),
    );
    const summary = container.querySelector(
      "details[data-technical-panels] > summary",
    );
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toMatch(/análise técnica/i);
  });

  it("os painéis técnicos ficam dentro do <details>", () => {
    const { container } = render(
      React.createElement(StatsLayoutResponsive, { panels: ALL_PANELS }),
    );
    const details = container.querySelector("details[data-technical-panels]");
    // Pelo menos um painel técnico (A-home) deve existir dentro do details
    const techPanel = details?.querySelector("[data-panel='A-home']");
    expect(techPanel).not.toBeNull();
  });

  it("renderiza 0 painéis sem o wrapper <details> quando a lista é vazia", () => {
    const { container } = render(
      React.createElement(StatsLayoutResponsive, { panels: [] }),
    );
    expect(container.querySelector("details[data-technical-panels]")).toBeNull();
  });
});
