-- ============================================================
-- 0044_model_calibration_relax_metric — remove o CHECK enumerado de
-- model_calibration.metric pra suportar curvas isotônicas por LADO
-- independente + mercados secundários (Fix 2/3 do ia-pattern-fix).
--
-- Contexto: até 0031 o metric era restrito a
--   ('1x2-home','1x2-draw','1x2-away','over25','btts').
-- O over25-under era derivado como (1 − cal_over) e o btts-nao como
-- (1 − p_btts) — sem curva própria. Os dados mostraram assimetria forte
-- (over25-over ~calibrado vs over25-under 1/18 na IA): cada lado precisa de
-- curva PRÓPRIA. Além disso a extensão pra corners/cards/sot usa chaves com
-- linha variável ('corners-over-85', 'corners-over-95', …) — enumerar no CHECK
-- é frágil.
--
-- Decisão: o `metric` é uma CHAVE INTERNA controlada inteiramente pelo
-- fit-isotonic.ts (service_role-only write). Remover o CHECK em vez de tentar
-- enumerar. Reversível: re-aplicar o ADD CONSTRAINT do 0031.
-- ============================================================

ALTER TABLE public.model_calibration
  DROP CONSTRAINT IF EXISTS model_calibration_metric_check;
