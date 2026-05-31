-- Migration 0045: add `forced` column to ai_recommendations
-- Marks a reco that was requested below the edge threshold (force=true in the API).
-- Forced recos are EXCLUDED from all calibration metrics (ROI/Brier/win-rate)
-- to prevent data poisoning — same class of concern as Lição B19.
-- Append-only: this column did not exist before.

ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS forced boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ai_recommendations.forced IS
  'True when the recommendation was forced by the user below the edge threshold. '
  'Forced recos are excluded from all calibration metrics (ROI/Brier/win-rate/CLV).';
