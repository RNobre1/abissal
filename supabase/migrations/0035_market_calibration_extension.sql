-- ============================================================
-- 0035_market_calibration_extension — Extend model_calibration metric
-- enum to support secondary markets (corners, cards, SOT).
--
-- WHY: Wave O+E (2026-05-26) expands Market type to include:
--   corners-over-85/95/105, corners-under-85/95/105
--   cards-over-35/45/55,    cards-under-35/45/55
--   sot-over-75/95/105,     sot-under-75/95/105
--
-- The `model_calibration` table uses a text `metric` column
-- (not a Postgres ENUM type) — see migration 0019. Adding new
-- metric values does NOT require DDL changes; they are inserted
-- as rows when calibration data accumulates.
--
-- WHAT THIS MIGRATION DOES:
-- 1. Adds a descriptive comment to model_calibration explaining
--    the Wave O+E metric naming convention.
-- 2. Verifies (SELECT) that the table exists and is healthy.
--    No destructive DDL.
--
-- NOTE: actual_corners_*/actual_cards_*/actual_sot_* remain NULL
-- in fixture_simulations for now — the choistats recent-results
-- FT fixture object only exposes goals+reds (no corners/yellows).
-- Calibration for secondary markets will be data-driven once
-- ~30+ resolved rows accumulate. This migration is a no-op DDL
-- placeholder; the real work happens at calibration runtime.
--
-- Migration is fully idempotent (no structural changes).
-- Apply via Supabase pooler before merge.
-- ============================================================

-- Document the new metric naming convention for Wave O+E markets.
COMMENT ON TABLE public.model_calibration IS
  'Isotonic calibration curves per metric-side pair. '
  'Primary markets: 1x2-home, 1x2-draw, 1x2-away, over25, over25-under, btts-sim, btts-nao. '
  'Wave G (2026-05-25): btts metric added. '
  'Wave O+E (2026-05-26): secondary markets planned: '
  'corners-over-85/95/105, corners-under-85/95/105, '
  'cards-over-35/45/55, cards-under-35/45/55, '
  'sot-over-75/95/105, sot-under-75/95/105. '
  'These rows are inserted by the calibration script when >= 30 resolved rows exist per metric.';

-- Healthcheck: confirm the table structure matches what calibration code expects.
-- Real schema (from migration 0019): metric/pairs/model_version/effective_from/effective_until/n.
DO $$
DECLARE
  col_count INT;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'model_calibration'
    AND column_name IN ('metric', 'pairs', 'model_version', 'effective_from', 'n');
  IF col_count < 5 THEN
    RAISE EXCEPTION '0035: model_calibration missing expected columns (found %)', col_count;
  END IF;
END;
$$;
