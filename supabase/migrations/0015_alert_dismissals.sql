-- ============================================================
-- alert_dismissals — persistir "já visto/dispensado" por usuário.
--
-- Sem FK rígida para fixtures: fixtures são purgadas em 3 dias;
-- linhas órfãs são inócuas e podem ser limpas por housekeeping futuro.
-- PK composta (user_id, fixture_id) garante idempotência nos inserts.
-- ============================================================

create table if not exists public.alert_dismissals (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  fixture_id   bigint      not null,
  dismissed_at timestamptz not null default now(),
  primary key  (user_id, fixture_id)
);

alter table public.alert_dismissals enable row level security;

-- Política unificada: usuário só acessa seus próprios dismissals.
-- Padrão espelhado de bets/transactions/houses (0001_init.sql).
create policy "alert_dismissals_select"
  on public.alert_dismissals
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "alert_dismissals_insert"
  on public.alert_dismissals
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "alert_dismissals_delete"
  on public.alert_dismissals
  for delete
  to authenticated
  using (auth.uid() = user_id);
