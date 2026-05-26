/**
 * B.2 — SummaryMetricCards IC95% integration tests (TDD)
 *
 * Testa:
 * - Com n ≥ 30, card exibe IC95%
 * - Com n < 30, card exibe badge "⚠ amostra pequena"
 * - Cor verde/vermelho SÓ ativa quando n ≥ 30
 * - ReliabilityDiagram: Wilson bar dominante (strokeOpacity=0.75) e círculos abertos (n_bin <30)
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SummaryMetricCards } from "@/components/calibracao/summary-cards";
import { ReliabilityDiagram } from "@/components/calibracao/reliability-diagram";

describe("<SummaryMetricCards /> com IC95%", () => {
  it("n≥30 → exibe IC95% abaixo do número principal", () => {
    render(
      <SummaryMetricCards
        brier={{ value: 0.22, target: 0.25, label: "Brier", n: 50 }}
        roi={{ value: 0.05, target: 0.0, label: "ROI", n: 50 }}
        clv={{ value: 0.012, target: 0.015, label: "CLV", n: 50 }}
      />,
    );
    // Deve exibir algum IC95% — pelo menos "IC" ou "n=50"
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/IC 95%|IC95%|n=50/i);
  });

  it("n<30 → exibe badge amostra pequena", () => {
    render(
      <SummaryMetricCards
        brier={{ value: 0.22, target: 0.25, label: "Brier", n: 12 }}
        roi={{ value: 0.05, target: 0.0, label: "ROI", n: 12 }}
        clv={{ value: 0.012, target: 0.015, label: "CLV", n: 12 }}
      />,
    );
    const badges = screen.getAllByText(/amostra pequena|⚠/i);
    expect(badges.length).toBeGreaterThan(0);
  });

  it("n<30 Brier → cor neutra (data-status=neutral)", () => {
    const { container } = render(
      <SummaryMetricCards
        brier={{ value: 0.22, target: 0.25, label: "Brier", n: 12 }}
        roi={{ value: 0.05, target: 0.0, label: "ROI", n: 50 }}
        clv={{ value: 0.012, target: 0.015, label: "CLV", n: 50 }}
      />,
    );
    const brierCard = container.querySelector("[data-metric='brier']");
    expect(brierCard?.getAttribute("data-status")).toBe("neutral");
  });

  it("n≥30 Brier abaixo target → cor verde", () => {
    const { container } = render(
      <SummaryMetricCards
        brier={{ value: 0.22, target: 0.25, label: "Brier", n: 50 }}
        roi={{ value: 0.05, target: 0.0, label: "ROI", n: 50 }}
        clv={{ value: 0.012, target: 0.015, label: "CLV", n: 50 }}
      />,
    );
    const brierCard = container.querySelector("[data-metric='brier']");
    expect(brierCard?.getAttribute("data-status")).toBe("good");
  });

  it("n omitido → fallback neutro (não quebra)", () => {
    expect(() =>
      render(
        <SummaryMetricCards
          brier={{ value: 0.22, target: 0.25, label: "Brier" }}
          roi={{ value: 0.05, target: 0.0, label: "ROI" }}
          clv={{ value: 0.012, target: 0.015, label: "CLV" }}
        />,
      ),
    ).not.toThrow();
  });
});

describe("<ReliabilityDiagram /> com Wilson dominante", () => {
  const BINS_HIGH_N = [
    { range: [0, 0.2] as [number, number], n: 35, predictedAvg: 0.1, observedFreq: 0.12 },
    { range: [0.2, 0.4] as [number, number], n: 40, predictedAvg: 0.3, observedFreq: 0.28 },
  ];

  const BINS_LOW_N = [
    { range: [0, 0.2] as [number, number], n: 10, predictedAvg: 0.1, observedFreq: 0.12 },
    { range: [0.2, 0.4] as [number, number], n: 5, predictedAvg: 0.3, observedFreq: 0.28 },
  ];

  it("Wilson bars têm strokeOpacity=0.75 (dominante)", () => {
    const { container } = render(
      <ReliabilityDiagram bins={BINS_HIGH_N} labelMetric="vitória mandante" />,
    );
    const ciLines = container.querySelectorAll("[data-ci-bar]");
    expect(ciLines.length).toBeGreaterThan(0);
    // Verifica que pelo menos uma bar tem strokeOpacity 0.75
    const hasHighOpacity = Array.from(ciLines).some(
      (el) => el.getAttribute("stroke-opacity") === "0.75",
    );
    expect(hasHighOpacity).toBe(true);
  });

  it("bins n<30 → círculos abertos (fill=none)", () => {
    const { container } = render(
      <ReliabilityDiagram bins={BINS_LOW_N} labelMetric="vitória mandante" />,
    );
    const dots = container.querySelectorAll("[data-reliability-dot]");
    const hasOpenCircle = Array.from(dots).some(
      (el) => el.getAttribute("fill") === "none",
    );
    expect(hasOpenCircle).toBe(true);
  });

  it("bins n≥30 → círculos preenchidos", () => {
    const { container } = render(
      <ReliabilityDiagram bins={BINS_HIGH_N} labelMetric="vitória mandante" />,
    );
    const dots = container.querySelectorAll("[data-reliability-dot]");
    const allFilled = Array.from(dots).every(
      (el) => el.getAttribute("fill") !== "none",
    );
    expect(allFilled).toBe(true);
  });
});
