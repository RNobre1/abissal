"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const disciplinaSchema = z.object({
  stop_loss_daily_pct: z.coerce
    .number()
    .min(0)
    .max(100)
    .nullable()
    .optional()
    .transform((v) => (v === 0 ? null : v)),
  max_bets_per_day: z.coerce
    .number()
    .int()
    .min(0)
    .max(50)
    .nullable()
    .optional()
    .transform((v) => (v === 0 ? null : v)),
  cooldown_after_loss_min: z.coerce.number().int().min(0).max(1440).default(60),
  quiet_mode_drawdown_pct: z.coerce.number().min(0).max(100).default(5),
  thesis_gate_enabled: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
  quiet_mode_enabled: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
});

export type DisciplinaSettingsState = {
  success?: boolean;
  error?: string;
};

export async function saveDisciplinaSettingsAction(
  _prev: DisciplinaSettingsState,
  formData: FormData,
): Promise<DisciplinaSettingsState> {
  const raw = {
    stop_loss_daily_pct: formData.get("stop_loss_daily_pct")
      ? Number(formData.get("stop_loss_daily_pct"))
      : null,
    max_bets_per_day: formData.get("max_bets_per_day")
      ? Number(formData.get("max_bets_per_day"))
      : null,
    cooldown_after_loss_min: formData.get("cooldown_after_loss_min"),
    quiet_mode_drawdown_pct: formData.get("quiet_mode_drawdown_pct"),
    thesis_gate_enabled: formData.get("thesis_gate_enabled"),
    quiet_mode_enabled: formData.get("quiet_mode_enabled"),
  };

  const parsed = disciplinaSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "dados inválidos" };
  }

  const data = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "sessão expirada" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from("disciplina_settings").upsert({
    user_id: user.id,
    stop_loss_daily_pct: data.stop_loss_daily_pct ?? null,
    max_bets_per_day: data.max_bets_per_day ?? null,
    cooldown_after_loss_min: data.cooldown_after_loss_min,
    quiet_mode_drawdown_pct: data.quiet_mode_drawdown_pct,
    thesis_gate_enabled: data.thesis_gate_enabled,
    quiet_mode_enabled: data.quiet_mode_enabled,
    updated_at: new Date().toISOString(),
  });

  if (error) return { error: error.message };

  revalidatePath("/configuracoes/disciplina");
  revalidatePath("/");
  return { success: true };
}
