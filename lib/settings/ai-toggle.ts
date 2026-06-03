/**
 * Kill switch GLOBAL de IA. Fonte da verdade: `app_settings.key = 'ai_enabled'`
 * (jsonb boolean). Quando `false`, todo uso de LLM/OpenRouter é pulado/recusado
 * graciosamente (cron recomendador, /api/ai-reco/compute, OCR de bilhete).
 *
 * Default seguro = **LIGADO**: se a flag não existir, a leitura falhar ou o
 * client lançar, assume ligado (não quebra o comportamento atual). Desligar é
 * uma EXCEÇÃO explícita — só `value === false` desliga.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const AI_ENABLED_KEY = "ai_enabled";

/**
 * Forma mínima do client que esta lib usa. O `SupabaseClient` real (browser,
 * server ou admin) satisfaz estruturalmente; o cast evita acoplar aos tipos
 * gerados de `Database` (app_settings é tabela nova, fora dos types até regen).
 */
type SettingsClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: { value: unknown } | null; error: unknown }>;
      };
    };
    upsert: (
      row: Record<string, unknown>,
      opts: { onConflict: string },
    ) => Promise<{ error: { message?: string } | null }>;
  };
};

/** Lê a flag global. Retorna `true` (ligado) em qualquer ausência/erro. */
export async function isAiEnabled(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await (supabase as unknown as SettingsClient)
      .from("app_settings")
      .select("value")
      .eq("key", AI_ENABLED_KEY)
      .maybeSingle();
    if (error || !data) return true;
    return data.value !== false;
  } catch {
    return true;
  }
}

/** Grava a flag global (requer service_role — usar o admin client). */
export async function setAiEnabled(
  supabase: SupabaseClient,
  enabled: boolean,
  userId: string | null,
): Promise<void> {
  const { error } = await (supabase as unknown as SettingsClient).from("app_settings").upsert(
    {
      key: AI_ENABLED_KEY,
      value: enabled,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
    { onConflict: "key" },
  );
  if (error) {
    throw new Error(error.message ?? "Falha ao gravar app_settings.ai_enabled");
  }
}
