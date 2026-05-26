"use client";

/**
 * FeedbackButtons — 4 botões discretos para o usuário registrar
 * concordância/execução sobre uma ai_recommendation (loop de feedback humano).
 *
 * - 👍 Concordo  (agree)
 * - 👎 Discordo  (disagree)
 * - ✅ Apostei   (bet)
 * - ⏸️ Não apostei (no_bet)
 *
 * Cada botão pode estar:
 *   - default: clicável.
 *   - active:  já registrado anteriormente — mantém clicável (re-clicar
 *     atualiza comentário via upsert), mas com chrome `active`.
 *   - busy:    request em andamento.
 *
 * Estados são INDEPENDENTES: o usuário pode (e provavelmente vai) marcar
 * "agree" + "bet" ao mesmo tempo. Cada decision tem sua própria linha em
 * `ai_reco_feedback`.
 *
 * O comentário (opcional) é shared entre todos os botões — o último upsert
 * "vence" para o decision específico.
 *
 * Após sucesso chama `router.refresh()` pro panel SSR re-renderizar com o
 * feedback atualizado (caso futuras leituras dependam dele).
 */

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTelemetry } from "@/lib/telemetry";

type Decision = "agree" | "disagree" | "bet" | "no_bet";

interface FeedbackButtonsProps {
  aiRecommendationId: number;
  /** Decisions já registradas — usadas pra realçar botões ativos. */
  existingDecisions?: Decision[];
  /**
   * A2: callback invocado quando o usuário clica "✅ Apostei". Em vez de
   * POSTar diretamente em /api/ai-reco/feedback, abre o modal de
   * confirmação (casa + stake + odd). Se não fornecido, o botão "bet"
   * mantém o comportamento legado de feedback simples.
   */
  onOpenApostei?: () => void;
}

interface ButtonConfig {
  decision: Decision;
  label: string;
  icon: string;
  testId: string;
}

const BUTTONS: ButtonConfig[] = [
  { decision: "agree", label: "Concordo", icon: "👍", testId: "agree" },
  { decision: "disagree", label: "Discordo", icon: "👎", testId: "disagree" },
  { decision: "bet", label: "Apostei", icon: "✅", testId: "bet" },
  { decision: "no_bet", label: "Não apostei", icon: "⏸️", testId: "no_bet" },
];

export function FeedbackButtons({
  aiRecommendationId,
  existingDecisions = [],
  onOpenApostei,
}: FeedbackButtonsProps) {
  const track = useTelemetry();
  const mountedAtRef = useRef<number>(0);
  useEffect(() => { mountedAtRef.current = Date.now(); }, []);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submittingDecision, setSubmittingDecision] = useState<Decision | null>(
    null,
  );
  const [comment, setComment] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<Decision>>(
    () => new Set(existingDecisions),
  );

  async function send(decision: Decision) {
    // A2: intercepta "bet" — abre o modal de confirmação em vez de POSTar
    // direto. O modal cria a bet no ledger e marca o feedback como 'bet'
    // server-side, então NÃO chamamos /feedback aqui pra evitar duplicar.
    if (decision === "bet" && onOpenApostei) {
      onOpenApostei();
      return;
    }
    // Telemetria: feedback_button_click com tempo desde montagem do painel
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const elapsedMs = mountedAtRef.current > 0 ? now - mountedAtRef.current : undefined;
    track("feedback_button_click", {
      ai_recommendation_id: aiRecommendationId,
      panel_id: decision,
      ...(elapsedMs !== undefined && { elapsed_ms: elapsedMs }),
    });
    setError(null);
    setSubmittingDecision(decision);
    try {
      const res = await fetch("/api/ai-reco/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          aiRecommendationId,
          userDecision: decision,
          comment: comment.trim().length > 0 ? comment.trim() : undefined,
        }),
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
      setSaved((prev) => {
        const next = new Set(prev);
        next.add(decision);
        return next;
      });
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erro de rede";
      setError(msg);
    } finally {
      setSubmittingDecision(null);
    }
  }

  const anyBusy = pending || submittingDecision !== null;

  return (
    <div
      className="flex flex-col gap-2"
      data-feedback-panel
      data-ai-recommendation-id={aiRecommendationId}
    >
      <div className="label text-[var(--color-ink-muted)]">
        Loop de feedback (opcional):
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="feedback IA">
        {BUTTONS.map((b) => {
          const isSaved = saved.has(b.decision);
          const isSubmitting = submittingDecision === b.decision;
          return (
            <button
              key={b.decision}
              type="button"
              data-feedback-button={b.decision}
              data-feedback-saved={isSaved ? "true" : "false"}
              aria-pressed={isSaved}
              aria-busy={isSubmitting}
              disabled={anyBusy}
              onClick={() => send(b.decision)}
              className={`label inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2.5 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-vermelho)] disabled:cursor-not-allowed disabled:opacity-60 ${
                isSaved
                  ? "border-[var(--color-vermelho)] text-[var(--color-vermelho)]"
                  : "border-[var(--color-line)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              <span aria-hidden="true">{b.icon}</span>
              <span>{isSubmitting ? "salvando..." : b.label}</span>
              {isSaved && !isSubmitting ? (
                <span aria-hidden="true" className="ml-1">
                  ·
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <textarea
        data-feedback-comment
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="comentário (opcional) — anexado ao próximo clique"
        rows={2}
        maxLength={2000}
        className="label w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-2 py-1.5 text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-vermelho)] focus:outline-none"
      />
      {error ? (
        <span
          role="alert"
          className="label text-[var(--color-vermelho)]"
          data-feedback-error
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}
