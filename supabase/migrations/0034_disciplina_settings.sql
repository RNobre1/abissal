-- Migration 0029: tabela disciplina_settings
-- Configurações de fricção ética por usuário.
-- Todas as colunas com valores DEFAULT razoáveis — coluna NULL = feature desabilitada.

CREATE TABLE IF NOT EXISTS disciplina_settings (
  user_id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stop_loss_daily_pct      NUMERIC(5,2),         -- ex: 5.00 = 5% da banca; NULL = sem stop-loss
  max_bets_per_day         INT,                  -- ex: 5; NULL = sem limite
  cooldown_after_loss_min  INT DEFAULT 60,       -- minutos de cooldown após qualquer loss; 0 = off
  quiet_mode_drawdown_pct  NUMERIC(5,2) DEFAULT 5.0,  -- % drawdown 24h pra ativar quiet mode
  quiet_mode_until         TIMESTAMPTZ,          -- timestamp de expiração do quiet mode ativo
  thesis_gate_enabled      BOOLEAN DEFAULT TRUE,
  quiet_mode_enabled       BOOLEAN DEFAULT TRUE,
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);

-- RLS: cada usuário só vê/modifica seus próprios settings
ALTER TABLE disciplina_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY disciplina_settings_owner
  ON disciplina_settings
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE disciplina_settings IS
  'Configurações de fricção ética por usuário: stop-loss, max apostas/dia, cooldown pós-loss, quiet mode.';
