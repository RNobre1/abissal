"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <header className="mb-12">
        <span className="label">abissal · entrar</span>
        <h1
          className="mt-6 text-[3.5rem] leading-[0.92] tracking-[-0.045em]"
          style={{ color: "var(--color-ink-display)" }}
        >
          banca,
          <br />
          <span
            className="italic"
            style={{ color: "var(--color-vermelho)", fontWeight: 400 }}
          >
            habitada.
          </span>
        </h1>
      </header>

      <form action={formAction} className="card flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-2">
          <label className="label" htmlFor="email">
            email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-1)] px-3 py-2.5 text-[var(--color-ink)] outline-none focus:border-[var(--color-vermelho)]"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="label" htmlFor="password">
            senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-1)] px-3 py-2.5 font-mono text-[var(--color-ink)] outline-none focus:border-[var(--color-vermelho)]"
          />
        </div>

        {state.error && (
          <p
            role="alert"
            className="num text-sm"
            style={{ color: "var(--color-warning)" }}
          >
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-medium uppercase tracking-[0.18em] text-[var(--color-ink-display)] transition-colors disabled:opacity-50"
          style={{ backgroundColor: "var(--color-vermelho)" }}
        >
          {pending ? "entrando…" : "entrar"}
        </button>
      </form>

      <p className="mt-8 max-w-prose text-sm text-[var(--color-ink-muted)]">
        Cadastro fechado. Para criar acesso, gere usuário no dashboard Supabase
        do projeto.
      </p>
    </main>
  );
}
