/**
 * PanelSkeleton — Wave C regression tests.
 *
 * Verifies:
 * 1. Uses `.animate-shimmer` CSS class (not inline `backgroundImage` style).
 * 2. Includes `motion-reduce:animate-none` for vestibular accessibility.
 * 3. Does NOT use inline style on the shimmer layer.
 * 4. Keeps `role="status"` and `aria-label` for screen readers.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PanelSkeleton } from "@/components/fixtures/stats/skeleton";

describe("PanelSkeleton — Wave C shimmer via CSS class", () => {
  it("shimmer layer uses CSS class animate-shimmer (not inline backgroundImage)", () => {
    const { container } = render(<PanelSkeleton />);
    const shimmerLayer = container.querySelector("[aria-hidden]") as HTMLElement | null;
    expect(shimmerLayer, "shimmer layer should exist").not.toBeNull();

    // Must have the CSS class.
    expect(shimmerLayer?.className).toContain("animate-shimmer");

    // Must NOT have inline backgroundImage style (Wave C — moved to CSS).
    expect(shimmerLayer?.style.backgroundImage).toBeFalsy();
    expect(shimmerLayer?.style.animation).toBeFalsy();
  });

  it("includes motion-reduce:animate-none for vestibular accessibility", () => {
    const { container } = render(<PanelSkeleton />);
    const shimmerLayer = container.querySelector("[aria-hidden]") as HTMLElement | null;
    expect(shimmerLayer?.className).toContain("motion-reduce:animate-none");
  });

  it("keeps role=status and aria-label for screen readers", () => {
    const { container } = render(<PanelSkeleton label="Carregando dados" />);
    const skeleton = container.querySelector("[data-testid='panel-skeleton']") as HTMLElement | null;
    expect(skeleton?.getAttribute("role")).toBe("status");
    expect(skeleton?.getAttribute("aria-label")).toBe("Carregando dados");
  });

  it("sets height via inline style (arbitrary pixel value needed)", () => {
    const { container } = render(<PanelSkeleton h={320} />);
    const skeleton = container.querySelector("[data-testid='panel-skeleton']") as HTMLElement | null;
    // Height is still inline because Tailwind cannot know arbitrary pixel values.
    expect(skeleton?.style.height).toBe("320px");
  });

  it("does not render a <style> tag (keyframes extracted to globals.css)", () => {
    const { container } = render(<PanelSkeleton />);
    const styleTags = container.querySelectorAll("style");
    expect(styleTags.length).toBe(0);
  });
});
