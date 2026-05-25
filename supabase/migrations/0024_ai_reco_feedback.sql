-- ============================================================
-- ai_reco_feedback — feedback humano sobre cada ai_recommendation
--
-- Permite separar dois ROI distintos:
--   - ROI hipotético: PL de TODAS as recos da IA × resultado real
--     (já computado por `AiRecommendationReconciler`).
--   - ROI realista: PL apenas das recos onde o usuário marcou
--     'bet' (apostou de verdade).
--
-- Também alimenta dataset pra fine-tuning futuro:
--   - 'agree' / 'disagree' = avaliação do PILOT sobre a tese (independe
--     de ele ter apostado — pode concordar e não ter banca, ou discordar
--     e apostar por outros motivos).
--   - 'bet' / 'no_bet' = decisão final de execução.
--
-- Unicidade: 1 linha por (ai_recommendation_id, user_decision)
-- — permite "concordo" + "apostei" coexistindo, mas evita duplicação do
--   mesmo decision repetido. Endpoint usa upsert para sobrescrever
--   comentário caso o usuário re-clique.
--
-- FK hard pra ai_recommendations(id) com ON DELETE CASCADE — feedback
-- não sobrevive à remoção da reco original (caso o reconciler limpe
-- recos órfãs no futuro).
--
-- Spec: discussion 2026-05-25 — loop de feedback humano IA-2.
-- ============================================================

create table if not exists public.ai_reco_feedback (
  id                    bigserial primary key,
  ai_recommendation_id  bigint not null
                          references public.ai_recommendations(id) on delete cascade,
  user_decision         text not null
                          check (user_decision in ('agree','disagree','bet','no_bet')),
  comment               text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (ai_recommendation_id, user_decision)
);

create index if not exists idx_ai_reco_feedback_reco
  on public.ai_reco_feedback (ai_recommendation_id);
create index if not exists idx_ai_reco_feedback_decision
  on public.ai_reco_feedback (user_decision);

alter table public.ai_reco_feedback enable row level security;

-- service_role escreve via endpoint; authenticated lê (single-user)
grant select on public.ai_reco_feedback to authenticated;
