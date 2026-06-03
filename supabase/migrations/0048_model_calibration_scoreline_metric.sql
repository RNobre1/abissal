-- ============================================================
-- 0048_model_calibration_scoreline_metric — documenta a métrica de calibração
-- de PLACAR ('scoreline-cal') em model_calibration.
--
-- WHY (item 1 / B28, 2026-06-03): a sim era superconfiante no placar mais
-- provável (dizia ~15% pro top-1, cravava ~10%) e inflava empate (+~3pp).
-- Medido pela 1ª vez (scripts/calibracao/measure-scoreline-accuracy.ts) e
-- calibrado DISPLAY-ONLY via temperatura T (achata o pico) + drawFactor δ
-- (deflaciona empate), fit por log-loss e validado out-of-sample. NÃO bumpa
-- model_version (calibra a SAÍDA, não o gerador — mantém isotônica/league/dist-k).
--
-- FORMATO (difere das demais): a linha 'scoreline-cal' guarda em `pairs` um
-- OBJETO JSON, não um array [x,y]:
--   pairs = { temperature, drawFactor, raw:{top1Hit,top1Pred,drawReal,drawPred,
--             top3Hit,top6Hit,rps}, cal:{top1Pred,drawPred} }
-- Por ser objeto (não-array), os readers isotônicos a IGNORAM automaticamente
-- (Array.isArray falha) — sem colisão. Lida por scoreline-cal-repository.ts.
-- Inserida pelo fit-scoreline-cal.ts (service_role) quando ≥30 resolvidas.
-- Refit MECÂNICO semanal (B24). `metric` é text livre desde a 0044 → sem DDL.
--
-- Migration idempotente (sem mudança estrutural) — só atualiza o COMMENT.
-- ============================================================

COMMENT ON TABLE public.model_calibration IS
  'Calibração pós-modelo por (metric, model_version). '
  'Isotônicas (pairs = array [x,y]): 1x2-home/draw/away, over25, over25-under, '
  'btts, btts-nao, e secundários corners/cards/sot-over|under-NN. '
  'DISTRIBUIÇÃO (pairs = [[meanPred,meanActual]]): corners/cards/sot/goals-dist '
  '(k = média_real/média_prevista corrige a média do Poisson). '
  'PLACAR (pairs = OBJETO {temperature,drawFactor,raw,cal}): scoreline-cal — '
  'recalibra a forma do top_scorelines (achata pico + deflaciona empate), '
  'display-only, sem bump de model_version (item 1 / B28, 2026-06-03). '
  'Prioridade nos consumidores de mercado: curva → k → raw.';
