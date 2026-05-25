-- ============================================================
-- ai_recommendations — recomendação de aposta pré-jogo emitida
-- pelo IA-2 Recomendador (substitui /api/copilot + /api/fixture-copilot).
--
-- Conceitualmente distinta de `ai_predictions` (legado, só winner+over):
-- captura mercado, side, units, edge, kelly_pre, reasoning, red_flags,
-- e a edge_table_snapshot (todas candidatas consideradas — não só a
-- escolhida) pra debug retroativo.
--
-- Reconciler `AiRecommendationReconciler` (Ruby) fecha status='pending'
-- → 'resolved' com actual_*_goals + bet_won + pl_units calculados.
--
-- FK soft pra `fixtures` (fixture_id sem constraint) — sobrevive à
-- purga diária de 3-4 dias.
--
-- Spec: docs/superpowers/specs/2026-05-24-ai-recomendador-design.md §4.1
-- ============================================================

create table if not exists public.ai_recommendations (
  id                  bigserial primary key,
  created_at          timestamptz not null default now(),

  -- identificação da fixture (FK soft)
  fixture_id          bigint,
  home_team           text not null,
  away_team           text not null,
  league              text,
  kickoff_utc         timestamptz,

  -- versionamento
  reco_version        text not null,                  -- 'reco-v1' inicial
  prompt_version      text not null,                  -- 'prompt-v1.0'
  llm_model           text not null,                  -- 'deepseek/deepseek-r1'
  llm_log_id          bigint,                         -- FK soft pra llm_request_logs.id

  -- input (decisão)
  edge_table_snapshot jsonb not null,                 -- TODAS as candidatas consideradas
  league_calibrated   boolean not null default false,

  -- output IA (estruturado)
  verdict             text not null check (verdict in ('bet','skip')),
  market              text,                            -- '1x2'|'over25'|'under25'|'btts-sim'|'btts-nao'|'asian'
  side                text,                            -- 'home'|'draw'|'away'|'over'|'under'|'+0.5'|'-1.0'…
  prob_estimated      numeric(5,4),                   -- 4 casas pra suportar 0.0001
  prob_calibrated     numeric(5,4),
  edge_pct            numeric(6,2),                   -- ex: 8.50 ou 123.45 (extremo)
  odd_captured        numeric(6,3),
  kelly_pre           numeric(5,2),
  units_final         numeric(5,2),                   -- IA-adjusted, cap 2.0u / 0.5u
  reduction_reason    text,
  confidence          text check (confidence in ('alto','medio','baixo')),

  -- output IA (prosa)
  summary_line        text,                            -- ≤ 60 chars, ex: "BTTS · 1.5u · 64%"
  reasoning_full      text,
  red_flags           jsonb default '[]'::jsonb,

  -- custo (denormalizado pra agregação rápida)
  cost_usd            numeric(8,5),

  -- reconciliação
  status              text not null default 'pending'
                        check (status in ('pending','resolved','unresolvable')),
  actual_home_goals   int,
  actual_away_goals   int,
  actual_resolved_at  timestamptz,
  bet_won             boolean,
  pl_units            numeric(7,2)                    -- +1.5 / -1.0; null se skip
);

create index if not exists ai_recommendations_status_kickoff_idx
  on public.ai_recommendations (status, kickoff_utc);
create index if not exists ai_recommendations_fixture_idx
  on public.ai_recommendations (fixture_id)
  where fixture_id is not null;
create index if not exists ai_recommendations_created_at_desc_idx
  on public.ai_recommendations (created_at desc);
create index if not exists ai_recommendations_verdict_bet_kickoff_idx
  on public.ai_recommendations (kickoff_utc)
  where verdict = 'bet';

alter table public.ai_recommendations enable row level security;

-- service_role escreve via reconciler/recommender; authenticated lê (single-user)
grant select on public.ai_recommendations to authenticated;
