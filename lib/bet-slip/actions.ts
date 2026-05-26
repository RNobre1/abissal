"use server";

/**
 * lib/bet-slip/actions.ts
 *
 * Server Actions for the bet slip / bilhete múltipla feature (Wave M).
 *
 * NOTE: bet_slips / bet_slip_legs are new tables (migration 0032).
 * Supabase types.ts has NOT been regenerated yet (requires apply on prod).
 * All .from("bet_slips") / .from("bet_slip_legs") calls use `as any` to
 * bypass the type-system's table allowlist. Once types are regenerated
 * post-migration, remove the casts.
 *
 * All actions validate auth first (returns {error} on failure rather than
 * throwing, to allow graceful UI handling).
 *
 * Telemetry (Wave T) and stake jitter (Wave B) integration points are
 * commented with TODO markers — they will be wired once those PRs merge.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  computeOddCombined,
  computePotentialReturn,
  type BetSlip,
  type SlipLeg,
} from "./compute";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ActionResult {
  error?: string;
}

export interface AddLegResult extends ActionResult {
  slipId?: number;
  legId?: number;
}

export interface CommitSlipResult extends ActionResult {
  betId?: string;
}

export interface AddLegInput {
  ai_recommendation_id?: number | null;
  fixture_id: number | null;
  home_team: string;
  away_team: string;
  market: string;
  side: string;
  odd_taken: number;
  league?: string | null;
  kickoff_utc?: string | null;
  sport_id?: string | null;
  market_id?: string | null;
}

// ── getDraftSlip ──────────────────────────────────────────────────────────────

/**
 * Returns the current user's draft slip (with legs), or null if none exists
 * or user is not authenticated.
 */
export async function getDraftSlip(): Promise<BetSlip | null> {
  const supabaseRaw = await createClient();
  const supabase = supabaseRaw as AnyClient;
  const {
    data: { user },
  } = await supabaseRaw.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("bet_slips")
    .select("*, bet_slip_legs(*)")
    .eq("user_id", user.id)
    .eq("status", "draft")
    .maybeSingle();

  if (error || !data) return null;

  return data as BetSlip;
}

// ── addLegToSlip ──────────────────────────────────────────────────────────────

/**
 * Adds a leg to the current user's draft slip.
 * Creates a new draft slip if one does not exist.
 * Recalculates odd_combined and potential_return on the slip after insert.
 */
export async function addLegToSlip(input: AddLegInput): Promise<AddLegResult> {
  const supabaseRaw = await createClient();
  const supabase = supabaseRaw as AnyClient;
  const {
    data: { user },
  } = await supabaseRaw.auth.getUser();
  if (!user) return { error: "Não autenticado" };

  // 1. Get or create draft slip
  let slipId: number;
  const existing = await getDraftSlip();

  if (existing) {
    slipId = existing.id;
  } else {
    const { data: newSlip, error: slipErr } = await supabase
      .from("bet_slips")
      .insert({ user_id: user.id, status: "draft" })
      .select("id")
      .single();

    if (slipErr || !newSlip) {
      return { error: slipErr?.message ?? "Erro ao criar bilhete" };
    }
    slipId = newSlip.id;
  }

  // 2. Insert leg
  const { data: leg, error: legErr } = await supabase
    .from("bet_slip_legs")
    .insert({
      slip_id: slipId,
      fixture_id: input.fixture_id,
      home_team: input.home_team,
      away_team: input.away_team,
      market: input.market,
      side: input.side,
      odd_taken: input.odd_taken,
      league: input.league ?? null,
      kickoff_utc: input.kickoff_utc ?? null,
      ai_recommendation_id: input.ai_recommendation_id ?? null,
      sport_id: input.sport_id ?? null,
      market_id: input.market_id ?? null,
    })
    .select("id, slip_id")
    .single();

  if (legErr || !leg) {
    return { error: legErr?.message ?? "Erro ao adicionar seleção" };
  }

  // 3. Recalculate combined odd
  await _recalculateSlip(supabase, slipId, user.id, existing?.stake_total ?? null);

  revalidatePath("/bilhete");

  // TODO post Wave T merge: track slip_leg_added telemetry event
  // await trackEvent('slip_leg_added', { slip_id: slipId, fixture_id: input.fixture_id, ai_recommendation_id: input.ai_recommendation_id });

  return { slipId, legId: leg.id };
}

// ── removeLegFromSlip ─────────────────────────────────────────────────────────

/**
 * Removes a leg from the slip. Recalculates odd_combined after removal.
 */
export async function removeLegFromSlip(legId: number): Promise<ActionResult> {
  const supabaseRaw = await createClient();
  const supabase = supabaseRaw as AnyClient;
  const {
    data: { user },
  } = await supabaseRaw.auth.getUser();
  if (!user) return { error: "Não autenticado" };

  // Find the leg's slip_id (to verify ownership via RLS)
  const { data: leg, error: findErr } = await supabase
    .from("bet_slip_legs")
    .select("id, slip_id")
    .eq("id", legId)
    .single();

  if (findErr || !leg) {
    return { error: findErr?.message ?? "Seleção não encontrada" };
  }

  // Delete leg
  const { error: delErr } = await supabase
    .from("bet_slip_legs")
    .delete()
    .eq("id", legId);

  if (delErr) return { error: delErr.message };

  // Recalculate slip (fetch fresh slip to get stake)
  const { data: freshSlip } = await supabase
    .from("bet_slips")
    .select("stake_total, user_id")
    .eq("id", leg.slip_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (freshSlip) {
    await _recalculateSlip(
      supabase,
      leg.slip_id,
      user.id,
      freshSlip.stake_total,
    );
  }

  revalidatePath("/bilhete");

  // TODO post Wave T merge: track slip_leg_removed
  return {};
}

// ── updateSlipStake ───────────────────────────────────────────────────────────

/**
 * Updates the total stake on a slip and recalculates potential_return.
 */
export async function updateSlipStake(
  slipId: number,
  stakeTotal: number,
): Promise<ActionResult> {
  if (stakeTotal <= 0) return { error: "Stake deve ser positivo" };

  const supabaseRaw = await createClient();
  const supabase = supabaseRaw as AnyClient;
  const {
    data: { user },
  } = await supabaseRaw.auth.getUser();
  if (!user) return { error: "Não autenticado" };

  // TODO post Wave B merge: apply applyStakeJitter(stakeTotal) here for display
  // The jitter is applied on the total, NOT per leg.

  await _recalculateSlip(supabase, slipId, user.id, stakeTotal);

  revalidatePath("/bilhete");
  return {};
}

// ── commitSlip ────────────────────────────────────────────────────────────────

/**
 * Commits a draft slip:
 *  1. Reads all legs from the slip
 *  2. Calls place_bet RPC with kind='multiple'
 *  3. Creates a bet_selections row per leg
 *  4. Sets slip.status='committed' + slip.bet_id
 *  5. Records a bet_stake transaction
 */
export async function commitSlip(
  slipId: number,
  houseId: string,
): Promise<CommitSlipResult> {
  const supabaseRaw = await createClient();
  const supabase = supabaseRaw as AnyClient;
  const {
    data: { user },
  } = await supabaseRaw.auth.getUser();
  if (!user) return { error: "Não autenticado" };

  // Fetch slip + legs
  const { data: slip, error: slipErr } = await supabase
    .from("bet_slips")
    .select("*, bet_slip_legs(*)")
    .eq("id", slipId)
    .eq("user_id", user.id)
    .eq("status", "draft")
    .maybeSingle();

  if (slipErr || !slip) {
    return { error: slipErr?.message ?? "Bilhete não encontrado" };
  }

  const legs = (slip.bet_slip_legs ?? []) as SlipLeg[];

  if (legs.length < 2) {
    return {
      error: "Bilhete múltiplo precisa de ao menos 2 seleções",
    };
  }

  if (!slip.stake_total || slip.stake_total <= 0) {
    return { error: "Informe o stake antes de confirmar" };
  }

  // Build selections payload for place_bet RPC
  const selections = legs.map((leg, idx) => ({
    event_label: `${leg.home_team ?? "?"} × ${leg.away_team ?? "?"}`,
    selection_label: `${leg.market} / ${leg.side}`,
    odds: leg.odd_taken,
    event_date: leg.kickoff_utc ?? null,
    sport_id: leg.sport_id ?? null,
    market_id: leg.market_id ?? null,
    league: leg.league ?? null,
    position_index: idx,
  }));

  // Call existing place_bet RPC (already handles 'multiple' kind + selections)
  const { data: betId, error: rpcErr } = await supabaseRaw.rpc("place_bet", {
    p_payload: {
      house_id: houseId,
      kind: "multiple",
      total_stake: slip.stake_total,
      placed_at: new Date().toISOString(),
      selections,
    },
  });

  if (rpcErr || !betId) {
    return { error: rpcErr?.message ?? "Erro ao criar aposta" };
  }

  // Mark slip as committed
  await supabase
    .from("bet_slips")
    .update({ status: "committed", bet_id: betId })
    .eq("id", slipId)
    .eq("user_id", user.id);

  revalidatePath("/bets");
  revalidatePath("/bilhete");
  revalidatePath("/");

  // TODO post Wave T merge: track slip_committed telemetry event
  // await trackEvent('slip_committed', { leg_count: legs.length, odd_combined: slip.odd_combined, stake_total: slip.stake_total });

  return { betId: betId as string };
}

// ── cancelSlip ────────────────────────────────────────────────────────────────

export async function cancelSlip(slipId: number): Promise<ActionResult> {
  const supabaseRaw = await createClient();
  const supabase = supabaseRaw as AnyClient;
  const {
    data: { user },
  } = await supabaseRaw.auth.getUser();
  if (!user) return { error: "Não autenticado" };

  const { error } = await supabase
    .from("bet_slips")
    .update({ status: "cancelled" })
    .eq("id", slipId)
    .eq("user_id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/bilhete");

  // TODO post Wave T merge: track slip_cancelled
  return {};
}

// ── private helpers ───────────────────────────────────────────────────────────

async function _recalculateSlip(
  supabase: AnyClient,
  slipId: number,
  userId: string,
  stakeTotal: number | null,
): Promise<void> {
  // Fetch current legs
  const { data: legs } = await supabase
    .from("bet_slip_legs")
    .select("odd_taken")
    .eq("slip_id", slipId);

  const legList = (legs ?? []) as Array<{ odd_taken: number }>;
  const oddCombined = computeOddCombined(
    legList.map((l) => ({ odd_taken: l.odd_taken } as SlipLeg)),
  );
  const potentialReturn =
    stakeTotal != null
      ? computePotentialReturn(stakeTotal, oddCombined)
      : null;

  await supabase
    .from("bet_slips")
    .update({
      odd_combined: oddCombined,
      potential_return: potentialReturn,
      stake_total: stakeTotal,
    })
    .eq("id", slipId)
    .eq("user_id", userId);
}
