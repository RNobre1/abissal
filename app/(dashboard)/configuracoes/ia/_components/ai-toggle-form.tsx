"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setAiEnabledAction } from "../actions";

/**
 * Toggle do kill switch GLOBAL de IA. Otimista com rollback em erro: atualiza o
 * estado ao confirmar a Server Action; se falhar, mostra o erro e mantém o
 * estado anterior. Quando desligado, NENHUMA chamada de IA é feita no sistema.
 */
export function AiToggleForm({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !enabled;
    setError(null);
    startTransition(async () => {
      const res = await setAiEnabledAction(next);
      if (res.error) {
        setError(res.error);
        return;
      }
      setEnabled(res.enabled ?? next);
    });
  }

  return (
    <div className="flex flex-col gap-5" data-testid="ai-toggle">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span
            className="font-display text-2xl"
            data-ai-state={enabled ? "on" : "off"}
            style={{
              color: enabled
                ? "var(--color-ink-display)"
                : "var(--color-vermelho)",
            }}
          >
            {enabled ? "IA ativa" : "IA desativada"}
          </span>
          <span className="max-w-prose text-sm text-[var(--color-ink-muted)]">
            {enabled
              ? "O recomendador diário, a análise on-demand e o OCR de bilhete estão ligados — cada um consome créditos do OpenRouter."
              : "Nenhuma chamada de IA é feita: o cron diário é pulado, os botões de análise e o OCR ficam indisponíveis. Zero gasto no OpenRouter."}
          </span>
        </div>

        <Button
          type="button"
          variant={enabled ? "danger" : "primary"}
          onClick={toggle}
          disabled={pending}
          aria-pressed={enabled}
          className="shrink-0"
        >
          {pending ? "salvando…" : enabled ? "desativar IA" : "ativar IA"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--color-vermelho)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
