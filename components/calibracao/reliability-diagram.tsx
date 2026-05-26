/**
 * ReliabilityDiagram — scatter SVG puro: previsto vs observado.
 *
 * U.3 spec: scatter + diagonal y=x (perfect calibration) + banda Wilson 95%
 * (binomial confidence). SVG puro (sem recharts) — controle total do layout.
 *
 * Eixo X = probabilidade prevista (média do bucket)
 * Eixo Y = frequência observada (acerto real no bucket)
 * Diagonal y=x = calibração perfeita
 * Pontos maiores = mais amostras (n)
 */

interface Bin {
  range: [number, number];
  n: number;
  predictedAvg: number | null;
  observedFreq: number | null;
}

interface ReliabilityDiagramProps {
  bins: Bin[];
  labelMetric: string;
}

const PADDING = { top: 16, right: 16, bottom: 36, left: 40 };
const WIDTH = 280;
const HEIGHT = 240;

const PLOT_W = WIDTH - PADDING.left - PADDING.right;
const PLOT_H = HEIGHT - PADDING.top - PADDING.bottom;

function toX(p: number): number {
  return PADDING.left + p * PLOT_W;
}

function toY(p: number): number {
  return PADDING.top + (1 - p) * PLOT_H;
}

/**
 * Intervalo de Wilson 95% para proporção binomial.
 * Retorna [lower, upper] em proporção (0-1).
 */
function wilsonInterval(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96; // 95% z-score
  const phat = k / n;
  const denom = 1 + (z * z) / n;
  const center = (phat + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function ReliabilityDiagram({ bins, labelMetric }: ReliabilityDiagramProps) {
  const validBins = bins.filter(
    (b) => b.n > 0 && b.predictedAvg !== null && b.observedFreq !== null,
  );

  if (validBins.length === 0) {
    return (
      <div className="card flex items-center justify-center p-8">
        <span className="label text-[var(--color-ink-faint)]">sem dados suficientes</span>
      </div>
    );
  }

  const maxN = Math.max(...validBins.map((b) => b.n));

  return (
    <div className="flex flex-col gap-2">
      <span className="label text-[var(--color-ink-muted)]">{labelMetric}</span>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-label={`Reliability diagram — ${labelMetric}`}
        className="w-full overflow-visible"
        style={{ maxWidth: WIDTH }}
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line
              x1={toX(0)} y1={toY(v)}
              x2={toX(1)} y2={toY(v)}
              stroke="var(--color-line)"
              strokeOpacity={0.4}
              strokeDasharray="2 4"
            />
            <text
              x={PADDING.left - 6}
              y={toY(v) + 4}
              textAnchor="end"
              style={{ fill: "var(--color-ink-faint)", fontSize: 9 }}
            >
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}

        {/* Diagonal y=x (calibração perfeita) */}
        <line
          data-diagonal
          x1={toX(0)} y1={toY(0)}
          x2={toX(1)} y2={toY(1)}
          stroke="var(--color-ink-faint)"
          strokeDasharray="4 4"
          strokeWidth={1.5}
        />

        {/* Wilson 95% confidence bands */}
        {validBins.map((b, i) => {
          const x = toX(b.predictedAvg!);
          const obs = b.observedFreq!;
          const [lo, hi] = wilsonInterval(Math.round(obs * b.n), b.n);
          return (
            <line
              key={`ci-${i}`}
              x1={x} y1={toY(lo)}
              x2={x} y2={toY(hi)}
              stroke="var(--color-vermelho)"
              strokeOpacity={0.35}
              strokeWidth={2}
            />
          );
        })}

        {/* Data points — radius proporcional a n */}
        {validBins.map((b, i) => {
          const cx = toX(b.predictedAvg!);
          const cy = toY(b.observedFreq!);
          const r = 3 + (b.n / maxN) * 6;
          return (
            <circle
              key={`dot-${i}`}
              data-reliability-dot
              cx={cx}
              cy={cy}
              r={r}
              fill="var(--color-vermelho)"
              fillOpacity={0.8}
              stroke="var(--color-surface-1)"
              strokeWidth={1.5}
            >
              <title>
                Previsto: {Math.round(b.predictedAvg! * 100)}% · Observado:{" "}
                {Math.round(b.observedFreq! * 100)}% · n={b.n}
              </title>
            </circle>
          );
        })}

        {/* Axis labels */}
        <text
          x={toX(0.5)}
          y={HEIGHT - 4}
          textAnchor="middle"
          style={{ fill: "var(--color-ink-muted)", fontSize: 10 }}
        >
          previsto
        </text>
        <text
          x={8}
          y={toY(0.5)}
          textAnchor="middle"
          transform={`rotate(-90, 8, ${toY(0.5)})`}
          style={{ fill: "var(--color-ink-muted)", fontSize: 10 }}
        >
          observado
        </text>
      </svg>
      <p className="label text-[var(--color-ink-faint)]">
        Diagonal = calibração perfeita. Pontos maiores = mais amostras. Barras = IC 95% Wilson.
      </p>
    </div>
  );
}
