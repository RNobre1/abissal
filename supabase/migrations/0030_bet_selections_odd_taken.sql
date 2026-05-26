-- 0030_bet_selections_odd_taken.sql
-- Adiciona odd_taken em bet_selections para CLV correto.
--
-- Motivação (Wave B fix #2):
--   O CLV deve usar a odd QUE O PILOT EFETIVAMENTE APOSTOU (odd_taken),
--   não a odd_captured que é a odd do modelo no momento do cálculo da reco.
--   odd_captured ∈ ai_recommendations (modelo)
--   odd_taken    ∈ bet_selections (Pilot)
--
--   CLV = (odd_taken / odd_close - 1) * 100
--
-- Campo:
--   odd_taken NUMERIC(8,4) — null para apostas anteriores (backfill manual),
--   NOT NULL para novas apostas via /api/ai-reco/apostei.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- Aplicar via Supabase pooler antes do merge (Pilot aplica).

ALTER TABLE public.bet_selections
  ADD COLUMN IF NOT EXISTS odd_taken NUMERIC(8,4);

COMMENT ON COLUMN public.bet_selections.odd_taken IS
  'Odd efetivamente apostada pelo Pilot (pode diferir de ai_recommendations.odd_captured). Usada no CLV: (odd_taken / odd_close - 1) * 100.';

-- Índice para JOIN eficiente com closing_odds em /calibracao
CREATE INDEX IF NOT EXISTS idx_bet_selections_odd_taken_notnull
  ON public.bet_selections (id)
  WHERE odd_taken IS NOT NULL;
