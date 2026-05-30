// Landing pré-login do Abissal (frente E) — servida em "/" (raiz pública).
// O middleware redireciona usuário autenticado pra /painel; deslogado vê isto.
// F2: casca SSR (poema de 6 cenas + copy + hero + CTA).
// F3: scroll-driven CSS (landing.css) — reveals por cena, 0 KB JS.
// F4: ParticlesCanvas (canvas 2D bioluminescente). F5: AbyssShader (WebGL via ogl, lazy + fallback).
// Fundo ambiente FIXO (shader → partículas → overlay de descida) atrás do conteúdo.
// Spec: docs/superpowers/specs/2026-05-29-landing-pre-login-design.md

import "./landing.css";
import type { Metadata } from "next";
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

const SCENES: string[] = [
  "O mercado é um abismo. Sem fundo. Sob pressão.",
  "Abaixo de certa profundidade, a luz do sol não chega. A maioria afunda.",
  "Mas o abismo é habitado. O que vive aqui não espera a luz vir de fora—",
];

const sceneText =
  "max-w-2xl text-center font-[family-name:var(--font-display)] font-light leading-snug text-[var(--color-ink-display)]";
const sceneSize = {
  fontSize: "clamp(1.75rem,4vw,3rem)",
  letterSpacing: "-0.02em",
} as const;

export default function LandingPage() {
  return (
    <>
      {/* Fundo ambiente fixo. z positivos baixos: z negativo ficaria ATRÁS do
          background opaco do <body> (ordem de pintura CSS). Conteúdo em z-10. */}
      <AbyssShader className="fixed inset-0 z-0" />
      <ParticlesCanvas className="fixed inset-0 z-[1]" />
      <div
        aria-hidden
        className="landing-darken pointer-events-none fixed inset-0 z-[2] bg-black"
      />

      <main id="main" className="relative z-10">
        {/* Cena 0 — superfície / hero */}
        <section className="flex min-h-[100svh] flex-col items-center justify-center gap-8 px-6 text-center">
          <AbissalMark size={132} title="Abissal" />
          <h1 className="landing-rise lowercase" style={{ fontSize: "clamp(3rem,9vw,6rem)" }}>
            abissal
          </h1>
          <p className="landing-reveal max-w-md text-lg text-[var(--color-ink-muted)]">
            A maioria aposta no escuro.
          </p>
          <Link
            href="/login"
            className="landing-reveal rounded-[var(--radius)] border border-[var(--color-line-strong)] px-6 py-3 text-[var(--color-ink-display)] backdrop-blur-sm transition-colors hover:border-[var(--color-vermelho)] hover:bg-[var(--color-vermelho)]/10"
          >
            entrar
          </Link>
          <span className="landing-scroll-hint label mt-8 animate-pulse text-[var(--color-ink-faint)]">
            ↓ role para descer
          </span>
        </section>

        {/* Cenas 1–3 — a descida */}
        {SCENES.map((text, i) => (
          <section
            key={i}
            className="flex min-h-[100svh] items-center justify-center px-6"
          >
            <p className={`landing-reveal ${sceneText}`} style={sceneSize}>
              {text}
            </p>
          </section>
        ))}

        {/* Cena 4 — o farol (clímax) */}
        <section className="flex min-h-[100svh] flex-col items-center justify-center gap-10 px-6 text-center">
          <AbissalMark size={160} title="Abissal" className="landing-rise" />
          <p className={`landing-reveal ${sceneText}`} style={sceneSize}>
            —gera a própria. Análise. Edge. Disciplina.{" "}
            <span style={{ color: "var(--color-vermelho-hi)" }}>Sua luz no escuro.</span>
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
            className="landing-reveal rounded-[var(--radius)] bg-[var(--color-vermelho)] px-8 py-3 text-[var(--color-ink-display)] transition-colors hover:bg-[var(--color-vermelho-hi)]"
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
