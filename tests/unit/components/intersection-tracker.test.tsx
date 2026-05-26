/**
 * Tests for `IntersectionTracker` component — debounce 2 s, threshold 0.5,
 * fires `panel_view` event via useTelemetry when panel is visible.
 *
 * We mock IntersectionObserver to control visibility triggers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Mock useTelemetry
// ─────────────────────────────────────────────────────────────────────────────

const mockTrack = vi.fn();
vi.mock("@/lib/telemetry/use-telemetry", () => ({
  useTelemetry: () => mockTrack,
}));

// ─────────────────────────────────────────────────────────────────────────────
// IntersectionObserver mock
// ─────────────────────────────────────────────────────────────────────────────

type IOCallback = (entries: IntersectionObserverEntry[]) => void;

let capturedCallback: IOCallback | null = null;
let capturedOptions: IntersectionObserverInit | undefined;

const mockObserve = vi.fn();
const mockDisconnect = vi.fn();
const mockUnobserve = vi.fn();

class MockIntersectionObserver {
  constructor(callback: IOCallback, options?: IntersectionObserverInit) {
    capturedCallback = callback;
    capturedOptions = options;
  }
  observe = mockObserve;
  unobserve = mockUnobserve;
  disconnect = mockDisconnect;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  capturedCallback = null;
  capturedOptions = undefined;
  mockObserve.mockClear();
  mockDisconnect.mockClear();
  mockUnobserve.mockClear();
  mockTrack.mockClear();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeEntry(isIntersecting: boolean): IntersectionObserverEntry {
  return {
    isIntersecting,
    intersectionRatio: isIntersecting ? 0.6 : 0.0,
    target: document.createElement("div"),
    boundingClientRect: {} as DOMRectReadOnly,
    intersectionRect: {} as DOMRectReadOnly,
    rootBounds: null,
    time: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

async function getComponent() {
  const mod = await import(
    "@/lib/telemetry/intersection-tracker"
  );
  return mod.IntersectionTracker;
}

describe("IntersectionTracker — mounting", () => {
  it("renders children", async () => {
    const IntersectionTracker = await getComponent();
    const { getByText } = render(
      <IntersectionTracker panelId="A-home">
        <span>panel content</span>
      </IntersectionTracker>,
    );
    expect(getByText("panel content")).toBeTruthy();
  });

  it("attaches an IntersectionObserver with threshold 0.5", async () => {
    const IntersectionTracker = await getComponent();
    render(
      <IntersectionTracker panelId="A-home">
        <div />
      </IntersectionTracker>,
    );
    expect(mockObserve).toHaveBeenCalledTimes(1);
    // threshold can be a number or an array — both are valid IntersectionObserver API
    const threshold = capturedOptions?.threshold;
    const thresholdValue = Array.isArray(threshold) ? threshold[0] : threshold;
    expect(thresholdValue).toBe(0.5);
  });
});

describe("IntersectionTracker — debounce 2 s", () => {
  it("does NOT call track immediately on intersection", async () => {
    const IntersectionTracker = await getComponent();
    render(
      <IntersectionTracker panelId="B">
        <div />
      </IntersectionTracker>,
    );
    // Fire intersection
    act(() => {
      capturedCallback!([makeEntry(true)]);
    });
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("calls track('panel_view', { panel_id }) after 2 s debounce", async () => {
    const IntersectionTracker = await getComponent();
    render(
      <IntersectionTracker panelId="B">
        <div />
      </IntersectionTracker>,
    );
    act(() => {
      capturedCallback!([makeEntry(true)]);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith("panel_view", { panel_id: "B" });
  });

  it("resets debounce timer when element leaves and re-enters viewport", async () => {
    const IntersectionTracker = await getComponent();
    render(
      <IntersectionTracker panelId="C">
        <div />
      </IntersectionTracker>,
    );
    act(() => {
      capturedCallback!([makeEntry(true)]);
    });
    // Leave after 1 s (before debounce fires)
    act(() => {
      vi.advanceTimersByTime(1000);
      capturedCallback!([makeEntry(false)]);
    });
    // Re-enter
    act(() => {
      capturedCallback!([makeEntry(true)]);
    });
    // 1 s more — first debounce still hasn't fired (reset), total 2 s from re-enter not yet
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockTrack).not.toHaveBeenCalled();
    // Full 2 s from re-entry
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockTrack).toHaveBeenCalledTimes(1);
  });

  it("does NOT call track again if element stays visible beyond 2 s (fires only once per continuous view)", async () => {
    const IntersectionTracker = await getComponent();
    render(
      <IntersectionTracker panelId="D">
        <div />
      </IntersectionTracker>,
    );
    act(() => {
      capturedCallback!([makeEntry(true)]);
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // Should only fire once even after 5 s
    expect(mockTrack).toHaveBeenCalledTimes(1);
  });
});

describe("IntersectionTracker — cleanup", () => {
  it("disconnects IntersectionObserver on unmount", async () => {
    const IntersectionTracker = await getComponent();
    const { unmount } = render(
      <IntersectionTracker panelId="E">
        <div />
      </IntersectionTracker>,
    );
    unmount();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
