-- 0014_banca_loop.sql
-- Fecha o loop de banca:
--   Parte 1: resolve_bet dispara generate_balance_snapshots idempotente (warning-safe).
--   Parte 2: views roi_by_house_view + roi_by_period_view.
--
-- Invariante: balance_snapshot é cache reconstruível de transactions.
-- Falha no snapshot NÃO reverte o resolve — o ledger é a fonte da verdade.

-- ============================================================================
-- PARTE 1: CREATE OR REPLACE FUNCTION resolve_bet
-- Corpo idêntico ao de 0006_bet_rpcs.sql + bloco de snapshot ao final.
-- ============================================================================

create or replace function public.resolve_bet(
  p_bet_id        uuid,
  p_status        bet_status,
  p_actual_return numeric default null,
  p_resolved_at   timestamptz default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user          uuid := auth.uid();
  v_bet           public.bets%rowtype;
  v_actual_return numeric;
  v_resolved_at   timestamptz := coalesce(p_resolved_at, now());
  v_selection_status bet_status;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if p_status not in ('won','lost','void','cashed_out',
                      'half_won','half_lost','partially_void') then
    raise exception 'invalid resolution status: %', p_status
      using errcode = '22023';
  end if;

  select * into v_bet
    from public.bets
   where id = p_bet_id and user_id = v_user
   for update;

  if not found then
    raise exception 'bet not found' using errcode = 'P0002';
  end if;

  if v_bet.status <> 'pending' then
    raise exception 'bet already resolved (current: %)', v_bet.status
      using errcode = '22023';
  end if;

  if p_status in ('cashed_out','half_won','half_lost','partially_void')
     and p_actual_return is null then
    raise exception 'actual_return is required for status %', p_status
      using errcode = '22023';
  end if;

  v_actual_return := case
    when p_actual_return is not null then p_actual_return
    when p_status = 'won'  then v_bet.expected_return
    when p_status = 'lost' then 0
    when p_status = 'void' then v_bet.total_stake
    else 0
  end;

  if v_actual_return < 0 then
    raise exception 'actual_return cannot be negative' using errcode = '22023';
  end if;

  update public.bets
     set status        = p_status,
         actual_return = round(v_actual_return, 2),
         resolved_at   = v_resolved_at,
         updated_at    = now()
   where id = p_bet_id and user_id = v_user;

  -- Mirror status onto selections so per-leg displays stay consistent for
  -- single & multiple bets. For partial / cashed-out outcomes we leave them
  -- as 'pending' to be edited per-leg later (Phase 3.1 polish).
  v_selection_status := case
    when p_status = 'won'  then 'won'::bet_status
    when p_status = 'lost' then 'lost'::bet_status
    when p_status = 'void' then 'void'::bet_status
    else null
  end;

  if v_selection_status is not null then
    update public.bet_selections
       set status = v_selection_status
     where bet_id = p_bet_id and user_id = v_user;
  end if;

  if v_actual_return > 0 then
    insert into public.transactions (
      user_id, house_id, kind, direction, amount,
      occurred_at, related_bet_id, note
    ) values (
      v_user, v_bet.house_id, 'bet_return', 'in', v_actual_return,
      v_resolved_at, p_bet_id,
      'retorno (' || p_status::text || ')'
    );
  end if;

  -- Snapshot idempotente: gera (ou atualiza) o snapshot do dia do resolve.
  -- Falha não reverte o ledger — snapshot é cache reconstruível.
  begin
    PERFORM generate_balance_snapshots(v_resolved_at::date);
  exception when others then
    RAISE WARNING 'resolve_bet: generate_balance_snapshots falhou para % (%): %',
      v_resolved_at::date, SQLSTATE, SQLERRM;
  end;
end;
$$;

revoke all on function public.resolve_bet(uuid, bet_status, numeric, timestamptz)
  from public, anon;
grant execute on function public.resolve_bet(uuid, bet_status, numeric, timestamptz)
  to authenticated;

-- ============================================================================
-- PARTE 2: views roi_by_house_view + roi_by_period_view
-- ============================================================================

-- Por casa: métricas de ROI/yield/win_rate por casa de apostas
-- Derivado de bets + bet_selections + transactions (sem novas tabelas).
-- ROI por casa = (retorno - stake) / net_capital_da_casa
--   onde net_capital_da_casa = depósitos - saques (transactions kind=deposit/withdrawal)
-- Yield por casa = (retorno - stake) / stake  (apostas resolvidas)
-- Win rate = apostas ganhas / (ganhas + perdidas)  [void não conta]
create or replace view public.roi_by_house_view as
with house_capital as (
  select
    t.user_id,
    t.house_id,
    coalesce(sum(t.amount) filter (where t.kind = 'deposit'),    0)::numeric(14,2) as deposits,
    coalesce(sum(t.amount) filter (where t.kind = 'withdrawal'), 0)::numeric(14,2) as withdrawals
  from public.transactions t
  group by t.user_id, t.house_id
),
bet_agg as (
  select
    b.user_id,
    b.house_id,
    coalesce(sum(b.total_stake)    filter (where b.status <> 'pending'), 0)::numeric(14,2) as resolved_staked,
    coalesce(sum(b.actual_return)  filter (where b.status <> 'pending'), 0)::numeric(14,2) as resolved_returned,
    count(*)                       filter (where b.status <> 'pending')                    as bet_count,
    count(*)                       filter (where b.status = 'won')                         as won_count,
    count(*)                       filter (where b.status = 'lost')                        as lost_count,
    coalesce(sum(b.total_stake)    filter (where b.status = 'pending'),  0)::numeric(14,2) as pending_stake
  from public.bets b
  group by b.user_id, b.house_id
)
select
  h.id                                                                     as house_id,
  h.user_id,
  h.name                                                                   as house_name,
  h.slug,
  h.color_hex,
  coalesce(ba.resolved_staked,   0)::numeric(14,2)                        as resolved_staked,
  coalesce(ba.resolved_returned, 0)::numeric(14,2)                        as resolved_returned,
  -- P/L da casa
  (coalesce(ba.resolved_returned, 0) - coalesce(ba.resolved_staked, 0))::numeric(14,2) as pl,
  -- Yield = pl / staked (null quando staked = 0)
  case
    when coalesce(ba.resolved_staked, 0) = 0 then null
    else ((ba.resolved_returned - ba.resolved_staked) / ba.resolved_staked)::numeric(14,6)
  end                                                                      as yield,
  -- ROI = pl / net_capital (null quando net_capital = 0)
  case
    when (coalesce(hc.deposits, 0) - coalesce(hc.withdrawals, 0)) = 0 then null
    else ((ba.resolved_returned - ba.resolved_staked)
           / (hc.deposits - hc.withdrawals))::numeric(14,6)
  end                                                                      as roi,
  -- Win rate (null quando nenhuma resolvida)
  case
    when (coalesce(ba.won_count, 0) + coalesce(ba.lost_count, 0)) = 0 then null
    else (ba.won_count::numeric / (ba.won_count + ba.lost_count))::numeric(14,6)
  end                                                                      as win_rate,
  coalesce(ba.bet_count,    0)                                             as bet_count,
  coalesce(ba.pending_stake,0)::numeric(14,2)                             as pending_stake
from public.houses h
left join house_capital hc on hc.user_id = h.user_id and hc.house_id = h.id
left join bet_agg ba        on ba.user_id = h.user_id and ba.house_id = h.id;

-- Por período: ROI/yield agregado por mês e janela rolling-30d
create or replace view public.roi_by_period_view as
with monthly as (
  select
    b.user_id,
    to_char(b.resolved_at, 'YYYY-MM')                                      as period,
    'monthly'                                                               as period_type,
    coalesce(sum(b.total_stake)   filter (where b.status <> 'pending'), 0)::numeric(14,2)  as resolved_staked,
    coalesce(sum(b.actual_return) filter (where b.status <> 'pending'), 0)::numeric(14,2)  as resolved_returned,
    count(*)                      filter (where b.status = 'won')                           as won_count,
    count(*)                      filter (where b.status = 'lost')                          as lost_count,
    count(*)                      filter (where b.status <> 'pending')                     as bet_count
  from public.bets b
  where b.resolved_at is not null
  group by b.user_id, to_char(b.resolved_at, 'YYYY-MM')
),
rolling_30d as (
  select
    b.user_id,
    'rolling-30d'                                                           as period,
    'rolling-30d'                                                           as period_type,
    coalesce(sum(b.total_stake)   filter (where b.status <> 'pending'), 0)::numeric(14,2)  as resolved_staked,
    coalesce(sum(b.actual_return) filter (where b.status <> 'pending'), 0)::numeric(14,2)  as resolved_returned,
    count(*)                      filter (where b.status = 'won')                           as won_count,
    count(*)                      filter (where b.status = 'lost')                          as lost_count,
    count(*)                      filter (where b.status <> 'pending')                     as bet_count
  from public.bets b
  where b.resolved_at >= (current_date - interval '30 days')
    and b.resolved_at is not null
  group by b.user_id
)
select
  user_id,
  period,
  period_type,
  resolved_staked,
  resolved_returned,
  (resolved_returned - resolved_staked)::numeric(14,2)                     as pl,
  case
    when resolved_staked = 0 then null
    else ((resolved_returned - resolved_staked) / resolved_staked)::numeric(14,6)
  end                                                                       as yield,
  won_count,
  lost_count,
  bet_count,
  case
    when (won_count + lost_count) = 0 then null
    else (won_count::numeric / (won_count + lost_count))::numeric(14,6)
  end                                                                       as win_rate
from (
  select * from monthly
  union all
  select * from rolling_30d
) combined
order by user_id, period_type desc, period desc;

grant select on public.roi_by_house_view  to authenticated;
grant select on public.roi_by_period_view to authenticated;

-- RLS isolation: views devem rodar como invoker para que o RLS do usuário
-- autenticado se aplique — mesma correção aplicada em 0005_security_hardening.sql
-- nas views antigas (house_balance_view / bet_summary_view / daily_pl_view).
alter view public.roi_by_house_view  set (security_invoker = true);
alter view public.roi_by_period_view set (security_invoker = true);
