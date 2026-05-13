"use client";

/**
 * Panel H · markets-browser
 *
 * Inline panel showing 4-6 headline market cards + a "ver todos (N)" button
 * that opens a Radix Dialog drawer with the full 0-39 markets bucket of
 * `odds_summary`, grouped into 6 categories (match, halves, teams, corners,
 * cards, player-props). Returns `null` when no markets are present.
 *
 * URL state: the active category is persisted via the `markets_cat` query
 * param (`router.replace(..., { scroll: false })`) so a category survives
 * page refresh and is link-shareable. The dialog open/close itself is
 * intentionally not in the URL — drawers are ephemeral by intent.
 *
 * Headline picks (inline, no drawer needed): Result, BTTS, Match Goals
 * Overs/Unders (Over 2.5 highlighted when present), Total Cards
 * Over/Under (Over 5.5 highlighted when present). We rank by exact-name
 * lookup against the canonical market keys; any miss is silently skipped.
 */

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { PanelShell } from "@/components/fixtures/stats/panels/_shell";
import type {
  OddsCategory,
  OddsCategoryEntry,
  OddsCategoryMap,
} from "@/lib/fixtures/stats/detail-json-types";

interface MarketsBrowserProps {
  data: OddsCategoryMap;
}

const CATEGORY_ORDER: OddsCategory[] = [
  "match",
  "halves",
  "teams",
  "corners",
  "cards",
  "player-props",
];

const CATEGORY_LABEL: Record<OddsCategory, string> = {
  match: "match",
  halves: "halves",
  teams: "teams",
  corners: "corners",
  cards: "cards",
  "player-props": "player-props",
  other: "other",
};

/**
 * Exact market names the inline panel highlights. Ordered — first match
 * found wins a slot. Missing markets are skipped (we don't pad with
 * placeholders; a 3-card row is fine).
 */
const HEADLINE_MARKETS = [
  "Result",
  "BTTS",
  "Match Goals Overs/Unders",
  "Total Cards Over/Under",
  "Total Corners Over/Under",
  "Double Chance",
] as const;

/**
 * Per-market preferred outcome to highlight inline. Falls back to "show
 * all outcomes" when not listed. Names match the keys nested under
 * `odds_summary.<market>` (case-sensitive in the source).
 */
const HEADLINE_PREFER_OUTCOME: Record<string, string> = {
  "Match Goals Overs/Unders": "Over 2.5",
  "Total Cards Over/Under": "Over 5.5",
  "Total Corners Over/Under": "Over 9.5",
};

function flattenAll(data: OddsCategoryMap): Array<{
  category: OddsCategory;
  entry: OddsCategoryEntry;
}> {
  const out: Array<{ category: OddsCategory; entry: OddsCategoryEntry }> = [];
  for (const cat of CATEGORY_ORDER) {
    const entries = data[cat];
    if (!entries) continue;
    for (const entry of entries) out.push({ category: cat, entry });
  }
  // include "other" too so the total count matches the raw bucket
  const other = data.other;
  if (other) for (const entry of other) out.push({ category: "other", entry });
  return out;
}

function findHeadlines(
  data: OddsCategoryMap,
): Array<{ entry: OddsCategoryEntry; preferred?: string }> {
  const all = flattenAll(data);
  const byName = new Map(all.map((x) => [x.entry.market, x.entry]));
  const picks: Array<{ entry: OddsCategoryEntry; preferred?: string }> = [];
  for (const name of HEADLINE_MARKETS) {
    const entry = byName.get(name);
    if (!entry) continue;
    picks.push({ entry, preferred: HEADLINE_PREFER_OUTCOME[name] });
    if (picks.length >= 6) break;
  }
  return picks;
}

export function MarketsBrowser({ data }: MarketsBrowserProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const availableCategories = useMemo(
    () => CATEGORY_ORDER.filter((c) => (data[c]?.length ?? 0) > 0),
    [data],
  );

  const all = useMemo(() => flattenAll(data), [data]);
  const total = all.length;
  const headlines = useMemo(() => findHeadlines(data), [data]);

  // URL param ⇒ active category; fall back to the first available cat that
  // actually has markets. Stays "match" even if the URL has a bogus value.
  const urlCat = searchParams.get("markets_cat") as OddsCategory | null;
  const activeCategory: OddsCategory =
    urlCat && CATEGORY_ORDER.includes(urlCat) && (data[urlCat]?.length ?? 0) > 0
      ? urlCat
      : (availableCategories[0] ?? "match");

  if (total === 0) return null;

  function setCategory(cat: OddsCategory) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("markets_cat", cat);
    const qs = next.toString();
    router.replace(qs.length > 0 ? `?${qs}` : "?", { scroll: false });
  }

  const activeEntries = data[activeCategory] ?? [];

  return (
    <PanelShell title="Mercados" eyebrow={`${total} mercados`}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {headlines.map(({ entry, preferred }) => (
          <HeadlineCard key={entry.market} entry={entry} preferred={preferred} />
        ))}
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="mt-2 self-start rounded-md px-3 py-1.5 text-sm font-medium"
            style={{
              background: "var(--color-vermelho)",
              color: "var(--color-ink-display)",
            }}
          >
            ver todos os mercados ({total})
          </button>
        </Dialog.Trigger>

        <Dialog.Portal>
          <Dialog.Overlay
            className="fixed inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.6)" }}
          />
          <Dialog.Content
            aria-label="Mercados de apostas"
            className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[85vh] flex-col gap-3 overflow-hidden rounded-t-lg p-4 sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[min(720px,90vw)] sm:max-h-[80vh] sm:rounded-lg"
            style={{
              background: "var(--color-surface-1)",
              color: "var(--color-ink-display)",
              border: "1px solid var(--color-ink-faint)",
            }}
          >
            <header className="flex items-center justify-between gap-2">
              <Dialog.Title className="font-display text-lg">
                Todos os mercados
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="fechar"
                  className="label rounded px-2 py-1 text-[var(--color-ink-muted)]"
                  style={{ background: "var(--color-surface-2)" }}
                >
                  fechar
                </button>
              </Dialog.Close>
            </header>

            <Dialog.Description className="label text-[var(--color-ink-faint)]">
              {total} mercados em {availableCategories.length} categorias
            </Dialog.Description>

            <div
              className="flex flex-wrap gap-1.5 border-b pb-2"
              style={{ borderColor: "var(--color-ink-faint)" }}
            >
              {CATEGORY_ORDER.map((cat) => {
                const count = data[cat]?.length ?? 0;
                const isActive = cat === activeCategory;
                const isAvailable = count > 0;
                return (
                  <button
                    key={cat}
                    type="button"
                    data-testid="markets-cat-chip"
                    data-active={isActive ? "true" : "false"}
                    disabled={!isAvailable}
                    onClick={() => setCategory(cat)}
                    className="rounded-full px-2.5 py-1 text-xs font-medium transition"
                    style={{
                      background: isActive
                        ? "var(--color-vermelho)"
                        : "var(--color-surface-2)",
                      color: isActive
                        ? "var(--color-ink-display)"
                        : isAvailable
                          ? "var(--color-ink-muted)"
                          : "var(--color-ink-faint)",
                      opacity: isAvailable ? 1 : 0.5,
                      cursor: isAvailable ? "pointer" : "not-allowed",
                    }}
                  >
                    {CATEGORY_LABEL[cat]}
                    {count > 0 ? (
                      <span className="num ml-1 opacity-80">({count})</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto">
              <ul className="flex flex-col gap-2">
                {activeEntries.map((entry) => (
                  <li
                    key={entry.market}
                    data-testid="markets-list-item"
                    className="rounded-md p-3"
                    style={{ background: "var(--color-surface-2)" }}
                  >
                    <div className="mb-2 font-medium text-[var(--color-ink-display)]">
                      {entry.market}
                    </div>
                    <ul className="flex flex-col gap-1">
                      {entry.outcomes.map((o, i) => (
                        <OutcomeRow key={`${o.name}-${i}`} outcome={o} />
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </PanelShell>
  );
}

interface HeadlineCardProps {
  entry: OddsCategoryEntry;
  /** If supplied, only this outcome is rendered (compact card). */
  preferred?: string;
}

function HeadlineCard({ entry, preferred }: HeadlineCardProps) {
  const shown = preferred
    ? entry.outcomes.filter((o) => o.name === preferred)
    : entry.outcomes;
  const list = shown.length > 0 ? shown : entry.outcomes;
  return (
    <div
      data-testid="markets-headline-card"
      className="flex flex-col gap-1.5 rounded-md p-3"
      style={{ background: "var(--color-surface-2)" }}
    >
      <div className="label text-[var(--color-ink-faint)]">{entry.market}</div>
      <ul className="flex flex-col gap-0.5">
        {list.map((o, i) => (
          <OutcomeRow key={`${o.name}-${i}`} outcome={o} />
        ))}
      </ul>
    </div>
  );
}

interface OutcomeRowProps {
  outcome: OddsCategoryEntry["outcomes"][number];
}

/**
 * One <li> rendering an outcome — used by both the inline headline card
 * and the in-dialog full-market list. Extracted so the bookmaker/odds
 * formatting stays consistent across both surfaces.
 */
function OutcomeRow({ outcome }: OutcomeRowProps) {
  return (
    <li className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-[var(--color-ink-muted)]">{outcome.name}</span>
      <span className="num text-[var(--color-ink-display)]">
        {outcome.decimal_odds.toFixed(2)}
        {outcome.bookmaker ? (
          <span className="label ml-1 text-[var(--color-ink-faint)]">
            {outcome.bookmaker}
          </span>
        ) : null}
      </span>
    </li>
  );
}
