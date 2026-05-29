// ============================================================
// PÁGINA DE PREVIEW / DESCARTÁVEL — afinação do glow (frente D).
// Geometria fixa = V1 "estratos serenos" (a escolhida). Varia só a
// INTENSIDADE do glow: V1 (medium) e V7 (neon) nas pontas como régua;
// G1/G2/G3 são candidatos ao "entre os dois". Farol vermelho clássico
// (#d43535); só a V7 é neon (referência).
// Pública via PUBLIC_PATHS do middleware. Animação 100% CSS, GPU,
// respeita prefers-reduced-motion.
// ============================================================

import type { Metadata } from "next";
import type { CSSProperties } from "react";

export const metadata: Metadata = {
  title: "Abissal — afinando o glow",
  robots: { index: false, follow: false },
};

// Geometria fixa da V1 (estratos serenos): 4 estratos marfim afunilando.
const Y_TOP = 26;
const Y_BOT = 68;
const COUNT = 4;
const TOP_W = 64;
const BOT_W = 34;
const STROKE_W = 3.2;
const BEACON_R = 4;

const LINES = Array.from({ length: COUNT }, (_, i) => {
  const t = i / (COUNT - 1);
  return {
    y: Y_TOP + (Y_BOT - Y_TOP) * t,
    w: TOP_W + (BOT_W - TOP_W) * t,
    op: 0.95 + (0.34 - 0.95) * t,
  };
});
const BEACON_CY = LINES[LINES.length - 1].y + 12;

type Tuning = {
  id: string;
  name: string;
  blurb: string;
  s1: number; // scale no pico
  b1: number;
  b2: number; // raios base (px)
  p1: number;
  p2: number;
  p3: number; // raios no pico (px)
  gc: string; // cor do farol
  gcs: string; // cor externa difusa (rgba)
  pace: string;
  isRef?: boolean;
  star?: boolean;
};

const TUNINGS: Tuning[] = [
  {
    id: "ref-a",
    name: "V1 — original",
    blurb: "régua (mín.) · medium",
    s1: 1.16, b1: 1, b2: 4, p1: 2, p2: 9, p3: 18,
    gc: "#d43535", gcs: "rgba(196,43,43,.45)", pace: "2.6s",
    isRef: true,
  },
  {
    id: "g1",
    name: "G1 — sutil+",
    blurb: "um passo acima da V1",
    s1: 1.18, b1: 1.5, b2: 5, p1: 2.5, p2: 11, p3: 21,
    gc: "#d43535", gcs: "rgba(196,43,43,.48)", pace: "2.5s",
  },
  {
    id: "g2",
    name: "G2 — meio-termo",
    blurb: "meu palpite do “entre os dois”",
    s1: 1.2, b1: 1.5, b2: 6, p1: 3, p2: 13, p3: 24,
    gc: "#d43535", gcs: "rgba(196,43,43,.5)", pace: "2.4s",
    star: true,
  },
  {
    id: "g3",
    name: "G3 — forte",
    blurb: "quase V7, mas vermelho clássico",
    s1: 1.21, b1: 2, b2: 7, p1: 3, p2: 15, p3: 27,
    gc: "#d43535", gcs: "rgba(196,43,43,.52)", pace: "2.3s",
  },
  {
    id: "ref-b",
    name: "V7 — neon",
    blurb: "régua (máx.) · neon",
    s1: 1.22, b1: 2, b2: 7, p1: 3, p2: 15, p3: 28,
    gc: "#ff3b3b", gcs: "rgba(255,59,59,.55)", pace: "2.2s",
    isRef: true,
  },
];

function Mark({
  t,
  size,
  animated = true,
}: {
  t: Tuning;
  size: number;
  animated?: boolean;
}) {
  const style = {
    "--gc": t.gc,
    "--gcs": t.gcs,
    "--pace": t.pace,
    "--s1": t.s1,
    "--b1": `${t.b1}px`,
    "--b2": `${t.b2}px`,
    "--p1": `${t.p1}px`,
    "--p2": `${t.p2}px`,
    "--p3": `${t.p3}px`,
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
      {LINES.map((l, i) => (
        <line
          key={i}
          className="strata-line"
          x1={50 - l.w / 2}
          y1={l.y}
          x2={50 + l.w / 2}
          y2={l.y}
          stroke="#f8f5ef"
          strokeOpacity={l.op}
          strokeWidth={STROKE_W}
          strokeLinecap="round"
          style={{ animationDelay: `${0.1 + i * 0.1}s` }}
        />
      ))}
      <circle
        className={`beacon${animated ? " anim" : ""}`}
        cx={50}
        cy={BEACON_CY}
        r={BEACON_R}
        fill={t.gc}
        style={style}
      />
    </svg>
  );
}

function Lockup({ size }: { size: number }) {
  const g2 = TUNINGS[2];
  return (
    <span className="inline-flex items-center gap-3">
      <Mark t={g2} size={size} />
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
  filter: drop-shadow(0 0 var(--b1) var(--gc)) drop-shadow(0 0 var(--b2) var(--gc));
}
.mark .beacon.anim { animation: pulse var(--pace,2.4s) ease-in-out 1s infinite; }
@keyframes pulse {
  0%,100% { transform: scale(1);         filter: drop-shadow(0 0 var(--b1) var(--gc)) drop-shadow(0 0 var(--b2) var(--gc)); }
  50%     { transform: scale(var(--s1)); filter: drop-shadow(0 0 var(--p1) var(--gc)) drop-shadow(0 0 var(--p2) var(--gc)) drop-shadow(0 0 var(--p3) var(--gcs)); }
}
.mark.no-anim .strata-line, .mark.no-anim .beacon { animation: none; }
@media (prefers-reduced-motion: reduce) {
  .mark .strata-line, .mark .beacon { animation: none !important; }
  .mark .strata-line { opacity: 1; }
}
.wordmark { font-family: var(--font-fraunces), Georgia, serif; font-weight: 300; letter-spacing: -.02em; }
.i-wrap { position: relative; }
.i-dot {
  position: absolute; left: 50%; top: .02em;
  width: .15em; height: .15em; transform: translateX(-50%);
  border-radius: 50%; background: #d43535; filter: drop-shadow(0 0 .05em #c42b2b);
}
`;

export default function GlowTuningPage() {
  return (
    <>
      <style>{CSS}</style>
      <main id="main" className="mx-auto max-w-6xl px-6 py-16">
        <p className="label mb-3 text-[var(--color-ink-muted)]">
          preview descartável · frente D · afinando o glow
        </p>
        <h1 className="mb-4 text-[clamp(2.5rem,6vw,4.5rem)]">estratos serenos · glow</h1>
        <p className="mb-2 max-w-2xl text-[var(--color-ink-muted)]">
          Geometria da <strong className="text-[var(--color-ink)]">V1 (original)</strong> fixa — variei só a{" "}
          <strong className="text-[var(--color-ink)]">intensidade do glow</strong>. As pontas em cinza (V1 e V7) são a{" "}
          <strong className="text-[var(--color-ink)]">régua</strong>; os três do meio são candidatos ao “entre os dois”.
        </p>
        <p className="mb-12 max-w-2xl text-sm text-[var(--color-ink-faint)]">
          <strong className="text-[var(--color-vermelho-hi)]">G2</strong> é meu palpite. Farol no vermelho clássico
          (#d43535) em todos; só a V7 é neon, pra referência. Me diz: G1, G2 ou G3 (ou “um meio de G2 e G3”).
        </p>

        <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {TUNINGS.map((t) => (
            <article
              key={t.id}
              className={`relative rounded-[var(--radius-lg)] border p-5 ${
                t.star
                  ? "border-[var(--color-vermelho)] bg-[var(--color-surface-2)]"
                  : t.isRef
                    ? "border-[var(--color-line-subtle)] bg-transparent opacity-80"
                    : "border-[var(--color-line)] bg-[var(--color-surface-1)]"
              }`}
            >
              {t.star && (
                <span className="label absolute right-3 top-3 rounded bg-[var(--color-vermelho)] px-1.5 py-0.5 text-[var(--color-ink-display)]">
                  ★
                </span>
              )}
              {t.isRef && (
                <span className="label absolute right-3 top-3 text-[var(--color-ink-faint)]">
                  régua
                </span>
              )}
              <div className="flex h-28 items-center justify-center">
                <Mark t={t} size={104} />
              </div>
              <h2 className="mt-1 text-base">{t.name}</h2>
              <p className="mb-3 text-xs text-[var(--color-ink-muted)]">{t.blurb}</p>
              <div className="flex items-end gap-3 rounded-[var(--radius)] border border-[var(--color-line-subtle)] bg-[var(--color-void)] p-3">
                {[16, 32].map((s) => (
                  <div key={s} className="flex flex-col items-center gap-1">
                    <Mark t={t} size={s} animated={false} />
                    <span className="num text-[9px] text-[var(--color-ink-faint)]">{s}px</span>
                  </div>
                ))}
                <span className="num ml-auto text-[10px] text-[var(--color-ink-faint)]">
                  pico ~{t.p2}px · {t.pace}
                </span>
              </div>
            </article>
          ))}
        </section>

        <section className="mt-14 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-1)] p-8">
          <p className="label mb-6 text-[var(--color-ink-faint)]">
            lockup com o glow G2 · Fraunces 300 · o pingo do “i” é o farol
          </p>
          <div className="flex flex-col gap-8">
            <Lockup size={72} />
            <Lockup size={40} />
          </div>
        </section>

        <p className="mt-12 text-sm text-[var(--color-ink-faint)]">
          Cravado o glow, produzo favicon, app/icon.svg dark/light, PWA icons + o spec da identidade.
        </p>
      </main>
    </>
  );
}
