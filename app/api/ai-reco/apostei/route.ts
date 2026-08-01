import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/ai-reco/apostei — cria (ou atualiza, se já pending) uma bet
 * manual no domínio banca vinculada a uma `ai_recommendation`.
 *
 * Conecta os dois domínios:
 *   - Análise (ai_recommendations, fixture_simulations, ai_reco_feedback)
 *   - Banca (bets, transactions, bet_selections, bet_events)
 *
 * Essa rota é o elo perdido: cada clique no botão "✅ Apostei" no
 * AiRecoPanel agora **cria** uma `bets` row vinculada via
 * `bets.ai_recommendation_id` (migration 0025) — e separadamente registra
 * `ai_reco_feedback.user_decision='bet'` (mantém compatibilidade com o
 * loop antigo de feedback humano).
 *
 * Habilita o painel "ROI realizado" em /calibracao: distinguir entre
 *   - ROI hipotético = soma de `pl_units` de TODAS as recos resolvidas;
 *   - ROI realizado  = soma do P/L só das bets que o Pilot apostou de fato.
 *
 * Body:
 *   {
 *     "aiRecommendationId": 123,                    // FK ai_recommendations.id
 *     "houseId": "uuid",                            // FK houses.id (única do user)
 *     "stake": 21.00,                                // BRL > 0
 *     "odd": 2.10?,                                  // default = reco.odd_captured
 *     "market": "btts-sim"?,                         // default = reco.market
 *     "side": "yes"?                                 // default = reco.side
 *   }
 *
 * Comportamento:
 *   - 400 body inválido / stake ≤ 0 / aiRecommendationId ≤ 0.
 *   - 401 sem sessão (auth.uid() requerido para place_bet RPC).
 *   - 404 reco ou casa não encontradas (ou casa de outro user).
 *   - 200 + { betId, aiRecommendationId } em sucesso.
 *
 * Idempotência: o índice `uniq_bets_pending_per_reco` (migration 0025)
 * impede 2 bets pending com a mesma reco — a action faz UPDATE em vez de
 * INSERT quando já existe uma. Permite o Pilot revisar casa/stake sem
 * duplicar (ledger fica coerente).
 *
 * Auth: server client (createClient) com cookies — `auth.uid()` é
 * necessário pra place_bet RPC (security invoker). NÃO usa admin client.
 *
 * Spec: tarefa A2 — discussão 2026-05-25 (PO/CFO/CMO/CRO).
 */

export const maxDuration = 15;

const bodySchema = z.object({
  aiRecommendationId: z.number().int().positive(),
  houseId: z.string().uuid("houseId must be a UUID"),
  stake: z.number().positive("stake must be > 0"),
  odd: z.number().positive().optional(),
  market: z.string().min(1).max(100).optional(),
  side: z.string().min(1).max(100).optional(),
});

interface RecoLookupRow {
  id: number;
  market: string | null;
  side: string | null;
  odd_captured: number | string | null;
  units_final: number | string | null;
}

interface HouseLookupRow {
  id: string;
  name: string;
}

interface ExistingBetRow {
  id: string;
  ai_recommendation_id: number;
  status: string;
  is_free_bet: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

function toNumber(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number.parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request): Promise<Response> {
  // ---------------------------------------------------------------------------
  // 1. Body validation
  // ---------------------------------------------------------------------------
  let parsed: z.infer<typeof bodySchema>;
  try {
    const raw = await request.json();
    parsed = bodySchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      { error: "invalid request body", details: String(err) },
      { status: 400 },
    );
  }

  const supabase = (await createClient()) as AnySupabase;

  // ---------------------------------------------------------------------------
  // 2. Auth gate (place_bet RPC depends on auth.uid())
  // ---------------------------------------------------------------------------
  let userId: string;
  try {
    const { data: { user } = { user: null } } = await supabase.auth.getUser();
    if (!user?.id) {
      return NextResponse.json(
        { error: "sessão expirada" },
        { status: 401 },
      );
    }
    userId = user.id;
  } catch {
    return NextResponse.json(
      { error: "sessão expirada" },
      { status: 401 },
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Validate ai_recommendation_id (FK) and load defaults
  // ---------------------------------------------------------------------------
  let reco: RecoLookupRow | null = null;
  try {
    const { data, error } = await supabase
      .from("ai_recommendations")
      .select("id, market, side, odd_captured, units_final")
      .eq("id", parsed.aiRecommendationId)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: "recommendation lookup failed", details: error.message },
        { status: 500 },
      );
    }
    reco = (data as RecoLookupRow | null) ?? null;
  } catch (err) {
    return NextResponse.json(
      { error: "recommendation lookup error", details: String(err) },
      { status: 500 },
    );
  }
  if (!reco) {
    return NextResponse.json(
      { error: "ai_recommendation not found" },
      { status: 404 },
    );
  }

  // ---------------------------------------------------------------------------
  // 4. Validate house_id (FK) — must belong to the user (RLS already enforces
  //    when not using admin client; this lookup also handles 404 cleanly).
  // ---------------------------------------------------------------------------
  let house: HouseLookupRow | null = null;
  try {
    const { data, error } = await supabase
      .from("houses")
      .select("id, name")
      .eq("id", parsed.houseId)
      .is("archived_at", null)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: "house lookup failed", details: error.message },
        { status: 500 },
      );
    }
    house = (data as HouseLookupRow | null) ?? null;
  } catch (err) {
    return NextResponse.json(
      { error: "house lookup error", details: String(err) },
      { status: 500 },
    );
  }
  if (!house) {
    return NextResponse.json(
      { error: "house not found" },
      { status: 404 },
    );
  }

  // ---------------------------------------------------------------------------
  // 5. Resolve effective market/side/odd (request overrides reco defaults)
  // ---------------------------------------------------------------------------
  const effectiveOdd =
    parsed.odd ?? toNumber(reco.odd_captured) ?? null;
  if (effectiveOdd === null || effectiveOdd <= 1.0) {
    return NextResponse.json(
      {
        error:
          "odd inválida: forneça body.odd ou cadastre odd_captured na reco",
      },
      { status: 400 },
    );
  }
  const effectiveMarket = parsed.market ?? reco.market ?? "—";
  const effectiveSide = parsed.side ?? reco.side ?? "—";
  const selectionLabel = `${effectiveMarket} · ${effectiveSide}`;
  const eventLabel = `reco #${reco.id}`;

  // ---------------------------------------------------------------------------
  // 6. Idempotency: if a pending bet already exists for this reco, UPDATE
  // ---------------------------------------------------------------------------
  let existingBet: ExistingBetRow | null = null;
  try {
    const { data, error } = await supabase
      .from("bets")
      .select("id, ai_recommendation_id, status, is_free_bet")
      .eq("ai_recommendation_id", parsed.aiRecommendationId)
      .eq("status", "pending")
      .maybeSingle();
    if (!error && data) {
      existingBet = data as ExistingBetRow;
    }
  } catch {
    // Defensive: if the lookup fails transiently, fall through to insert path.
    // The unique index will catch a hard duplicate later.
    existingBet = null;
  }

  if (existingBet !== null) {
    // UPDATE path — adjust stake, odds and house.
    //
    // IMPORTANT: a direct bets.update() here would change total_stake/house_id
    // on the bets row but leave the original bet_stake transaction with the old
    // values — the old comment "ledger fica coerente" was incorrect (Bug 2 fix).
    //
    // For regular bets: use adjust_bet_stake RPC (migration 0051) which emits
    // ledger transactions atomically (reversal of original stake + new debit).
    //
    // For free bets: no stake transactions exist, so a direct bets.update()
    // is correct — nothing to adjust in the ledger.
    const expectedReturn = Number((parsed.stake * effectiveOdd).toFixed(2));
    try {
      if (!existingBet.is_free_bet) {
        // Regular bet: use RPC to keep ledger coherent
        const { error: adjustErr } = await supabase.rpc("adjust_bet_stake", {
          p_payload: {
            bet_id: existingBet.id,
            new_stake: parsed.stake,
            new_house_id: parsed.houseId,
            new_odds: Number(effectiveOdd.toFixed(4)),
            placed_at: new Date().toISOString(),
          },
        });
        if (adjustErr) {
          return NextResponse.json(
            { error: "bet update failed", details: adjustErr.message },
            { status: 500 },
          );
        }
      } else {
        // Free bet: only update the bets row (no ledger transactions to adjust)
        const { error: updErr } = await supabase
          .from("bets")
          .update({
            total_stake: parsed.stake,
            total_odds: Number(effectiveOdd.toFixed(4)),
            expected_return: expectedReturn,
            house_id: parsed.houseId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingBet.id)
          .select("id")
          .single();
        if (updErr) {
          return NextResponse.json(
            { error: "bet update failed", details: updErr.message },
            { status: 500 },
          );
        }
      }
    } catch (err) {
      return NextResponse.json(
        { error: "bet update error", details: String(err) },
        { status: 500 },
      );
    }

    // Mark feedback as 'bet' (idempotent upsert)
    await upsertBetFeedback(supabase, parsed.aiRecommendationId);

    return NextResponse.json(
      { betId: existingBet.id, aiRecommendationId: parsed.aiRecommendationId },
      { status: 200 },
    );
  }

  // ---------------------------------------------------------------------------
  // 7. INSERT path: place_bet RPC → returns bet uuid
  // ---------------------------------------------------------------------------
  // `place_bet` creates bet + bet_selections + transactions atomically. The
  // RPC does not know about ai_recommendation_id, so we patch it via UPDATE
  // immediately after. The two-step is acceptable because this route uses the
  // cookie-backed server client, so RLS scopes the UPDATE to the caller's own
  // bet — it is not a cross-user concern (the original note justified it with
  // "single-user MVP", which stopped being true on 2026-07-30). The residual
  // risk is a crash between the two steps leaving the link unset, which the
  // catch below already treats as cosmetic. Folding it into the RPC payload
  // would require changing migration 0006.
  const placeBetPayload = {
    house_id: parsed.houseId,
    kind: "single" as const,
    total_stake: parsed.stake,
    placed_at: new Date().toISOString(),
    note: `vinculada à reco IA #${reco.id}`,
    // ai_recommendation_id is NOT a field place_bet RPC reads; we still
    // include it in the captured payload for test introspection and patch
    // bets.ai_recommendation_id below via UPDATE.
    ai_recommendation_id: parsed.aiRecommendationId,
    selections: [
      {
        event_label: eventLabel,
        selection_label: selectionLabel,
        odds: effectiveOdd,
      },
    ],
  };

  let betId: string;
  try {
    const { data, error } = await supabase.rpc("place_bet", {
      p_payload: placeBetPayload,
    });
    if (error || !data) {
      return NextResponse.json(
        { error: "bet creation failed", details: error?.message ?? "no id" },
        { status: 500 },
      );
    }
    betId = String(data);
  } catch (err) {
    return NextResponse.json(
      { error: "bet creation error", details: String(err) },
      { status: 500 },
    );
  }

  // Patch bets.ai_recommendation_id (RPC didn't set it; ensure index applies)
  try {
    await supabase
      .from("bets")
      .update({ ai_recommendation_id: parsed.aiRecommendationId })
      .eq("id", betId);
  } catch {
    // Non-fatal: the bet exists; the link is the cosmetic part. The user
    // can re-link manually if needed. We never lose the financial record.
  }

  // Patch bet_selections.odd_taken — persiste a odd real apostada pelo Pilot
  // (migration 0030). Necessário para CLV correto: CLV = (odd_taken / odd_close - 1) * 100.
  // odd_taken pode diferir de ai_recommendations.odd_captured (o modelo calcula
  // com a odd capturada; o Pilot pode ter apostado numa odd diferente).
  // Non-fatal: se a tabela ainda não tem a coluna (pré-migration), o UPDATE
  // retorna erro silencioso. O bet já está persistido no ledger.
  try {
    await supabase
      .from("bet_selections")
      .update({ odd_taken: Number(effectiveOdd.toFixed(4)) })
      .eq("bet_id", betId);
  } catch {
    // Pre-migration 0030 fallback: silently ignore.
  }

  // Mark feedback as 'bet' (audit / loop antigo)
  await upsertBetFeedback(supabase, parsed.aiRecommendationId);

  // Use user_id eventually for audit/sanity check; suppress unused warning
  void userId;

  return NextResponse.json(
    { betId, aiRecommendationId: parsed.aiRecommendationId },
    { status: 200 },
  );
}

/**
 * Upserts a `bet` decision into `ai_reco_feedback`. Never throws — the bet
 * already exists in the ledger; the feedback row is audit/loop antigo and
 * any failure degrades silently (the row can be created later via the old
 * /feedback endpoint).
 */
async function upsertBetFeedback(
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
