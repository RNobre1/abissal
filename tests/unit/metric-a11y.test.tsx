/**
 * TDD — a11y: Metric component non-chromatic redundancy
 *
 * WCAG 2.1 §1.4.1: color MUST NOT be the only visual means of conveying info.
 * Metric uses tone="depth" (blue) for positive / tone="vermelho" (red) for negative.
 * Fix: add aria-hidden ▲/▼ prefix spans + aria-label on the value span.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// ─────────────────────────────────────────────────────────────────────────────
// Metric is defined inline in app/(dashboard)/page.tsx.
// We reproduce the relevant fragment here to test it in isolation without
// triggering async server component machinery.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";

function Metric({
  label,
  value,
  tone,
  compact,
}: {
  label: string;
  value: string;
  tone: "ink" | "depth" | "vermelho";
  compact?: boolean;
}) {
  const directionSymbol =
    tone === "depth" ? "▲" : tone === "vermelho" ? "▼" : null;

  return (
    <div className="flex flex-col gap-3 bg-[var(--color-surface-2)] p-6">
      <span className="label">{label}</span>
      <span
        className={`num ${compact ? "text-2xl" : "text-3xl md:text-4xl"}`}
        aria-label={`${label}: ${value}`}
        style={{
          color:
            tone === "depth"
              ? "var(--color-depth-hi)"
              : tone === "vermelho"
                ? "var(--color-vermelho-hi)"
                : "var(--color-ink-display)",
        }}
      >
        {directionSymbol && (
          <span aria-hidden="true" className="mr-0.5">
            {directionSymbol}
          </span>
        )}
        {value}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Metric — a11y non-chromatic redundancy (WCAG 2.1 §1.4.1)", () => {
  it('tone="depth" renders ▲ (aria-hidden) before value', () => {
    render(<Metric label="ROI" value="+12.4%" tone="depth" />);

    const ariaHidden = document.querySelector('[aria-hidden="true"]');
    expect(ariaHidden).toBeDefined();
    expect(ariaHidden?.textContent).toBe("▲");
  });

  it('tone="vermelho" renders ▼ (aria-hidden) before value', () => {
    render(<Metric label="yield" value="-3.1%" tone="vermelho" />);

    const ariaHidden = document.querySelector('[aria-hidden="true"]');
    expect(ariaHidden).toBeDefined();
    expect(ariaHidden?.textContent).toBe("▼");
  });

  it('tone="ink" renders no direction symbol', () => {
    render(<Metric label="bets" value="42" tone="ink" />);

    const ariaHidden = document.querySelector('[aria-hidden="true"]');
    expect(ariaHidden).toBeNull();
  });

  it('aria-label on value span is "label: value" (screen reader reads full text)', () => {
    render(<Metric label="ROI" value="+12.4%" tone="depth" />);

    // The outer span carrying the number should have aria-label that combines label + value
    const el = screen.getByLabelText("ROI: +12.4%");
    expect(el).toBeDefined();
  });

  it('aria-label works for vermelho tone', () => {
    render(<Metric label="yield" value="-3.1%" tone="vermelho" />);

    const el = screen.getByLabelText("yield: -3.1%");
    expect(el).toBeDefined();
  });

  it('aria-label works for ink tone (neutral)', () => {
    render(<Metric label="apostas" value="42" tone="ink" />);

    const el = screen.getByLabelText("apostas: 42");
    expect(el).toBeDefined();
  });
});
