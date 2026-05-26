"use client";

/**
 * IntersectionTracker — wraps children and fires a `panel_view` telemetry
 * event when the wrapped element has been continuously visible (above the
 * 0.5 intersection threshold) for at least 2 seconds.
 *
 * Debounce prevents noisy events when the user quickly scrolls past a panel:
 * only sustained views (2 s dwell time) are recorded.
 *
 * Usage:
 *   <IntersectionTracker panelId="A-home">
 *     <PanelContent />
 *   </IntersectionTracker>
 */

import { useEffect, useRef, type ReactNode } from "react";
import { useTelemetry } from "./use-telemetry";

const DEBOUNCE_MS = 2_000;
const THRESHOLD = 0.5;

interface IntersectionTrackerProps {
  panelId: string;
  children: ReactNode;
}

export function IntersectionTracker({
  panelId,
  children,
}: IntersectionTrackerProps) {
  const track = useTelemetry();
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        if (entry.isIntersecting && !firedRef.current) {
          // Start debounce timer
          if (timerRef.current !== null) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            if (!firedRef.current) {
              firedRef.current = true;
              track("panel_view", { panel_id: panelId });
            }
          }, DEBOUNCE_MS);
        } else if (!entry.isIntersecting) {
          // Cancel pending timer — element left viewport before dwell time
          if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
          }
        }
      },
      { threshold: THRESHOLD },
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [panelId, track]);

  return <div ref={containerRef}>{children}</div>;
}
