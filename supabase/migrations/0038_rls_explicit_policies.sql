-- 0038_rls_explicit_policies.sql
-- Auditoria RLS pós-brainstorm CISO/SRE/Adversary (2026-05-27):
--   * ai_recommendations: RLS ON mas zero policies SELECT → deny implícito
--     para anônimos; adicionar SELECT explícito para authenticated.
--   * ai_reco_feedback: RLS ON, zero policies, sem coluna user_id →
--     SELECT explícito para authenticated com USING (true).
--   * ui_telemetry: policy INSERT permissiva para `public` (anônimo) →
--     substituir por INSERT restrito a authenticated (user_id = auth.uid()).
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.
-- NÃO aplicar sem aprovação do Pilot — orquestrador aplica.

-- ─────────────────────────────────────────────────────────────────────────────
-- ai_recommendations: SELECT para authenticated
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS ai_recommendations_select ON public.ai_recommendations;
CREATE POLICY ai_recommendations_select
  ON public.ai_recommendations
  FOR SELECT
  TO authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- ai_reco_feedback: SELECT para authenticated
-- (tabela não tem coluna user_id, portanto USING (true) é correto;
--  controle de acesso a linhas individuais não faz sentido sem owner)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS ai_reco_feedback_select ON public.ai_reco_feedback;
CREATE POLICY ai_reco_feedback_select
  ON public.ai_reco_feedback
  FOR SELECT
  TO authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- ui_telemetry INSERT: fechar anon-insert, exigir auth.uid() = user_id
-- (policy existente: "ui_telemetry_insert_any" TO public WITH CHECK (true))
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS ui_telemetry_insert_any ON public.ui_telemetry;
DROP POLICY IF EXISTS ui_telemetry_insert_auth ON public.ui_telemetry;
CREATE POLICY ui_telemetry_insert_auth
  ON public.ui_telemetry
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());
