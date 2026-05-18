/**
 * Write side de `ai_predictions` — insere uma predição estruturada capturada
 * pelo fixture-copilot. Fire-and-forget: callers NÃO devem aguardar o
 * resultado dentro do hot path. Erros são engolidos (nunca afetam a resposta
 * ao usuário). Padrão espelhado de `lib/llm-logs.ts`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FromSupabase = { from: (table: string) => any };

export interface PredictionInput {
  fixture_id?: number | null;
  route: "fixture-copilot";
  model?: string | null;
  reasoner?: boolean;
  home_team: string;
  away_team: string;
  league?: string | null;
  kickoff_utc?: string | null;
  pred_winner: "home" | "draw" | "away";
  pred_confidence: number;
  pred_over_under: "over" | "under";
  raw_excerpt?: string | null;
}

export async function recordPrediction(
  supabase: FromSupabase,
  input: PredictionInput,
): Promise<void> {
  try {
    const { error } = await supabase.from("ai_predictions").insert({
      fixture_id: input.fixture_id ?? null,
      route: input.route,
      model: input.model ?? null,
      reasoner: input.reasoner ?? false,
      home_team: input.home_team,
      away_team: input.away_team,
      league: input.league ?? null,
      kickoff_utc: input.kickoff_utc ?? null,
      pred_winner: input.pred_winner,
      pred_confidence: input.pred_confidence,
      pred_over_under: input.pred_over_under,
      raw_excerpt: input.raw_excerpt ?? null,
      status: "pending",
    });
    if (error) {
      console.error("[predictions-repo] insert failed:", error.message ?? error);
    }
  } catch (err) {
    console.error("[predictions-repo] insert threw:", err);
  }
}
