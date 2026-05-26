-- ============================================================
-- 0036_actuals_reconciler — Wave R: API-Football reconciler
-- para corners/cards/SOT em fixture_simulations.
--
-- WHY: Wave O+E+P+R (PR #11) emite recomendações em mercados
-- secundários. Wave G (0029_actuals_secondary) adicionou colunas
-- actual_corners_*/actual_cards_*/actual_sot_* mas o reconciler
-- nunca foi implementado — colunas ficaram NULL, calibração quebra.
-- Esta migration adiciona:
--   1. actual_data_source TEXT — rastreabilidade de qual fonte
--      preencheu os actuals (ou por que ficou pendente).
--   2. actuals_fixture_mapping — cache de mapeamento
--      choistats_fixture_id → api_football_fixture_id.
--
-- Pré-requisito: 0029_actuals_secondary deve estar aplicada
-- (colunas actual_corners_home, actual_cards_home, actual_sot_home
-- devem existir).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS.
-- ============================================================

-- 1. Coluna de rastreabilidade na tabela principal
ALTER TABLE public.fixture_simulations
  ADD COLUMN IF NOT EXISTS actual_data_source TEXT;

COMMENT ON COLUMN public.fixture_simulations.actual_data_source IS
  'Wave R (2026-05-26): fonte que preencheu actual_corners/cards/sot. '
  'Valores: api-football (sucesso), unresolvable-mapping_failed (fixture '
  'não encontrada na API-Football), unresolvable-stats_unavailable (fixture '
  'encontrada mas sem estatísticas disponíveis), '
  'unresolvable-unsupported_league (liga não mapeada). '
  'NULL = não tentado ainda.';

-- Índice para query de reconciler (filtra actual_data_source IS NULL)
CREATE INDEX IF NOT EXISTS idx_fixsim_actual_data_source
  ON public.fixture_simulations (actual_data_source)
  WHERE actual_data_source IS NOT NULL;

-- 2. Cache de mapeamento choistats → api_football fixture IDs
CREATE TABLE IF NOT EXISTS public.actuals_fixture_mapping (
  id                        BIGSERIAL PRIMARY KEY,
  choistats_fixture_id      BIGINT NOT NULL,
  api_football_fixture_id   BIGINT NOT NULL,
  league                    TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (choistats_fixture_id)
);

COMMENT ON TABLE public.actuals_fixture_mapping IS
  'Wave R: cache de mapeamento choistats_fixture_id → api_football_fixture_id. '
  'Evita gastar quota da API-Football em discovery repetido. '
  'Populado pelo ActualsReconciler (scripts/scraper/lib/scraper/actuals/fixture_resolver.rb).';

CREATE INDEX IF NOT EXISTS idx_actuals_mapping_choistats
  ON public.actuals_fixture_mapping (choistats_fixture_id);

-- ============================================================
-- Healthcheck: valida que colunas pré-requisito existem
-- Lição: 0035 alucinada — este DO block garante que a migration
-- não aplica silenciosamente em schema incompleto.
-- ============================================================
DO $$
DECLARE
  cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'fixture_simulations'
    AND column_name  IN (
      'actual_corners_home',
      'actual_corners_away',
      'actual_cards_home',
      'actual_cards_away',
      'actual_sot_home',
      'actual_sot_away',
      'actual_data_source'  -- acabamos de adicionar
    );

  -- Precisamos de pelo menos 7 colunas (6 pré-existentes + 1 nova)
  IF cnt < 7 THEN
    RAISE EXCEPTION
      '0036: colunas pré-requisito insuficientes em fixture_simulations '
      '(encontradas: %, esperadas: 7). Verifique se 0029_actuals_secondary '
      'e o ADD COLUMN desta migration foram aplicados.', cnt;
  END IF;
END;
$$;
