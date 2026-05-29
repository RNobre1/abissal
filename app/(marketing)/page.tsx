// Landing pré-login do Abissal (frente E) — servida em "/" (raiz pública).
// O middleware redireciona usuário autenticado pra /painel; deslogado vê isto.
// F1+F2: roteamento + casca SSR (estrutura do poema + copy + hero + CTA).
// As camadas de animação (CSS scroll-driven, canvas, GSAP, WebGL shader) entram
// nas fases seguintes. Spec: docs/superpowers/specs/2026-05-29-landing-pre-login-design.md

import type { Metadata } from "next";
import Link from "next/link";
import { AbissalMark } from "@/components/brand/abissal-mark";

export const metadata: Metadata = {
  title: "Abissal — aposte com luz própria",
  description:
    "O mercado é um abismo. A maioria aposta no escuro. O Abissal gera o próprio sinal: análise, edge e disciplina.",
  robots: { index: false, follow: false },
};

const SCENES: { bg: string; text: string }[] = [
  { bg: "#0d0d12", text: "O mercado é um abismo. Sem fundo. Sob pressão." },
  {
    bg: "#0a0a0e",
    text: "Abaixo de certa profundidade, a luz do sol não chega. A maioria afunda.",
  },
  {
    bg: "#070709",
    text: "Mas o abismo é habitado. O que vive aqui não espera a luz vir de fora—",
  },
];

export default function LandingPage() {
  return (
    <main id="main" className="bg-[var(--color-void)]">
      {/* Cena 0 — superfície / hero */}
      <section className="flex min-h-[100svh] flex-col items-center justify-center gap-8 px-6 text-center">
        <AbissalMark size={132} title="Abissal" />
        <h1 className="lowercase" style={{ fontSize: "clamp(3rem,9vw,6rem)" }}>
          abissal
        </h1>
        <p className="max-w-md text-lg text-[var(--color-ink-muted)]">
          A maioria aposta no escuro.
        </p>
        <Link
          href="/login"
          className="rounded-[var(--radius)] border border-[var(--color-line-strong)] px-6 py-3 text-[var(--color-ink-display)] transition-colors hover:border-[var(--color-vermelho)] hover:bg-[var(--color-vermelho)]/10"
        >
          entrar
        </Link>
        <span className="label mt-8 animate-pulse text-[var(--color-ink-faint)]">
          ↓ role para descer
        </span>
      </section>

      {/* Cenas 1–3 — a descida */}
      {SCENES.map((s, i) => (
        <section
          key={i}
          className="flex min-h-[100svh] items-center justify-center px-6"
          style={{ backgroundColor: s.bg }}
        >
          <p
            className="max-w-2xl text-center font-[family-name:var(--font-display)] font-light leading-snug text-[var(--color-ink-display)]"
            style={{ fontSize: "clamp(1.75rem,4vw,3rem)", letterSpacing: "-0.02em" }}
          >
            {s.text}
          </p>
        </section>
      ))}

      {/* Cena 4 — o farol (clímax) */}
      <section className="flex min-h-[100svh] flex-col items-center justify-center gap-10 bg-[#050507] px-6 text-center">
        <AbissalMark size={160} title="Abissal" />
        <p
          className="max-w-2xl font-[family-name:var(--font-display)] font-light leading-snug text-[var(--color-ink-display)]"
          style={{ fontSize: "clamp(1.75rem,4vw,3rem)", letterSpacing: "-0.02em" }}
        >
          —gera a própria. Análise. Edge. Disciplina.{" "}
          <span style={{ color: "var(--color-vermelho-hi)" }}>Sua luz no escuro.</span>
        </p>
      </section>

      {/* Cena 5 — convite */}
      <section className="flex min-h-[100svh] flex-col items-center justify-center gap-8 bg-[var(--color-void)] px-6 text-center">
        <AbissalMark size={96} title="Abissal" />
        <h2 className="lowercase" style={{ fontSize: "clamp(2.5rem,7vw,4.5rem)" }}>
          abissal
        </h2>
        <Link
          href="/login"
          className="rounded-[var(--radius)] bg-[var(--color-vermelho)] px-8 py-3 text-[var(--color-ink-display)] transition-colors hover:bg-[var(--color-vermelho-hi)]"
        >
          entrar
        </Link>
        <p className="label text-[var(--color-ink-faint)]">
          gestão de banca · análise pré-jogo
        </p>
      </section>
    </main>
  );
}
