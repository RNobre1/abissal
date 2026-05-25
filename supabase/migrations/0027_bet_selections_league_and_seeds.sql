-- 0027_bet_selections_league_and_seeds.sql
-- 1. Add league column to bet_selections
-- 2. Seed sports + markets reference data
-- 3. Update place_bet RPC to read league from JSON payload

-- ── 1. League column ─────────────────────────────────────────────────────────
alter table public.bet_selections
  add column if not exists league text;

create index if not exists idx_bet_selections_league
  on public.bet_selections(league);

-- ── 2. Seeds ─────────────────────────────────────────────────────────────────
insert into public.sports (slug, name) values
  ('futebol',    'Futebol'),
  ('tenis',      'Tênis'),
  ('basquete',   'Basquete'),
  ('americano',  'Futebol Americano'),
  ('hoquei',     'Hóquei no Gelo'),
  ('esports',    'eSports')
on conflict (slug) do nothing;

insert into public.markets (slug, name, description) values
  ('resultado-final',    'Resultado Final',       '1X2 — vitória mandante, empate ou visitante'),
  ('ambas-marcam',       'Ambas Marcam',          'BTTS — ambos os times marcam gol'),
  ('over-under-25',      'Over/Under 2.5',        'Total de gols acima ou abaixo de 2.5'),
  ('over-under-35',      'Over/Under 3.5',        'Total de gols acima ou abaixo de 3.5'),
  ('handicap-asiatico',  'Handicap Asiático',     'Handicap asiático com linha variável'),
  ('dupla-chance',       'Dupla Chance',          '1X, X2 ou 12'),
  ('primeiro-marcador',  'Primeiro Marcador',     'Quem marca o primeiro gol da partida'),
  ('escanteios-over-under', 'Escanteios O/U',    'Total de escanteios Over/Under'),
  ('cartoes-over-under', 'Cartões O/U',           'Total de cartões Over/Under'),
  ('vencedor',           'Vencedor',              'Moneyline — quem vence (sem empate)'),
  ('set-vencedor',       'Vencedor do Set',       'Quem vence o set específico'),
  ('game-spread',        'Game Spread',           'Spread de games em tênis')
on conflict (slug) do nothing;

-- ── 3. Update place_bet RPC ───────────────────────────────────────────────────
create or replace function public.place_bet(p_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user            uuid := auth.uid();
  v_house_id        uuid;
  v_kind            bet_kind;
  v_total_stake     numeric;
  v_placed_at       timestamptz;
  v_note            text;
  v_tags            text[];
  v_selections      jsonb;
  v_bet_id          uuid := gen_random_uuid();
  v_total_odds      numeric := 1;
  v_selection       jsonb;
  v_position        int := 0;
  v_selection_count int;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  v_house_id    := (p_payload->>'house_id')::uuid;
  v_kind        := (p_payload->>'kind')::bet_kind;
  v_total_stake := (p_payload->>'total_stake')::numeric;
  v_placed_at   := coalesce((p_payload->>'placed_at')::timestamptz, now());
  v_note        := nullif(p_payload->>'note', '');
  v_tags        := coalesce(
                     (select array_agg(value)
                        from jsonb_array_elements_text(p_payload->'tags')),
                     array[]::text[]);
  v_selections  := p_payload->'selections';

  if v_house_id is null then
    raise exception 'house_id is required' using errcode = '22023';
  end if;

  if v_total_stake is null or v_total_stake <= 0 then
    raise exception 'total_stake must be > 0' using errcode = '22023';
  end if;

  if v_selections is null or jsonb_typeof(v_selections) <> 'array' then
    raise exception 'selections array is required' using errcode = '22023';
  end if;

  v_selection_count := jsonb_array_length(v_selections);

  if v_selection_count = 0 then
    raise exception 'at least one selection is required' using errcode = '22023';
  end if;

  if v_kind = 'single' and v_selection_count <> 1 then
    raise exception 'single bet must have exactly one selection'
      using errcode = '22023';
  end if;

  if v_kind in ('multiple','system') and v_selection_count < 2 then
    raise exception '% bet requires 2+ selections', v_kind
      using errcode = '22023';
  end if;

  -- combined odds = product of leg odds
  for v_selection in select * from jsonb_array_elements(v_selections) loop
    v_total_odds := v_total_odds * (v_selection->>'odds')::numeric;
  end loop;

  insert into public.bets (
    id, user_id, house_id, kind, status,
    total_stake, total_odds, expected_return,
    placed_at, note, tags
  ) values (
    v_bet_id, v_user, v_house_id, v_kind, 'pending',
    v_total_stake, round(v_total_odds, 4),
    round(v_total_stake * v_total_odds, 2),
    v_placed_at, v_note, v_tags
  );

  for v_selection in select * from jsonb_array_elements(v_selections) loop
    insert into public.bet_selections (
      user_id, bet_id, position_index,
      event_label, selection_label, odds,
      sport_id, market_id, league, event_date, status
    ) values (
      v_user, v_bet_id, v_position,
      coalesce(nullif(v_selection->>'event_label', ''), '—'),
      coalesce(nullif(v_selection->>'selection_label', ''), '—'),
      (v_selection->>'odds')::numeric,
      nullif(v_selection->>'sport_id', '')::uuid,
      nullif(v_selection->>'market_id', '')::uuid,
      nullif(v_selection->>'league', ''),
      nullif(v_selection->>'event_date', '')::timestamptz,
      'pending'
    );
    v_position := v_position + 1;
  end loop;

  insert into public.transactions (
    user_id, house_id, kind, direction, amount,
    occurred_at, related_bet_id, note
  ) values (
    v_user, v_house_id, 'bet_stake', 'out', v_total_stake,
    v_placed_at, v_bet_id, 'stake'
  );

  return v_bet_id;
end;
$$;

revoke all on function public.place_bet(jsonb) from public, anon;
grant execute on function public.place_bet(jsonb) to authenticated;
