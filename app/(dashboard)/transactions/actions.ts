"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type TxKind = Database["public"]["Enums"]["transaction_kind"];
type TxDirection = Database["public"]["Enums"]["transaction_direction"];

const MANUAL_KINDS = [
  "deposit",
  "withdrawal",
  "bonus_credit",
  "bonus_rollover",
  "fee",
  "adjustment_credit",
  "adjustment_debit",
] as const;

const KIND_DIRECTION: Record<(typeof MANUAL_KINDS)[number], TxDirection> = {
  deposit: "in",
  withdrawal: "out",
  bonus_credit: "in",
  bonus_rollover: "in",
  fee: "out",
  adjustment_credit: "in",
  adjustment_debit: "out",
};

const createSchema = z.object({
  house_id: z.string().uuid("Selecione uma casa"),
  kind: z.enum(MANUAL_KINDS),
  amount: z
    .string()
    .min(1, "Informe um valor")
    .transform((v) => v.replace(/\./g, "").replace(",", "."))
    .pipe(z.coerce.number().positive("Valor deve ser positivo")),
  occurred_at: z.string().min(1, "Informe uma data"),
  note: z.string().max(500).optional(),
});

export type CreateTxState = {
  error?: string;
  values?: Record<string, string>;
};

export async function createTransactionAction(
  _prev: CreateTxState,
  formData: FormData,
): Promise<CreateTxState> {
  const raw = {
    house_id: String(formData.get("house_id") ?? ""),
    kind: String(formData.get("kind") ?? "deposit"),
    amount: String(formData.get("amount") ?? ""),
    occurred_at: String(formData.get("occurred_at") ?? ""),
    note: String(formData.get("note") ?? ""),
  };

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: parsed.error.errors[0]?.message ?? "Dados inválidos",
      values: raw,
    };
  }

  const { house_id, kind, amount, occurred_at, note } = parsed.data;

  if (
    (kind === "adjustment_credit" || kind === "adjustment_debit") &&
    (!note || note.trim().length < 3)
  ) {
    return {
      error: "Ajustes manuais exigem nota explicativa.",
      values: raw,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada" };

  const direction = KIND_DIRECTION[kind];
  // occurred_at comes as datetime-local (no timezone). Treat as user-local
  // and let Postgres store as timestamptz with the system timezone.
  const occurredIso = new Date(occurred_at).toISOString();

  const { error } = await supabase.from("transactions").insert({
    user_id: user.id,
    house_id,
    kind: kind as TxKind,
    direction,
    amount: Number(amount.toFixed(2)),
    occurred_at: occurredIso,
    note: note || null,
  });

  if (error) return { error: error.message, values: raw };

  revalidatePath("/transactions");
  revalidatePath("/houses");
  revalidatePath("/");
  redirect("/transactions");
}

export const MANUAL_KIND_LABELS: Record<(typeof MANUAL_KINDS)[number], string> = {
  deposit: "Depósito",
  withdrawal: "Saque",
  bonus_credit: "Bônus (crédito)",
  bonus_rollover: "Liberação de rollover",
  fee: "Taxa",
  adjustment_credit: "Ajuste manual (crédito)",
  adjustment_debit: "Ajuste manual (débito)",
};

export { MANUAL_KINDS };
