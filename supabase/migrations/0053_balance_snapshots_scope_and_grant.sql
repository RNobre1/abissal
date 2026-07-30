-- 0053 — conserta `balance_snapshots`, que nunca funcionou, sem reabrir a
-- brecha que a 0005 fechou.
--
-- O DEFEITO (achado na revisão de 2026-07-30, verificado migration a migration):
--   0003 → `generate_balance_snapshots` nasce com grant só pra service_role.
--   0005 → revoke explícito de public/anon/authenticated.
--   0014 → `resolve_bet` (SECURITY INVOKER, grant pra authenticated) passa a
--          chamar `PERFORM generate_balance_snapshots(...)` no fim, e engole
--          qualquer erro num `RAISE WARNING`.
--
-- Ou seja: o app resolve uma aposta como usuário autenticado, o RPC tenta
-- executar uma função pra qual esse papel não tem permissão, falha, e o erro
-- morre no warning. `balance_snapshots` ficou com ZERO linhas desde a 0014 —
-- e junto foram `daily_pl_view` (vazia) e `/forecast` (preso em "ainda cedo
-- demais" pra sempre).
--
-- POR QUE O GRANT NÃO PODE SIMPLESMENTE VOLTAR: a função é SECURITY DEFINER e
-- itera sobre `houses` de TODOS os usuários. Devolver o grant a `authenticated`
-- deixaria qualquer usuário disparar a geração para os outros — exatamente o
-- que a 0005 fechou. Com mais de um usuário no sistema isso deixa de ser
-- hipótese.
--
-- A CORREÇÃO: escopar por `auth.uid()` DENTRO da função.
--   • chamada por usuário autenticado  → só as casas dele;
--   • chamada por service_role (cron)  → `auth.uid()` é null → todas, como antes.
-- Assim o grant volta a ser seguro e o `resolve_bet` não precisa ser tocado —
-- o coração do ledger fica intacto.

create or replace function public.generate_balance_snapshots(p_date date default current_date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  rows_written int := 0;
  v_caller uuid := auth.uid();
  h record;
  b record;
begin
  for h in
    select id, user_id
      from public.houses
     where archived_at is null
       -- Escopo: usuário autenticado só gera o próprio snapshot. service_role
       -- (auth.uid() null) mantém o comportamento global de que o cron depende.
       and (v_caller is null or user_id = v_caller)
  loop
    select * into b from public.house_balance(h.user_id, h.id);

    insert into public.balance_snapshots (
      user_id, house_id, snapshot_date, balance,
      deposits_to_date, withdrawals_to_date, staked_to_date,
      returned_to_date, pending_stake
    )
    values (
      h.user_id, h.id, p_date, b.balance,
      b.deposits_to_date, b.withdrawals_to_date, b.staked_to_date,
      b.returned_to_date, b.pending_stake
    )
    on conflict (user_id, house_id, snapshot_date)
    do update set
      balance              = excluded.balance,
      deposits_to_date     = excluded.deposits_to_date,
      withdrawals_to_date  = excluded.withdrawals_to_date,
      staked_to_date       = excluded.staked_to_date,
      returned_to_date     = excluded.returned_to_date,
      pending_stake        = excluded.pending_stake;

    rows_written := rows_written + 1;
  end loop;

  return rows_written;
end;
$$;

-- `anon` segue de fora: quem não está logado não gera nada.
revoke all on function public.generate_balance_snapshots(date) from public, anon;
grant execute on function public.generate_balance_snapshots(date) to authenticated;
grant execute on function public.generate_balance_snapshots(date) to service_role;
