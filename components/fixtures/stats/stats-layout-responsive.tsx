"use client";

/**
 * Responsive renderer for the stats panel grid.
 *
 * - Desktop (≥768px): 12-column CSS grid.
 *   - Painéis de decisão imediata (SIM) ficam sempre visíveis.
 *   - Os demais painéis técnicos são envolvidos em um `<details>` recolhido
 *     por default — reduz cognitive overload ao ocultar os 13+ painéis de
 *     análise até o usuário precisar deles.
 * - Mobile (<768px): Radix `<Tabs.Root>` com 5 tabs. Cada aba monta apenas
 *   seus painéis declarados — Radix desmonta conteúdo inativo por default,
 *   ganho real de perf em mobile (lightweight-charts, recharts, lista de
 *   streaks só constroem quando a aba está ativa).
 *
 * Viewport detection usa `useSyncExternalStore` + `window.matchMedia`
 * para que o markup SSR corresponda ao render inicial do cliente (desktop),
 * evitando hydration drift. O primeiro tick do matchMedia troca para a
 * estrutura mobile se o viewport for realmente estreito.
 *
 * `MOBILE_TABS` (declarado em `stats-layout.tsx`) é a fonte da verdade
 * para o mapeamento tab → panel-id. Painéis declarados pelo `page.tsx`
 * mas ausentes de qualquer aba caem na aba "visão".
 *
 * DECISION_PANEL_IDS: ids dos painéis que ficam FORA do <details> no
 * desktop — ficam sempre visíveis como parte da "zona de decisão".
 */

import * as Tabs from "@radix-ui/react-tabs";
import { useSyncExternalStore } from "react";
import {
  MOBILE_TABS,
  renderPanelSlot,
  type PanelSlot,
} from "./stats-layout";

const MOBILE_QUERY = "(max-width: 767.98px)";

/**
 * Painéis que ficam FORA do <details> no modo desktop. Estes são os painéis
 * de "decisão rápida" — simulação pré-jogo — que o usuário quer ver sem
 * precisar expandir o bloco de análise técnica.
 */
const DECISION_PANEL_IDS = new Set(["SIM"]);

// ─── matchMedia hook ────────────────────────────────────────────────────

function subscribe(query: string) {
  return (cb: () => void) => {
    if (typeof window === "undefined") return () => {};
    const mql = window.matchMedia(query);
    // Newer browsers expose addEventListener; legacy Safari uses addListener.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    }
    const legacy = mql as unknown as {
      addListener?: (cb: () => void) => void;
      removeListener?: (cb: () => void) => void;
    };
    legacy.addListener?.(cb);
    return () => legacy.removeListener?.(cb);
  };
}

function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe(MOBILE_QUERY),
    () => {
      if (typeof window === "undefined") return false;
      return window.matchMedia(MOBILE_QUERY).matches;
    },
    // Server snapshot: assume desktop. The grid SSRs; if the real viewport
    // is mobile, the first client tick will swap to tabs. Acceptable for
    // a CSR-heavy stats page.
    () => false,
  );
}

// ─── Component ──────────────────────────────────────────────────────────

interface StatsLayoutResponsiveProps {
  panels: PanelSlot[];
}

export function StatsLayoutResponsive({
  panels,
}: StatsLayoutResponsiveProps) {
  const isMobile = useIsMobile();

  if (panels.length === 0) {
    return (
      <section
        data-panels-empty
        className="@container/main rounded-[var(--radius)] border border-[var(--color-line-subtle)] bg-[var(--color-surface-1)] p-6"
      >
        <p className="label text-[var(--color-ink-faint)]">
          painéis em construção
        </p>
      </section>
    );
  }

  if (!isMobile) {
    // Separate decision panels (always visible) from technical panels (inside <details>).
    const decisionPanels = panels.filter((p) => DECISION_PANEL_IDS.has(p.id));
    const technicalPanels = panels.filter((p) => !DECISION_PANEL_IDS.has(p.id));

    return (
      <section
        data-panels
        className="@container/main flex flex-col gap-6"
      >
        {/* Decision panels — always visible (e.g. SIM) */}
        {decisionPanels.length > 0 && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
            {decisionPanels.map((p) => renderPanelSlot(p, false))}
          </div>
        )}

        {/* Technical panels — collapsed by default */}
        {technicalPanels.length > 0 && (
          <details
            data-technical-panels
            className="group rounded-[var(--radius)] border border-[var(--color-line-subtle)]"
          >
            <summary
              className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-[var(--radius)] bg-[var(--color-surface-1)] px-4 py-3 transition-colors hover:bg-[var(--color-surface-2)]"
            >
              <span className="label">
                análise técnica ({technicalPanels.length} painéis)
              </span>
              <span
                aria-hidden="true"
                className="label text-[var(--color-ink-faint)] transition-transform group-open:rotate-180"
              >
                &#x2193;
              </span>
            </summary>
            <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-12 lg:gap-6">
              {technicalPanels.map((p) => renderPanelSlot(p, false))}
            </div>
          </details>
        )}
      </section>
    );
  }

  // ─── Mobile tabs ──────────────────────────────────────────────────────
  const byId = new Map<string, PanelSlot>();
  for (const p of panels) byId.set(p.id, p);

  // Track which panel ids are already accounted for by a tab.
  const claimedIds = new Set<string>(MOBILE_TABS.flatMap((t) => t.panels));
  // Unclaimed panels fall into "visão" so nothing disappears on mobile.
  const orphanIds = panels
    .map((p) => p.id)
    .filter((id) => !claimedIds.has(id));

  return (
    <Tabs.Root
      defaultValue={MOBILE_TABS[0].id}
      className="@container/main flex flex-col gap-4"
      data-mobile-tabs
    >
      <Tabs.List
        className="flex w-full snap-x snap-mandatory gap-1 overflow-x-auto rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-surface-1)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="seções da fixture"
      >
        {MOBILE_TABS.map((tab) => (
          <Tabs.Trigger
            key={tab.id}
            value={tab.id}
            className="label shrink-0 snap-start rounded-[var(--radius-sm)] px-3 py-2 text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] data-[state=active]:bg-[var(--color-vermelho)] data-[state=active]:text-[var(--color-ink-display)]"
          >
            {tab.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      {MOBILE_TABS.map((tab) => {
        const ids =
          tab.id === MOBILE_TABS[0].id
            ? [...tab.panels, ...orphanIds]
            : tab.panels;
        const tabPanels = ids
          .map((id) => byId.get(id))
          .filter((p): p is PanelSlot => Boolean(p));
        return (
          <Tabs.Content
            key={tab.id}
            value={tab.id}
            className="flex flex-col gap-4 focus-visible:outline-none"
          >
            {tabPanels.map((p) => renderPanelSlot(p, true))}
          </Tabs.Content>
        );
      })}
    </Tabs.Root>
  );
}
