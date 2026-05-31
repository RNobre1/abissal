-- 0046 — Escalares pré-jogo derivados da simulação para os "scans" sob demanda
-- (agentes duplo-green e escanteios-2+-ambos-tempos).
--
-- Computados DENTRO do Monte Carlo (scripts/scraper, onde a matriz Dixon-Coles-
-- Poisson e os samples de escanteios por-tempo já vivem em memória) e persistidos
-- como escalares — fiel ao ADR-006 (Worker só lê escalar, nunca cruza blob/jsonb
-- pesado; lições B12/B14). Display/ranking-only; NÃO entram em calibração, ROI ou
-- Brier (não são predições calibráveis, são derivações da distribuição da sim).
--
-- Todas nullable: degradação honesta quando a sim não tem dados por-tempo
-- (per_half_available=false ⇒ p_both_2corners_both_halves fica NULL) ou quando a
-- linha é antiga (pré-backfill) — nunca zeradas.

ALTER TABLE public.fixture_simulations
  -- Duplo green: prob. de um time ABRIR +2 de saldo em algum instante E NÃO vencer
  -- (empate ou derrota). Exato via matriz × P(atingir ±2 | placar) sobre os placares
  -- não-vitoriosos do time. _home/_away por lado; o escalar agregado é "qualquer time".
  ADD COLUMN IF NOT EXISTS p_duplo_green numeric(5,4),
  ADD COLUMN IF NOT EXISTS p_duplo_green_home numeric(5,4),
  ADD COLUMN IF NOT EXISTS p_duplo_green_away numeric(5,4),
  -- Escanteios: prob. de AMBOS os times terem 2+ escanteios em AMBOS os tempos
  -- (casa 1ºT≥2 ∧ casa 2ºT≥2 ∧ fora 1ºT≥2 ∧ fora 2ºT≥2). Joint exato contado sobre
  -- os samples por-tempo do MC. NULL quando per_half_available=false.
  ADD COLUMN IF NOT EXISTS p_both_2corners_both_halves numeric(5,4);

COMMENT ON COLUMN public.fixture_simulations.p_duplo_green IS
  'Prob (0..1) de QUALQUER time abrir +2 de saldo e não vencer (empate/derrota). Derivado da matriz DC-Poisson. Ranking-only, fora de calibração.';
COMMENT ON COLUMN public.fixture_simulations.p_duplo_green_home IS
  'Idem, restrito ao mandante (mandante abre +2 e não vence).';
COMMENT ON COLUMN public.fixture_simulations.p_duplo_green_away IS
  'Idem, restrito ao visitante (visitante abre +2 e não vence).';
COMMENT ON COLUMN public.fixture_simulations.p_both_2corners_both_halves IS
  'Prob (0..1) de ambos os times terem 2+ escanteios em ambos os tempos. NULL se per_half_available=false. Ranking-only, fora de calibração.';
