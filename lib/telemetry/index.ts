/**
 * lib/telemetry — public exports for the telemetry sub-system.
 *
 * Usage:
 *   import { useTelemetry } from "@/lib/telemetry"
 *   import { IntersectionTracker } from "@/lib/telemetry"
 */

export { useTelemetry, type TrackFn, type TelemetryPayload } from "./use-telemetry";
export { IntersectionTracker } from "./intersection-tracker";
