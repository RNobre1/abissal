import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { PanelSkeleton } from "./skeleton";
import { StatsLayoutResponsive } from "./stats-layout-responsive";

/**
 * A single panel slot inside the StatsLayout grid.
 *
 * `node` is rendered behind a Suspense boundary so a slow Server panel
 * can stream in without blocking the rest of the page. `h` controls the
 * skeleton fallback height to keep CLS at zero.
 */
export interface PanelSlot {
  id: string;
  node: ReactNode;
  /** Skeleton placeholder height in px. */
  h?: number;
  /** Grid-column placement (e.g. "span 12 / span 12"). */
  colSpan?: string;
  /** A11y label for the fallback state. */
  label?: string;
}

/**
 * Auto-derived mobile tab groupings. Each tab lists the panel ids it
 * should mount. Order is significant — the first tab is the default.
 *
 * `page.tsx` is FORBIDDEN by T8, so the mapping is hardcoded here.
 * Panels declared by `page.tsx` but absent from any tab fall back to
 * the "visão" tab so nothing disappears on mobile.
 */
export const MOBILE_TABS: ReadonlyArray<{
  id: string;
  label: string;
  panels: string[];
}> = [
  {
    id: "visao",
    label: "visão",
    // "I" (árbitro) migrou da extinta aba "odds" — ver nota abaixo.
    panels: ["AI_RECO", "B", "A-home", "A-away", "D", "E", "M", "K", "L", "N", "I"],
  },
  {
    id: "simulacao",
    label: "simulação",
    panels: ["SIM"],
  },
  {
    id: "streaks",
    label: "streaks",
    panels: ["F"],
  },
  {
    id: "jogos",
    label: "jogos",
    panels: ["C-home", "C-away"],
  },
  {
    id: "players",
    label: "players",
    panels: ["G+"],
  },
  // A aba "odds" foi removida em 28/07. Ela tinha três painéis: "H"
  // (MarketsBrowser) já não existia desde a B23, "J" (predictions do
  // choistats) só tem dado em ~11% dos jogos, e "I" (árbitro) era o único
  // que o Pilot realmente consultava — esse foi promovido pra "visão".
];

interface StatsLayoutProps {
  fixtureId: number;
  hero: ReactNode;
  panels: PanelSlot[];
}

/**
 * Wraps a panel in <Suspense> + the data-panel attribute slot. Shared
 * between desktop grid and mobile tab content so SSR markup, a11y, and
 * test selectors stay identical regardless of breakpoint.
 */
export function renderPanelSlot(p: PanelSlot, mobile = false): ReactNode {
  return (
    <Suspense
      key={p.id}
      fallback={
        <PanelSkeleton h={p.h ?? 240} colSpan={p.colSpan} label={p.label} />
      }
    >
      <div
        data-panel={p.id}
        style={mobile ? undefined : { gridColumn: p.colSpan }}
        className={mobile ? "block" : "contents lg:block"}
      >
        {p.node}
      </div>
    </Suspense>
  );
}

/**
 * Wrapper for the /fixtures/[id]/stats page.
 *
 * Top-to-bottom hierarchy:
 *  1. <header> with a back link to /fixtures/[id] (the AI analyze page).
 *  2. <section data-hero> — the Stadium Wall hero, full bleed.
 *  3. <StatsLayoutResponsive> — Client wrapper that picks grid (desktop)
 *     or Radix tabs (mobile, <768px) based on `window.matchMedia`.
 */
export function StatsLayout({ fixtureId, hero, panels }: StatsLayoutProps) {
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 lg:px-8 lg:py-12">
      <header className="mb-6 flex items-center justify-between gap-2">
        <Link
          href={`/fixtures/${fixtureId}`}
          className="label inline-flex items-center gap-2 hover:text-[var(--color-ink)]"
        >
          ← análise IA
        </Link>
        <span className="label num text-[var(--color-ink-faint)]">
          stats / fixture #{fixtureId}
        </span>
      </header>

      <section data-hero className="mb-8">
        {hero}
      </section>

      <StatsLayoutResponsive panels={panels} />
    </main>
  );
}
