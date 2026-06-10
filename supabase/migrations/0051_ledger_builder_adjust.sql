-- 0051_ledger_builder_adjust.sql
-- Corrige dois furos de ledger:
--
--   BUG 1: createBetBuilderAction inseria direto em `bets` sem débitar o
--   stake da banca. Fix: RPC `place_bet_builder` que insere bets +
--   bet_selections + transactions atomicamente (igual ao place_bet
--   para kind='single'/'multiple').
--
--   BUG 2: o caminho UPDATE (idempotência) de /api/ai-reco/apostei e
--   /apostei/batch fazia UPDATE direto em bets sem ajustar a transação
--   bet_stake original → house_balance divergia.
--   Fix: RPC `adjust_bet_stake` que emite estorno + novo débito, ambos
--   append-only (transactions é imutável via trigger), e atualiza bets.
--
-- Regras invariantes:
--   - is_free_bet=true: NÃO insere/estorna transactions (stake fictícia).
--   - Só bets.status='pending' podem ser ajustadas.
--   - Estorno aponta para a transação original via related_transaction_id.

-- ============================================================================
-- place_bet_builder
-- ============================================================================
-- Insere bets (kind='bet_builder') + N bet_selections + transactions(bet_stake)
-- atomicamente. Segue o mesmo padrão de place_bet (0041) adaptado para o
-- bet_builder: legs em vez de selections, odd_combined pré-calculada.
--
-- Payload shape:
-- {
--   "house_id"     : uuid,
--   "total_stake"  : numeric,        -- > 0
--   "total_odds"   : numeric,        -- >= 1.01 (odd combinada)
--   "placed_at"    : timestamptz?,   -- defaults to now()
--   "note"         : text?,
--   "is_free_bet"  : boolean?,       -- default false
--   "thesis"       : text?,
--   "home_team"    : text?,
--   "away_team"    : text?,
--   "legs"         : [               -- N condições (N >= 1)
--     { "market": text, "side": text }, ...
--   ]
-- }
-- Returns: uuid do novo bet.

CREATE OR REPLACE FUNCTION public.place_bet_builder(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user          uuid := auth.uid();
  v_house_id      uuid;
  v_total_stake   numeric;
  v_total_odds    numeric;
  v_placed_at     timestamptz;
  v_note          text;
  v_is_free_bet   boolean;
  v_thesis        text;
  v_home_team     text;
  v_away_team     text;
  v_legs          jsonb;
  v_leg           jsonb;
  v_bet_id        uuid := gen_random_uuid();
  v_position      int := 0;
  v_event_label   text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '28000';
  END IF;

  v_house_id    := (p_payload->>'house_id')::uuid;
  v_total_stake := (p_payload->>'total_stake')::numeric;
  v_total_odds  := (p_payload->>'total_odds')::numeric;
  v_placed_at   := COALESCE((p_payload->>'placed_at')::timestamptz, now());
  v_note        := nullif(p_payload->>'note', '');
  v_is_free_bet := COALESCE((p_payload->>'is_free_bet')::boolean, false);
  v_thesis      := nullif(p_payload->>'thesis', '');
  v_home_team   := nullif(p_payload->>'home_team', '');
  v_away_team   := nullif(p_payload->>'away_team', '');
  v_legs        := p_payload->'legs';

  IF v_house_id IS NULL THEN
    RAISE EXCEPTION 'house_id is required' USING errcode = '22023';
  END IF;

  IF v_total_stake IS NULL OR v_total_stake <= 0 THEN
    RAISE EXCEPTION 'total_stake must be > 0' USING errcode = '22023';
  END IF;

  IF v_total_odds IS NULL OR v_total_odds <= 1 THEN
    RAISE EXCEPTION 'total_odds must be > 1' USING errcode = '22023';
  END IF;

  IF v_legs IS NULL OR jsonb_typeof(v_legs) <> 'array' OR jsonb_array_length(v_legs) = 0 THEN
    RAISE EXCEPTION 'legs array is required and must have at least one item' USING errcode = '22023';
  END IF;

  -- event_label: "Home × Away" ou "jogo" quando times não informados
  v_event_label := CASE
    WHEN v_home_team IS NOT NULL AND v_away_team IS NOT NULL
      THEN v_home_team || ' × ' || v_away_team
    ELSE 'jogo'
  END;

  -- 1. Insert bets row
  INSERT INTO public.bets (
    id, user_id, house_id, kind, status,
    total_stake, total_odds, expected_return,
    placed_at, note, thesis, is_free_bet
  ) VALUES (
    v_bet_id, v_user, v_house_id, 'bet_builder', 'pending',
    v_total_stake, ROUND(v_total_odds, 4),
    ROUND(v_total_stake * v_total_odds, 2),
    v_placed_at, v_note, v_thesis, v_is_free_bet
  );

  -- 2. Insert bet_selections (one per leg)
  FOR v_leg IN SELECT * FROM jsonb_array_elements(v_legs) LOOP
    INSERT INTO public.bet_selections (
      user_id, bet_id, position_index,
      event_label, selection_label, odds, status
    ) VALUES (
      v_user, v_bet_id, v_position,
      v_event_label,
      -- selection_label: "market — side"
      COALESCE(nullif(v_leg->>'market', ''), '—') || ' — ' || COALESCE(nullif(v_leg->>'side', ''), '—'),
      -- odds: odd_combined (satisfies CHECK odds > 1; individual odds not available)
      v_total_odds,
      'pending'
    );
    v_position := v_position + 1;
  END LOOP;

  -- 3. Debit stake from ledger (skip for free bets)
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

REVOKE ALL ON FUNCTION public.place_bet_builder(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.place_bet_builder(jsonb) TO authenticated;

-- ============================================================================
-- adjust_bet_stake
-- ============================================================================
-- Ajusta atomicamente stake + casa de um bet pendente:
--   1. Emite ESTORNO da transação original (direction oposta ao débito,
--      related_transaction_id → tx original, note explicativo). Append-only.
--   2. Emite novo DÉBITO com novo stake e nova casa.
--   3. Atualiza bets (total_stake, total_odds, expected_return, house_id).
--
-- Apenas bets status='pending' e is_free_bet=false podem ser ajustadas.
-- Free bets: a chamada é silenciosamente ignorada (sem exceção) — a camada
-- de aplicação não deve chamá-la para free bets, mas se chamar, é no-op.
--
-- Payload shape:
-- {
--   "bet_id"       : uuid,
--   "new_stake"    : numeric,   -- > 0
--   "new_house_id" : uuid,
--   "new_odds"     : numeric?,  -- se omitido, mantém bets.total_odds atual
--   "placed_at"    : timestamptz? -- defaults to now() para as novas transações
-- }

CREATE OR REPLACE FUNCTION public.adjust_bet_stake(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user         uuid := auth.uid();
  v_bet_id       uuid;
  v_new_stake    numeric;
  v_new_house_id uuid;
  v_new_odds     numeric;
  v_placed_at    timestamptz;
  v_bet          public.bets%rowtype;
  v_orig_tx_id   uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '28000';
  END IF;

  v_bet_id       := (p_payload->>'bet_id')::uuid;
  v_new_stake    := (p_payload->>'new_stake')::numeric;
  v_new_house_id := (p_payload->>'new_house_id')::uuid;
  v_placed_at    := COALESCE((p_payload->>'placed_at')::timestamptz, now());

  IF v_bet_id IS NULL THEN
    RAISE EXCEPTION 'bet_id is required' USING errcode = '22023';
  END IF;

  IF v_new_stake IS NULL OR v_new_stake <= 0 THEN
    RAISE EXCEPTION 'new_stake must be > 0' USING errcode = '22023';
  END IF;

  IF v_new_house_id IS NULL THEN
    RAISE EXCEPTION 'new_house_id is required' USING errcode = '22023';
  END IF;

  -- Lock + load the bet (RLS: user can only touch their own bets)
  SELECT * INTO v_bet
    FROM public.bets
   WHERE id = v_bet_id AND user_id = v_user
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bet not found' USING errcode = 'P0002';
  END IF;

  IF v_bet.status <> 'pending' THEN
    RAISE EXCEPTION 'bet already resolved — cannot adjust stake (status: %)', v_bet.status
      USING errcode = '22023';
  END IF;

  -- Free bets: no transactions to adjust; just update bets row and return
  IF v_bet.is_free_bet THEN
    v_new_odds := COALESCE((p_payload->>'new_odds')::numeric, v_bet.total_odds);
    UPDATE public.bets
       SET total_stake     = v_new_stake,
           total_odds      = ROUND(v_new_odds, 4),
           expected_return = ROUND(v_new_stake * v_new_odds, 2),
           house_id        = v_new_house_id,
           updated_at      = now()
     WHERE id = v_bet_id AND user_id = v_user;
    RETURN;
  END IF;

  v_new_odds := COALESCE((p_payload->>'new_odds')::numeric, v_bet.total_odds);

  -- 1. Find the original bet_stake transaction for this bet
  SELECT id INTO v_orig_tx_id
    FROM public.transactions
   WHERE related_bet_id = v_bet_id
     AND kind = 'bet_stake'
     AND user_id = v_user
   ORDER BY occurred_at ASC
   LIMIT 1;

  -- 2. Emit reversal of original stake (credit back old stake to old house)
  --    related_transaction_id points to the original debit for auditability.
  IF v_orig_tx_id IS NOT NULL THEN
    INSERT INTO public.transactions (
      user_id, house_id, kind, direction, amount,
      occurred_at, related_bet_id, related_transaction_id, note
    ) VALUES (
      v_user, v_bet.house_id, 'bet_stake', 'in', v_bet.total_stake,
      v_placed_at, v_bet_id, v_orig_tx_id,
      'estorno: stake ajustado de ' || v_bet.house_id::text || ' → ' || v_new_house_id::text
    );
  ELSE
    -- Edge case: original tx was never created (builder bug, pre-0051 rows).
    -- No reversal needed — just skip to the new debit.
    NULL;
  END IF;

  -- 3. Emit new debit for the new stake in the new house
  INSERT INTO public.transactions (
    user_id, house_id, kind, direction, amount,
    occurred_at, related_bet_id, note
  ) VALUES (
    v_user, v_new_house_id, 'bet_stake', 'out', v_new_stake,
    v_placed_at, v_bet_id, 'stake ajustado'
  );

  -- 4. Update bets row
  UPDATE public.bets
     SET total_stake     = v_new_stake,
         total_odds      = ROUND(v_new_odds, 4),
         expected_return = ROUND(v_new_stake * v_new_odds, 2),
         house_id        = v_new_house_id,
         updated_at      = now()
   WHERE id = v_bet_id AND user_id = v_user;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_bet_stake(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.adjust_bet_stake(jsonb) TO authenticated;
