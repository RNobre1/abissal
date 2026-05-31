"use client";

/**
 * ForceAnalysisButton — appears in the AiRecoPanel skip state.
 *
 * Click flow:
 *  1. POST /api/ai-reco/compute with { fixtureId, force: true }.
 *  2. While in-flight: disabled + "analisando..." spinner.
 *  3. On success: renders the forced result inline with disclaimer.
 *  4. On error: inline alert + button stays available for retry.
 *
 * Forced recos are excluded from ALL calibration metrics — that disclaimer
 * is shown prominently after the result lands.
 *
 * Design: dark-only, PT-BR, no intrusive success notification.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface ForceResult {
  decision: {
    verdict: string;
    summary_line?: string | null;
    reasoning?: string | null;
  };
  reco_id: number | null;
}

interface ForceAnalysisButtonProps {
  fixtureId: number;
}

export function ForceAnalysisButton({ fixtureId }: ForceAnalysisButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ForceResult | null>(null);

  const busy = pending || submitting;

  async function handleClick() {
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/ai-reco/compute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixtureId, force: true }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setError(
          text && text.length < 200
            ? `falha (${res.status}): ${text}`
            : `falha (${res.status})`,
        );
        return;
      }
      const data = (await res.json()) as ForceResult;
      setResult(data);
      // Refresh so the parent server component re-fetches and can update.
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro de rede");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="flex flex-col gap-2">
        <p
          data-testid="forced-disclaimer"
          className="label rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] px-3 py-2 text-[var(--color-ink-muted)]"
        >
          ⚠ análise forçada — abaixo do edge mínimo; não conta pra calibração
        </p>
        {result.decision.summary_line ? (
          <p className="text-sm text-[var(--color-ink)]">
            {result.decision.summary_line}
          </p>
        ) : null}
        {result.decision.reasoning ? (
          <p className="text-sm text-[var(--color-ink-muted)]">
            {result.decision.reasoning}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        data-testid="force-analysis-btn"
        className="label inline-flex w-fit items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-2 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink-muted)] focus-visible:outline-2 focus-visible:outline-[var(--color-vermelho)] disabled:cursor-not-allowed disabled:opacity-60"
        aria-busy={busy}
      >
        {busy ? (
          <span className="inline-flex items-center gap-2" data-ai-reco-loading>
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
            />
            <span>analisando — pode levar até 1 min</span>
          </span>
        ) : (
          "[ forçar análise ]"
        )}
      </button>
      {busy ? (
        <span className="label text-[var(--color-ink-faint)]">
          análise abaixo do threshold de edge — não contará pra calibração
        </span>
      ) : null}
      {error ? (
        <span
          role="alert"
          className="label text-[var(--color-vermelho)]"
          data-ai-reco-error
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}
