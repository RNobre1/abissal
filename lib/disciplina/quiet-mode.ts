/**
 * lib/disciplina/quiet-mode.ts
 *
 * Verifica se o "quiet mode" está ativo para o usuário.
 *
 * Quiet mode esconde OportunidadesIa na dashboard por N horas após
 * drawdown 24h exceder o threshold configurado.
 *
 * Kill switch: env var FRICAO_QUIET_MODE_ENABLED
 *   - "false" → sempre retorna active=false
 *   - qualquer outro valor ou ausente → habilitado (default true)
 *
 * Duração padrão: 4 horas (configurável via quiet_mode_duration_h, não exposto
 * na UI MVP para simplicidade — constante aqui).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_QUIET_DURATION_HOURS = 4;
const RESOLUTION_STATUSES = ["won", "lost", "void", "cashed_out", "half_won", "half_lost", "partially_void"];

export interface QuietModeResult {
  active: boolean;
  until?: Date;
  reason?: "loss" | "manual";
}

/**
 * Determina se o quiet mode está ativo.
 *
 * Ordem de verificação:
 * 1. Kill switch env → false
 * 2. Settings: quiet_mode_enabled=false → false
 * 3. Settings: quiet_mode_until > now → true (cooldown ainda rodando)
 * 4. PL_24h < -threshold% → true, persiste quiet_mode_until = now + 4h
 * 5. Demais casos → false
 */
export async function isQuietModeActive(
  supabase: SupabaseClient,
  userId: string,
): Promise<QuietModeResult> {
  // Kill switch env
  if (process.env.FRICAO_QUIET_MODE_ENABLED === "false") {
    return { active: false };
  }

  // Busca settings (graceful degradation se tabela ausente)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settings, error: settingsError } = await (supabase as any)
    .from("disciplina_settings")
    .select("quiet_mode_enabled, quiet_mode_drawdown_pct, quiet_mode_until")
    .eq("user_id", userId)
    .maybeSingle();

  if (settingsError) {
    // Tabela não existe ainda (migrations pendentes) — degrada graciosamente
    return { active: false };
  }

  // Se sem settings → usa defaults (quiet mode habilitado por default)
  const quietEnabled = settings?.quiet_mode_enabled ?? true;
  if (!quietEnabled) return { active: false };

  const drawdownThreshold = Number(settings?.quiet_mode_drawdown_pct ?? 5);

  // Verifica se quiet_mode_until ainda está no futuro
  if (settings?.quiet_mode_until) {
    const until = new Date(settings.quiet_mode_until as string);
    if (until > new Date()) {
      return { active: true, until, reason: "loss" };
    }
  }

  // Calcula PL das últimas 24h
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: bets } = await supabase
    .from("bets")
    .select("total_stake, actual_return, resolved_at")
    .gte("resolved_at", since24h)
    .not("actual_return", "is", null)
    .in("status", RESOLUTION_STATUSES)
    .order("resolved_at", { ascending: false });

  if (!bets || bets.length === 0) return { active: false };

  let totalStake = 0;
  let totalReturn = 0;

  for (const bet of bets) {
    totalStake += Number(bet.total_stake ?? 0);
    totalReturn += Number(bet.actual_return ?? 0);
  }

  if (totalStake === 0) return { active: false };

  const pl = totalReturn - totalStake;
  const drawdownPct = totalStake > 0 ? (-pl / totalStake) * 100 : 0;

  if (pl < 0 && drawdownPct >= drawdownThreshold) {
    // Ativa quiet mode: persiste quiet_mode_until
    const until = new Date(Date.now() + DEFAULT_QUIET_DURATION_HOURS * 60 * 60 * 1000);

    // Upsert sem aguardar erro crítico — se falhar, retorna ativo mesmo assim
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("disciplina_settings").upsert({
      user_id: userId,
      quiet_mode_until: until.toISOString(),
      updated_at: new Date().toISOString(),
    });

    return { active: true, until, reason: "loss" };
  }

  return { active: false };
}
