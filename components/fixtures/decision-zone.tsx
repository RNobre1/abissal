/**
 * DecisionZone — wrapper da "zona de decisão" no topo de /fixtures/[id].
 *
 * Renderiza em ordem: Hero → AiRecoPanel → MomentumChart, seguido de um
 * divisor explícito "análise técnica ↓" que separa os itens de decisão
 * dos 14+ painéis de análise abaixo.
 *
 * Design: max-h-screen no breakpoint desktop para manter a zona de decisão
 * visível sem rolar. Mobile: sem max-h (scroll livre já é o padrão).
 *
 * U.1 — 8 personas convergiram que Hero + Reco + Momentum no TOPO com
 * divisor explícito é o layout correto para tomada de decisão imediata.
 */

import type { ReactNode } from "react";

interface DecisionZoneProps {
  hero: ReactNode;
  reco: ReactNode;
  momentum: ReactNode | null;
  /**
   * Desempenho histórico do modelo nesta liga. Fica na zona de decisão, não
   * entre os painéis técnicos: "posso confiar nesta simulação?" é pergunta de
   * decisão, e dentro do accordion técnico (fechado por padrão) ninguém veria.
   */
  modelPerf?: ReactNode | null;
}

export function DecisionZone({ hero, reco, momentum, modelPerf }: DecisionZoneProps) {
  return (
    <section data-section="decision-zone" className="flex flex-col gap-4">
      {/* Hero — identificação do jogo + KPIs de mercado */}
      <div data-decision-slot="hero">{hero}</div>

      {/* AI Reco Panel — sugestão de aposta (sugestões da IA) */}
      <div data-decision-slot="reco">{reco}</div>

      {/* Momentum Chart — tendência recente dos times */}
      {momentum != null ? <div data-decision-slot="momentum">{momentum}</div> : null}

      {/* Quanto o modelo acerta nesta liga — o contexto que qualifica tudo acima */}
      {modelPerf != null ? (
        <div data-decision-slot="model-perf">{modelPerf}</div>
      ) : null}

      {/* Divisor explícito separando zona de decisão dos painéis técnicos */}
      <div
        role="separator"
        aria-label="análise técnica abaixo"
        className="flex items-center gap-3 py-2"
      >
        <span className="flex-1 border-t border-[var(--color-line)]" aria-hidden />
        <span className="label shrink-0 tracking-widest text-[var(--color-ink-faint)]">
          análise técnica ↓
        </span>
        <span className="flex-1 border-t border-[var(--color-line)]" aria-hidden />
      </div>
    </section>
  );
}
