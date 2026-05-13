"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { RadarData } from "@/lib/fixtures/stats/detail-json-types";

interface RadarComparisonProps {
  homeTeam: string;
  awayTeam: string;
  data: RadarData;
  /** Fixed width for tests; omitted in prod → ResponsiveContainer. */
  width?: number;
  height?: number;
}

/**
 * Painel K · radar comparativo — 6 eixos (gols/jogo, gols sofridos, SOT,
 * booking points, cantos, faltas), com dois polígonos sobrepostos (home
 * vermelho, away depth blue).
 *
 * Usa os valores `home_norm`/`away_norm` já calculados em T1 (escala
 * 0-1 contra o máximo do par), de forma que o tamanho do polígono lê
 * "domínio relativo" em cada eixo sem distorção de unidade.
 */
export function RadarComparison({
  homeTeam,
  awayTeam,
  data,
  width,
  height = 320,
}: RadarComparisonProps) {
  if (data.axes.length === 0) {
    return (
      <div
        className="card flex items-center justify-center p-4"
        style={{ height }}
      >
        <span className="label text-[var(--color-ink-faint)]">sem dados</span>
      </div>
    );
  }

  // recharts RadarChart consumes one row per axis with named keys.
  const chartData = data.axes.map((axis) => ({
    axis: axis.label,
    home: axis.home_norm,
    away: axis.away_norm,
    homeRaw: axis.home,
    awayRaw: axis.away,
  }));

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center gap-3">
        <span className="label">perfil comparativo</span>
        <span className="num text-xs text-[var(--color-vermelho)]">
          ● {homeTeam}
        </span>
        <span className="num text-xs text-[var(--color-depth)]">
          ● {awayTeam}
        </span>
      </div>
      {width !== undefined ? (
        <div style={{ width, height }}>
          <RadarBody
            chartData={chartData}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            width={width}
            height={height}
          />
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <RadarBody
            chartData={chartData}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
          />
        </ResponsiveContainer>
      )}
    </div>
  );
}

/**
 * Inner-only component. Splits the RadarChart JSX into one place so the
 * "fixed-width" (tests) and "ResponsiveContainer" (prod) branches don't
 * diverge. `width`/`height` propagate through only when explicitly passed —
 * inside <ResponsiveContainer> recharts itself supplies them.
 */
interface RadarBodyProps {
  chartData: Array<{
    axis: string;
    home: number;
    away: number;
    homeRaw: number;
    awayRaw: number;
  }>;
  homeTeam: string;
  awayTeam: string;
  width?: number;
  height?: number;
}

function RadarBody({
  chartData,
  homeTeam,
  awayTeam,
  width,
  height,
}: RadarBodyProps) {
  return (
    <RadarChart
      data={chartData}
      outerRadius="75%"
      {...(width !== undefined ? { width } : {})}
      {...(height !== undefined ? { height } : {})}
    >
      <PolarGrid stroke="var(--color-ink-faint)" />
      <PolarAngleAxis
        dataKey="axis"
        tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
      />
      <PolarRadiusAxis
        angle={90}
        domain={[0, 1]}
        tick={false}
        axisLine={false}
      />
      <Radar
        name={homeTeam}
        dataKey="home"
        stroke="#c42b2b"
        fill="#c42b2b"
        fillOpacity={0.35}
        isAnimationActive={false}
      />
      <Radar
        name={awayTeam}
        dataKey="away"
        stroke="#1a5fad"
        fill="#1a5fad"
        fillOpacity={0.3}
        isAnimationActive={false}
      />
      <Tooltip
        contentStyle={{
          background: "var(--color-surface-2)",
          border: "1px solid var(--color-ink-faint)",
          color: "var(--color-ink-display)",
          fontSize: 12,
        }}
        labelStyle={{ color: "var(--color-ink-muted)" }}
      />
    </RadarChart>
  );
}
