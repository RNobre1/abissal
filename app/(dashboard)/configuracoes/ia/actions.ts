"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setAiEnabled } from "@/lib/settings/ai-toggle";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AiToggleState = {
  success?: boolean;
  error?: string;
  enabled?: boolean;
};

/**
 * Liga/desliga o kill switch GLOBAL de IA (app_settings.ai_enabled).
 *
 * Write-path sensível (config global) → validação COMPLETA de sessão via
 * `getUser()` (round-trip, não `getClaims` — Lição B22). A escrita usa o admin
 * client (service_role) porque `app_settings` só dá SELECT a `authenticated`.
 */
export async function setAiEnabledAction(enabled: boolean): Promise<AiToggleState> {
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (!data?.user?.id) return { error: "Não autenticado." };
    userId = data.user.id;
  } catch {
    return { error: "Não autenticado." };
  }

  try {
    const admin = createAdminClient() as unknown as SupabaseClient;
    await setAiEnabled(admin, enabled, userId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao salvar a configuração." };
  }

  revalidatePath("/configuracoes/ia");
  return { success: true, enabled };
}
