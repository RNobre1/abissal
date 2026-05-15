import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

// Mock lightweight-charts — happy-dom has no real canvas / WebGL.
// `vi.hoisted` puts the mock vars *above* the auto-hoisted `vi.mock`.
const mocks = vi.hoisted(() => {
  const setData = vi.fn();
  const addLineSeries = vi.fn(() => ({ setData }));
  const remove = vi.fn();
  const fitContent = vi.fn();
  const applyOptions = vi.fn();
  const createChart = vi.fn(() => ({
    addLineSeries,
    remove,
    applyOptions,
    timeScale: () => ({ fitContent }),
  }));
  return { setData, addLineSeries, remove, fitContent, applyOptions, createChart };
});

vi.mock("lightweight-charts", () => ({
  createChart: mocks.createChart,
}));

const setDataMock = mocks.setData;
const addLineSeriesMock = mocks.addLineSeries;
const removeMock = mocks.remove;
const createChartMock = mocks.createChart;
const fitContentMock = mocks.fitContent;

import { MomentumChart } from "@/components/fixtures/stats/panels/momentum-chart";

const homeSeries = [
  { time: "2026-05-01", value: 1.2 },
  { time: "2026-05-05", value: 1.6 },
  { time: "2026-05-10", value: 2.0 },
];
const awaySeries = [
  { time: "2026-05-01", value: 0.8 },
  { time: "2026-05-05", value: 1.0 },
  { time: "2026-05-10", value: 1.5 },
];

describe("<MomentumChart />", () => {
  beforeEach(() => {
    setDataMock.mockClear();
    addLineSeriesMock.mockClear();
    removeMock.mockClear();
    createChartMock.mockClear();
    fitContentMock.mockClear();
  });

  it("creates a chart with two line series after mount", () => {
    render(
      <MomentumChart
        homeTeam="Tottenham"
        awayTeam="Leeds"
        home={homeSeries}
        away={awaySeries}
      />,
    );
    expect(createChartMock).toHaveBeenCalledTimes(1);
    expect(addLineSeriesMock).toHaveBeenCalledTimes(2);
    // Each series gets its own setData call.
    expect(setDataMock).toHaveBeenCalledTimes(2);
  });

  it("renders 'sem dados' fallback when both series are empty", () => {
    const { getByText } = render(
      <MomentumChart
        homeTeam="A"
        awayTeam="B"
        home={[]}
        away={[]}
      />,
    );
    expect(getByText(/sem dados/i)).toBeDefined();
    // No chart instantiated when both series empty.
    expect(createChartMock).not.toHaveBeenCalled();
  });

  it("cleans up chart on unmount", () => {
    const { unmount } = render(
      <MomentumChart
        homeTeam="A"
        awayTeam="B"
        home={homeSeries}
        away={awaySeries}
      />,
    );
    unmount();
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it("renders a team legend with both team names", () => {
    const { container } = render(
      <MomentumChart
        homeTeam="Tottenham"
        awayTeam="Leeds"
        home={homeSeries}
        away={awaySeries}
      />,
    );
    expect(container.querySelector("[data-team-legend]")).not.toBeNull();
    expect(screen.getByText("Tottenham")).toBeInTheDocument();
    expect(screen.getByText("Leeds")).toBeInTheDocument();
  });

  it("renders a numeric Y axis tick from the value domain", () => {
    render(
      <MomentumChart
        homeTeam="Tottenham"
        awayTeam="Leeds"
        home={homeSeries}
        away={awaySeries}
      />,
    );
    // max value across series = 2.0 → ChartFrame Y tick "2" present.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("does not leak: unmount runs even when only one side has data", () => {
    const { unmount } = render(
      <MomentumChart
        homeTeam="A"
        awayTeam="B"
        home={homeSeries}
        away={[]}
      />,
    );
    expect(createChartMock).toHaveBeenCalledTimes(1);
    unmount();
    expect(removeMock).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
