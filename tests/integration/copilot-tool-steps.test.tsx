import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CopilotToolSteps } from "@/components/fixtures/copilot-tool-steps";
import { CopilotFab } from "@/components/fixtures/copilot-fab";

describe("CopilotToolSteps", () => {
  it("renders one chip per hop with name + summary and a success mark", () => {
    render(
      <CopilotToolSteps
        hops={[
          { tool: "scan_fixtures", args: {}, result_summary: "scan_fixtures: 3/12 (2026-05-16)", took_ms: 10 },
          { tool: "inspect_fixture", args: {}, result_summary: "get_referee: ok", took_ms: 5 },
        ]}
      />,
    );
    expect(screen.getByText("scan_fixtures")).toBeTruthy();
    expect(screen.getByText(/3\/12/)).toBeTruthy();
    expect(screen.getAllByText("✓").length).toBe(2);
    expect(screen.getAllByText("ok").length).toBe(2);
  });

  it("marks a hop whose result_summary starts with error: as failed", () => {
    render(
      <CopilotToolSteps
        hops={[{ tool: "scan_fixtures", args: {}, result_summary: "error: campo inválido: x", took_ms: 1 }]}
      />,
    );
    expect(screen.getByText("✗")).toBeTruthy();
    expect(screen.getByText("falhou")).toBeTruthy();
    expect(screen.getByText(/campo inválido/)).toBeTruthy();
  });

  it("renders nothing when there are no hops", () => {
    const { container } = render(<CopilotToolSteps hops={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("CopilotFab wiring", () => {
  it("composes with CopilotToolSteps without throwing", () => {
    const { container } = render(<CopilotFab date="today" />);
    expect(container.firstChild).not.toBeNull();
  });
});
