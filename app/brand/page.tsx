// ============================================================
// PÁGINA DE PREVIEW / DESCARTÁVEL — variações de identidade (frente D).
// NÃO faz parte do app autenticado: vive fora do route group (dashboard)
// E está em PUBLIC_PATHS do middleware (senão cai no /login).
// Animação 100% CSS (0 KB JS), GPU-only (transform/opacity/filter),
// respeita prefers-reduced-motion.
// Conceito escolhido: "estratos serenos". V1 = a original do 1º preview.
// Decisões técnicas: docs/pesquisas/identidade-animacao/04-svg-logo-favicon.md
// ============================================================

import type { Metadata } from "next";
import type { CSSProperties } from "react";

export const metadata: Metadata = {
  title: "Abissal — variações de identidade",
  robots: { index: false, follow: false },
};

type Stroke = "ink" | "depth" | "gradient";
type Glow = "subtle" | "medium" | "strong";
type BeaconPos = "below" | "mid";

type Variation = {
  id: string;
  name: string;
  count: number;
  topW: number;
  botW: number;
  stroke: Stroke;
  strokeW: number;
  beaconR: number;
  beaconPos: BeaconPos;
  glow: Glow;
  pace: string; // ex "2.6s"
  gc: string; // glow color (hex do farol)
  gcs: string; // glow soft (rgba externa)
  original?: boolean;
};

const Y_TOP = 26;
const Y_BOT = 68;

const VARIATIONS: Variation[] = [
  {
    id: "v1",
    name: "Original (no /brand)",
    count: 4,
    topW: 64,
    botW: 34,
    stroke: "ink",
    strokeW: 3.2,
    beaconR: 4,
    beaconPos: "below",
    glow: "medium",
    pace: "2.6s",
    gc: "#d43535",
    gcs: "rgba(196,43,43,.45)",
    original: true,
  },
  {
    id: "v2",
    name: "Raso (3 estratos)",
    count: 3,
    topW: 62,
    botW: 40,
    stroke: "ink",
    strokeW: 3.2,
    beaconR: 4,
    beaconPos: "below",
    glow: "medium",
    pace: "2.6s",
    gc: "#d43535",
    gcs: "rgba(196,43,43,.45)",
  },
  {
    id: "v3",
    name: "Profundo (6 estratos)",
    count: 6,
    topW: 68,
    botW: 28,
    stroke: "ink",
    strokeW: 3.0,
    beaconR: 4,
    beaconPos: "below",
    glow: "medium",
    pace: "2.6s",
    gc: "#d43535",
    gcs: "rgba(196,43,43,.45)",
  },
  {
    id: "v4",
    name: "Abissal denso (7 finos)",
    count: 7,
    topW: 70,
    botW: 22,
    stroke: "ink",
    strokeW: 2.6,
    beaconR: 3.6,
    beaconPos: "below",
    glow: "medium",
    pace: "2.8s",
    gc: "#d43535",
    gcs: "rgba(196,43,43,.45)",
  },
  {
    id: "v5",
    name: "Oceânico (estratos azuis)",
    count: 4,
    topW: 64,
    botW: 34,
    stroke: "depth",
    strokeW: 3.2,
    beaconR: 4.2,
    beaconPos: "below",
    glow: "medium",
    pace: "2.6s",
    gc: "#d43535",
    gcs: "rgba(196,43,43,.45)",
  },
  {
    id: "v6",
    name: "Descida (gradiente)",
    count: 5,
    topW: 66,
    botW: 30,
    stroke: "gradient",
    strokeW: 3.2,
    beaconR: 4.2,
    beaconPos: "below",
    glow: "medium",
    pace: "2.8s",
    gc: "#d43535",
    gcs: "rgba(196,43,43,.45)",
  },
  {
    id: "v7",
    name: "Farol neon",
    count: 4,
    topW: 62,
    botW: 34,
    stroke: "ink",
    strokeW: 3.2,
    beaconR: 4.6,
    beaconPos: "below",
    glow: "strong",
    pace: "2.2s",
    gc: "#ff3b3b",
    gcs: "rgba(255,59,59,.55)",
  },
  {
    id: "v8",
    name: "Sussurro (glow sutil)",
    count: 4,
    topW: 58,
    botW: 36,
    stroke: "ink",
    strokeW: 2.4,
    beaconR: 3.2,
    beaconPos: "below",
    glow: "subtle",
    pace: "3.0s",
    gc: "#d43535",
    gcs: "rgba(196,43,43,.4)",
  },
  {
    id: "v9",
    name: "Bold (traço grosso)",
    count: 4,
    topW: 70,
    botW: 42,
    stroke: "ink",
    strokeW: 4.4,
    beaconR: 5.4,
    beaconPos: "below",
    glow: "medium",
    pace: "2.4s",
    gc: "#d43535",
    gcs: "rgba(196,43,43,.5)",
  },
  {
    id: "v10",
    name: "Luz no meio",
    count: 5,
    topW: 66,
    botW: 30,
    stroke: "ink",
    strokeW: 3.2,
    beaconR: 4,
    beaconPos: "mid",
    glow: "medium",
    pace: "2.6s",
    gc: "#d43535",
    gcs: "rgba(196,43,43,.45)",
  },
];

function strataLines(v: Variation) {
  const n = v.count;
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    return {
      y: Y_TOP + (Y_BOT - Y_TOP) * t,
      w: v.topW + (v.botW - v.topW) * t,
      op: 0.95 + (0.34 - 0.95) * t,
    };
  });
}

function strokeColor(v: Variation, size: number) {
  if (v.stroke === "depth") return "#2272c8";
  if (v.stroke === "gradient") return `url(#g-${v.id}-${size})`;
  return "#f8f5ef";
}

function corLabel(s: Stroke) {
  return s === "depth" ? "azul-abismo" : s === "gradient" ? "gradiente" : "marfim";
}

function Mark({
  v,
  size,
  animated = true,
}: {
  v: Variation;
  size: number;
  animated?: boolean;
}) {
  const lines = strataLines(v);
  const last = lines[lines.length - 1].y;
  const prev = lines[lines.length - 2]?.y ?? last - 8;
  const beaconCy = v.beaconPos === "mid" ? (last + prev) / 2 : last + 12;
  const beaconStyle = {
    "--gc": v.gc,
    "--gcs": v.gcs,
    "--pace": v.pace,
  } as CSSProperties;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`mark${animated ? "" : " no-anim"}`}
      role="img"
      aria-label="Abissal"
    >
      {v.stroke === "gradient" && (
        <defs>
          <linearGradient id={`g-${v.id}-${size}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f8f5ef" />
            <stop offset="100%" stopColor="#2272c8" />
          </linearGradient>
        </defs>
      )}
      {lines.map((l, i) => (
        <line
          key={i}
          className="strata-line"
          x1={50 - l.w / 2}
          y1={l.y}
          x2={50 + l.w / 2}
          y2={l.y}
          stroke={strokeColor(v, size)}
          strokeOpacity={l.op}
          strokeWidth={v.strokeW}
          strokeLinecap="round"
          style={{ animationDelay: `${0.1 + i * 0.1}s` }}
        />
      ))}
      <circle
        className={`beacon glow-${v.glow}`}
        cx={50}
        cy={beaconCy}
        r={v.beaconR}
        fill={v.gc}
        style={beaconStyle}
      />
    </svg>
  );
}

function Lockup({ size }: { size: number }) {
  return (
    <span className="inline-flex items-center gap-3">
      <Mark v={VARIATIONS[0]} size={size} />
      <span
        className="wordmark leading-none text-[var(--color-ink-display)]"
        style={{ fontSize: size * 0.62 }}
      >
        ab
        <span className="i-wrap">
          {"ı"}
          <span className="i-dot" />
        </span>
        ssal
      </span>
    </span>
  );
}

const CSS = `
.mark .strata-line {
  transform-box: fill-box; transform-origin: center;
  animation: rise .9s cubic-bezier(.16,1,.3,1) backwards;
}
@keyframes rise { from{transform:scaleX(0);opacity:0} to{transform:scaleX(1);opacity:1} }
.mark .beacon {
  transform-box: fill-box; transform-origin: center;
  filter: drop-shadow(0 0 3px var(--gc));
}
.mark .glow-subtle { animation: gs var(--pace,2.6s) ease-in-out 1s infinite; }
.mark .glow-medium { animation: gm var(--pace,2.6s) ease-in-out 1s infinite; }
.mark .glow-strong { animation: gst var(--pace,2.6s) ease-in-out 1s infinite; }
@keyframes gs {
  0%,100% { transform:scale(1);   filter:drop-shadow(0 0 1.5px var(--gc)); }
  50%     { transform:scale(1.1); filter:drop-shadow(0 0 3px var(--gc)) drop-shadow(0 0 7px var(--gcs)); }
}
@keyframes gm {
  0%,100% { transform:scale(1);    filter:drop-shadow(0 0 1px var(--gc)) drop-shadow(0 0 4px var(--gc)); }
  50%     { transform:scale(1.16); filter:drop-shadow(0 0 2px var(--gc)) drop-shadow(0 0 9px var(--gc)) drop-shadow(0 0 18px var(--gcs)); }
}
@keyframes gst {
  0%,100% { transform:scale(1.04); filter:drop-shadow(0 0 2px var(--gc)) drop-shadow(0 0 7px var(--gc)); }
  50%     { transform:scale(1.22); filter:drop-shadow(0 0 3px var(--gc)) drop-shadow(0 0 15px var(--gc)) drop-shadow(0 0 28px var(--gcs)); }
}
.mark.no-anim .strata-line, .mark.no-anim .beacon { animation: none; }
@media (prefers-reduced-motion: reduce) {
  .mark .strata-line, .mark .beacon { animation: none !important; }
  .mark .strata-line { opacity: 1; }
  .mark .beacon { filter: drop-shadow(0 0 4px var(--gc)); }
}
.wordmark { font-family: var(--font-fraunces), Georgia, serif; font-weight: 300; letter-spacing: -.02em; }
.i-wrap { position: relative; }
.i-dot {
  position: absolute; left: 50%; top: .02em;
  width: .15em; height: .15em; transform: translateX(-50%);
  border-radius: 50%; background: #d43535; filter: drop-shadow(0 0 .05em #c42b2b);
}
`;

export default function BrandVariationsPage() {
  return (
    <>
      <style>{CSS}</style>
      <main id="main" className="mx-auto max-w-6xl px-6 py-16">
        <p className="label mb-3 text-[var(--color-ink-muted)]">
          preview descartável · frente D · identidade
        </p>
        <h1 className="mb-4 text-[clamp(2.5rem,6vw,4.5rem)]">estratos serenos · 10 variações</h1>
        <p className="mb-2 max-w-2xl text-[var(--color-ink-muted)]">
          O conceito escolhido, variado em <strong className="text-[var(--color-ink)]">nº de estratos</strong>,{" "}
          <strong className="text-[var(--color-ink)]">cor</strong>,{" "}
          <strong className="text-[var(--color-ink)]">intensidade do glow</strong>, espessura, tamanho/posição do
          farol e ritmo. Animação 100% CSS, sobre o void real do app.
        </p>
        <p className="mb-12 max-w-2xl text-sm text-[var(--color-ink-faint)]">
          <strong className="text-[var(--color-vermelho-hi)]">V1</strong> é a original que estava no /brand. Me diz o
          número (V1–V10) que mais te pega — dá pra cruzar parâmetros depois (ex: “a V3 com o farol da V7”).
        </p>

        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {VARIATIONS.map((v, i) => (
            <article
              key={v.id}
              className="relative rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-1)] p-6"
            >
              <span className="label absolute left-4 top-4 text-[var(--color-ink-faint)]">
                V{i + 1}
              </span>
              {v.original && (
                <span className="label absolute right-4 top-4 rounded bg-[var(--color-vermelho)] px-2 py-1 text-[var(--color-ink-display)]">
                  original
                </span>
              )}
              <div className="flex h-36 items-center justify-center gap-6">
                <Mark v={v} size={120} />
                <div className="flex flex-col items-center gap-1">
                  <Mark v={v} size={32} animated={false} />
                  <span className="num text-[10px] text-[var(--color-ink-faint)]">32px</span>
                </div>
              </div>
              <h2 className="mb-2 mt-1 text-xl">{v.name}</h2>
              <p className="num text-xs leading-relaxed text-[var(--color-ink-muted)]">
                {v.count} estratos · {corLabel(v.stroke)} · glow {v.glow} · traço {v.strokeW} · farol r{v.beaconR}
                {v.beaconPos === "mid" ? " (no meio)" : ""} · {v.pace}
              </p>
            </article>
          ))}
        </section>

        <section className="mt-14 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-1)] p-8">
          <p className="label mb-6 text-[var(--color-ink-faint)]">
            lockup editorial (usando a V1) · Fraunces 300 · o pingo do “i” é o farol
          </p>
          <div className="flex flex-col gap-8">
            <Lockup size={72} />
            <Lockup size={40} />
          </div>
        </section>

        <p className="mt-12 text-sm text-[var(--color-ink-faint)]">
          Preview descartável. Escolhida a variação (ou o cruzamento), eu produzo favicon, app/icon.svg dark/light,
          PWA icons + o spec da identidade.
        </p>
      </main>
    </>
  );
}
