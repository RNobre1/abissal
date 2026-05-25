-- ============================================================
-- bets.ai_recommendation_id — vincula bet manual a uma reco IA
-- quando aplicável (sempre que o Pilot clica "✅ Apostei" no
-- AiRecoPanel).
--
-- NULLABLE: bets manuais sem reco continuam funcionando (foram
-- a maioria do histórico — esta é a entrada do elo perdido entre
-- domínio análise/IA e domínio banca).
--
-- ON DELETE SET NULL: se uma reco for purgada/removida do histórico
-- a bet sobrevive (ledger é a fonte de verdade financeira; a reco
-- vira fato perdido de proveniência, mas o stake/odd/status ficam
-- intactos).
--
-- Habilita o painel "ROI realizado (bets vinculadas)" em
-- /calibracao, complementando o "ROI hipotético" existente que
-- soma `pl_units` de TODAS as recos resolvidas (incluindo as que
-- o Pilot nunca apostou).
--
-- Spec: tarefa A2 — discussão 2026-05-25 (PO + CFO + CMO + CRO).
-- ============================================================

alter table public.bets
  add column if not exists ai_recommendation_id bigint
  references public.ai_recommendations(id) on delete set null;

create index if not exists idx_bets_ai_reco
  on public.bets (ai_recommendation_id);

-- Idempotência da action "✅ Apostei": só 1 bet pending por reco
-- (Pilot pode revisar casa/stake clicando de novo — a action faz
-- update em vez de criar duplicata). Resoluções (won/lost/void)
-- ficam fora do unique → permite re-bet futura na mesma reco caso
-- a primeira tenha sido encerrada.
create unique index if not exists uniq_bets_pending_per_reco
  on public.bets (ai_recommendation_id)
  where ai_recommendation_id is not null and status = 'pending';
