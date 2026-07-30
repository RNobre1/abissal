#!/usr/bin/env tsx
/**
 * Cron diário de balance_snapshots (Pacote A item 5).
 *
 * Snapshot só nascia quando uma aposta era resolvida (`resolve_bet` chama
 * `generate_balance_snapshots` — 0014). Dia sem resolução = buraco na série,
 * e o /forecast exige ≥14 dias de histórico. Este script roda todo dia via
 * GitHub Actions (balance-snapshots-daily.yml, 03:00 UTC = 00:00 BRT) e
 * garante um snapshot por dia por (usuário, casa).
 *
 * Escopo multi-usuário: a função é SECURITY DEFINER escopada por auth.uid()
 * DENTRO dela (migration 0053) — chamada via service_role, `auth.uid()` é
 * null e ela gera para TODAS as casas não-arquivadas de TODOS os usuários,
 * exatamente o comportamento de cron pretendido pela 0053. Nenhuma migration
 * nova é necessária.
 *
 * Idempotente: upsert ON CONFLICT (user_id, house_id, snapshot_date) — rodar
 * duas vezes no mesmo dia só re-escreve os mesmos valores.
 *
 * Manual:
 *   pnpm exec tsx scripts/banca/generate-snapshots.ts
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SR) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env",
  );
  process.exit(1);
}

const supabase = createClient(URL, SR, { auth: { persistSession: false } });

async function main(): Promise<void> {
  // p_date default current_date (UTC no Postgres). Às 03:00 UTC o snapshot
  // carimba o dia UTC recém-aberto com os saldos consolidados até ali;
  // resolve_bet re-upserta a mesma data ao longo do dia (convergem no fim).
  const { data, error } = await supabase.rpc("generate_balance_snapshots");

  if (error) {
    console.error(`generate_balance_snapshots falhou: ${error.message}`);
    process.exit(1);
  }

  console.log(
    `generate_balance_snapshots: ${Number(data)} snapshot(s) upsertado(s) (todas as contas, todas as casas ativas).`,
  );
}

main().catch((err) => {
  console.error("erro inesperado:", err);
  process.exit(1);
});
