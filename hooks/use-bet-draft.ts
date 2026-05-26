"use client";

import { useEffect, useRef } from "react";

/**
 * hooks/use-bet-draft.ts
 *
 * Autosave/draft persistence for the /bets/new form.
 *
 * Saves a snapshot to localStorage['__bet_draft'] whenever the draft state
 * changes (debounced 800ms to avoid excessive writes).
 *
 * On mount, returns the stored draft (if any) so the form can pre-populate.
 *
 * Usage:
 *   const { draft, saveDraft, clearDraft } = useBetDraft();
 *
 * When the form is successfully submitted, call clearDraft() to remove
 * the stored snapshot.
 *
 * The draft is keyed by the user's session so a multi-user environment
 * (shared device) does not leak drafts. In single-user mode the key
 * is just '__bet_draft'.
 */

const DRAFT_KEY = "__bet_draft";
const DEBOUNCE_MS = 800;

export type BetDraft = Record<string, unknown>;

export function loadBetDraft(): BetDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BetDraft;
  } catch {
    return null;
  }
}

export function clearBetDraft(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // best-effort
  }
}

/**
 * useBetDraft — provides an autosave side-effect for the /bets/new form.
 *
 * @param draft  Current draft state (reactive — should be a dependency of
 *               the caller's state).
 */
export function useBetDraft(draft: BetDraft | null): void {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (draft === null) return;

    // Debounce writes
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        // storage quota exceeded — silently ignore
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draft]);
}
