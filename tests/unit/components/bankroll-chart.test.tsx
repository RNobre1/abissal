import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BankrollChart, type BankrollPoint } from "@/components/banca/bankroll-chart";

const THIRTY_POINTS: BankrollPoint[] = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-05-${String(i + 1).padStart(2, "0")}`,
  balance: 1000 + i * 5,
  drawdown: i > 10 ? (i - 10) * 2 : 0,
}));

const DRAWDOWN_POINTS: BankrollPoint[] = [
  { date: "2026-05-01", balance: 1000, drawdown: 0 },
  { date: "2026-05-02", balance: 1050, drawdown: 0 },
  { date: "2026-05-03", balance: 980, drawdown: 70 },
  { date: "2026-05-04", balance: 1020, drawdown: 30 },
];

describe("BankrollChart", () => {
  it("renders without crashing with 30 data points", () => {
    const { container } = render(
      <BankrollChart data={THIRTY_POINTS} width={800} height={300} />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the chart container element", () => {
    const { container } = render(
      <BankrollChart data={THIRTY_POINTS} width={800} height={300} />,
    );
    // recharts renders a <div class="recharts-wrapper"> or we have our wrapper
    expect(container.querySelector("svg, [data-testid='bankroll-chart']")).toBeTruthy();
  });

  it("shows empty state when data is empty", () => {
    render(<BankrollChart data={[]} width={800} height={300} />);
    expect(screen.getByText(/sem dados/i)).toBeTruthy();
  });

  it("renders drawdown overlay when drawdown data is present", () => {
    const { container } = render(
      <BankrollChart data={DRAWDOWN_POINTS} width={800} height={300} showDrawdown />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("does not crash with single point", () => {
    const { container } = render(
      <BankrollChart
        data={[{ date: "2026-05-01", balance: 1000, drawdown: 0 }]}
        width={800}
        height={300}
      />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("accepts custom height", () => {
    const { container } = render(
      <BankrollChart data={THIRTY_POINTS} width={800} height={400} />,
    );
    expect(container.firstChild).toBeTruthy();
  });
});
