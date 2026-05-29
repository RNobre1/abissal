// AbissalMark — o mark "estratos + farol" da identidade (frente D).
// SVG puro, sem "use client" (usável em RSC). Animação 100% CSS via classes
// definidas em globals.css (.abissal-mark / .abissal-strata / .abissal-beacon),
// GPU-only e com prefers-reduced-motion. Quando data-animated="false", o CSS
// desliga a animação (estado estático — favicon/ícone).
// Geometria/glow G2: docs/superpowers/specs/2026-05-29-identidade-visual-design.md §3.

const Y_TOP = 26;
const Y_BOT = 68;
const COUNT = 4;
const TOP_W = 64;
const BOT_W = 34;

const STRATA = Array.from({ length: COUNT }, (_, i) => {
  const t = i / (COUNT - 1);
  return {
    y: Y_TOP + (Y_BOT - Y_TOP) * t,
    w: TOP_W + (BOT_W - TOP_W) * t,
    op: 0.95 + (0.34 - 0.95) * t,
  };
});
const BEACON_CY = STRATA[STRATA.length - 1].y + 12;

export type AbissalMarkProps = {
  /** lado do quadrado, em px (viewBox é 100×100) */
  size?: number;
  /** false = estático (favicon/ícone); true = farol pulsa + estratos sobem */
  animated?: boolean;
  /** aria-label do SVG */
  title?: string;
  className?: string;
};

export function AbissalMark({
  size = 32,
  animated = true,
  title = "Abissal",
  className,
}: AbissalMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={title}
      data-animated={animated ? "true" : "false"}
      className={className ? `abissal-mark ${className}` : "abissal-mark"}
    >
      {STRATA.map((l, i) => (
        <line
          key={i}
          className="abissal-strata"
          x1={50 - l.w / 2}
          y1={l.y}
          x2={50 + l.w / 2}
          y2={l.y}
          stroke="#f8f5ef"
          strokeOpacity={l.op}
          strokeWidth={3.2}
          strokeLinecap="round"
          style={{ animationDelay: `${0.1 + i * 0.1}s` }}
        />
      ))}
      <circle className="abissal-beacon" cx={50} cy={BEACON_CY} r={4} fill="#d43535" />
    </svg>
  );
}
