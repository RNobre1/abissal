-- Migration 0028: adiciona coluna thesis em bets
-- Guarda a tese do apostador quando thesis gate é acionado
-- (hora >= 22h BRT ou drawdown_3d >= 10%)

ALTER TABLE bets ADD COLUMN IF NOT EXISTS thesis TEXT;

COMMENT ON COLUMN bets.thesis IS
  'Tese do apostador exigida pelo thesis gate (hora >= 22h BRT ou drawdown_3d >= 10%). NULL quando gate não foi acionado.';
