/**
 * Tests for FeedbackButtons — useOptimistic behavior (Wave C).
 *
 * Verifies:
 *   1. Optimistic update: clicking a button immediately sets aria-pressed=true
 *      BEFORE the fetch resolves (instant visual feedback).
 *   2. Rollback: when the fetch fails, aria-pressed reverts to false.
 *   3. Commit: when the fetch succeeds, aria-pressed stays true.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { FeedbackButtons } from "@/app/(dashboard)/fixtures/[id]/_components/feedback-buttons";

// Router mock — FeedbackButtons calls router.refresh() on success.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fetchButton(container: HTMLElement, decision: string): HTMLButtonElement {
  const btn = container.querySelector(
    `[data-feedback-button="${decision}"]`,
  ) as HTMLButtonElement | null;
  if (!btn) throw new Error(`button ${decision} not found`);
  return btn;
}

describe("FeedbackButtons — useOptimistic", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(""),
        } as Response),
      ),
    );
  });

  it("shows optimistic saved state immediately on click (before fetch resolves)", async () => {
    // Arrange: block fetch until we explicitly resolve it.
    let resolveFetch!: () => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = () =>
        resolve({ ok: true, text: () => Promise.resolve("") } as Response);
    });
    vi.stubGlobal("fetch", vi.fn(() => fetchPromise));

    const { container } = render(
      <FeedbackButtons aiRecommendationId={42} />,
    );

    const agreeBtn = fetchButton(container, "agree");
    expect(agreeBtn.getAttribute("aria-pressed")).toBe("false");

    // Act: click — useOptimistic should flip immediately.
    act(() => {
      fireEvent.click(agreeBtn);
    });

    // Assert: optimistic update visible before fetch completes.
    expect(agreeBtn.getAttribute("aria-pressed")).toBe("true");

    // Cleanup: resolve the pending fetch.
    act(() => {
      resolveFetch();
    });
    await waitFor(() => {
      expect(agreeBtn.getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("rolls back optimistic state when fetch fails (network error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network error"))),
    );

    const { container } = render(
      <FeedbackButtons aiRecommendationId={42} />,
    );

    const disagreeBtn = fetchButton(container, "disagree");
    expect(disagreeBtn.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      fireEvent.click(disagreeBtn);
    });

    // Optimistic: pressed immediately.
    expect(disagreeBtn.getAttribute("aria-pressed")).toBe("true");

    // After rejection: should roll back to false.
    await waitFor(() => {
      expect(disagreeBtn.getAttribute("aria-pressed")).toBe("false");
    });
  });

  it("rolls back when fetch returns non-ok status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve("server error"),
        } as Response),
      ),
    );

    const { container } = render(
      <FeedbackButtons aiRecommendationId={42} />,
    );

    const noBtn = fetchButton(container, "no_bet");
    act(() => { fireEvent.click(noBtn); });

    // Optimistic: pressed immediately.
    expect(noBtn.getAttribute("aria-pressed")).toBe("true");

    // After non-ok: rolls back.
    await waitFor(() => {
      expect(noBtn.getAttribute("aria-pressed")).toBe("false");
    });
  });

  it("confirms saved state on success (aria-pressed stays true)", async () => {
    const { container } = render(
      <FeedbackButtons aiRecommendationId={42} />,
    );

    const betBtn = fetchButton(container, "bet");
    act(() => { fireEvent.click(betBtn); });

    await waitFor(() => {
      expect(betBtn.getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("existingDecisions marca botões como já salvos (aria-pressed=true inicial)", () => {
    const { container } = render(
      <FeedbackButtons
        aiRecommendationId={42}
        existingDecisions={["agree", "bet"]}
      />,
    );

    expect(fetchButton(container, "agree").getAttribute("aria-pressed")).toBe("true");
    expect(fetchButton(container, "bet").getAttribute("aria-pressed")).toBe("true");
    expect(fetchButton(container, "disagree").getAttribute("aria-pressed")).toBe("false");
  });
});
