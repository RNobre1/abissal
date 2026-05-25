-- ============================================================
-- llm_request_logs — estende com observabilidade obsessiva (req do Pilot):
-- cost_usd, prompt_version (A/B retroativo), prompt_snapshot (jsonb completo
-- do input), response_raw (output literal incluindo <think>), ai_recommendation_id
-- (cross-ref bi-direcional com ai_recommendations.llm_log_id).
--
-- Reter snapshots indefinidamente — ~120KB/dia × 365d = ~44MB/ano (trivial
-- no Supabase Free). Cron futuro pode truncar entries > 90d se necessário.
--
-- Spec: docs/superpowers/specs/2026-05-24-ai-recomendador-design.md §4.2 + §8
-- ============================================================

alter table public.llm_request_logs
  add column if not exists cost_usd              numeric(8,5),
  add column if not exists prompt_version        text,
  add column if not exists prompt_snapshot       jsonb,
  add column if not exists response_raw          text,
  add column if not exists ai_recommendation_id  bigint;

-- Atualizar check do route pra incluir os novos endpoints
-- (sem DROP — apenas adiciona valores aceitos)
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name like '%llm_request_logs_route_check%'
      and table_name = 'llm_request_logs'
  ) then
    -- Não há check explícito por route no schema atual (route é text livre),
    -- então não precisa alterar. Mantemos route livre pra 'ai-reco', etc.
    null;
  end if;
end $$;

create index if not exists idx_llm_logs_prompt_version
  on public.llm_request_logs (prompt_version)
  where prompt_version is not null;

create index if not exists idx_llm_logs_cost_created_at
  on public.llm_request_logs (created_at desc)
  where cost_usd is not null;

create index if not exists idx_llm_logs_ai_recommendation
  on public.llm_request_logs (ai_recommendation_id)
  where ai_recommendation_id is not null;
