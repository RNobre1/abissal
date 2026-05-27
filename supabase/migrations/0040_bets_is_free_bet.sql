-- 0040_bets_is_free_bet.sql
-- Adiciona coluna is_free_bet às bets pra suportar bonus/aposta grátis.
-- Free bet: stake não desconta da banca (sem transactions bet_stake);
-- ganhando, actual_return = stake * (odds - 1) (só lucro, stake fictício
-- não retorna). Padrão Betano/Bet365.
-- Idempotente.
ALTER TABLE public.bets
  ADD COLUMN IF NOT EXISTS is_free_bet boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bets.is_free_bet IS
  'true = aposta grátis da casa; não move banca em place_bet; ganhando retorna apenas lucro (stake*(odds-1))';
