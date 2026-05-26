/**
 * lib/disciplina/disciplina-guard.ts
 *
 * Guard server-side para validar limites de disciplina antes de confirmar aposta.
 *
 * Verificações (em ordem):
 *   1. stop_loss_daily_pct: se |PL_hoje| / banca >= threshold → bloqueia
 *   2. max_bets_per_day: se apostas_hoje >= max → bloqueia
 *   3. cooldown_after_loss_min: se último loss < N minutos atrás → bloqueia
 *
 * Graceful degradation: se tabela disciplina_settings não existir (migração
 * pendente) ou settings null → allowed=true (sem bloqueio).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface DisciplinaGuardResult {
  allowed: boolean;
  reason?: string;
  /** ISO timestamp de reset para o usuário saber quando pode apostar novamente */
  resetAt?: string;
}

type DisciplinaSettings = {
  stop_loss_daily_pct: number | null;
  max_bets_per_day: number | null;
  cooldown_after_loss_min: number | null;
};

/**
 * Computa o início do dia BRT (UTC-3) para filtrar apostas de hoje.
 */
function todayBrtStart(): Date {
  const now = new Date();
  // BRT = UTC-3; início do dia BRT em UTC = 03:00 UTC
  const utcH = now.getUTCHours();
  const utcOffset = 3; // BRT offset in hours from UTC

  const dayStartUtc = new Date(now);
  dayStartUtc.setUTCHours(utcOffset, 0, 0, 0);

  // Se são menos de 03:00 UTC, o "hoje BRT" começou às 03:00 UTC do dia anterior
  if (utcH < utcOffset) {
    dayStartUtc.setUTCDate(dayStartUtc.getUTCDate() - 1);
  }

  return dayStartUtc;
}

export async function checkDisciplinaLimits(
  supabase: SupabaseClient,
  _userId: string,
): Promise<DisciplinaGuardResult> {
  // Busca settings (graceful degradation)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settings, error: settingsError } = await (supabase as any)
    .from("disciplina_settings")
    .select("stop_loss_daily_pct, max_bets_per_day, cooldown_after_loss_min")
    .eq("user_id", _userId)
    .maybeSingle();

  if (settingsError || !settings) {
    return { allowed: true };
  }

  const s = settings as DisciplinaSettings;
  const todayStart = todayBrtStart().toISOString();

  // Busca apostas de hoje + última aposta com loss para cooldown
  const { data: todayBets } = await supabase
    .from("bets")
    .select("id, status, total_stake, actual_return, placed_at, resolved_at")
    .eq("user_id", _userId)
    .gte("placed_at", todayStart)
    .order("placed_at", { ascending: false });

  const bets = todayBets ?? [];

  // 1. stop_loss_daily_pct
  if (s.stop_loss_daily_pct != null && s.stop_loss_daily_pct > 0) {
    // Busca saldo total da banca
    const { data: balances } = await supabase
      .from("house_balance_view")
      .select("balance")
      .is("archived_at", null)
      .order("balance", { ascending: false });

    const totalBalance = (balances ?? []).reduce(
      (acc, h) => acc + Number(h.balance ?? 0),
      0,
    );

    if (totalBalance > 0) {
      const resolvedBets = bets.filter((b) => b.actual_return !== null);
      const totalStake = resolvedBets.reduce((acc, b) => acc + Number(b.total_stake ?? 0), 0);
      const totalReturn = resolvedBets.reduce((acc, b) => acc + Number(b.actual_return ?? 0), 0);
      const plToday = totalReturn - totalStake;
      const drawdownPct = (-plToday / totalBalance) * 100;

      if (plToday < 0 && drawdownPct >= s.stop_loss_daily_pct) {
        const resetAt = new Date();
        // Reset a 00:00 BRT = 03:00 UTC do próximo dia
        resetAt.setUTCHours(27, 0, 0, 0); // 27h = próxima meia-noite BRT em UTC (03:00 + 24h = 27:00)
        return {
          allowed: false,
          reason: `Stop-loss diário de ${s.stop_loss_daily_pct}% atingido. Próximo reset 00:00 BRT.`,
          resetAt: resetAt.toISOString(),
        };
      }
    }
  }

  // 2. max_bets_per_day
  if (s.max_bets_per_day != null && s.max_bets_per_day > 0) {
    if (bets.length >= s.max_bets_per_day) {
      return {
        allowed: false,
        reason: `Máximo de ${s.max_bets_per_day} apostas por dia atingido. Próximo reset 00:00 BRT.`,
      };
    }
  }

  // 3. cooldown_after_loss_min
  if (s.cooldown_after_loss_min != null && s.cooldown_after_loss_min > 0) {
    const lostBets = bets
      .filter((b) => b.status === "lost" && b.resolved_at)
      .sort((a, b) => new Date(b.resolved_at!).getTime() - new Date(a.resolved_at!).getTime());

    if (lostBets.length > 0) {
      const lastLoss = new Date(lostBets[0]!.resolved_at!);
      const minutesSinceLoss = (Date.now() - lastLoss.getTime()) / (60 * 1000);

      if (minutesSinceLoss < s.cooldown_after_loss_min) {
        const remaining = Math.ceil(s.cooldown_after_loss_min - minutesSinceLoss);
        const resetAt = new Date(lastLoss.getTime() + s.cooldown_after_loss_min * 60 * 1000);
        return {
          allowed: false,
          reason: `Cooldown pós-loss ativo. Aguarde ${remaining} minuto(s).`,
          resetAt: resetAt.toISOString(),
        };
      }
    }
  }

  return { allowed: true };
}
