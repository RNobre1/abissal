/**
 * U.3 — /calibracao redesign visual components
 *
 * Testa:
 * - SummaryMetricCards: 3 cards grandes (Brier, ROI, CLV) com cor verde/vermelha
 * - ClvGauge: progress bar com bets count + CLV % + distância do target
 * - ReliabilityDiagram: SVG com pontos + diagonal y=x
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SummaryMetricCards } from "@/components/calibracao/summary-cards";
import { ClvGauge } from "@/components/calibracao/clv-gauge";
import { ReliabilityDiagram } from "@/components/calibracao/reliability-diagram";

describe("<SummaryMetricCards />", () => {
  it("renderiza 3 cards com labels Brier, ROI, CLV", () => {
    render(
      <SummaryMetricCards
        brier={{ value: 0.21, target: 0.25, label: "Brier 1X2" }}
        roi={{ value: 0.08, target: 0.0, label: "ROI" }}
        clv={{ value: 0.008, target: 0.015, label: "CLV médio" }}
      />,
    );
    expect(screen.getByText(/Brier/i)).toBeInTheDocument();
    expect(screen.getByText(/ROI/i)).toBeInTheDocument();
    expect(screen.getByText(/CLV/i)).toBeInTheDocument();
  });

  it("Brier abaixo do target com n≥30 → cor verde (badge 'ok')", () => {
    const { container } = render(
      <SummaryMetricCards
        brier={{ value: 0.21, target: 0.25, label: "Brier 1X2", n: 50 }}
        roi={{ value: 0.08, target: 0.0, label: "ROI", n: 50 }}
        clv={{ value: 0.008, target: 0.015, label: "CLV médio", n: 50 }}
      />,
    );
    const brierCard = container.querySelector("[data-metric='brier']");
    expect(brierCard).not.toBeNull();
    expect(brierCard!.getAttribute("data-status")).toBe("good");
  });

  it("Brier acima do target com n≥30 → cor vermelha (badge 'warn')", () => {
    const { container } = render(
      <SummaryMetricCards
        brier={{ value: 0.30, target: 0.25, label: "Brier 1X2", n: 50 }}
        roi={{ value: -0.05, target: 0.0, label: "ROI", n: 50 }}
        clv={{ value: -0.01, target: 0.015, label: "CLV médio", n: 50 }}
      />,
    );
    const brierCard = container.querySelector("[data-metric='brier']");
    expect(brierCard).not.toBeNull();
    expect(brierCard!.getAttribute("data-status")).toBe("warn");
  });

  it("ROI positivo com n≥30 → status good", () => {
    const { container } = render(
      <SummaryMetricCards
        brier={{ value: 0.21, target: 0.25, label: "Brier 1X2", n: 50 }}
        roi={{ value: 0.08, target: 0.0, label: "ROI", n: 50 }}
        clv={{ value: 0.008, target: 0.015, label: "CLV médio", n: 50 }}
      />,
    );
    const roiCard = container.querySelector("[data-metric='roi']");
    expect(roiCard!.getAttribute("data-status")).toBe("good");
  });

  it("valores nulos renderizam '—'", () => {
    render(
      <SummaryMetricCards
        brier={{ value: null, target: 0.25, label: "Brier 1X2" }}
        roi={{ value: null, target: 0.0, label: "ROI" }}
        clv={{ value: null, target: 0.015, label: "CLV médio" }}
      />,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });
});

describe("<ClvGauge />", () => {
  it("renderiza contagem de bets e CLV%", () => {
    const { container } = render(
      <ClvGauge
        betCount={186}
        targetCount={300}
        clvPct={0.8}
        targetClvPct={1.5}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("186");
    expect(text).toContain("300");
    // CLV como % — clvPct=0.8 → componente exibe (0.8*100).toFixed(1) = "+80.0%"
    expect(text).toMatch(/80\.0%|80,0%/);
  });

  it("renderiza progress bar com data-gauge", () => {
    const { container } = render(
      <ClvGauge
        betCount={150}
        targetCount={300}
        clvPct={1.2}
        targetClvPct={1.5}
      />,
    );
    expect(container.querySelector("[data-gauge]")).not.toBeNull();
  });

  it("quando betCount=0, não quebra", () => {
    expect(() =>
      render(
        <ClvGauge betCount={0} targetCount={300} clvPct={0} targetClvPct={1.5} />,
      ),
    ).not.toThrow();
  });
});

describe("<ReliabilityDiagram />", () => {
  const BINS = [
    { range: [0, 0.2] as [number, number], n: 10, predictedAvg: 0.1, observedFreq: 0.12 },
    { range: [0.2, 0.4] as [number, number], n: 15, predictedAvg: 0.3, observedFreq: 0.28 },
    { range: [0.4, 0.6] as [number, number], n: 20, predictedAvg: 0.5, observedFreq: 0.52 },
    { range: [0.6, 0.8] as [number, number], n: 12, predictedAvg: 0.7, observedFreq: 0.68 },
    { range: [0.8, 1.0] as [number, number], n: 8, predictedAvg: 0.9, observedFreq: 0.88 },
  ];

  it("renderiza SVG com viewBox", () => {
    const { container } = render(
      <ReliabilityDiagram bins={BINS} labelMetric="vitória mandante" />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("viewBox")).toBeTruthy();
  });

  it("renderiza a diagonal y=x (data-diagonal)", () => {
    const { container } = render(
      <ReliabilityDiagram bins={BINS} labelMetric="vitória mandante" />,
    );
    expect(container.querySelector("[data-diagonal]")).not.toBeNull();
  });

  it("renderiza N pontos correspondentes aos bins não-vazios", () => {
    const { container } = render(
      <ReliabilityDiagram bins={BINS} labelMetric="vitória mandante" />,
    );
    const dots = container.querySelectorAll("[data-reliability-dot]");
    expect(dots.length).toBe(BINS.filter((b) => b.n > 0).length);
  });

  it("empty state quando todos os bins têm n=0", () => {
    const emptyBins = BINS.map((b) => ({ ...b, n: 0, predictedAvg: null, observedFreq: null }));
    render(
      <ReliabilityDiagram bins={emptyBins} labelMetric="vitória mandante" />,
    );
    expect(screen.getByText(/sem dados/i)).toBeInTheDocument();
  });

  it("label da métrica é exibida", () => {
    render(
      <ReliabilityDiagram bins={BINS} labelMetric="vitória mandante" />,
    );
    expect(screen.getByText(/vitória mandante/i)).toBeInTheDocument();
  });
});
