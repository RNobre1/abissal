-- ============================================================
-- closing_odds — odds capturadas próximas ao kick-off (CLV tracking)
--
-- CLV (Closing Line Value) = (odd_taken / odd_close - 1) * 100.
-- Métrica única que sobrevive a small-sample: distingue sorte de skill
-- em ~50 bets (vs 300+ pra ROI/Brier).
--
-- Capture pipeline: cron 4x/dia (15/17/19/21 UTC) chama Choistats API
-- pra fixtures com `ai_recommendations.verdict='bet'` cujo kickoff_utc
-- cai nas próximas 4h. Insere idempotente via UNIQUE constraint.
--
-- FK soft pra `ai_recommendations` (com ON DELETE SET NULL) — sobrevive
-- à eventual purga; `fixture_id` é o id choistats (mesma convenção de
-- ai_recommendations).
--
-- Spec: tarefa A1 (CLV tracking)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.closing_odds (
  id BIGSERIAL PRIMARY KEY,
  fixture_id BIGINT NOT NULL,                         -- choistats id
  market TEXT NOT NULL,                               -- '1x2' | 'over25' | 'btts'
  side TEXT NOT NULL,                                 -- 'home'|'draw'|'away'|'over'|'under'|'sim'|'nao'
  odd_close NUMERIC(8,3) NOT NULL,
  source TEXT NOT NULL,                               -- 'choistats' | 'pinnacle' | 'betfair'
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ai_recommendation_id BIGINT REFERENCES public.ai_recommendations(id) ON DELETE SET NULL,
  -- evita duplicar mesmo mercado/lado/fonte pra mesma fixture
  CONSTRAINT closing_odds_unique_market_side_source
    UNIQUE (fixture_id, market, side, source)
);

CREATE INDEX IF NOT EXISTS idx_closing_odds_reco
  ON public.closing_odds (ai_recommendation_id);
CREATE INDEX IF NOT EXISTS idx_closing_odds_fixture
  ON public.closing_odds (fixture_id);

ALTER TABLE public.closing_odds ENABLE ROW LEVEL SECURITY;

-- service_role escreve via capture job; authenticated lê pro painel /calibracao.
GRANT SELECT ON public.closing_odds TO authenticated;
