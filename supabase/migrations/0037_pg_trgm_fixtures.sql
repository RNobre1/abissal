-- ============================================================
-- 0037_pg_trgm_fixtures.sql — fuzzy matching de nomes de times
-- pro OCR de cupons (Wave N2)
--
-- WHY: Wave N parseia nomes de times de screenshots de cupons via
-- vision LLM. Nomes extraídos por OCR frequentemente diferem dos
-- nomes canônicos do DB (abreviações, acentuação, grafias alternativas).
-- pg_trgm + GIN indexes permitem similarity() em O(log n) pra janela
-- de fixtures [hoje-2d, hoje+4d] sem full-scan.
--
-- Idempotente: CREATE EXTENSION IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION.
-- pg_trgm pode já estar habilitado no Supabase — IF NOT EXISTS é safe.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_fixtures_home_team_trgm
  ON public.fixtures USING GIN (home_team gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_fixtures_away_team_trgm
  ON public.fixtures USING GIN (away_team gin_trgm_ops);

-- RPC function: fuzzy match de fixtures por nome de time
-- Parâmetros:
--   p_home     — nome do time mandante extraído do OCR
--   p_away     — nome do time visitante extraído do OCR
--   p_kickoff  — instante UTC do kickoff (ISO 8601); NULL → usa janela now()-2d/+4d
-- Retorna top 3 fixtures ordenadas por confidence DESC (avg trigram similarity)
CREATE OR REPLACE FUNCTION public.match_fixture_fuzzy(
  p_home    text,
  p_away    text,
  p_kickoff timestamptz DEFAULT NULL
) RETURNS TABLE (
  id          bigint,
  home_team   text,
  away_team   text,
  league      text,
  country     text,
  kickoff_utc timestamptz,
  confidence  numeric
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    f.id,
    f.home_team,
    f.away_team,
    f.league,
    f.country,
    f.kickoff_utc,
    ((similarity(f.home_team, p_home) + similarity(f.away_team, p_away)) / 2.0)::numeric AS confidence
  FROM public.fixtures f
  WHERE
    (similarity(f.home_team, p_home) > 0.3 OR similarity(f.away_team, p_away) > 0.3)
    AND (
      (
        p_kickoff IS NOT NULL
        AND f.kickoff_utc BETWEEN (p_kickoff - INTERVAL '2 days') AND (p_kickoff + INTERVAL '4 days')
      )
      OR
      (
        p_kickoff IS NULL
        AND f.kickoff_utc BETWEEN (now() - INTERVAL '2 days') AND (now() + INTERVAL '4 days')
      )
    )
  ORDER BY confidence DESC
  LIMIT 3;
$$;

GRANT EXECUTE ON FUNCTION public.match_fixture_fuzzy(text, text, timestamptz)
  TO authenticated, anon;
