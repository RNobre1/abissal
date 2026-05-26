/**
 * Tests for `useTelemetry` hook — batching, flush timer, beforeunload sendBeacon.
 *
 * Behavioral spec:
 *   - `track(event, payload)` appends to an in-memory queue.
 *   - The queue is flushed every 10 s via setInterval.
 *   - The queue is flushed when it reaches 50 events.
 *   - On `beforeunload` the queue is flushed via `navigator.sendBeacon`.
 *   - `session_id` is generated once per module import (UUID, stable across calls).
 *   - When the queue is empty, no network call is made.
 *   - After a successful flush the queue is cleared.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { renderHook, act } from "@testing-library/react";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

// We mock fetch so no real network call happens.
const mockFetch = vi.fn<typeof fetch>();

// sendBeacon mock
const mockSendBeacon = vi.fn(() => true);

// Fake sessionStorage (happy-dom provides a real one, but we want isolation)
const sessionStorage = (() => {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
})();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", mockFetch);
  vi.stubGlobal("navigator", { sendBeacon: mockSendBeacon });
  vi.stubGlobal("sessionStorage", sessionStorage);
  sessionStorage.clear();
  mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
  mockSendBeacon.mockReturnValue(true);
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function getHook() {
  const { useTelemetry } = await import("@/lib/telemetry/use-telemetry");
  return useTelemetry;
}

// ─────────────────────────────────────────────────────────────────────────────
// Basic tracking
// ─────────────────────────────────────────────────────────────────────────────

describe("useTelemetry — basic tracking", () => {
  it("returns a track function", async () => {
    const useTelemetry = await getHook();
    const { result } = renderHook(() => useTelemetry());
    expect(typeof result.current).toBe("function");
  });

  it("does NOT call fetch synchronously after a single track call", async () => {
    const useTelemetry = await getHook();
    const { result } = renderHook(() => useTelemetry());
    act(() => {
      result.current("apostei_modal_open", { fixture_id: 1 });
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auto-flush after 10 s
// ─────────────────────────────────────────────────────────────────────────────

describe("useTelemetry — auto-flush after 10 s", () => {
  it("flushes via fetch after 10 s interval fires", async () => {
    const useTelemetry = await getHook();
    const { result } = renderHook(() => useTelemetry());
    act(() => {
      result.current("apostei_modal_open", { fixture_id: 1 });
    });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/telemetry");
    const body = JSON.parse(init.body as string) as { events: unknown[] };
    expect(body.events).toHaveLength(1);
    expect((body.events[0] as { event_type: string }).event_type).toBe(
      "apostei_modal_open",
    );
  });

  it("does NOT flush when queue is empty after 10 s", async () => {
    const useTelemetry = await getHook();
    renderHook(() => useTelemetry());
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("clears the queue after a successful flush", async () => {
    const useTelemetry = await getHook();
    const { result } = renderHook(() => useTelemetry());
    act(() => {
      result.current("apostei_modal_open", { fixture_id: 1 });
    });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    // Track another event; wait another 10 s. Only the second event should be in the payload.
    act(() => {
      result.current("apostei_modal_cancel", { fixture_id: 1 });
    });
    mockFetch.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { events: unknown[] };
    expect(body.events).toHaveLength(1);
    expect((body.events[0] as { event_type: string }).event_type).toBe(
      "apostei_modal_cancel",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flush at 50 events
// ─────────────────────────────────────────────────────────────────────────────

describe("useTelemetry — flush at 50 events", () => {
  it("flushes immediately when 50 events are queued", async () => {
    const useTelemetry = await getHook();
    const { result } = renderHook(() => useTelemetry());
    await act(async () => {
      for (let i = 0; i < 50; i++) {
        result.current("panel_view", { panel_id: `panel-${i}` });
      }
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { events: unknown[] };
    expect(body.events).toHaveLength(50);
  });

  it("does NOT flush at 49 events", async () => {
    const useTelemetry = await getHook();
    const { result } = renderHook(() => useTelemetry());
    act(() => {
      for (let i = 0; i < 49; i++) {
        result.current("panel_view", { panel_id: `panel-${i}` });
      }
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// beforeunload → sendBeacon
// ─────────────────────────────────────────────────────────────────────────────

describe("useTelemetry — beforeunload sendBeacon", () => {
  it("calls sendBeacon on beforeunload with queued events", async () => {
    const useTelemetry = await getHook();
    const { result } = renderHook(() => useTelemetry());
    act(() => {
      result.current("feedback_button_click", { elapsed_ms: 5000 });
    });
    // Simulate beforeunload
    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    expect(mockSendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = mockSendBeacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toContain("/api/telemetry");
    const text = await blob.text();
    const body = JSON.parse(text) as { events: unknown[] };
    expect(body.events).toHaveLength(1);
    expect((body.events[0] as { event_type: string }).event_type).toBe(
      "feedback_button_click",
    );
  });

  it("does NOT call sendBeacon when queue is empty on beforeunload", async () => {
    const useTelemetry = await getHook();
    renderHook(() => useTelemetry());
    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    expect(mockSendBeacon).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// session_id
// ─────────────────────────────────────────────────────────────────────────────

describe("useTelemetry — session_id", () => {
  it("includes session_id in every event payload", async () => {
    const useTelemetry = await getHook();
    const { result } = renderHook(() => useTelemetry());
    act(() => {
      result.current("apostei_modal_open", { fixture_id: 1 });
    });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      events: Array<{ session_id?: string }>;
    };
    expect(body.events[0].session_id).toBeTruthy();
    expect(typeof body.events[0].session_id).toBe("string");
  });

  it("uses the same session_id across multiple track calls", async () => {
    const useTelemetry = await getHook();
    const { result } = renderHook(() => useTelemetry());
    act(() => {
      result.current("apostei_modal_open", { fixture_id: 1 });
      result.current("apostei_modal_cancel", { fixture_id: 1 });
    });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      events: Array<{ session_id?: string }>;
    };
    expect(body.events[0].session_id).toBe(body.events[1].session_id);
  });
});
