-- ============================================================
-- 0047_model_calibration_dist_metric — documenta a convenção das métricas
-- de calibração de DISTRIBUIÇÃO ('corners-dist'/'cards-dist'/'sot-dist').
--
-- WHY (docs/tasks/calibracao-distribuicao): a simulação SUBESTIMA o total de
-- escanteios/cartões/finalizações no alvo (k≈1.06/1.14/1.08, medido em held-out).
-- A isotônica por-linha só cobre 3 linhas; o fator `k` corrige a MÉDIA do Poisson
-- e calibra TODAS as linhas de uma vez (sample-efficient). Coexiste com a
-- isotônica — prioridade no EdgeCalculator: curva isotônica → k → raw.
--
-- FORMATO: cada linha `${stat}-dist` reusa o schema existente (migration 0019):
--   metric  = 'corners-dist' | 'cards-dist' | 'sot-dist' | 'goals-dist'
--   pairs   = [[meanPred, meanActual]]   -- âncora [x,y] self-describing; k = y/x
--   n       = nº de jogos resolvidos no fit
-- O `metric` é text livre desde a 0044 (CHECK removido) — NENHUMA DDL é
-- necessária; as linhas são inseridas pelo fit-dist.ts (service_role write)
-- quando há ≥30 resolvidas por mercado. Refit MECÂNICO semanal (B24).
--
-- Lida por: lib/ai-reco/dist-k-repository.ts (TS) + ai_reco/dist_k_lookup.rb
-- (Ruby). O reader isotônico (active-curves / IsotonicLookup) IGNORA '*-dist'.
--
-- Migration idempotente (sem mudança estrutural) — só atualiza o COMMENT.
-- ============================================================

COMMENT ON TABLE public.model_calibration IS
  'Curvas/fatores de calibração pós-modelo por (metric, model_version). '
  'Isotônicas (PAV): 1x2-home/draw/away, over25, over25-under, btts, btts-nao, '
  'e secundários por linha corners/cards/sot-over/under-NN. '
  'DISTRIBUIÇÃO (Opção A, task calibracao-distribuicao, 2026-06-02): '
  'corners-dist/cards-dist/sot-dist/goals-dist guardam pairs=[[meanPred,meanActual]] '
  '(k = meanActual/meanPred) e corrigem a média do Poisson dos mercados de '
  'contagem (a sim subestima ~6-13%). Prioridade no consumidor: curva → k → raw. '
  'Inseridas pelo fit-dist.ts quando >= 30 resolvidas por mercado.';
