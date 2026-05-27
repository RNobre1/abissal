-- 0042_resolve_bet_free_bet.sql
-- Recria resolve_bet RPC com suporte a is_free_bet.
--
-- Mudança para free bets (is_free_bet = true):
--   - Se p_status = 'won' e p_actual_return IS NULL:
--       v_actual_return := v_bet.total_stake * (v_bet.total_odds - 1)
--       (retorna APENAS o lucro — stake fictícia não retorna)
--   - Se p_status = 'lost': actual_return = 0 (sem transação de stake pra reverter)
--   - Se p_status = 'void': actual_return = 0 (stake fictícia, não há o que reembolsar)
--
-- Demais lógica mantida (inserir transactions(kind='bet_return'), snapshot, etc).
-- Base: última versão em 0014_banca_loop.sql.

CREATE OR REPLACE FUNCTION public.resolve_bet(
  p_bet_id        uuid,
  p_status        bet_status,
  p_actual_return numeric DEFAULT NULL,
  p_resolved_at   timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user             uuid := auth.uid();
  v_bet              public.bets%rowtype;
  v_actual_return    numeric;
  v_resolved_at      timestamptz := COALESCE(p_resolved_at, now());
  v_selection_status bet_status;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '28000';
  END IF;

  IF p_status NOT IN ('won','lost','void','cashed_out',
                      'half_won','half_lost','partially_void') THEN
    RAISE EXCEPTION 'invalid resolution status: %', p_status
      USING errcode = '22023';
  END IF;

  SELECT * INTO v_bet
    FROM public.bets
   WHERE id = p_bet_id AND user_id = v_user
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bet not found' USING errcode = 'P0002';
  END IF;

  IF v_bet.status <> 'pending' THEN
    RAISE EXCEPTION 'bet already resolved (current: %)', v_bet.status
      USING errcode = '22023';
  END IF;

  IF p_status IN ('cashed_out','half_won','half_lost','partially_void')
     AND p_actual_return IS NULL THEN
    RAISE EXCEPTION 'actual_return is required for status %', p_status
      USING errcode = '22023';
  END IF;

  -- Compute actual_return.
  -- For free bets: winning returns ONLY profit (stake * (odds - 1));
  --   the fictitious stake is never returned.
  -- For void free bets: actual_return = 0 (no stake was deducted, nothing to refund).
  IF p_actual_return IS NOT NULL THEN
    v_actual_return := p_actual_return;
  ELSIF v_bet.is_free_bet THEN
    v_actual_return := CASE
      WHEN p_status = 'won'  THEN ROUND(v_bet.total_stake * (v_bet.total_odds - 1), 2)
      WHEN p_status = 'lost' THEN 0
      WHEN p_status = 'void' THEN 0  -- free bet void: nothing to refund
      ELSE 0
    END;
  ELSE
    v_actual_return := CASE
      WHEN p_status = 'won'  THEN v_bet.expected_return
      WHEN p_status = 'lost' THEN 0
      WHEN p_status = 'void' THEN v_bet.total_stake
      ELSE 0
    END;
  END IF;

  IF v_actual_return < 0 THEN
    RAISE EXCEPTION 'actual_return cannot be negative' USING errcode = '22023';
  END IF;

  UPDATE public.bets
     SET status        = p_status,
         actual_return = ROUND(v_actual_return, 2),
         resolved_at   = v_resolved_at,
         updated_at    = now()
   WHERE id = p_bet_id AND user_id = v_user;

  -- Mirror status onto selections
  v_selection_status := CASE
    WHEN p_status = 'won'  THEN 'won'::bet_status
    WHEN p_status = 'lost' THEN 'lost'::bet_status
    WHEN p_status = 'void' THEN 'void'::bet_status
    ELSE NULL
  END;

  IF v_selection_status IS NOT NULL THEN
    UPDATE public.bet_selections
       SET status = v_selection_status
     WHERE bet_id = p_bet_id AND user_id = v_user;
  END IF;

  IF v_actual_return > 0 THEN
    INSERT INTO public.transactions (
      user_id, house_id, kind, direction, amount,
      occurred_at, related_bet_id, note
    ) VALUES (
      v_user, v_bet.house_id, 'bet_return', 'in', v_actual_return,
      v_resolved_at, p_bet_id,
      'retorno (' || p_status::text || ')'
    );
  END IF;

  -- Snapshot idempotente (falha não reverte o ledger)
  BEGIN
    PERFORM generate_balance_snapshots(v_resolved_at::date);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'resolve_bet: generate_balance_snapshots falhou para % (%): %',
      v_resolved_at::date, SQLSTATE, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_bet(uuid, bet_status, numeric, timestamptz)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_bet(uuid, bet_status, numeric, timestamptz)
  TO authenticated;
