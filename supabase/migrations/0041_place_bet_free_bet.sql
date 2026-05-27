-- 0041_place_bet_free_bet.sql
-- Recria place_bet RPC com suporte a is_free_bet.
--
-- Mudança: se p_payload->>'is_free_bet' = 'true':
--   1. Insere bets.is_free_bet = true
--   2. NÃO insere transactions(kind='bet_stake') — stake não desconta da banca
--
-- Demais comportamento mantido (selections, validations, odds computation).
-- Base: última versão em 0027_bet_selections_league_and_seeds.sql.

CREATE OR REPLACE FUNCTION public.place_bet(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
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
  v_is_free_bet     boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '28000';
  END IF;

  v_house_id    := (p_payload->>'house_id')::uuid;
  v_kind        := (p_payload->>'kind')::bet_kind;
  v_total_stake := (p_payload->>'total_stake')::numeric;
  v_placed_at   := COALESCE((p_payload->>'placed_at')::timestamptz, now());
  v_note        := nullif(p_payload->>'note', '');
  v_tags        := COALESCE(
                     (SELECT array_agg(value)
                        FROM jsonb_array_elements_text(p_payload->'tags')),
                     array[]::text[]);
  v_selections  := p_payload->'selections';
  v_is_free_bet := COALESCE((p_payload->>'is_free_bet')::boolean, false);

  IF v_house_id IS NULL THEN
    RAISE EXCEPTION 'house_id is required' USING errcode = '22023';
  END IF;

  IF v_total_stake IS NULL OR v_total_stake <= 0 THEN
    RAISE EXCEPTION 'total_stake must be > 0' USING errcode = '22023';
  END IF;

  IF v_selections IS NULL OR jsonb_typeof(v_selections) <> 'array' THEN
    RAISE EXCEPTION 'selections array is required' USING errcode = '22023';
  END IF;

  v_selection_count := jsonb_array_length(v_selections);

  IF v_selection_count = 0 THEN
    RAISE EXCEPTION 'at least one selection is required' USING errcode = '22023';
  END IF;

  IF v_kind = 'single' AND v_selection_count <> 1 THEN
    RAISE EXCEPTION 'single bet must have exactly one selection'
      USING errcode = '22023';
  END IF;

  IF v_kind IN ('multiple','system') AND v_selection_count < 2 THEN
    RAISE EXCEPTION '% bet requires 2+ selections', v_kind
      USING errcode = '22023';
  END IF;

  -- combined odds = product of leg odds
  FOR v_selection IN SELECT * FROM jsonb_array_elements(v_selections) LOOP
    v_total_odds := v_total_odds * (v_selection->>'odds')::numeric;
  END LOOP;

  INSERT INTO public.bets (
    id, user_id, house_id, kind, status,
    total_stake, total_odds, expected_return,
    placed_at, note, tags, is_free_bet
  ) VALUES (
    v_bet_id, v_user, v_house_id, v_kind, 'pending',
    v_total_stake, round(v_total_odds, 4),
    round(v_total_stake * v_total_odds, 2),
    v_placed_at, v_note, v_tags, v_is_free_bet
  );

  FOR v_selection IN SELECT * FROM jsonb_array_elements(v_selections) LOOP
    INSERT INTO public.bet_selections (
      user_id, bet_id, position_index,
      event_label, selection_label, odds,
      sport_id, market_id, league, event_date, status
    ) VALUES (
      v_user, v_bet_id, v_position,
      COALESCE(nullif(v_selection->>'event_label', ''), '—'),
      COALESCE(nullif(v_selection->>'selection_label', ''), '—'),
      (v_selection->>'odds')::numeric,
      nullif(v_selection->>'sport_id', '')::uuid,
      nullif(v_selection->>'market_id', '')::uuid,
      nullif(v_selection->>'league', ''),
      nullif(v_selection->>'event_date', '')::timestamptz,
      'pending'
    );
    v_position := v_position + 1;
  END LOOP;

  -- Free bet: NÃO desconta da banca (sem transactions bet_stake).
  -- Aposta normal: insere transactions(kind='bet_stake', direction='out').
  IF NOT v_is_free_bet THEN
    INSERT INTO public.transactions (
      user_id, house_id, kind, direction, amount,
      occurred_at, related_bet_id, note
    ) VALUES (
      v_user, v_house_id, 'bet_stake', 'out', v_total_stake,
      v_placed_at, v_bet_id, 'stake'
    );
  END IF;

  RETURN v_bet_id;
END;
$$;

REVOKE ALL ON FUNCTION public.place_bet(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.place_bet(jsonb) TO authenticated;
