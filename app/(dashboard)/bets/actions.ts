"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";

type BetKind = Database["public"]["Enums"]["bet_kind"];
type BetStatus = Database["public"]["Enums"]["bet_status"];

const RESOLUTION_STATUSES = [
  "won",
  "lost",
  "void",
  "cashed_out",
  "half_won",
  "half_lost",
  "partially_void",
] as const satisfies ReadonlyArray<BetStatus>;

const RESOLUTION_NEEDS_RETURN = new Set<BetStatus>([
  "cashed_out",
  "half_won",
  "half_lost",
  "partially_void",
]);

export const RESOLUTION_LABELS: Record<(typeof RESOLUTION_STATUSES)[number], string> = {
  won: "Ganha",
  lost: "Perdida",
  void: "Anulada (refund)",
  cashed_out: "Cash-out",
  half_won: "Meia ganha",
  half_lost: "Meia perdida",
  partially_void: "Parcialmente anulada",
};

const numFromBR = z
  .string()
  .min(1, "informe o valor")
  .transform((v) => v.replace(/\./g, "").replace(",", "."))
  .pipe(z.coerce.number());

const selectionSchema = z.object({
  event_label: z.string().trim().min(1, "evento obrigatório").max(200),
  selection_label: z.string().trim().min(1, "seleção obrigatória").max(200),
  odds: numFromBR.pipe(z.number().min(1.01, "odd mínima 1.01").max(10000)),
  event_date: z.string().optional(),
});

const placeSchema = z.object({
  house_id: z.string().uuid("escolha uma casa"),
  kind: z.enum(["single", "multiple"]),
  total_stake: numFromBR.pipe(z.number().positive("stake deve ser > 0")),
  placed_at: z.string().min(1, "informe quando"),
  note: z.string().max(500).optional(),
  selections: z.array(selectionSchema).min(1),
});

export type PlaceBetState = {
  error?: string;
  values?: Record<string, string>;
};

export async function placeBetAction(
  _prev: PlaceBetState,
  formData: FormData,
): Promise<PlaceBetState> {
  const kind = String(formData.get("kind") ?? "single") as "single" | "multiple";

  const eventLabels = formData.getAll("event_label").map(String);
  const selectionLabels = formData.getAll("selection_label").map(String);
  const oddsRaw = formData.getAll("odds").map(String);
  const eventDates = formData.getAll("event_date").map(String);

  const legs = eventLabels.map((event_label, i) => ({
    event_label,
    selection_label: selectionLabels[i] ?? "",
    odds: oddsRaw[i] ?? "",
    event_date: eventDates[i] ?? "",
  }));

  const raw = {
    house_id: String(formData.get("house_id") ?? ""),
    kind,
    total_stake: String(formData.get("total_stake") ?? ""),
    placed_at: String(formData.get("placed_at") ?? ""),
    note: String(formData.get("note") ?? ""),
    selections: legs,
  };

  const parsed = placeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: parsed.error.errors[0]?.message ?? "dados inválidos",
      values: {
        house_id: raw.house_id,
        kind: raw.kind,
        total_stake: raw.total_stake,
        placed_at: raw.placed_at,
        note: raw.note,
      },
    };
  }

  const data = parsed.data;

  if (data.kind === "single" && data.selections.length !== 1) {
    return { error: "aposta simples precisa de exatamente 1 seleção" };
  }
  if (data.kind === "multiple" && data.selections.length < 2) {
    return { error: "múltipla precisa de 2+ seleções" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "sessão expirada" };

  const placedIso = new Date(data.placed_at).toISOString();

  const payload: Json = {
    house_id: data.house_id,
    kind: data.kind as BetKind,
    total_stake: data.total_stake,
    placed_at: placedIso,
    note: data.note ? data.note : null,
    selections: data.selections.map((s) => ({
      event_label: s.event_label,
      selection_label: s.selection_label,
      odds: s.odds,
      event_date: s.event_date ? new Date(s.event_date).toISOString() : null,
    })),
  };

  const { data: betId, error } = await supabase.rpc("place_bet", {
    p_payload: payload,
  });

  if (error) return { error: error.message };

  revalidatePath("/bets");
  revalidatePath("/transactions");
  revalidatePath("/houses");
  revalidatePath("/");
  redirect(`/bets/${betId}`);
}

const resolveSchema = z.object({
  bet_id: z.string().uuid(),
  status: z.enum(RESOLUTION_STATUSES),
  actual_return: z.string().optional(),
});

export async function resolveBetAction(formData: FormData): Promise<void> {
  const parsed = resolveSchema.safeParse({
    bet_id: String(formData.get("bet_id") ?? ""),
    status: String(formData.get("status") ?? ""),
    actual_return: formData.get("actual_return")
      ? String(formData.get("actual_return"))
      : undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.errors[0]?.message ?? "dados inválidos");
  }

  const { bet_id, status, actual_return } = parsed.data;

  let returnNumber: number | undefined;
  if (RESOLUTION_NEEDS_RETURN.has(status)) {
    if (!actual_return) {
      throw new Error("informe o retorno realizado para esse status");
    }
    const cleaned = actual_return.replace(/\./g, "").replace(",", ".");
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("retorno inválido");
    }
    returnNumber = Number(n.toFixed(2));
  } else if (actual_return && actual_return.trim() !== "") {
    const cleaned = actual_return.replace(/\./g, "").replace(",", ".");
    const n = Number(cleaned);
    if (Number.isFinite(n) && n >= 0) {
      returnNumber = Number(n.toFixed(2));
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_bet", {
    p_bet_id: bet_id,
    p_status: status as BetStatus,
    p_actual_return: returnNumber,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/bets");
  revalidatePath(`/bets/${bet_id}`);
  revalidatePath("/transactions");
  revalidatePath("/houses");
  revalidatePath("/");
}

export { RESOLUTION_STATUSES, RESOLUTION_NEEDS_RETURN };
