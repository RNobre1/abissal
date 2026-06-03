-- 0050_app_settings.sql
-- Kill switch GLOBAL de IA (+ futuras flags globais do app).
--
-- Tabela key-value GLOBAL (vale pro sistema inteiro, NÃO por-usuário —
-- diferente de `disciplina_settings`, que é RLS-scoped por auth.uid()).
-- Primeira flag: `ai_enabled` — quando false, TODO uso de LLM/OpenRouter
-- (cron recomendador IA-2, /api/ai-reco/compute on-demand, OCR de bilhete)
-- é pulado/recusado graciosamente. Motivo: economizar quando os créditos
-- do OpenRouter acabam ou em períodos sem jogos relevantes.
--
-- Leitura: `authenticated` SELECT (flag não-sensível; MVP single-user). O
-- scraper Ruby lê via DATABASE_URL (role do pooler → bypassa RLS).
-- Escrita: SÓ via service_role (a Server Action usa o admin client). Não há
-- policy de INSERT/UPDATE/DELETE pra `authenticated` — consistente com o
-- /admin atual, que já escreve via service_role.

create table if not exists app_settings (
  key         text primary key,
  value       jsonb       not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid        references auth.users (id) on delete set null
);

comment on table app_settings is
  'Configuração GLOBAL do app (key-value). Ex.: ai_enabled = kill switch de IA. NÃO é por-usuário (≠ disciplina_settings).';

alter table app_settings enable row level security;

-- Todos os autenticados leem as flags globais (não-sensíveis).
drop policy if exists app_settings_read on app_settings;
create policy app_settings_read on app_settings
  for select to authenticated using (true);

-- Sem policy de escrita pra authenticated: INSERT/UPDATE/DELETE só via service_role.

-- Seed: IA LIGADA por padrão (= estado atual do sistema). Desligar é uma
-- decisão explícita, feita pelo toggle em /configuracoes.
insert into app_settings (key, value)
values ('ai_enabled', 'true'::jsonb)
on conflict (key) do nothing;
