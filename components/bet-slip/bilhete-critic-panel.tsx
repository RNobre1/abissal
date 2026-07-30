"use client";

/**
 * F2 — "Advogado do diabo do bilhete" (UI).
 *
 *  - <BilheteCriticPanel>: painel de resultado reutilizável — veredicto por
 *    perna (ok/atenção/fuga com cor) + veredicto do bilhete (resumo,
 *    correlações, comentário de EV).
 *  - <BilheteCriticSection>: botão "⚖️ Criticar bilhete" + máquina de estados
 *    (loading com timer, erro acionável com retry, kill switch off → botão
 *    some) + telemetria (bilhete_critic_click / bilhete_critic_result).
 *
 * Usado no drawer do bet-slip e na página /bilhete.
 */

import { useEffect, useRef, useState } from "react";
import type { SlipLeg } from "@/lib/bet-slip/compute";
import { useTelemetry } from "@/lib/telemetry/use-telemetry";

// ── Tipos do resultado (contrato do POST /api/bilhete/critic) ───────────────

export interface CriticPanelLeg {
  verdict: "ok" | "atencao" | "fuga" | string;
  why: string;
  home: string;
  away: string;
  market: string;
  side: string;
  odd: number;
  has_model_data: boolean;
  prob_calibrated: number | null;
  edge_pct: number | null;
}

export interface CriticPanelOverall {
  summary: string;
  correlation_flags: string[];
  ev_comment: string;
}

interface VerdictStyle {
  label: string;
  color: string;
}

const VERDICT_STYLES: Record<string, VerdictStyle> = {
  ok: { label: "ok", color: "var(--color-success)" },
  atencao: { label: "atenção", color: "var(--color-warning)" },
  fuga: { label: "fuga", color: "var(--color-vermelho)" },
};

function verdictStyle(verdict: string): VerdictStyle {
  return VERDICT_STYLES[verdict] ?? { label: verdict, color: "var(--color-ink-muted)" };
}

// ── Painel de resultado ─────────────────────────────────────────────────────

export function BilheteCriticPanel({
  legs,
  overall,
}: {
  legs: CriticPanelLeg[];
  overall: CriticPanelOverall;
}) {
  return (
    <div data-bilhete-critic-panel className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {legs.map((leg, i) => {
          const style = verdictStyle(leg.verdict);
          return (
            <li
              key={i}
              data-critic-verdict={leg.verdict}
              className="rounded-[var(--radius-sm)] border border-[var(--color-line)] p-2"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="label min-w-0 truncate text-[var(--color-ink)]">
                  {leg.home} × {leg.away}{" "}
                  <span className="text-[var(--color-ink-faint)]">
                    · {leg.market}/{leg.side} @{" "}
                    <span className="num tabular-nums">{leg.odd.toFixed(2)}</span>
                  </span>
                </span>
                <span
                  className="label shrink-0 rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-semibold"
                  style={{ color: style.color, borderColor: style.color }}
                >
                  {style.label}
                </span>
              </div>
              <p className="label mt-1 text-[var(--color-ink-muted)]">{leg.why}</p>
              <p className="label mt-0.5 text-xs text-[var(--color-ink-faint)]">
                {leg.has_model_data ? (
                  <>
                    {leg.prob_calibrated != null ? (
                      <>
                        prob calibrada{" "}
                        <span className="num tabular-nums">
                          {(leg.prob_calibrated * 100).toFixed(1)}%
                        </span>
                      </>
                    ) : null}
                    {leg.edge_pct != null ? (
                      <>
                        {" · edge "}
                        <span className="num tabular-nums">
                          {leg.edge_pct >= 0 ? "+" : ""}
                          {leg.edge_pct.toFixed(1)}%
                        </span>
                      </>
                    ) : null}
                  </>
                ) : (
                  "sem dados do modelo"
                )}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2">
        <p className="label font-semibold text-[var(--color-ink)]">
          {overall.summary}
        </p>
        {overall.correlation_flags.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-0.5">
            {overall.correlation_flags.map((flag, i) => (
              <li key={i} className="label text-xs text-[var(--color-warning)]">
                ⚠ {flag}
              </li>
            ))}
          </ul>
        ) : null}
        {overall.ev_comment ? (
          <p className="label mt-1 text-xs text-[var(--color-ink-muted)]">
            {overall.ev_comment}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Botão + máquina de estados ──────────────────────────────────────────────

interface CriticApiResponse {
  legs: CriticPanelLeg[];
  overall: CriticPanelOverall;
  latencyMs: number;
}

type CriticState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "result"; data: CriticApiResponse };

export function BilheteCriticSection({
  legs,
  stakeTotal,
  oddCombined,
  aiEnabled = true,
}: {
  legs: SlipLeg[];
  stakeTotal: number | null;
  oddCombined: number;
  aiEnabled?: boolean;
}) {
  const track = useTelemetry();
  const [state, setState] = useState<CriticState>({ phase: "idle" });
  // Kill switch descoberto em runtime (503 ai_disabled) — botão some.
  const [aiOff, setAiOff] = useState(false);
  const [elapsedS, setElapsedS] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
    };
  }, []);

  if (!aiEnabled || aiOff || legs.length === 0) return null;

  function stopTimer() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function handleClick() {
    track("bilhete_critic_click", { leg_count: legs.length });
    setState({ phase: "loading" });
    setElapsedS(0);
    stopTimer();
    timerRef.current = setInterval(() => setElapsedS((s) => s + 1), 1000);
    const t0 = Date.now();

    try {
      const res = await fetch("/api/bilhete/critic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          legs: legs.map((leg) => ({
            ...(leg.fixture_id != null ? { fixtureId: leg.fixture_id } : {}),
            home: leg.home_team ?? "?",
            away: leg.away_team ?? "?",
            market: leg.market,
            side: leg.side,
            odd: leg.odd_taken,
          })),
          stakeTotal,
          oddCombined,
        }),
      });

      const elapsed_ms = Date.now() - t0;
      stopTimer();

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          ai_disabled?: boolean;
        };
        track("bilhete_critic_result", {
          elapsed_ms,
          status: "error",
          leg_count: legs.length,
        });
        if (res.status === 503 && body.ai_disabled) {
          setAiOff(true);
          return;
        }
        setState({
          phase: "error",
          message: body.error ?? `Erro ${res.status} ao criticar o bilhete.`,
        });
        return;
      }

      const data = (await res.json()) as CriticApiResponse;
      track("bilhete_critic_result", {
        elapsed_ms,
        status: "ok",
        leg_count: legs.length,
      });
      setState({ phase: "result", data });
    } catch {
      stopTimer();
      track("bilhete_critic_result", {
        elapsed_ms: Date.now() - t0,
        status: "error",
        leg_count: legs.length,
      });
      setState({
        phase: "error",
        message: "Falha de rede ao criticar o bilhete — verifique a conexão.",
      });
    }
  }

  return (
    <div data-bilhete-critic className="flex flex-col gap-2">
      {state.phase === "loading" ? (
        <p className="label text-[var(--color-ink-muted)]" aria-live="polite">
          ⚖️ analisando o bilhete…{" "}
          <span className="num tabular-nums">{elapsedS}s</span>
        </p>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          className="label rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-2 text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
        >
          ⚖️ Criticar bilhete
        </button>
      )}

      {state.phase === "error" ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-vermelho)] px-2 py-1.5"
        >
          <span className="label text-[var(--color-vermelho)]">
            {state.message}
          </span>
          <button
            type="button"
            onClick={handleClick}
            className="label shrink-0 text-[var(--color-ink-muted)] underline hover:text-[var(--color-ink)]"
          >
            tentar de novo
          </button>
        </div>
      ) : null}

      {state.phase === "result" ? (
        <BilheteCriticPanel
          legs={state.data.legs}
          overall={state.data.overall}
        />
      ) : null}
    </div>
  );
}
