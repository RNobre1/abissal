-- Migration 0052: índice único parcial em ai_recommendations para prevenir
-- recomendações duplicadas por (fixture_id, market, side) em rodadas consecutivas.
--
-- CONTEXTO (Bug 1 — 2026-06-09):
--   Fixtures com KO na janela 24-48h eram processadas em 2 rodadas diárias:
--   303 grupos duplicados medidos em prod (fixture_id, market, side), 553 linhas
--   extras, 127 verdict='bet'. Causa: FIXTURES_QUERY não excluía fixtures já
--   processadas; INSERT não tinha ON CONFLICT.
--
-- CORREÇÃO EM 3 CAMADAS:
--   (a) FIXTURES_QUERY: NOT EXISTS contra ai_recommendations WHERE forced=false
--   (b) RECO_INSERT_SQL: ON CONFLICT DO NOTHING (segunda camada defensiva)
--   (c) Este índice parcial: previne duplicatas no nível do banco
--
-- ESCOPO DO ÍNDICE:
--   WHERE forced = false AND market IS NOT NULL AND side IS NOT NULL
--   - forced=false: exclui recos on-demand (forced=true podem repetir market/side)
--   - market/side NOT NULL: exclui skips (persist_skip insere market=NULL, side=NULL);
--     NULLs não colidem em índices parciais PG17 sem NULLS NOT DISTINCT explícito,
--     então skips múltiplos da mesma fixture continuam sendo inseridos livremente.
--
-- ⚠️  ATENÇÃO: este índice NÃO pode ser criado em prod enquanto houverem
-- duplicatas existentes (CREATE UNIQUE INDEX falhará com duplicate key error).
-- ANTES de aplicar, rodar o script de limpeza:
--   DATABASE_URL=... bundle exec bin/dedupe_ai_recommendations --execute
-- Ele mantém 1 linha por grupo (a mais antiga ou a referenciada por FK) e deleta
-- as restantes. Ver bin/dedupe_ai_recommendations --dry-run primeiro.

CREATE UNIQUE INDEX IF NOT EXISTS ai_recommendations_dedup_idx
  ON public.ai_recommendations (fixture_id, market, side)
  WHERE forced = false
    AND market IS NOT NULL
    AND side   IS NOT NULL;

COMMENT ON INDEX public.ai_recommendations_dedup_idx IS
  'Previne recos duplicadas não-forçadas para o mesmo fixture+market+side. '
  'Skips (market/side NULL) e recos forçadas (forced=true) estão fora do escopo. '
  'Exige limpeza das duplicatas existentes antes de aplicar (bin/dedupe_ai_recommendations).';
