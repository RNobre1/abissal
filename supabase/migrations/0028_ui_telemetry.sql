-- Migration: 0028_ui_telemetry.sql
-- Tabela de telemetria de UX para diagnóstico de comportamento do produto.
-- RLS: qualquer usuário (inclusive anônimo) pode inserir; usuário autenticado
--      só lê os próprios eventos; service_role lê tudo (para o dashboard admin).

CREATE TABLE IF NOT EXISTS ui_telemetry (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type            TEXT NOT NULL,
  fixture_id            BIGINT,
  ai_recommendation_id  BIGINT,
  panel_id              TEXT,
  elapsed_ms            INT,
  session_id            TEXT,
  payload               JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para as queries do dashboard
CREATE INDEX IF NOT EXISTS idx_ui_telemetry_event_created
  ON ui_telemetry(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ui_telemetry_user_created
  ON ui_telemetry(user_id, created_at DESC);

-- Índice para a query de rate limit (session_id + created_at)
CREATE INDEX IF NOT EXISTS idx_ui_telemetry_session_created
  ON ui_telemetry(session_id, created_at DESC);

-- RLS
ALTER TABLE ui_telemetry ENABLE ROW LEVEL SECURITY;

-- Qualquer cliente pode inserir (sem user_id obrigatório — anônimo OK)
CREATE POLICY ui_telemetry_insert_any
  ON ui_telemetry
  FOR INSERT
  WITH CHECK (true);

-- Usuário autenticado só vê seus próprios eventos; anônimo vê rows com user_id NULL
CREATE POLICY ui_telemetry_select_own
  ON ui_telemetry
  FOR SELECT
  USING (user_id = auth.uid() OR user_id IS NULL);
