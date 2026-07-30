"use client";

import { useState } from "react";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShortcutRow {
  keys: string[];
  description: string;
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: ["j", "↓"], description: "próxima fixture" },
  { keys: ["k", "↑"], description: "fixture anterior" },
  { keys: ["[", "]"], description: "fixture anterior / próxima (aliases)" },
  { keys: ["Enter"], description: "abrir fixture em foco" },
  { keys: ["s"], description: "voltar para lista de fixtures" },
  { keys: ["b"], description: "focar botão “+ bilhete” da página" },
  { keys: ["?"], description: "este menu de ajuda" },
];

/**
 * Foca o primeiro botão "+ bilhete" real da página (AddToSlipButton expõe
 * `data-add-to-slip` — Wave M mergeada). No-op quando não há botão.
 */
function focusAddToSlipButton() {
  const btn = document.querySelector<HTMLElement>("[data-add-to-slip]");
  btn?.focus();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * KeyboardHelpModal — opens with `?`, closes with `Escape` or clicking overlay.
 * Rendered inside the dashboard layout so it's available on every page.
 */
export function KeyboardHelpModal() {
  const [open, setOpen] = useState(false);

  useKeyboardShortcuts({
    shortcuts: [
      { key: "?", handler: () => setOpen((v) => !v) },
      { key: "Escape", handler: () => setOpen(false) },
      { key: "b", handler: () => focusAddToSlipButton() },
    ],
    disabled: false,
  });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Atalhos de teclado"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-sm rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-surface-1)] p-6 shadow-2xl">
        <header className="mb-5 flex items-baseline justify-between">
          <span className="label">atalhos de teclado</span>
          <button
            onClick={() => setOpen(false)}
            className="label text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            aria-label="fechar"
          >
            esc
          </button>
        </header>

        <table className="w-full text-sm">
          <tbody>
            {SHORTCUTS.map((row) => (
              <tr key={row.keys.join("+")} className="border-b border-[var(--color-line)] last:border-0">
                <td className="py-2 pr-4">
                  <div className="flex gap-1">
                    {row.keys.map((k) => (
                      <kbd
                        key={k}
                        className="num rounded border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--color-ink-display)]"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </td>
                <td className="py-2 text-[var(--color-ink-muted)]">
                  {row.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
