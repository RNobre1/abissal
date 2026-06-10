-- backfill-builder-ledger.sql
-- Corrige saldo fantasma causado pelo Bug 1 (createBetBuilderAction):
-- o builder inseria direto em `bets` sem débitar o stake via RPC place_bet.
-- Quando essas bets foram resolvidas como 'void', resolve_bet creditou o
-- stake de volta (bet_return 'in') sem que houvesse débito prévio →
-- saldo inflado.
--
-- MATEMÁTICA:
--   Fluxo correto de uma aposta normal:
--     1. place_bet  → transactions(bet_stake, 'out', stake)      -stake
--     2. resolve_bet void → transactions(bet_return, 'in', stake) +stake
--     Saldo líquido = 0 (certo — stake sai e retorna)
--
--   Fluxo bugado do builder:
--     1. bets.insert direto → SEM transactions(bet_stake)         nada
--     2. resolve_bet void → transactions(bet_return, 'in', stake) +stake
--     Saldo líquido = +stake (ERRADO — phantom credit)
--
-- CORREÇÃO:
--   Para cada bet kind='bet_builder' / status em ('void','lost','won') /
--   is_free_bet=false que NÃO tem transactions(bet_stake, 'out'):
--     Se tem bet_return 'in' (crédito fantasma), inserir um
--     transactions(bet_stake, 'out') retroativo para neutralizá-lo.
--     Se o bet_return não existe (status='lost', actual_return=0), não
--     há crédito fantasma — nada a corrigir.
--
-- EM PROD (2026-06-09):
--   2 bets kind='bet_builder', status='void', is_free_bet=false, R$10 cada.
--   resolve_bet void → actual_return = total_stake = R$10 → bet_return 'in' R$10.
--   Sem bet_stake 'out' correspondente → +R$10 fantasma por bet = +R$20 total.
--
--   O script abaixo:
--     a) identifica essas bets (sem bet_stake, com bet_return phantom)
--     b) insere o bet_stake 'out' retroativo com a data do bet_return (cronologia correta)
--     c) O saldo líquido passa a ser: -R$10 (stake) + R$10 (void refund) = 0 (correto)
--
-- APLIQUE MANUALMENTE via pooler/Management API.
-- Idempotente: a subquery NOT EXISTS garante que não duplica se rodar 2×.

-- ---------------------------------------------------------------------------
-- DRY-RUN (leia primeiro, confirme os números)
-- ---------------------------------------------------------------------------
SELECT
  b.id          AS bet_id,
  b.user_id,
  b.house_id,
  b.total_stake,
  b.status,
  b.placed_at,
  tx_ret.id     AS phantom_bet_return_tx_id,
  tx_ret.amount AS phantom_credit_amount
FROM public.bets b
JOIN public.transactions tx_ret
  ON tx_ret.related_bet_id = b.id
 AND tx_ret.kind = 'bet_return'
 AND tx_ret.direction = 'in'
WHERE b.kind = 'bet_builder'
  AND b.is_free_bet = false
  AND b.status NOT IN ('pending')
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions tx_stake
     WHERE tx_stake.related_bet_id = b.id
       AND tx_stake.kind = 'bet_stake'
       AND tx_stake.direction = 'out'
  );

-- ---------------------------------------------------------------------------
-- BACKFILL: insere bet_stake 'out' retroativo para neutralizar o phantom
-- ---------------------------------------------------------------------------
-- Descomente e execute APÓS confirmar o DRY-RUN acima.
-- ---------------------------------------------------------------------------
-- INSERT INTO public.transactions (
--   user_id, house_id, kind, direction, amount,
--   occurred_at, related_bet_id, note
-- )
-- SELECT
--   b.user_id,
--   b.house_id,
--   'bet_stake',
--   'out',
--   b.total_stake,
--   -- Data retroativa = momento do bet_return (cronologia correta no ledger)
--   tx_ret.occurred_at,
--   b.id,
--   'backfill: stake faltante do bet_builder (bug pré-0051; banca corrigida ' || now()::date::text || ')'
-- FROM public.bets b
-- JOIN public.transactions tx_ret
--   ON tx_ret.related_bet_id = b.id
--  AND tx_ret.kind = 'bet_return'
--  AND tx_ret.direction = 'in'
-- WHERE b.kind = 'bet_builder'
--   AND b.is_free_bet = false
--   AND b.status NOT IN ('pending')
--   AND NOT EXISTS (
--     SELECT 1 FROM public.transactions tx_stake
--      WHERE tx_stake.related_bet_id = b.id
--        AND tx_stake.kind = 'bet_stake'
--        AND tx_stake.direction = 'out'
--   );

-- ---------------------------------------------------------------------------
-- VERIFICAÇÃO PÓS-BACKFILL
-- ---------------------------------------------------------------------------
-- Execute após o INSERT; deve retornar 0 rows (todas as bets corrigidas).
-- SELECT id, total_stake, status FROM public.bets
-- WHERE kind = 'bet_builder'
--   AND is_free_bet = false
--   AND status NOT IN ('pending')
--   AND NOT EXISTS (
--     SELECT 1 FROM public.transactions tx_stake
--      WHERE tx_stake.related_bet_id = bets.id
--        AND tx_stake.kind = 'bet_stake'
--        AND tx_stake.direction = 'out'
--   );
