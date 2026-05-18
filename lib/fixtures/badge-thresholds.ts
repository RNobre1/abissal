/**
 * Constantes de threshold para o cálculo de badges de fixture.
 *
 * FONTE ÚNICA DA VERDADE para TS. A view SQL correspondente
 * (`supabase/migrations/0017_fixture_badges.sql`, CTEs `strong_streaks` e
 * `referee_flag`) DEVE refletir estes valores literalmente. Ao alterar
 * qualquer constante aqui, edite também o SQL na mesma PR — o teste
 * `lib/fixtures/badge-thresholds.parity.test.ts` falha se houver divergência.
 *
 * Mapeamento TS → SQL:
 *   STREAK_PERC_MIN          → `perc >= 70`          (CTEs strong_streaks)
 *   REFEREE_BOOKING_THRESHOLD → `> 45`                (CTE referee_flag)
 *   REFEREE_2YA_THRESHOLD    → `>= 3`                 (CTE referee_flag)
 *   REFEREE_MIN_COMPLETED    → `>= 5`                 (CTE referee_flag)
 *   STREAK_OVER25_SUBSTR     → `like '%over 2.5%'`    (CTE strong_streaks)
 *   STREAK_BTTS_SUBSTRS      → `like '%btts%'` / `like '%both teams%'`
 *   STREAK_FH_SUBSTRS        → `like '%1h %'` / `like '%first half%'` / `like '%1st half%'`
 *   MAX_BADGES               → `[1:3]`                (CTE badge_arrays)
 */

/** Percentual mínimo de `overall_perc` para um streak ser considerado "forte". */
export const STREAK_PERC_MIN = 70;

/** Média de booking points acima da qual o árbitro recebe badge de cartão alto. */
export const REFEREE_BOOKING_THRESHOLD = 45;

/** Número de cartões duplo-amarelos (yellow_reds) que aciona o badge de cartões. */
export const REFEREE_2YA_THRESHOLD = 3;

/** Número mínimo de jogos apitados para o árbitro ter amostra suficiente. */
export const REFEREE_MIN_COMPLETED = 5;

/** Número máximo de badges exibidos por fixture (cap anti-árvore-de-natal). */
export const MAX_BADGES = 3;

/** Substring que identifica streak de Over 2.5 (aplicada em lower-case). */
export const STREAK_OVER25_SUBSTR = "over 2.5";

/** Substrings que identificam streak de BTTS (aplicadas em lower-case). */
export const STREAK_BTTS_SUBSTRS = ["btts", "both teams"] as const;

/** Substrings que identificam streak de primeiro tempo (aplicadas em lower-case). */
export const STREAK_FH_SUBSTRS = ["1h ", "first half", "1st half"] as const;
