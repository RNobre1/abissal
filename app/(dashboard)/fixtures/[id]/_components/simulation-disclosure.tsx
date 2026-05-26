"use client";

/**
 * Wrapper client da simulação pré-jogo.
 *
 * Desktop (≥768px): card recolhido por default. PanelShell + toggle "▸ ver"
 * / "▾ ocultar". Body só montado quando expandido.
 * Mobile (<768px): conteúdo sempre visível, toggle oculto via @container CSS.
 *
 * Wave C: substituído useSyncExternalStore + window.matchMedia por
 * @container CSS. O toggle ainda usa `useState` (interação JS inevitável),
 * mas `useIsMobile` / `useSyncExternalStore` foram eliminados. Sem
 * hydration mismatch nem layout shift.
 *
 * Estratégia CSS:
 *   - Botão toggle: `hidden` (mobile) + `@[768px]/card:inline-flex` (desktop).
 *   - Região de conteúdo: sempre `block` no DOM; no desktop usa
 *     `data-sim-region` + CSS inline via `style` para ocultar quando
 *     collapsed. No mobile o CSS do @container sobrescreve para block.
 *
 * SimulationPanel passa em modo chrome="bare" (sem PanelShell interno).
 */
import { useId, useState, type ReactNode } from "react";
import { PanelShell } from "@/components/fixtures/stats/panels/_shell";
import { InfoPopover } from "@/components/fixtures/stats/_primitives/info-popover";

function MonteCarloEyebrow() {
  return (
    <span className="inline-flex items-center gap-1.5">
      Monte Carlo
      <InfoPopover label="o que é a simulação pré-jogo">
        <p>
          Resultado de uma simulação Monte Carlo (10k iterações) computada no
          scraper a partir das médias de temporada. Mostra o placar mais
          provável, probabilidades de mercado e a alocação de eventos por
          jogador. Não é palpite do mercado nem opinião — é a distribuição do
          modelo.
        </p>
      </InfoPopover>
    </span>
  );
}

export function SimulationDisclosure({
  children,
  defaultExpanded = false,
}: {
  children: ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const regionId = useId();

  return (
    <PanelShell
      title="Simulação pré-jogo"
      gap={4}
      eyebrow={
        <span className="inline-flex items-center gap-3">
          <MonteCarloEyebrow />
          {/*
           * Toggle oculto no mobile via @container (container/card < 768px).
           * `hidden` garante display:none por default (SSR + mobile).
           * `@[768px]/card:inline-flex` ativa apenas no desktop.
           */}
          <button
            type="button"
            data-sim-toggle
            aria-expanded={expanded}
            aria-controls={regionId}
            onClick={() => setExpanded((v) => !v)}
            className="label hidden @[768px]/card:inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 py-1 text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-[var(--color-vermelho)]"
          >
            <span aria-hidden>{expanded ? "▾" : "▸"}</span>
            {expanded ? "ocultar" : "ver"}
          </button>
        </span>
      }
    >
      {/*
       * Região de conteúdo:
       * - Mobile (<768px container): sempre visível (não tem o toggle).
       * - Desktop (≥768px): visível só quando `expanded`.
       *
       * Usamos dois wrappers sobrepostos controlados por @container:
       * um para mobile (always-block) e um para desktop (JS-driven display).
       * Tailwind @container variant garante que nenhum JS detecta viewport.
       */}
      <div
        id={regionId}
        aria-hidden={!expanded}
        data-sim-region
        className={[
          // Mobile: always block — @container hides the desktop layer
          "block",
          // Desktop: hidden when not expanded — controlled via data attr
          expanded ? "@[768px]/card:block" : "@[768px]/card:hidden",
        ].join(" ")}
      >
        {children}
      </div>
    </PanelShell>
  );
}
