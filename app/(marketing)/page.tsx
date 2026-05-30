// Landing pré-login do Abissal (frente E) — servida em "/" (raiz pública).
// O middleware redireciona usuário autenticado pra /painel; deslogado vê isto.
// F2 casca · F3 scroll-driven · F4 partículas · F5 shader WebGL (lazy+fallback).
// W3: split-word reveal (palavras em cadeia) + depth markers + ritmo das cenas.
// Spec: docs/superpowers/specs/2026-05-29-landing-pre-login-design.md

import "./landing.css";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { AbissalMark } from "@/components/brand/abissal-mark";
import { AbyssShader } from "@/components/marketing/abyss-shader";
import { ParticlesCanvas } from "@/components/marketing/particles-canvas";

export const metadata: Metadata = {
  title: "Abissal — aposte com luz própria",
  description:
    "O mercado é um abismo. A maioria aposta no escuro. O Abissal gera o próprio sinal: análise, edge e disciplina.",
  robots: { index: false, follow: false },
};

const sceneText =
  "max-w-[24ch] text-center font-[family-name:var(--font-display)] font-light text-[var(--color-ink-display)]";
const sceneSize = {
  fontSize: "clamp(1.75rem,4vw,3rem)",
  letterSpacing: "-0.02em",
  lineHeight: 1.12,
} as const;

// Cada palavra emerge da água em cadeia (--i alimenta o stagger no CSS).
function SplitWords({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((w, i) => (
        <span
          key={i}
          className="landing-word"
          style={{ "--i": i } as CSSProperties}
        >
          {i < words.length - 1 ? `${w} ` : w}
        </span>
      ))}
    </>
  );
}

function DepthMark({ children }: { children: string }) {
  return (
    <span className="landing-depth num pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-[10px] tracking-[0.25em] text-[var(--color-ink-faint)]">
      {children}
    </span>
  );
}

const SCENES: { text: string; depth: string; minH: string }[] = [
  {
    text: "O mercado é um abismo. Sem fundo. Sob pressão.",
    depth: "200 m",
    minH: "85svh",
  },
  {
    text: "Abaixo de certa profundidade, a luz do sol não chega. A maioria afunda.",
    depth: "1 000 m",
    minH: "85svh",
  },
  {
    text: "Mas o abismo é habitado. O que vive aqui não espera a luz vir de fora—",
    depth: "4 000 m",
    minH: "115svh",
  },
];

export default function LandingPage() {
  return (
    <>
      {/* Fundo ambiente fixo. z positivos baixos (z negativo ficaria atrás do
          background opaco do body). Conteúdo em z-10. */}
      <AbyssShader className="fixed inset-0 z-0" />
      <ParticlesCanvas className="fixed inset-0 z-[1]" />
      <div
        aria-hidden
        className="landing-darken pointer-events-none fixed inset-0 z-[2] bg-black"
      />

      <main id="main" className="relative z-10">
        {/* Cena 0 — superfície / hero */}
        <section className="flex min-h-[100svh] flex-col items-center justify-center gap-6 px-6 text-center">
          <AbissalMark size={132} title="Abissal" />
          <h1 className="landing-rise lowercase" style={{ fontSize: "clamp(3rem,9vw,6rem)" }}>
            abissal
          </h1>
          <p className="landing-reveal max-w-md text-lg text-[var(--color-ink-muted)]">
            A maioria aposta no escuro.
          </p>
          <p className="landing-reveal label text-[var(--color-ink-faint)]">
            gestão de banca · análise pré-jogo de futebol
          </p>
          <Link
            href="/login"
            className="landing-reveal mt-2 rounded-[var(--radius)] bg-[var(--color-vermelho)] px-8 py-3.5 text-[var(--color-ink-display)] transition-colors hover:bg-[var(--color-vermelho-hi)]"
          >
            entrar
          </Link>
          <span className="landing-scroll-hint label mt-8 animate-pulse text-[var(--color-ink-faint)]">
            ↓ role para descer
          </span>
        </section>

        {/* Cenas 1–3 — a descida */}
        {SCENES.map((s, i) => (
          <section
            key={i}
            className="relative flex items-center justify-center px-6"
            style={{ minHeight: s.minH }}
          >
            <DepthMark>{s.depth}</DepthMark>
            <p className={sceneText} style={sceneSize}>
              <SplitWords text={s.text} />
            </p>
          </section>
        ))}

        {/* Cena 4 — o farol (clímax) */}
        <section className="relative flex min-h-[100svh] flex-col items-center justify-center gap-10 px-6 text-center">
          <DepthMark>6 000 m · zona hadal</DepthMark>
          <AbissalMark size={160} title="Abissal" className="landing-rise" />
          <p className={sceneText} style={sceneSize}>
            <SplitWords text="—gera a própria. Análise. Edge. Disciplina." />{" "}
            <span style={{ color: "var(--color-vermelho-hi)" }}>
              <SplitWords text="Sua luz no escuro." />
            </span>
          </p>
        </section>

        {/* Cena 5 — convite */}
        <section className="flex min-h-[100svh] flex-col items-center justify-center gap-8 px-6 text-center">
          <AbissalMark size={96} title="Abissal" className="landing-reveal" />
          <h2 className="landing-reveal lowercase" style={{ fontSize: "clamp(2.5rem,7vw,4.5rem)" }}>
            abissal
          </h2>
          <Link
            href="/login"
            className="landing-reveal rounded-[var(--radius)] bg-[var(--color-vermelho)] px-8 py-3.5 text-[var(--color-ink-display)] transition-colors hover:bg-[var(--color-vermelho-hi)]"
          >
            entrar
          </Link>
          <p className="landing-reveal label text-[var(--color-ink-faint)]">
            gestão de banca · análise pré-jogo
          </p>
        </section>
      </main>
    </>
  );
}
