-- ============================================================
-- 0049_model_predictions — "arena" champion-challenger (shadow). ADR-011.
--
-- WHY: pra perseguir precisão sem "bumpar" o que já temos, rodamos modelos
-- challenger em PARALELO (shadow) contra o champion, sobre os MESMOS dados de
-- cada jogo, e deixamos regras de score próprias decidirem. Esta tabela guarda
-- UMA predição por (jogo × model_version × mercado), gravada NO MOMENTO do jogo
-- (forward-only) — contorna a retenção de ~4 dias do detail_json (não recomputa
-- histórico) E vira o store append-only que, ao amadurecer, destrava ML/GBM
-- (o único caminho que bate o mercado em RPS — bloqueado hoje pela retenção).
--
-- Só o champion (is_champion=true) alimenta bilhete/recomendador; challengers
-- ficam em shadow (nunca tocam ai_recommendations). Scoring (log_loss/brier/rps/
-- crps + closing_log_loss) é preenchido pelo reconciler ao resolver o jogo.
--
-- fixture_id = id NUMÉRICO do choistats (de source_url), NUNCA o PK interno de
-- fixtures (lição B29 — id-space split).
--
-- RLS: service_role escreve (scraper/reconciler); authenticated lê (UI /calibracao).
-- ============================================================

create table if not exists public.model_predictions (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  fixture_id       bigint      not null,             -- id do choistats (B29)
  model_version    text        not null,             -- 'sim-...-v7' (champion) | challengers
  is_champion      boolean     not null default false,
  market           text        not null,             -- '1x2' | 'over25' | 'btts' | 'corners' | 'cards' | 'sot' | 'scoreline'
  probs            jsonb       not null,             -- distribuição prevista (shape por mercado)
  -- ground truth + scores (preenchidos pelo reconciler ao resolver):
  outcome          jsonb,
  log_loss         double precision,
  brier            double precision,
  rps              double precision,                 -- só ordinal (1x2/scoreline)
  crps             double precision,                 -- só contagem (corners/cards/sot)
  closing_log_loss double precision,                 -- baseline: odds de fechamento devigadas (mesmo jogo/mercado)
  resolved_at      timestamptz,
  unique (fixture_id, model_version, market)
);

-- Comparação contínua: agrupa por modelo×mercado entre os resolvidos.
create index if not exists model_predictions_compare_idx
  on public.model_predictions (model_version, market, resolved_at);
-- Pendentes por jogo (reconcile).
create index if not exists model_predictions_fixture_idx
  on public.model_predictions (fixture_id) where resolved_at is null;

alter table public.model_predictions enable row level security;

grant select, insert, update on public.model_predictions to service_role;
grant select on public.model_predictions to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'model_predictions'
      and policyname = 'model_predictions_auth_select'
  ) then
    create policy model_predictions_auth_select
      on public.model_predictions for select to authenticated using (true);
  end if;
end $$;

comment on table public.model_predictions is
  'Arena champion-challenger (ADR-011): uma predição por (fixture_id choistats × model_version × market), '
  'gravada no momento do jogo (forward-only). Só is_champion alimenta o bilhete; challengers em shadow. '
  'Scores preenchidos pelo reconciler. Store append-only que destrava ML quando amadurecer.';
