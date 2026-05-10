"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  createTransactionAction,
  type CreateTxState,
  MANUAL_KINDS,
  MANUAL_KIND_LABELS,
} from "../actions";

const initial: CreateTxState = {};

export function TransactionForm({
  houses,
  defaultOccurredAt,
}: {
  houses: { id: string; name: string }[];
  defaultOccurredAt: string;
}) {
  const [state, action, pending] = useActionState(
    createTransactionAction,
    initial,
  );
  const [kind, setKind] = useState(state.values?.kind ?? "deposit");

  const requiresNote =
    kind === "adjustment_credit" || kind === "adjustment_debit";

  return (
    <form action={action} className="card flex flex-col gap-5 p-6">
      <Field label="casa" htmlFor="house_id">
        <Select
          id="house_id"
          name="house_id"
          required
          defaultValue={state.values?.house_id ?? houses[0]?.id}
        >
          {houses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="tipo" htmlFor="kind">
        <Select
          id="kind"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          required
        >
          {MANUAL_KINDS.map((k) => (
            <option key={k} value={k}>
              {MANUAL_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="valor (BRL)"
        htmlFor="amount"
        hint="Sempre positivo. A direção (entrada/saída) vem do tipo."
      >
        <Input
          id="amount"
          name="amount"
          mono
          inputMode="decimal"
          placeholder="0,00"
          required
          defaultValue={state.values?.amount ?? ""}
        />
      </Field>

      <Field label="quando" htmlFor="occurred_at">
        <Input
          id="occurred_at"
          name="occurred_at"
          type="datetime-local"
          mono
          required
          defaultValue={state.values?.occurred_at ?? defaultOccurredAt}
        />
      </Field>

      <Field
        label={requiresNote ? "nota (obrigatória para ajustes)" : "nota (opcional)"}
        htmlFor="note"
        hint="Por quê. Quem paga isso. O contexto que daqui a 3 meses estará apagado."
      >
        <textarea
          id="note"
          name="note"
          rows={3}
          required={requiresNote}
          defaultValue={state.values?.note ?? ""}
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
          <Link href="/transactions">cancelar</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "registrando…" : "registrar"}
        </Button>
      </div>
    </form>
  );
}
