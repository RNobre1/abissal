-- ============================================================
-- 0032_bet_slips.sql — Bilhete Múltipla (Wave M)
--
-- Introduces two tables:
--   bet_slips      — one draft per user, transitions to committed
--   bet_slip_legs  — individual selections within a slip
--
-- `bets.kind` already supports 'multiple' (enum created in 0001_init.sql),
-- so NO additional migration is needed for that.
--
-- RLS: owner-only via user_id (bet_slips) and slip ownership join
--       (bet_slip_legs).
-- ============================================================

-- ── bet_slips ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bet_slips (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'draft',
  stake_total      NUMERIC(12, 2),
  odd_combined     NUMERIC(10, 4),
  potential_return NUMERIC(12, 2),
  bet_id           UUID REFERENCES public.bets(id) ON DELETE SET NULL,
  thesis           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bet_slips_status_check
    CHECK (status IN ('draft', 'committed', 'cancelled')),
  CONSTRAINT bet_slips_stake_positive
    CHECK (stake_total IS NULL OR stake_total > 0)
);

CREATE INDEX IF NOT EXISTS idx_bet_slip_user_status
  ON public.bet_slips(user_id, status);

CREATE INDEX IF NOT EXISTS idx_bet_slip_user_draft
  ON public.bet_slips(user_id) WHERE status = 'draft';

-- ── bet_slip_legs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bet_slip_legs (
  id                   BIGSERIAL PRIMARY KEY,
  slip_id              BIGINT NOT NULL REFERENCES public.bet_slips(id) ON DELETE CASCADE,
  ai_recommendation_id BIGINT REFERENCES public.ai_recommendations(id) ON DELETE SET NULL,
  fixture_id           BIGINT,
  home_team            TEXT,
  away_team            TEXT,
  market               TEXT NOT NULL,
  side                 TEXT NOT NULL,
  odd_taken            NUMERIC(10, 4) NOT NULL,
  league               TEXT,
  sport_id             UUID REFERENCES public.sports(id),
  market_id            UUID REFERENCES public.markets(id),
  kickoff_utc          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slip_id, fixture_id, market, side),
  CONSTRAINT bet_slip_legs_odd_positive CHECK (odd_taken > 0)
);

CREATE INDEX IF NOT EXISTS idx_bet_slip_legs_slip
  ON public.bet_slip_legs(slip_id);

CREATE INDEX IF NOT EXISTS idx_bet_slip_legs_fixture
  ON public.bet_slip_legs(fixture_id);

-- ── updated_at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_bet_slips_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bet_slips_updated_at ON public.bet_slips;
CREATE TRIGGER bet_slips_updated_at
  BEFORE UPDATE ON public.bet_slips
  FOR EACH ROW EXECUTE FUNCTION public.trg_bet_slips_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.bet_slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_slip_legs ENABLE ROW LEVEL SECURITY;

-- bet_slips: owner CRUD
CREATE POLICY bet_slips_owner_all ON public.bet_slips
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- bet_slip_legs: owner via slip FK join
CREATE POLICY bet_slip_legs_owner_all ON public.bet_slip_legs
  FOR ALL
  USING (
    slip_id IN (
      SELECT id FROM public.bet_slips WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    slip_id IN (
      SELECT id FROM public.bet_slips WHERE user_id = auth.uid()
    )
  );
