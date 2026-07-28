/**
 * StatsLayout — desktop grid + mobile tabs responsive behavior.
 *
 * Mobile (<768px viewport) switches to a Radix `<Tabs.Root>` so the user
 * does not scroll through 14 panels stacked. The desktop grid stays
 * untouched.
 *
 * Strategy: a thin Client Component (`StatsLayoutResponsive`) detects
 * viewport via `window.matchMedia` and conditionally renders one of the
 * two structures. happy-dom does NOT implement `matchMedia` natively, so
 * we stub it on `window` per test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  StatsLayout,
  type PanelSlot,
} from "@/components/fixtures/stats/stats-layout";

// ─── matchMedia stub ────────────────────────────────────────────────────

interface MediaListenerCtl {
  listeners: Set<(ev: { matches: boolean; media: string }) => void>;
  matches: boolean;
}

function installMatchMedia(initialMatches: boolean): MediaListenerCtl {
  const ctl: MediaListenerCtl = {
    listeners: new Set(),
    matches: initialMatches,
  };
  // Reassign per test so the snapshot is fresh.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: ctl.matches,
      media: query,
      onchange: null,
      addEventListener: (
        _: string,
        cb: (ev: { matches: boolean; media: string }) => void,
      ) => {
        ctl.listeners.add(cb);
      },
      removeEventListener: (
        _: string,
        cb: (ev: { matches: boolean; media: string }) => void,
      ) => {
        ctl.listeners.delete(cb);
      },
      addListener: (
        cb: (ev: { matches: boolean; media: string }) => void,
      ) => {
        ctl.listeners.add(cb);
      },
      removeListener: (
        cb: (ev: { matches: boolean; media: string }) => void,
      ) => {
        ctl.listeners.delete(cb);
      },
      dispatchEvent: () => true,
    }),
  });
  return ctl;
}

function fireMediaChange(ctl: MediaListenerCtl, matches: boolean) {
  ctl.matches = matches;
  for (const cb of ctl.listeners) {
    cb({ matches, media: "(max-width: 767.98px)" });
  }
}

// ─── fixtures ───────────────────────────────────────────────────────────

function mkPanel(id: string, label: string): PanelSlot {
  return {
    id,
    label,
    colSpan: "span 12 / span 12",
    h: 100,
    node: <div data-panel-content={id}>{`PANEL ${id}`}</div>,
  };
}

function allPanels(): PanelSlot[] {
  return [
    mkPanel("B", "momentum"),
    mkPanel("A-home", "rec home"),
    mkPanel("A-away", "rec away"),
    mkPanel("D", "h2h"),
    mkPanel("E", "splits"),
    mkPanel("M", "dist"),
    mkPanel("K", "radar"),
    mkPanel("L", "scatter"),
    mkPanel("I", "ref"),
    mkPanel("J", "predictions"),
    mkPanel("N", "insights"),
    mkPanel("F", "streaks"),
    mkPanel("G+", "players"),
    mkPanel("H", "markets"),
    mkPanel("C-home", "rec match home"),
    mkPanel("C-away", "rec match away"),
  ];
}

function hero(): ReactNode {
  return <div data-testid="hero">HERO</div>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── tests ──────────────────────────────────────────────────────────────

describe("StatsLayout — desktop behavior", () => {
  beforeEach(() => {
    installMatchMedia(false); // desktop: media query does NOT match
  });

  it("renders the 12-column grid with every panel mounted", () => {
    const panels = allPanels();
    const { container } = render(
      <StatsLayout fixtureId={42} hero={hero()} panels={panels} />,
    );

    // The desktop grid section is present.
    expect(container.querySelector("section[data-panels]")).not.toBeNull();
    // Tabs root is NOT rendered.
    expect(container.querySelector("[role='tablist']")).toBeNull();
    // Each panel is mounted exactly once.
    for (const p of panels) {
      const slots = container.querySelectorAll(`[data-panel="${p.id}"]`);
      expect(slots.length, `panel ${p.id} should mount once`).toBe(1);
    }
  });

  it("renders back link to fixture page", () => {
    render(<StatsLayout fixtureId={42} hero={hero()} panels={[]} />);
    const back = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === "/fixtures/42");
    expect(back).toBeDefined();
  });
});

describe("StatsLayout — mobile tabs", () => {
  it("renders Radix tabs (not the desktop grid) under 768px viewport", () => {
    installMatchMedia(true);
    const panels = allPanels();

    const { container } = render(
      <StatsLayout fixtureId={42} hero={hero()} panels={panels} />,
    );

    // Tablist is present.
    const tablist = container.querySelector("[role='tablist']");
    expect(tablist).not.toBeNull();
    // Desktop grid is NOT rendered (single source of truth).
    expect(container.querySelector("section[data-panels]")).toBeNull();
  });

  // A aba "odds" saiu em 28/07: o painel H (MarketsBrowser) já tinha sido
  // removido na B23, o J (predictions do choistats) cobre só ~11% dos jogos e
  // o Pilot não usa nenhum dos dois — sobrava o árbitro (I), que agora vive na
  // aba "visão". Uma aba a menos = menos markup e menos hidratação no mobile.
  it("exposes 5 tab triggers (visão · simulação · streaks · jogos · players)", () => {
    installMatchMedia(true);
    render(<StatsLayout fixtureId={42} hero={hero()} panels={allPanels()} />);

    const triggers = screen.getAllByRole("tab");
    const labels = triggers.map((t) => t.textContent?.toLowerCase() ?? "");
    expect(triggers).toHaveLength(5);
    expect(labels).toEqual(
      expect.arrayContaining(["visão", "simulação", "streaks", "jogos", "players"]),
    );
    expect(labels).not.toContain("odds");
  });

  it("default tab 'visão' is active and shows panels A-home, D, M etc.", () => {
    installMatchMedia(true);
    const { container } = render(
      <StatsLayout fixtureId={42} hero={hero()} panels={allPanels()} />,
    );

    // Active tab content has visão's panels.
    expect(container.querySelector('[data-panel="A-home"]')).not.toBeNull();
    expect(container.querySelector('[data-panel="D"]')).not.toBeNull();
    expect(container.querySelector('[data-panel="M"]')).not.toBeNull();
    expect(container.querySelector('[data-panel="B"]')).not.toBeNull();
    // F (streaks) belongs to its own tab — NOT mounted while visão active.
    expect(container.querySelector('[data-panel="F"]')).toBeNull();
  });

  it("clicking 'streaks' tab mounts the F (streaks-heatmap) panel", () => {
    installMatchMedia(true);
    const { container } = render(
      <StatsLayout fixtureId={42} hero={hero()} panels={allPanels()} />,
    );

    const streaksTab = screen
      .getAllByRole("tab")
      .find((t) => t.textContent?.toLowerCase() === "streaks");
    expect(streaksTab).toBeDefined();
    act(() => {
      fireEvent.mouseDown(streaksTab!, { button: 0 });
    });

    expect(container.querySelector('[data-panel="F"]')).not.toBeNull();
    // visão panels are no longer mounted.
    expect(container.querySelector('[data-panel="A-home"]')).toBeNull();
  });

  it("clicking 'jogos' tab mounts both C-home and C-away", () => {
    installMatchMedia(true);
    const { container } = render(
      <StatsLayout fixtureId={42} hero={hero()} panels={allPanels()} />,
    );

    const jogosTab = screen
      .getAllByRole("tab")
      .find((t) => t.textContent?.toLowerCase() === "jogos");
    act(() => {
      fireEvent.mouseDown(jogosTab!, { button: 0 });
    });

    expect(container.querySelector('[data-panel="C-home"]')).not.toBeNull();
    expect(container.querySelector('[data-panel="C-away"]')).not.toBeNull();
  });

  it("o árbitro (I) fica na aba 'visão' — é o único painel da antiga aba odds que o Pilot usa", () => {
    installMatchMedia(true);
    const { container } = render(
      <StatsLayout fixtureId={42} hero={hero()} panels={allPanels()} />,
    );

    // 'visão' é a aba default, então o árbitro está montado de saída.
    expect(container.querySelector('[data-panel="I"]')).not.toBeNull();
  });

  it("não existe mais aba 'odds'", () => {
    installMatchMedia(true);
    render(<StatsLayout fixtureId={42} hero={hero()} panels={allPanels()} />);

    const oddsTab = screen
      .getAllByRole("tab")
      .find((t) => t.textContent?.toLowerCase() === "odds");
    expect(oddsTab).toBeUndefined();
  });

  it("clicking 'players' tab mounts the G+ panel", () => {
    installMatchMedia(true);
    const { container } = render(
      <StatsLayout fixtureId={42} hero={hero()} panels={allPanels()} />,
    );

    const playersTab = screen
      .getAllByRole("tab")
      .find((t) => t.textContent?.toLowerCase() === "players");
    act(() => {
      fireEvent.mouseDown(playersTab!, { button: 0 });
    });

    expect(container.querySelector('[data-panel="G+"]')).not.toBeNull();
  });
});

describe("StatsLayout — viewport change reactivity", () => {
  it("swaps from desktop grid to mobile tabs when viewport shrinks", () => {
    const ctl = installMatchMedia(false);
    const { container } = render(
      <StatsLayout fixtureId={42} hero={hero()} panels={allPanels()} />,
    );

    // Desktop initially.
    expect(container.querySelector("section[data-panels]")).not.toBeNull();
    expect(container.querySelector("[role='tablist']")).toBeNull();

    // Resize down.
    act(() => {
      fireMediaChange(ctl, true);
    });

    expect(container.querySelector("[role='tablist']")).not.toBeNull();
    expect(container.querySelector("section[data-panels]")).toBeNull();
  });
});

describe("StatsLayout — empty panels", () => {
  it("shows 'painéis em construção' on desktop when panels is empty", () => {
    installMatchMedia(false);
    render(<StatsLayout fixtureId={42} hero={hero()} panels={[]} />);
    expect(screen.getByText(/painéis em construção/i)).toBeDefined();
  });

  it("shows the placeholder on mobile too when panels is empty", () => {
    installMatchMedia(true);
    render(<StatsLayout fixtureId={42} hero={hero()} panels={[]} />);
    expect(screen.getByText(/painéis em construção/i)).toBeDefined();
  });
});
