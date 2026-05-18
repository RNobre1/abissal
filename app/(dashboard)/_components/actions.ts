"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Persiste o dismiss de um destaque pelo usuário autenticado.
 * Idempotente: ON CONFLICT (user_id, fixture_id) DO NOTHING.
 * Revalida a raiz "/" para sumir o item da seção Destaques do dia.
 */
export async function dismissAlert(fixtureId: number): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Sessão expirada — silencia (o destaque simplesmente permanece visible
    // até o próximo login).
    return;
  }

  await supabase.from("alert_dismissals").insert({
    user_id: user.id,
    fixture_id: fixtureId,
  });

  revalidatePath("/");
}
