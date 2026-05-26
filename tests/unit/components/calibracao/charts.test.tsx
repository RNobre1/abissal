/**
 * C — 3 charts MVP tests (TDD)
 *
 * Testa renderização básica de cada chart:
 * - BrierTimeChart: recharts LineChart, ponto de dados, empty state
 * - RoiCumulativeChart: linha cumulativa, referenceLine y=0, empty state
 * - ConfidenceBarsChart: barras por confidence, ROI label, n label
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock recharts pois Happy DOM não suporta SVG real do recharts
vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Line: () => <div data-testid="recharts-line" />,
  Bar: ({ dataKey }: { dataKey: string }) => <div data-testid="recharts-bar" data-key={dataKey} />,
  Area: () => <div data-testid="recharts-area" />,
  XAxis: () => <div data-testid="recharts-xaxis" />,
  YAxis: () => <div data-testid="recharts-yaxis" />,
  CartesianGrid: () => <div data-testid="recharts-grid" />,
  Tooltip: () => <div data-testid="recharts-tooltip" />,
  ReferenceLine: ({ y }: { y: number }) => <div data-testid="recharts-refline" data-y={y} />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="recharts-container">{children}</div>
  ),
  Cell: () => <div data-testid="recharts-cell" />,
}));

import { BrierTimeChart, type BrierTimeBucket } from "@/components/calibracao/brier-time-chart";
import { RoiCumulativeChart, type RoiBet } from "@/components/calibracao/roi-cumulative-chart";
import { ConfidenceBarsChart, type ConfidenceSummary } from "@/components/calibracao/confidence-bars";

const BRIER_BUCKETS: BrierTimeBucket[] = [
  { bucket: "2026-W20", n: 12, brier1x2: 0.22, brierOver: 0.19 },
  { bucket: "2026-W21", n: 18, brier1x2: 0.20, brierOver: 0.18 },
  { bucket: "2026-W22", n: 15, brier1x2: 0.24, brierOver: 0.21 },
];

const ROI_BETS: RoiBet[] = [
  { id: "1", placedAt: "2026-05-01", plUnits: 0.5 },
  { id: "2", placedAt: "2026-05-03", plUnits: -0.3 },
  { id: "3", placedAt: "2026-05-07", plUnits: 0.8 },
];

const CONFIDENCE_ROWS: ConfidenceSummary[] = [
  { confidence: "alto", n: 40, roiPct: 8.5, icLo: 2, icHi: 15 },
  { confidence: "medio", n: 30, roiPct: 1.2, icLo: -2, icHi: 4 },
  { confidence: "baixo", n: 20, roiPct: -3.0, icLo: -8, icHi: 2 },
];

describe("<BrierTimeChart />", () => {
  it("renderiza sem crashes com dados válidos", () => {
    expect(() =>
      render(<BrierTimeChart data={BRIER_BUCKETS} />),
    ).not.toThrow();
  });

  it("renderiza recharts container", () => {
    render(<BrierTimeChart data={BRIER_BUCKETS} />);
    expect(screen.getByTestId("recharts-container")).toBeInTheDocument();
  });

  it("empty state quando data=[]", () => {
    render(<BrierTimeChart data={[]} />);
    expect(screen.getByText(/sem buckets|sem dados/i)).toBeInTheDocument();
  });

  it("mantém peer-link para tabela de dados", () => {
    render(<BrierTimeChart data={BRIER_BUCKETS} />);
    const link = screen.getByRole("link", { name: /tabela de dados|ver dados/i });
    expect(link).toBeInTheDocument();
  });
});

describe("<RoiCumulativeChart />", () => {
  it("renderiza sem crashes com dados válidos", () => {
    expect(() =>
      render(<RoiCumulativeChart bets={ROI_BETS} />),
    ).not.toThrow();
  });

  it("renderiza recharts container", () => {
    render(<RoiCumulativeChart bets={ROI_BETS} />);
    expect(screen.getByTestId("recharts-container")).toBeInTheDocument();
  });

  it("inclui referenceLine em y=0", () => {
    render(<RoiCumulativeChart bets={ROI_BETS} />);
    const refLine = screen.getByTestId("recharts-refline");
    expect(refLine.getAttribute("data-y")).toBe("0");
  });

  it("empty state quando bets=[]", () => {
    render(<RoiCumulativeChart bets={[]} />);
    expect(screen.getByText(/sem apostas|sem dados/i)).toBeInTheDocument();
  });
});

describe("<ConfidenceBarsChart />", () => {
  it("renderiza sem crashes com dados válidos", () => {
    expect(() =>
      render(<ConfidenceBarsChart data={CONFIDENCE_ROWS} />),
    ).not.toThrow();
  });

  it("renderiza recharts container", () => {
    render(<ConfidenceBarsChart data={CONFIDENCE_ROWS} />);
    expect(screen.getByTestId("recharts-container")).toBeInTheDocument();
  });

  it("exibe n= para cada nível de confidence", () => {
    render(<ConfidenceBarsChart data={CONFIDENCE_ROWS} />);
    expect(screen.getByText(/n=40/i)).toBeInTheDocument();
    expect(screen.getByText(/n=30/i)).toBeInTheDocument();
    expect(screen.getByText(/n=20/i)).toBeInTheDocument();
  });

  it("empty state quando data=[]", () => {
    render(<ConfidenceBarsChart data={[]} />);
    expect(screen.getByText(/sem dados/i)).toBeInTheDocument();
  });
});
