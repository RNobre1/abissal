"use client";

interface Hop {
  tool: string;
  args: unknown;
  result_summary: string;
  took_ms: number;
}

/**
 * Sempre-visível: uma linha-chip por tool chamada no turno. Espelha o
 * FixtureToolSteps do Sub-projeto A (não acopla ao endpoint dele). O log
 * verboso (args JSON, tokens) continua no <details> "log do turno".
 */
export function CopilotToolSteps({ hops }: { hops: Hop[] }) {
  if (!hops || hops.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label="ferramentas usadas">
      {hops.map((h, i) => {
        const failed = h.result_summary.startsWith("error:");
        return (
          <li
            key={i}
            className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line-subtle)] bg-[var(--color-surface-2)] px-2 py-1 font-mono text-[11px]"
          >
            <span aria-hidden style={{ color: failed ? "var(--color-vermelho)" : "var(--color-ink-muted)" }}>
              {failed ? "✗" : "✓"}
            </span>
            <span className="sr-only">{failed ? "falhou" : "ok"}</span>
            <span className="text-[var(--color-vermelho)]">{h.tool}</span>
            <span className={`truncate ${failed ? "text-[var(--color-vermelho)]" : "text-[var(--color-ink-muted)]"}`}>· {h.result_summary}</span>
          </li>
        );
      })}
    </ul>
  );
}
