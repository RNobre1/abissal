"use client";

/**
 * Lazy wrappers para os painéis com recharts.
 *
 * Por que aqui e não no próprio componente?
 * - Os componentes de painel são importados em `page.tsx` (Server Component).
 * - `next/dynamic` em um Server Component cria o boundary de carregamento
 *   corretamente, mas ao usar `ssr: false` o bundle do servidor não arrasta
 *   a lib. O módulo cliente abaixo garante que recharts (~821 KB) só aparece
 *   no chunk do cliente quando o componente é efetivamente montado.
 *
 * Cada export re-expõe o mesmo contrato de props do componente original —
 * não há mudança de API para `page.tsx`.
 */

import dynamic from "next/dynamic";
import React from "react";

// ─── Skeleton compartilhado ──────────────────────────────────────────────────

function ChartSkeleton({ h = 320 }: { h?: number }) {
  return (
    <div
      className="card animate-shimmer"
      style={{ height: h }}
      aria-busy="true"
      aria-label="carregando gráfico"
    />
  );
}

// ─── RadarComparison ─────────────────────────────────────────────────────────

export const LazyRadarComparison = dynamic(
  () =>
    import(
      "@/components/fixtures/stats/panels/radar-comparison"
    ).then((m) => m.RadarComparison),
  {
    ssr: false,
    loading: () => <ChartSkeleton h={320} />,
  },
) as typeof import("@/components/fixtures/stats/panels/radar-comparison").RadarComparison;

// ─── ScatterPlayground ────────────────────────────────────────────────────────

export const LazyScatterPlayground = dynamic(
  () =>
    import(
      "@/components/fixtures/stats/panels/scatter-playground"
    ).then((m) => m.ScatterPlayground),
  {
    ssr: false,
    loading: () => <ChartSkeleton h={320} />,
  },
) as typeof import("@/components/fixtures/stats/panels/scatter-playground").ScatterPlayground;

// ─── RecentMatchesPanel ───────────────────────────────────────────────────────

export const LazyRecentMatchesPanel = dynamic(
  () =>
    import(
      "@/components/fixtures/stats/panels/recent-matches"
    ).then((m) => m.RecentMatchesPanel),
  {
    ssr: false,
    loading: () => <ChartSkeleton h={280} />,
  },
) as typeof import("@/components/fixtures/stats/panels/recent-matches").RecentMatchesPanel;

// ─── Players ─────────────────────────────────────────────────────────────────

export const LazyPlayers = dynamic(
  () =>
    import("@/components/fixtures/stats/panels/players").then(
      (m) => m.Players,
    ),
  {
    ssr: false,
    loading: () => <ChartSkeleton h={360} />,
  },
) as typeof import("@/components/fixtures/stats/panels/players").Players;
