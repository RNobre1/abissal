"use client";

/**
 * On-demand "pedir análise IA" button for the AiRecoPanel "none" state
 * (spec §7.1), reescrito no Pacote B (2026-07-30) pra ser HONESTO com a
 * latência real (p95 153s — R1 reasoning) e sobreviver a desconexões:
 *
 *  1. POST /api/ai-reco/compute com { fixtureId }. Copy: timer decorrido
 *     real (mm:ss) + "pode levar de 1 a 3 minutos" (sem promessa de ~40s).
 *  2. In-flight persistido em sessionStorage por fixture: re-mount da página
 *     mostra "processando…" e retoma via polling em vez de resetar pro CTA.
 *  3. Recuperação: se o fetch do POST morrer (rede/abort), o server pode ter
 *     completado mesmo assim (ADR-002 — o Worker segue com o request). O
 *     client entra em polling do GET (?fixtureId=) a cada ~10s por até ~4min;
 *     reco apareceu ⇒ router.refresh() + telemetria de sucesso.
 *  4. Telemetria preservada: ondemand_button_click e
 *     ondemand_response_received (elapsed_ms real, mesmo via polling).
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTelemetry } from "@/lib/telemetry";

const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_MS = 4 * 60_000;

type Phase = "idle" | "requesting" | "polling";

function storageKey(fixtureId: number): string {
  return `ai-reco-inflight:${fixtureId}`;
}

/** Lê o started-at persistido; entradas expiradas (> POLL_MAX_MS) são limpas. */
function readInflightStart(fixtureId: number): number | null {
  try {
    const raw = sessionStorage.getItem(storageKey(fixtureId));
    if (!raw) return null;
    const ts = Number(raw);
    if (!Number.isFinite(ts) || Date.now() - ts > POLL_MAX_MS) {
      sessionStorage.removeItem(storageKey(fixtureId));
      return null;
    }
    return ts;
  } catch {
    return null;
  }
}

function writeInflight(fixtureId: number, ts: number): void {
  try {
    sessionStorage.setItem(storageKey(fixtureId), String(ts));
  } catch {
    // sessionStorage indisponível — o botão segue funcionando sem persistência
  }
}

function clearInflight(fixtureId: number): void {
  try {
    sessionStorage.removeItem(storageKey(fixtureId));
  } catch {
    // noop
  }
}

function formatElapsed(ms: number): string {
  const totalS = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

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
  const track = useTelemetry();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [phase, setPhase] = useState<Phase>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle" || pending;

  // (b) Re-mount com análise in-flight: retoma em modo polling.
  useEffect(() => {
    const ts = readInflightStart(fixtureId);
    if (ts !== null) {
      setStartedAt(ts);
      setPhase("polling");
    }
  }, [fixtureId]);

  // Timer decorrido (1s) enquanto processa.
  useEffect(() => {
    if (phase === "idle") return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [phase]);

  // (c) Polling de recuperação: GET barato até a reco aparecer ou dar timeout.
  useEffect(() => {
    if (phase !== "polling" || startedAt === null) return;
    let cancelled = false;

    async function checkOnce() {
      if (startedAt === null) return;
      if (Date.now() - startedAt > POLL_MAX_MS) {
        if (!cancelled) {
          clearInflight(fixtureId);
          setPhase("idle");
          setError(
            "a análise não apareceu em ~4 min — o serviço pode estar lento; tenta de novo",
          );
        }
        return;
      }
      try {
        const res = await fetch(`/api/ai-reco/compute?fixtureId=${fixtureId}`);
        if (!res.ok) return; // erro transitório — tenta no próximo tick
        const data = (await res.json()) as { exists?: boolean };
        if (data.exists && !cancelled) {
          clearInflight(fixtureId);
          track("ondemand_response_received", {
            fixture_id: fixtureId,
            elapsed_ms: Date.now() - startedAt,
          });
          setPhase("idle");
          startTransition(() => {
            router.refresh();
          });
        }
      } catch {
        // rede instável — mantém o polling até o timeout
      }
    }

    void checkOnce();
    const id = setInterval(() => {
      void checkOnce();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, startedAt, fixtureId, track, router, startTransition]);

  async function handleClick() {
    setError(null);
    const ts = Date.now();
    setStartedAt(ts);
    setNow(ts);
    writeInflight(fixtureId, ts);
    track("ondemand_button_click", { fixture_id: fixtureId });
    setPhase("requesting");
    try {
      const res = await fetch("/api/ai-reco/compute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixtureId, homeTeam, awayTeam }),
      });
      if (!res.ok) {
        // O server RESPONDEU com erro — não há nada pra recuperar via polling.
        clearInflight(fixtureId);
        setPhase("idle");
        const text = await res.text().catch(() => "");
        setError(
          text && text.length < 200
            ? `falha (${res.status}): ${text}`
            : `falha (${res.status})`,
        );
        return;
      }
      clearInflight(fixtureId);
      track("ondemand_response_received", {
        fixture_id: fixtureId,
        elapsed_ms: Date.now() - ts,
      });
      setPhase("idle");
      startTransition(() => {
        router.refresh();
      });
    } catch {
      // Fetch morreu (rede/abort) — o server pode ter seguido processando
      // (ADR-002). Entra em recuperação por polling em vez de dar erro.
      setPhase("polling");
    }
  }

  const elapsed = startedAt !== null ? formatElapsed(now - startedAt) : "0:00";

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
        {busy ? (
          <span
            className="inline-flex items-center gap-2"
            data-ai-reco-loading
          >
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
            />
            <span>
              analisando… <span className="num tabular-nums">{elapsed}</span>
            </span>
          </span>
        ) : (
          "[ pedir análise IA ]"
        )}
      </button>
      {busy ? (
        <span
          className="label text-[var(--color-ink-faint)]"
          data-ai-reco-hint
        >
          {phase === "polling"
            ? "conexão instável — verificando o resultado a cada 10s; a análise continua no servidor"
            : "pode levar de 1 a 3 minutos (deepseek-r1, reasoning) — a análise continua no servidor mesmo se a página recarregar"}
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
