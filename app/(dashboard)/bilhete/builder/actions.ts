"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkDisciplinaLimits } from "@/lib/disciplina/disciplina-guard";
import { revalidatePath } from "next/cache";

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
  is_free_bet: z.boolean().default(false).optional(),
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
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

  // 4. Atomic INSERT via place_bet_builder RPC (migration 0051).
  //    The RPC inserts bets + bet_selections + transactions(bet_stake) in a
  //    single Postgres transaction. Direct insertion into `bets` without the
  //    RPC would skip the ledger debit — see bug fix in 0051.
  const rpcPayload = {
    house_id: data.house_id,
    total_stake: data.stake,
    total_odds: data.odd_combined,
    placed_at: new Date().toISOString(),
    is_free_bet: data.is_free_bet ?? false,
    thesis: data.thesis ?? null,
    home_team: data.home_team ?? null,
    away_team: data.away_team ?? null,
    legs: data.legs.map((leg) => ({ market: leg.market, side: leg.side })),
  };

  const { data: betId, error: rpcError } = await supabase.rpc(
    "place_bet_builder",
    { p_payload: rpcPayload },
  );

  if (rpcError || !betId) {
    return { error: rpcError?.message ?? "erro ao salvar aposta" };
  }

  revalidatePath("/bets");
  revalidatePath("/bilhete");

  redirect(`/bets/${betId as string}`);
}
