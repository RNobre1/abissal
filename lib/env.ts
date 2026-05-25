import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  // Adam-stats fixtures API routes (server-only).
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  /**
   * Modelo default do copilot/analisador antigo (deepseek/deepseek-v3.2).
   * Mantido pra retrocompat, mas o IA-2 Recomendador usa AI_RECO_MODEL.
   */
  OPENROUTER_MODEL: z.string().default("deepseek/deepseek-v3.2"),
  /**
   * Modelo do IA-2 Recomendador batch (Ruby runner / cron noturno).
   * Default: deepseek/deepseek-r1 (reasoning model). Reasoner=true em
   * tracking. p95 ~195s — ok pra batch, ruim pra UX on-demand.
   * Pode ser sobrescrito via env var.
   */
  AI_RECO_MODEL: z.string().default("deepseek/deepseek-r1"),
  /**
   * Modelo do IA-2 Recomendador on-demand (`/api/ai-reco/compute` quando
   * o usuário aperta "[ pedir análise IA ]" na /fixtures/[id]).
   * Default: anthropic/claude-sonnet-4.5 — fast, sem thinking, latência
   * ~3-5s p50. Trade-off vs R1: ~5× mais caro por token, mas UX
   * sincrona não tolera 3min de espera.
   */
  AI_RECO_MODEL_ONDEMAND: z.string().default("anthropic/claude-sonnet-4.5"),
  ADAMCHOI_API_TOKEN: z.string().min(1).optional(),
});

export const env = envSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  AI_RECO_MODEL: process.env.AI_RECO_MODEL,
  AI_RECO_MODEL_ONDEMAND: process.env.AI_RECO_MODEL_ONDEMAND,
  ADAMCHOI_API_TOKEN: process.env.ADAMCHOI_API_TOKEN,
});

export type Env = typeof env;
