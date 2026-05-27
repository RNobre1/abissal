"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkDisciplinaLimits } from "@/lib/disciplina/disciplina-guard";
import { revalidatePath } from "next/cache";
import type { Database } from "@/lib/supabase/types";

type BetKind = Database["public"]["Enums"]["bet_kind"];

// ── Schema ────────────────────────────────────────────────────────────────────

const legSchema = z.object({
  market: z.string().trim().min(1, "mercado obrigatório"),
  side: z.string().trim().min(1, "seleção obrigatória"),
});

const builderSchema = z.object({
  house_id: z.string().uuid("escolha uma casa"),
  fixture_id: z.coerce.number().int().positive().nullable(),
  home_team: z.string().trim().min(1, "time da casa obrigatório"),
  away_team: z.string().trim().min(1, "time visitante obrigatório"),
  odd_combined: z.coerce.number().gt(1.01, "odd combinada deve ser > 1.01"),
  stake: z.coerce.number().positive("stake deve ser > 0"),
  legs: z.array(legSchema).min(1, "adicione ao menos 1 condição"),
  thesis: z.string().trim().max(1000).optional(),
});

export type CreateBetBuilderInput = z.input<typeof builderSchema>;

export type CreateBetBuilderResult =
  | { ok: true; bet_id: string }
  | { error: string };

// ── Action ────────────────────────────────────────────────────────────────────

export async function createBetBuilderAction(
  input: CreateBetBuilderInput,
): Promise<CreateBetBuilderResult> {
  // 1. Parse & validate
  const parsed = builderSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "dados inválidos" };
  }
  const data = parsed.data;

  // 2. Auth gate
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "sessão expirada" };

  // 3. Disciplina guard
  const disciplinaCheck = await checkDisciplinaLimits(supabase, user.id);
  if (!disciplinaCheck.allowed) {
    return {
      error:
        disciplinaCheck.reason ??
        "aposta bloqueada pelas configurações de disciplina",
    };
  }

  // 4. INSERT bets row
  // `bet_builder` was added to the bet_kind enum via migration 0039.
  // Types are updated in this PR; cast to BetKind for type safety.
  const { data: betRow, error: betError } = await supabase
    .from("bets")
    .insert({
      user_id: user.id,
      house_id: data.house_id,
      kind: "bet_builder" as BetKind,
      total_odds: data.odd_combined,
      total_stake: data.stake,
      expected_return: Number((data.stake * data.odd_combined).toFixed(2)),
      status: "pending" as const,
      placed_at: new Date().toISOString(),
      thesis: data.thesis ?? null,
    })
    .select("id")
    .single();

  if (betError || !betRow) {
    return { error: betError?.message ?? "erro ao salvar aposta" };
  }

  const betId = betRow.id as string;

  // 5. INSERT bet_selections (N legs, odd_taken = NULL)
  // bet_selections does not have home_team/away_team/market/side/fixture_id columns.
  // We encode the fixture context in event_label and the condition in selection_label.
  // `odds` is required NOT NULL in schema; for bet_builder legs (no individual odd)
  // we store 0 as a sentinel (the combined odd lives in bets.total_odds).
  const eventLabel =
    data.home_team && data.away_team
      ? `${data.home_team} × ${data.away_team}`
      : "jogo";

  const selections = data.legs.map((leg, idx) => ({
    bet_id: betId,
    user_id: user.id,
    // Use odd_combined so the value satisfies CHECK (odds > 1).
    // Individual odds per leg are not available in bet_builder; the combined odd
    // is the same for all legs and already lives in bets.total_odds.
    odds: data.odd_combined,
    odd_taken: null, // nullable per BB A migration 0039 — no individual odd taken
    event_label: eventLabel,
    selection_label: `${leg.market} — ${leg.side}`,
    position_index: idx,
  }));

  const { error: selError } = await supabase
    .from("bet_selections")
    .insert(selections);

  if (selError) {
    // FATAL: selections are the core payload; roll back the bet row for atomicity.
    await supabase.from("bets").delete().eq("id", betId);
    return { error: `Falha ao salvar condições: ${selError.message}` };
  }

  revalidatePath("/bets");
  revalidatePath("/bilhete");

  redirect(`/bets/${betId}`);
}
