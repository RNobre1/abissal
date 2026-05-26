-- ============================================================
-- 0028_actuals_secondary — Secondary actual stats columns in
-- fixture_simulations (Wave G: calibração granular).
--
-- WHY: Until Wave G, only goals were reconciled (actual_home_goals,
-- actual_away_goals). BTTS, corners, cards, SOT, and SOT existed in
-- sim_stats but were never compared against reality. This migration
-- adds the actual_* columns so the reconciler can populate them when
-- data is available.
--
-- DATA AVAILABILITY CAVEAT (investigated 2026-05-25):
-- The choistats `recent-results` widget returns corners/SOT/cards only
-- in historical result entries (recentHomeResults[], headToHead[]) —
-- NOT for the current reconciled fixture. The current fixture's
-- `fixture` object only exposes: homeGoalsFt, awayGoalsFt, homeReds,
-- awayReds when status=FT.
-- Impact: actual_corners_*/actual_cards_*/actual_sot_* will remain NULL
-- until an alternative data source is wired. actual_btts is derivable
-- from goals (trivially: home_goals > 0 AND away_goals > 0) and will
-- be populated by the reconciler on the same pass as goals.
--
-- Migration is idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- ============================================================

ALTER TABLE public.fixture_simulations
  ADD COLUMN IF NOT EXISTS actual_btts          BOOLEAN,
  ADD COLUMN IF NOT EXISTS actual_corners_home  INT,
  ADD COLUMN IF NOT EXISTS actual_corners_away  INT,
  ADD COLUMN IF NOT EXISTS actual_cards_home    INT,
  ADD COLUMN IF NOT EXISTS actual_cards_away    INT,
  ADD COLUMN IF NOT EXISTS actual_sot_home      INT,
  ADD COLUMN IF NOT EXISTS actual_sot_away      INT;

-- Index on actual_btts for quick aggregation by calibration scripts.
-- Partial: only rows that have been reconciled.
CREATE INDEX IF NOT EXISTS idx_fixsim_actual_btts
  ON public.fixture_simulations (actual_btts)
  WHERE actual_btts IS NOT NULL;
