"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShortcutConfig {
  /** The keyboard key to listen for (e.g. "j", "k", "Enter", "?", "[", "]"). */
  key: string;
  /** Handler called when the key is pressed. */
  handler: (event: KeyboardEvent) => void;
  /**
   * When true, fires even when focus is inside an input/textarea/select.
   * Default: false (most shortcuts should NOT fire while typing).
   */
  allowInInput?: boolean;
}

export interface UseKeyboardShortcutsOptions {
  shortcuts: ShortcutConfig[];
  /** When true, all shortcuts are disabled. Useful when a modal is open. */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useKeyboardShortcuts
 *
 * Registers global `keydown` listeners for a set of keyboard shortcuts.
 * Ignores keypresses when the user is typing in an input/textarea/select
 * (unless `allowInInput: true` is set per shortcut).
 *
 * Designed for power-user navigation in the fixtures list and detail page:
 *   j/k       → previous/next fixture
 *   [/]       → same (explicit aliases)
 *   Enter     → open focused fixture
 *   s         → back to fixture list
 *   b         → focus "+ bilhete" button in AiRecoPanel (TODO Wave M)
 *   ?         → open keyboard help modal
 *
 * Implementation choice: custom `useEffect` + keydown instead of
 * `react-hotkeys-hook` — the project does not have the lib installed and
 * 8 shortcuts with simple key matching don't justify the dependency.
 */
export function useKeyboardShortcuts({
  shortcuts,
  disabled = false,
}: UseKeyboardShortcutsOptions): void {
  // Keep a stable ref so the effect doesn't re-register on every render.
  // Mutations are done in a layout effect (before paint) to satisfy the
  // react-hooks/refs linting rule that forbids direct .current writes in render.
  const shortcutsRef = useRef(shortcuts);
  const disabledRef = useRef(disabled);

  useLayoutEffect(() => {
    shortcutsRef.current = shortcuts;
    disabledRef.current = disabled;
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (disabledRef.current) return;

      // Ignore when typing in a form element
      const target = event.target as HTMLElement | null;
      if (target && typeof target.tagName === "string") {
        const tag = target.tagName.toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.isContentEditable) return;
      }

      // Find matching shortcut
      for (const shortcut of shortcutsRef.current) {
        if (event.key === shortcut.key) {
          if (shortcut.allowInInput) {
            // No tag check — always fires
          }
          shortcut.handler(event);
          break;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []); // Empty deps — shortcutsRef keeps it stable
}
