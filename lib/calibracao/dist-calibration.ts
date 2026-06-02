/**
 * Helper de leitura da calibração de DISTRIBUIÇÃO pra exibição em /calibracao.
 *
 * Converte as linhas `*-dist` de `model_calibration` (já carregadas pela página,
 * sem query extra) em linhas de display: por stat, o fator `k`, a média que a
 * sim previa vs a média real observada, e o `n`. Visualiza o viés sistemático
 * que descobrimos e agora corrigimos (a sim subestima corners/cards/sot ~6–13%).
 *
 * Puro, sem I/O. Espelha a derivação de k de dist-k-repository.ts.
 */

export interface DistCalibrationRow {
  /** "corners" | "cards" | "sot" | "goals". */
  stat: string;
  /** Fator multiplicativo da média: mean_calibrado = mean_previsto × k. */
  k: number;
  /** Média do total que a sim previa (home p50 + away p50). */
  meanPred: number;
  /** Média do total real observado. */
  meanActual: number;
  /** Nº de jogos resolvidos no fit. */
  n: number;
}

/** Linha mínima de model_calibration que este helper consome. */
export interface CalibrationRowLike {
  metric: string;
  n: number;
  pairs: unknown;
}

const SUFFIX = "-dist";
// Ordem de exibição (mais "apostável" primeiro).
const ORDER = ["corners", "sot", "cards", "goals"];

function parsePair(raw: unknown): [number, number] | null {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr) || !Array.isArray(arr[0]) || arr[0].length < 2) return null;
  const meanPred = arr[0][0];
  const meanActual = arr[0][1];
  if (
    typeof meanPred !== "number" ||
    typeof meanActual !== "number" ||
    !Number.isFinite(meanPred) ||
    !Number.isFinite(meanActual) ||
    meanPred <= 0
  ) {
    return null;
  }
  return [meanPred, meanActual];
}

/**
 * Extrai as linhas de calibração de distribuição ativas das rows de
 * model_calibration. Ignora curvas isotônicas (metric sem sufixo `-dist`).
 * Ordenado por relevância de aposta (corners, sot, cards, goals).
 */
export function distCalibrationRows(
  rows: CalibrationRowLike[],
): DistCalibrationRow[] {
  const out: DistCalibrationRow[] = [];
  for (const r of rows) {
    if (typeof r.metric !== "string" || !r.metric.endsWith(SUFFIX)) continue;
    const stat = r.metric.slice(0, -SUFFIX.length);
    const pair = parsePair(r.pairs);
    if (!pair) continue;
    const [meanPred, meanActual] = pair;
    out.push({ stat, k: meanActual / meanPred, meanPred, meanActual, n: r.n });
  }
  return out.sort((a, b) => {
    const ia = ORDER.indexOf(a.stat);
    const ib = ORDER.indexOf(b.stat);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}
