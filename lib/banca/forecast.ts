import regression from "regression";
import { mean, standardDeviation } from "simple-statistics";

/**
 * Núcleo puro do /forecast — regressão linear do P/L acumulado + projeção
 * com banda de 95% (random walk, cresce com sqrt(d)).
 *
 * Fix (Pacote A item 4): o eixo x da regressão é DIAS CORRIDOS desde o
 * primeiro snapshot da janela — não o índice da linha. Snapshots só nascem
 * em dia com aposta resolvida (até o cron diário existir), então a série tem
 * buracos de calendário; regressão por índice inflava o slope exibido como
 * "BRL/dia" para BRL/dia-com-aposta.
 */

export interface ForecastPoint {
  date: string; // ISO date (YYYY-MM-DD)
  pl: number;
}

export interface ForecastProjection {
  /** Dias corridos após o último snapshot da janela (1..horizon). */
  day: number;
  pl: number;
  lo: number;
  hi: number;
}

export interface ForecastResult {
  /** Tendência da regressão em BRL por dia CORRIDO. */
  slopePerDay: number;
  intercept: number;
  r2: number;
  /** Média dos deltas entre snapshots consecutivos. */
  dailyMean: number;
  /** Desvio-padrão dos deltas entre snapshots consecutivos. */
  dailyStd: number;
  lastPl: number;
  projected: ForecastProjection[];
}

const MS_PER_DAY = 86_400_000;

/** Dias corridos entre duas datas ISO (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / MS_PER_DAY);
}

/**
 * Constrói a previsão a partir da série de P/L acumulado (ordenada por data
 * ascendente). Retorna `null` com menos de 2 pontos (sem reta possível).
 */
export function buildForecast(
  series: ForecastPoint[],
  horizonDays: number,
): ForecastResult | null {
  if (series.length < 2) return null;

  const first = series[0].date;

  // Deltas entre snapshots consecutivos (drift + volatilidade).
  const deltas: number[] = [];
  for (let i = 1; i < series.length; i++) {
    deltas.push(series[i].pl - series[i - 1].pl);
  }
  const dailyMean = mean(deltas);
  const dailyStd = standardDeviation(deltas);

  // Regressão linear: x = dias corridos desde o primeiro snapshot.
  const points: [number, number][] = series.map((s) => [
    daysBetween(first, s.date),
    s.pl,
  ]);
  const result = regression.linear(points, { precision: 6 });
  const slopePerDay = result.equation[0];
  const intercept = result.equation[1];
  const r2 = result.r2;

  const lastX = points[points.length - 1][0];
  const lastPl = series[series.length - 1].pl;

  const projected: ForecastProjection[] = [];
  for (let d = 1; d <= horizonDays; d++) {
    const trend = slopePerDay * (lastX + d) + intercept;
    // Banda de 95% escala com sqrt(d) (random walk).
    const band = 1.96 * dailyStd * Math.sqrt(d);
    projected.push({ day: d, pl: trend, lo: trend - band, hi: trend + band });
  }

  return { slopePerDay, intercept, r2, dailyMean, dailyStd, lastPl, projected };
}
