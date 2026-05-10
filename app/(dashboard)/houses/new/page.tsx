"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { createHouseAction, type CreateState } from "../actions";

const initial: CreateState = {};

export default function NewHousePage() {
  const [state, action, pending] = useActionState(createHouseAction, initial);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12 lg:px-12 lg:py-16">
      <header className="mb-10">
        <span className="label">casas / nova</span>
        <h2 className="mt-2">nova casa</h2>
      </header>

      <form action={action} className="card flex flex-col gap-5 p-6">
        <Field label="nome" htmlFor="name" hint="ex: Bet365, Betano, Pinnacle">
          <Input
            id="name"
            name="name"
            required
            autoFocus
            defaultValue={state.values?.name ?? ""}
          />
        </Field>

        <Field
          label="site (opcional)"
          htmlFor="website_url"
          hint="https://..."
        >
          <Input
            id="website_url"
            name="website_url"
            type="url"
            inputMode="url"
            defaultValue={state.values?.website_url ?? ""}
          />
        </Field>

        <Field
          label="cor de acento (opcional)"
          htmlFor="color_hex"
          hint="hex 6 dígitos, ex: 1a5fad. Usada como fio na ficha da casa."
        >
          <Input
            id="color_hex"
            name="color_hex"
            mono
            placeholder="1a5fad"
            defaultValue={state.values?.color_hex ?? ""}
          />
        </Field>

        <Field
          label="anotações (opcional)"
          htmlFor="notes_md"
          hint="markdown, livre"
        >
          <textarea
            id="notes_md"
            name="notes_md"
            rows={4}
            defaultValue={state.values?.notes_md ?? ""}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-1)] px-3 py-2 text-[var(--color-ink)] outline-none focus:border-[var(--color-vermelho)]"
          />
        </Field>

        {state.error && (
          <p
            role="alert"
            className="num text-sm"
            style={{ color: "var(--color-warning)" }}
          >
            {state.error}
          </p>
        )}

        <div className="mt-2 flex items-center justify-between">
          <Button asChild variant="ghost">
            <Link href="/houses">cancelar</Link>
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "salvando…" : "criar casa"}
          </Button>
        </div>
      </form>
    </main>
  );
}
