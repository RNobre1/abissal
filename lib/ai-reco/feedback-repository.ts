import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reader for the `ai_reco_feedback` table (migration 0024).
 *
 * Scalar-only: every column listed below is escalar pequeno (FK + enum +
 * timestamps + opcional comment string ≤2000 chars). Sem detail_json /
 * jsonb pesado — passa no guard estático de repository-payload.
 *
 * Defensive shape: cada falha (tabela ausente, transient error, malformed)
 * degrada para `[]` em vez de jogar — o painel renderiza os botões como
 * "sem feedback ainda".
 *
 * Spec: discussion 2026-05-25 — loop de feedback humano IA-2.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any> | any;

export type UserDecision = "agree" | "disagree" | "bet" | "no_bet";

export interface AiRecoFeedbackDTO {
  id: number;
  ai_recommendation_id: number;
  user_decision: UserDecision;
  comment: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const COLUMNS =
  "id, ai_recommendation_id, user_decision, comment, created_at, updated_at";

function asDecision(v: unknown): UserDecision | null {
  if (v === "agree" || v === "disagree" || v === "bet" || v === "no_bet") {
    return v;
  }
  return null;
}

function mapRow(row: Record<string, unknown>): AiRecoFeedbackDTO | null {
  const decision = asDecision(row.user_decision);
  if (decision === null) return null;
  const id = Number(row.id);
  const recoId = Number(row.ai_recommendation_id);
  if (!Number.isFinite(id) || !Number.isFinite(recoId)) return null;
  const comment = typeof row.comment === "string" ? row.comment : null;
  const created =
    typeof row.created_at === "string" ? row.created_at : null;
  const updated =
    typeof row.updated_at === "string" ? row.updated_at : null;
  return {
    id,
    ai_recommendation_id: recoId,
    user_decision: decision,
    comment,
    created_at: created,
    updated_at: updated,
  };
}

/**
 * Returns every feedback row for a given ai_recommendation_id, mais recente
 * primeiro. Up to 4 rows (1 por user_decision distinto).
 *
 * Never throws: missing table / transient error / null all degrade to `[]`.
 */
export async function getFeedbackForReco(
  aiRecommendationId: number,
  supabase: AnySupabase,
): Promise<AiRecoFeedbackDTO[]> {
  try {
    const { data, error } = await supabase
      .from("ai_reco_feedback")
      .select(COLUMNS)
      .eq("ai_recommendation_id", aiRecommendationId)
      .order("updated_at", { ascending: false, nullsFirst: false });
    if (error || !data || !Array.isArray(data)) return [];
    const out: AiRecoFeedbackDTO[] = [];
    for (const row of data as Array<Record<string, unknown>>) {
      const dto = mapRow(row);
      if (dto !== null) out.push(dto);
    }
    return out;
  } catch {
    return [];
  }
}
