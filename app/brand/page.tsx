// ============================================================
// PÁGINA DE PREVIEW / DESCARTÁVEL — conceitos de identidade (frente D).
// NÃO faz parte do app autenticado: vive fora do route group (dashboard),
// logo é pública e sem gate de login. Animação 100% CSS (0 KB JS),
// GPU-only (transform/opacity/filter) e respeita prefers-reduced-motion.
// Remover (ou trancar atrás de flag) depois que o conceito for escolhido.
// Decisões técnicas: docs/pesquisas/identidade-animacao/04-svg-logo-favicon.md
// ============================================================

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Abissal — conceitos de identidade",
  robots: { index: false, follow: false },
};

type Variant = "strata" | "funnel" | "echo";

const LINES: Record<Variant, { y: number; w: number; op: number }[]> = {
  // estratos serenos — afunilamento suave, quase paralelo (casa com --texture-strata)
  strata: [
    { y: 32, w: 64, op: 0.92 },
    { y: 44, w: 54, op: 0.72 },
    { y: 56, w: 44, op: 0.54 },
    { y: 68, w: 34, op: 0.4 },
  ],
  // funil — convergência forte pro ponto de luz (direcional, "edge")
  funnel: [
    { y: 30, w: 70, op: 0.92 },
    { y: 44, w: 50, op: 0.72 },
    { y: 58, w: 32, op: 0.54 },
    { y: 70, w: 16, op: 0.4 },
  ],
  // eco — poucos estratos largos + farol grande emanando anéis (luz protagonista)
  echo: [
    { y: 30, w: 66, op: 0.92 },
    { y: 42, w: 58, op: 0.72 },
    { y: 54, w: 48, op: 0.54 },
  ],
};

const BEACON: Record<Variant, { cy: number; r: number }> = {
  strata: { cy: 82, r: 4 },
  funnel: { cy: 84, r: 4 },
  echo: { cy: 72, r: 5.4 },
};

function Mark({
  variant,
  size,
  animated = true,
}: {
  variant: Variant;
  size: number;
  animated?: boolean;
}) {
  const lines = LINES[variant];
  const beacon = BEACON[variant];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`mark${animated ? "" : " static"}`}
      role="img"
      aria-label="Abissal"
    >
      {variant === "echo" && animated && (
        <>
          <circle
            className="echo"
            cx={50}
            cy={beacon.cy}
            r={beacon.r}
            fill="none"
            stroke="#c42b2b"
            strokeWidth={2}
            style={{ animationDelay: "0s" }}
          />
          <circle
            className="echo"
            cx={50}
            cy={beacon.cy}
            r={beacon.r}
            fill="none"
            stroke="#c42b2b"
            strokeWidth={2}
            style={{ animationDelay: "1.3s" }}
          />
        </>
      )}
      {lines.map((l, i) => (
        <line
          key={i}
          className="strata-line"
          x1={50 - l.w / 2}
          y1={l.y}
          x2={50 + l.w / 2}
          y2={l.y}
          stroke="#f8f5ef"
          strokeOpacity={l.op}
          strokeWidth={3.2}
          strokeLinecap="round"
          style={{ animationDelay: `${0.1 + i * 0.12}s` }}
        />
      ))}
      <circle className="beacon" cx={50} cy={beacon.cy} r={beacon.r} fill="#d43535" />
    </svg>
  );
}

const CONCEPTS: {
  variant: Variant;
  name: string;
  desc: string;
  recommended?: boolean;
}[] = [
  {
    variant: "strata",
    name: "Estratos serenos",
    desc: "Camadas quase paralelas afunilando devagar — ecoa o --texture-strata do app. Ordenado, editorial.",
    recommended: true,
  },
  {
    variant: "funnel",
    name: "Funil / convergência",
    desc: "Tudo converge agressivamente pro ponto de luz. Direcional, sugere foco e descida ao edge.",
  },
  {
    variant: "echo",
    name: "Eco / sonar",
    desc: "Poucos estratos largos e o farol emanando anéis. A luz é protagonista — bioluminescência forte.",
  },
];

function Lockup({ size }: { size: number }) {
  return (
    <span className="inline-flex items-center gap-3">
      <Mark variant="strata" size={size} />
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
  transform-box: fill-box;
  transform-origin: center;
  animation: strata-rise .9s cubic-bezier(.16,1,.3,1) backwards;
}
.mark .beacon {
  transform-box: fill-box;
  transform-origin: center;
  filter: drop-shadow(0 0 3px #c42b2b);
  animation: beacon-pulse 2.6s ease-in-out 1s infinite;
}
.mark .echo {
  transform-box: fill-box;
  transform-origin: center;
  animation: echo-out 2.6s ease-out infinite;
}
.mark.static .strata-line,
.mark.static .beacon { animation: none; }
@keyframes strata-rise {
  from { transform: scaleX(0); opacity: 0; }
  to   { transform: scaleX(1); opacity: 1; }
}
@keyframes beacon-pulse {
  0%, 100% { transform: scale(1);    filter: drop-shadow(0 0 1px #d43535) drop-shadow(0 0 4px #c42b2b); }
  50%      { transform: scale(1.16); filter: drop-shadow(0 0 2px #d43535) drop-shadow(0 0 9px #c42b2b) drop-shadow(0 0 18px rgba(196,43,43,.45)); }
}
@keyframes echo-out {
  0%   { transform: scale(.5);  opacity: .55; }
  100% { transform: scale(1.7); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .mark .strata-line, .mark .beacon, .mark .echo { animation: none !important; }
  .mark .strata-line { opacity: 1; }
  .mark .echo { opacity: 0; }
}
.wordmark { font-family: var(--font-fraunces), Georgia, serif; font-weight: 300; letter-spacing: -.02em; }
.i-wrap { position: relative; }
.i-dot {
  position: absolute;
  left: 50%;
  top: .02em;
  width: .15em;
  height: .15em;
  transform: translateX(-50%);
  border-radius: 50%;
  background: #d43535;
  filter: drop-shadow(0 0 .05em #c42b2b);
}
`;

export default function BrandPreviewPage() {
  return (
    <>
      <style>{CSS}</style>
      <main id="main" className="mx-auto max-w-5xl px-6 py-16">
        <p className="label mb-3 text-[var(--color-ink-muted)]">
          preview descartável · frente D · identidade
        </p>
        <h1 className="mb-4 text-[clamp(2.5rem,6vw,4.5rem)]">conceitos de logo</h1>
        <p className="mb-2 max-w-2xl text-[var(--color-ink-muted)]">
          Direção <strong className="text-[var(--color-ink)]">abismo + bioluminescência</strong>,
          forma <strong className="text-[var(--color-ink)]">estratos + farol</strong>. Três
          geometrias da mesma ideia — escolha uma e eu produzo os assets finais. Animação 100% CSS,
          GPU, respeita <span className="num">prefers-reduced-motion</span>.
        </p>
        <p className="mb-12 max-w-2xl text-sm text-[var(--color-ink-faint)]">
          O fundo é o void real do app (note a textura de estratos horizontais) — o logo nasce dela.
        </p>

        <section className="grid gap-6 sm:grid-cols-3">
          {CONCEPTS.map((c) => (
            <article
              key={c.variant}
              className="relative rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-1)] p-6"
            >
              {c.recommended && (
                <span className="label absolute right-4 top-4 rounded bg-[var(--color-vermelho)] px-2 py-1 text-[var(--color-ink-display)]">
                  recomendado
                </span>
              )}
              <div className="flex h-40 items-center justify-center">
                <Mark variant={c.variant} size={132} />
              </div>
              <h2 className="mb-2 mt-2 text-2xl">{c.name}</h2>
              <p className="mb-5 text-sm text-[var(--color-ink-muted)]">{c.desc}</p>

              <p className="label mb-2 text-[var(--color-ink-faint)]">escala (favicon → header)</p>
              <div className="flex items-end gap-4 rounded-[var(--radius)] border border-[var(--color-line-subtle)] bg-[var(--color-void)] p-4">
                {[16, 24, 32, 48].map((s) => (
                  <div key={s} className="flex flex-col items-center gap-2">
                    <Mark variant={c.variant} size={s} animated={false} />
                    <span className="num text-[10px] text-[var(--color-ink-faint)]">{s}px</span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>

        {/* Lockup + favicon mock — aplicados ao recomendado */}
        <section className="mt-14 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-1)] p-8">
          <p className="label mb-6 text-[var(--color-ink-faint)]">
            lockup editorial · Fraunces 300 lowercase · o pingo do “i” é o farol
          </p>
          <div className="flex flex-col gap-10">
            <Lockup size={84} />
            <Lockup size={44} />
            <div className="flex items-center gap-3">
              <Lockup size={26} />
            </div>
          </div>

          <p className="label mb-3 mt-12 text-[var(--color-ink-faint)]">favicon na aba do navegador</p>
          <div className="inline-flex items-center gap-2 rounded-t-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2">
            <Mark variant="strata" size={16} animated={false} />
            <span className="text-sm text-[var(--color-ink-muted)]">Abissal — gestão de banca</span>
            <span className="ml-2 text-[var(--color-ink-faint)]">✕</span>
          </div>
        </section>

        <p className="mt-12 text-sm text-[var(--color-ink-faint)]">
          Preview descartável. Escolha 1 geometria (ou peça ajustes) e eu produzo favicon,
          app/icon.svg, versões dark/light + o spec da identidade.
        </p>
      </main>
    </>
  );
}
