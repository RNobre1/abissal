-- ============================================================
-- 0029_model_calibration_btts_metric — Extend model_calibration.metric
-- enum to include 'btts' (Wave G: calibração granular).
--
-- The current CHECK constraint in 0019_model_calibration.sql restricts
-- metric to ('1x2-home','1x2-draw','1x2-away','over25'). Wave G adds
-- 'btts' as the first binary metric from the secondary stats set.
--
-- COUNT metrics (corners, cards, SOT) do NOT use isotonic calibration
-- directly (isotonic PAV calibrates P(event) → observed frequency for
-- binary outcomes; for count distributions, CRPS is the appropriate
-- scoring rule). Documenting the trade-off here:
--
--   Binary metrics (p_btts, p_over_25, p_home, etc.):
--     → calibrated via isotonic regression → model_calibration table
--   Count metrics (corners, cards, SOT):
--     → evaluated via CRPS → /api/calibracao/secondary-metrics endpoint
--     → NO entry in model_calibration (calibration of count distributions
--       requires histogram regression or CORP decomposition, not PAV)
--
-- This migration only adds 'btts' to the binary metric set.
-- Idempotent: drops the constraint by name and recreates it.
-- ============================================================

ALTER TABLE public.model_calibration
  DROP CONSTRAINT IF EXISTS model_calibration_metric_check;

ALTER TABLE public.model_calibration
  ADD CONSTRAINT model_calibration_metric_check
    CHECK (metric IN ('1x2-home', '1x2-draw', '1x2-away', 'over25', 'btts'));
