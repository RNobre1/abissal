/**
 * Shimmer skeleton used as the Suspense fallback for each panel slot.
 * Pure presentational component — no client state, safe to render in
 * Server Components.
 *
 * Height is configurable so the placeholder matches the resolved panel
 * dimension, preventing layout shift when the real content hydrates.
 *
 * Wave C: shimmer moved from inline `style={}` + `<style>` tag to
 * `.animate-shimmer` CSS class defined in `globals.css`. The keyframes now
 * participate in the global `prefers-reduced-motion: reduce` reset
 * (`animation-duration: 0.01ms !important`), which was silently bypassed
 * by inline styles. The `motion-reduce:animate-none` Tailwind class adds
 * an explicit opt-out at the component level as well.
 */

interface PanelSkeletonProps {
  /** Pixel height; passed through to inline style so Tailwind doesn't
      need to know about every possible value. */
  h?: number;
  /** Optional grid-column placement (e.g. "span 12 / span 12"). */
  colSpan?: string;
  /** A11y label exposed via aria-label. */
  label?: string;
}

export function PanelSkeleton({
  h = 240,
  colSpan,
  label = "Carregando painel",
}: PanelSkeletonProps) {
  return (
    <div
      role="status"
      aria-label={label}
      data-testid="panel-skeleton"
      className="card relative overflow-hidden"
      style={{
        height: `${h}px`,
        gridColumn: colSpan,
      }}
    >
      {/*
       * Shimmer layer: `.animate-shimmer` defined in globals.css (Wave C).
       * `motion-reduce:animate-none` adds an explicit component-level opt-out
       * in addition to the global `prefers-reduced-motion` reset.
       */}
      <div
        aria-hidden
        className="animate-shimmer motion-reduce:animate-none absolute inset-0"
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
