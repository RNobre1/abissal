"use client";

/**
 * useTelemetry — React hook that returns a `track` function for recording
 * UX telemetry events.
 *
 * Behaviour:
 *   - Calls are queued in memory (not persisted to localStorage — the queue
 *     is intentionally ephemeral per-tab session).
 *   - Auto-flush every 10 s via `setInterval`.
 *   - Immediate flush when queue reaches 50 events.
 *   - `beforeunload` flush via `navigator.sendBeacon` to guarantee delivery.
 *   - `session_id` is generated once per tab (via `sessionStorage`), so
 *     events from the same browser tab share an ID across route navigations.
 *
 * The hook is stable (the returned `track` ref does not change between
 * renders), so it can safely be used inside dependency arrays.
 */

import { useEffect, useRef, useCallback } from "react";

const ENDPOINT = "/api/telemetry";
const FLUSH_INTERVAL_MS = 10_000;
const BATCH_SIZE_LIMIT = 50;
const SESSION_KEY = "__telemetry_session_id";

export interface TelemetryPayload {
  fixture_id?: number;
  ai_recommendation_id?: number;
  panel_id?: string;
  elapsed_ms?: number;
  [key: string]: unknown;
}

export interface TelemetryEvent {
  event_type: string;
  session_id: string;
  fixture_id?: number;
  ai_recommendation_id?: number;
  panel_id?: string;
  elapsed_ms?: number;
  payload?: Record<string, unknown>;
}

/** Generates or retrieves a stable UUID for this browser tab session. */
function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    // sessionStorage blocked (private browsing edge-cases): use in-memory fallback
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

// Module-level queue (shared across all hook instances in the same tab).
// This is intentional: multiple components can call useTelemetry() and they
// all feed the same batch — a single flush covers all events.
const queue: TelemetryEvent[] = [];
let sessionId: string | null = null;

function getSessionId(): string {
  if (!sessionId) sessionId = getOrCreateSessionId();
  return sessionId;
}

async function flushQueue(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: batch }),
    });
  } catch {
    // Fire-and-forget: silently discard on network error.
    // We intentionally do NOT re-queue to avoid unbounded growth.
  }
}

function flushViaBeacon(): void {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    navigator.sendBeacon(
      ENDPOINT,
      new Blob([JSON.stringify({ events: batch })], {
        type: "application/json",
      }),
    );
  } catch {
    // sendBeacon unavailable or failed — silently discard
  }
}

export type TrackFn = (
  eventType: string,
  payload?: TelemetryPayload,
) => void;

/**
 * Returns a stable `track` function.
 *
 * `track(eventType, payload)` appends to the module-level queue and
 * triggers an immediate flush when the batch size limit is reached.
 */
export function useTelemetry(): TrackFn {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Set up auto-flush interval (one per hook mount — idempotent since
    // module-level queue is shared; extra intervals just do no-op flushes).
    intervalRef.current = setInterval(() => {
      flushQueue().catch(() => undefined);
    }, FLUSH_INTERVAL_MS);

    // Flush on tab close
    const handleBeforeUnload = () => flushViaBeacon();
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const track = useCallback<TrackFn>((eventType, payload) => {
    const { fixture_id, ai_recommendation_id, panel_id, elapsed_ms, ...rest } =
      payload ?? {};

    const event: TelemetryEvent = {
      event_type: eventType,
      session_id: getSessionId(),
      ...(fixture_id !== undefined && { fixture_id }),
      ...(ai_recommendation_id !== undefined && { ai_recommendation_id }),
      ...(panel_id !== undefined && { panel_id }),
      ...(elapsed_ms !== undefined && { elapsed_ms }),
      ...(Object.keys(rest).length > 0 && { payload: rest as Record<string, unknown> }),
    };

    queue.push(event);

    if (queue.length >= BATCH_SIZE_LIMIT) {
      flushQueue().catch(() => undefined);
    }
  }, []);

  return track;
}
