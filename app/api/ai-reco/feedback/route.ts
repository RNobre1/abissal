import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/ai-reco/feedback -- captura feedback humano sobre uma
 * ai_recommendation (concordo, discordo, apostei, nao apostei).
 *
 * Body:
 *   {
 *     "aiRecommendationId": 123,
 *     "userDecision": "agree" | "disagree" | "bet" | "no_bet",
 *     "comment": "razao opcional"
 *   }
 *
 * Comportamento:
 *   - 400 se body invalido / userDecision fora do enum.
 *   - 401 sem sessao (auth gate -- apenas usuario autenticado pode registrar).
 *   - 404 se ai_recommendation_id nao existir.
 *   - 200 + { id } se upsert OK.
 *   - Upsert por (ai_recommendation_id, user_decision).
 *
 * Auth: createClient (server cookie session) -- auth gate adicionado 2026-05-27.
 *
 * Spec: discussion 2026-05-25 -- loop de feedback humano IA-2.
 */

export const maxDuration = 10;

const bodySchema = z.object({
  aiRecommendationId: z.number().int().positive(),
  userDecision: z.enum(["agree", "disagree", "bet", "no_bet"]),
  comment: z.string().max(2000).optional().nullable(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

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

  // ---------------------------------------------------------------------------
  // 2. Auth gate -- only the authenticated user can record feedback
  // ---------------------------------------------------------------------------
  try {
    const serverClient = (await createClient()) as AnySupabase;
    const { data: { user } = { user: null } } = await serverClient.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient() as AnySupabase;

  // ---------------------------------------------------------------------------
  // 3. Validate FK -- ai_recommendation_id must exist
  // ---------------------------------------------------------------------------
  try {
    const { data, error } = await supabase
      .from("ai_recommendations")
      .select("id")
      .eq("id", parsed.aiRecommendationId)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: "recommendation lookup failed", details: error.message },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: "ai_recommendation not found" },
        { status: 404 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: "recommendation lookup error", details: String(err) },
      { status: 500 },
    );
  }

  // ---------------------------------------------------------------------------
  // 4. Upsert feedback row
  // ---------------------------------------------------------------------------
  try {
    const { data, error } = await supabase
      .from("ai_reco_feedback")
      .upsert(
        {
          ai_recommendation_id: parsed.aiRecommendationId,
          user_decision: parsed.userDecision,
          comment: parsed.comment ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "ai_recommendation_id,user_decision" },
      )
      .select("id")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "feedback insert failed", details: error?.message ?? "no data" },
        { status: 500 },
      );
    }

    const id = (data as Record<string, unknown>).id;
    return NextResponse.json(
      { id: typeof id === "number" ? id : Number(id) },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "feedback insert error", details: String(err) },
      { status: 500 },
    );
  }
}
