/**
 * lib/disciplina/drawdown.ts
 *
 * Calcula o drawdown percentual das últimas 72h de apostas resolvidas.
 *
 * Fórmula:
 *   PL_72h = sum(actual_return) - sum(total_stake)   [apostas resolvidas com actual_return not null]
 *   drawdown_3d = max(0, -PL_72h / sum(total_stake) * 100)
 *
 * Se PL_72h >= 0 → drawdown = 0 (sem perda recente)
 * Se sem apostas ou stake = 0 → drawdown = 0
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const RESOLUTION_STATUSES = ["won", "lost", "void", "cashed_out", "half_won", "half_lost", "partially_void"];

/**
 * Computa o drawdown das últimas 72h para o usuário.
 * Requer que o Supabase client tenha acesso à tabela `bets` com RLS habilitado
 * (ou admin client se chamado server-side sem contexto de auth).
 *
 * @returns número entre 0 e 100 representando o drawdown percentual
 */
export async function computeDrawdown3d(
  supabase: SupabaseClient,
  _userId: string,
): Promise<number> {
  const since72h = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

  const { data: bets, error } = await supabase
    .from("bets")
    .select("total_stake, actual_return, resolved_at")
    .gte("resolved_at", since72h)
    .not("actual_return", "is", null)
    .in("status", RESOLUTION_STATUSES)
    .order("resolved_at", { ascending: false });

  if (error || !bets || bets.length === 0) return 0;

  let totalStake = 0;
  let totalReturn = 0;

  for (const bet of bets) {
    const stake = Number(bet.total_stake ?? 0);
    const ret = Number(bet.actual_return ?? 0);
    totalStake += stake;
    totalReturn += ret;
  }

  if (totalStake === 0) return 0;

  const pl = totalReturn - totalStake;
  if (pl >= 0) return 0;

  return (-pl / totalStake) * 100;
}
