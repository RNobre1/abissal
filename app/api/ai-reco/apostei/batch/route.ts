import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/ai-reco/apostei/batch
 *
 * Commits multiple AI recommendation bets in a single HTTP request.
 * Useful for slip-level betting (Wave M) or bulk bet entry.
 *
 * Body:
 *   {
 *     recommendations: Array<{
 *       ai_recommendation_id: number;
 *       effectiveOdd: number;
 *       stake?: number;       // overrides defaultStake for this item
 *       houseId?: string;     // overrides defaultHouseId for this item
 *     }>;
 *     defaultHouseId?: string;  // used when item does not specify houseId
 *     defaultStake?: number;    // used when item does not specify stake
 *     slip_id?: number;         // optional: associate all bets with a slip
 *   }
 *
 * Response (200):
 *   { created: number; failed: Array<{ ai_recommendation_id: number; error: string }> }
 *
 * Design:
 * - Best-effort: one failure does NOT abort the batch. Each item is processed
 *   independently; failures accumulate in `failed[]`.
 * - Internally calls the same logic as the single `/apostei` endpoint
 *   per item (DRY via shared helper).
 * - Auth: same as `/apostei` — requires a valid Supabase session.
 *
 * NOTE: This does NOT wrap all items in a single DB transaction intentionally.
 * Partial success is better than all-or-nothing for a slip with 3 recos
 * where 1 house lookup fails — the user can resolve the failed item manually.
 * A future `slip_id` FK could be added to link bets at the DB level.
 */

export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  ai_recommendation_id: z.number().int().positive(),
  effectiveOdd: z.number().positive("effectiveOdd must be > 0"),
  stake: z.number().positive().optional(),
  houseId: z.string().uuid().optional(),
});

const bodySchema = z.object({
  recommendations: z
    .array(itemSchema)
    .min(1, "recommendations must have at least 1 item"),
  defaultHouseId: z.string().uuid().optional(),
  defaultStake: z.number().positive().optional(),
  slip_id: z.number().int().positive().optional(),
});

type BodyInput = z.infer<typeof bodySchema>;
type ItemInput = BodyInput["recommendations"][number];

// ---------------------------------------------------------------------------
// Types (loose DB shapes)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

interface RecoRow {
  id: number;
  market: string | null;
  side: string | null;
  odd_captured: number | string | null;
  units_final: number | string | null;
}

interface HouseRow {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNumber(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number.parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * Processes a single recommendation item, mirrors /apostei logic.
 * Returns the betId on success, or throws with a descriptive message.
 */
async function processItem(
  supabase: AnySupabase,
  item: ItemInput,
  defaults: { houseId?: string; stake?: number },
): Promise<string> {
  const houseId = item.houseId ?? defaults.houseId;
  const stake = item.stake ?? defaults.stake;

  if (!houseId) throw new Error("houseId obrigatório (item ou defaultHouseId)");
  if (!stake || stake <= 0) throw new Error("stake obrigatório e > 0");

  // 1. Load reco
  const { data: recoData, error: recoErr } = await supabase
    .from("ai_recommendations")
    .select("id, market, side, odd_captured, units_final")
    .eq("id", item.ai_recommendation_id)
    .maybeSingle();

  if (recoErr) throw new Error(`reco lookup: ${recoErr.message}`);
  if (!recoData) throw new Error("ai_recommendation not found");
  const reco = recoData as RecoRow;

  // 2. Load house
  const { data: houseData, error: houseErr } = await supabase
    .from("houses")
    .select("id, name")
    .eq("id", houseId)
    .is("archived_at", null)
    .maybeSingle();

  if (houseErr) throw new Error(`house lookup: ${houseErr.message}`);
  if (!houseData) throw new Error("house not found");
  const house = houseData as HouseRow;

  // 3. Resolve effective odd
  const effectiveOdd =
    item.effectiveOdd ?? toNumber(reco.odd_captured) ?? null;
  if (!effectiveOdd || effectiveOdd <= 1.0) {
    throw new Error("odd inválida");
  }

  // 4. Idempotency: check existing pending bet for this reco
  const { data: existing } = await supabase
    .from("bets")
    .select("id, ai_recommendation_id, status, is_free_bet")
    .eq("ai_recommendation_id", item.ai_recommendation_id)
    .eq("status", "pending")
    .maybeSingle();

  if (existing) {
    // UPDATE path — adjust stake and house.
    //
    // IMPORTANT: a direct bets.update() would change the bets row but leave the
    // original bet_stake transaction unchanged → house_balance would diverge (Bug 2).
    //
    // For regular bets: use adjust_bet_stake RPC (migration 0051) which emits
    // ledger transactions atomically (reversal of original stake + new debit).
    //
    // For free bets: no stake transactions exist, so a direct bets.update()
    // is correct — nothing to adjust in the ledger.
    const existingBet = existing as { id: string; is_free_bet?: boolean };
    if (!existingBet.is_free_bet) {
      // Regular bet: use RPC to keep ledger coherent
      const { error: adjustErr } = await supabase.rpc("adjust_bet_stake", {
        p_payload: {
          bet_id: existing.id,
          new_stake: stake,
          new_house_id: houseId,
          new_odds: Number(effectiveOdd.toFixed(4)),
          placed_at: new Date().toISOString(),
        },
      });
      if (adjustErr) throw new Error(`bet update: ${adjustErr.message}`);
    } else {
      // Free bet: only update the bets row (no ledger transactions to adjust)
      const expectedReturn = Number((stake * effectiveOdd).toFixed(2));
      const { error: updErr } = await supabase
        .from("bets")
        .update({
          total_stake: stake,
          total_odds: Number(effectiveOdd.toFixed(4)),
          expected_return: expectedReturn,
          house_id: houseId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (updErr) throw new Error(`bet update: ${updErr.message}`);
    }

    await upsertFeedback(supabase, item.ai_recommendation_id);
    return existing.id as string;
  }

  // 5. INSERT path via place_bet RPC
  const effectiveMarket = reco.market ?? "—";
  const effectiveSide = reco.side ?? "—";
  const selectionLabel = `${effectiveMarket} · ${effectiveSide}`;
  const eventLabel = `reco #${reco.id}`;

  const placeBetPayload = {
    house_id: houseId,
    kind: "single" as const,
    total_stake: stake,
    placed_at: new Date().toISOString(),
    note: `vinculada à reco IA #${reco.id}`,
    ai_recommendation_id: item.ai_recommendation_id,
    selections: [{ event_label: eventLabel, selection_label: selectionLabel, odds: effectiveOdd }],
  };

  const { data: betIdRaw, error: rpcErr } = await supabase.rpc("place_bet", {
    p_payload: placeBetPayload,
  });

  if (rpcErr || !betIdRaw) {
    throw new Error(`place_bet: ${rpcErr?.message ?? "no id returned"}`);
  }

  const betId = String(betIdRaw);

  // Patch ai_recommendation_id (RPC does not set it)
  try {
    await supabase
      .from("bets")
      .update({ ai_recommendation_id: item.ai_recommendation_id })
      .eq("id", betId);
  } catch {
    // best-effort
  }

  await upsertFeedback(supabase, item.ai_recommendation_id);
  void house; // used only for 404 check
  return betId;
}

async function upsertFeedback(
  supabase: AnySupabase,
  aiRecommendationId: number,
): Promise<void> {
  try {
    await supabase.from("ai_reco_feedback").upsert(
      {
        ai_recommendation_id: aiRecommendationId,
        user_decision: "bet",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ai_recommendation_id,user_decision" },
    );
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  // 1. Parse body
  let parsed: BodyInput;
  try {
    const raw = await request.json();
    parsed = bodySchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      { error: "invalid request body", details: String(err) },
      { status: 400 },
    );
  }

  // 2. Auth gate
  const supabase = (await createClient()) as AnySupabase;
  try {
    const { data: { user } = { user: null } } = await supabase.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: "sessão expirada" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "sessão expirada" }, { status: 401 });
  }

  // 3. Process items — best-effort, never abort whole batch
  const defaults = {
    houseId: parsed.defaultHouseId,
    stake: parsed.defaultStake,
  };

  let created = 0;
  const failed: Array<{ ai_recommendation_id: number; error: string }> = [];

  for (const item of parsed.recommendations) {
    try {
      await processItem(supabase, item, defaults);
      created++;
    } catch (err) {
      failed.push({
        ai_recommendation_id: item.ai_recommendation_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ created, failed }, { status: 200 });
}
