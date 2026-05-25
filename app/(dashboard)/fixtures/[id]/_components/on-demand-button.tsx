"use client";

/**
 * On-demand "pedir análise IA" button for the AiRecoPanel "none" state
 * (spec §7.1).
 *
 * Click flow:
 *  1. POST /api/ai-reco/compute with { fixtureId } (created by Wave 3).
 *  2. While in-flight: disabled + "analisando..." label.
 *  3. Success: router.refresh() so the parent server component re-fetches
 *     `getRecommendationForFixture` and re-renders state A/B.
 *  4. Error: inline message + button stays available for retry.
 *
 * NOTE: Wave 4 may ship before Wave 3 wires up the route handler. If the
 * endpoint returns 404, the user sees a generic error message and can try
 * again later. This is acceptable for the launch window.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface OnDemandButtonProps {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
}

export function OnDemandButton({
  fixtureId,
  homeTeam,
  awayTeam,
}: OnDemandButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = pending || submitting;

  async function handleClick() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/ai-reco/compute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixtureId, homeTeam, awayTeam }),
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
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erro de rede";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        data-ai-reco-cta
        className="label inline-flex w-fit items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-2 text-[var(--color-ink)] transition-colors hover:text-[var(--color-vermelho)] focus-visible:outline-2 focus-visible:outline-[var(--color-vermelho)] disabled:cursor-not-allowed disabled:opacity-60"
        aria-busy={busy}
      >
        {busy ? "analisando..." : "[ pedir análise IA ]"}
      </button>
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
