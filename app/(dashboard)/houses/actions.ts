"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/slug";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  website_url: z
    .string()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  color_hex: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/, "Cor inválida (ex: #1a5fad)")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  notes_md: z.string().max(2000).optional(),
});

export type CreateState = { error?: string; values?: Record<string, string> };

export async function createHouseAction(
  _prev: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    website_url: String(formData.get("website_url") ?? ""),
    color_hex: String(formData.get("color_hex") ?? ""),
    notes_md: String(formData.get("notes_md") ?? ""),
  };
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: parsed.error.errors[0]?.message ?? "Dados inválidos",
      values: raw,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada" };

  const slug = slugify(parsed.data.name);

  const { error } = await supabase.from("houses").insert({
    user_id: user.id,
    name: parsed.data.name,
    slug,
    website_url: parsed.data.website_url ?? null,
    color_hex: parsed.data.color_hex
      ? parsed.data.color_hex.startsWith("#")
        ? parsed.data.color_hex
        : `#${parsed.data.color_hex}`
      : null,
    notes_md: parsed.data.notes_md || null,
  });

  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Já existe uma casa com esse nome."
          : error.message,
      values: raw,
    };
  }

  revalidatePath("/houses");
  revalidatePath("/");
  redirect("/houses");
}

export async function archiveHouseAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("houses")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);

  revalidatePath("/houses");
  revalidatePath("/");
}

export async function restoreHouseAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("houses")
    .update({ archived_at: null })
    .eq("id", id)
    .eq("user_id", user.id);

  revalidatePath("/houses");
  revalidatePath("/");
}
