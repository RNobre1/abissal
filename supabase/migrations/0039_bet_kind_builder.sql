-- Adiciona 'bet_builder' ao enum bet_kind pra suportar bilhetes tipo
-- "Criar Aposta" / "Build a Bet" (Betano, Bet365, etc) — 1 jogo, N condições,
-- 1 odd combinada única (sem odd individual por leg).
-- Idempotente: PostgreSQL não permite IF NOT EXISTS pra ADD VALUE, então usa
-- DO block com check.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.bet_kind'::regtype
      AND enumlabel = 'bet_builder'
  ) THEN
    ALTER TYPE public.bet_kind ADD VALUE 'bet_builder';
  END IF;
END
$$;
