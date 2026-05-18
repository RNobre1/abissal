import type { Badge } from "@/lib/fixtures/badges";

/**
 * Threshold mínimo de badges para considerar uma fixture de alto sinal.
 * Exportado para uso em testes e futura calibração.
 */
export const HIGH_SIGNAL_MIN_BADGES = 2;

/**
 * Retorna `true` se a fixture tem sinais suficientes para ser considerada
 * de alto sinal. Recebe o array de badges já computado por `computeBadges()`
 * — não recomputa, não faz I/O.
 *
 * @param badges - Array de Badge (ou string[] para compatibilidade de teste).
 */
export function isHighSignal(badges: Badge[] | string[]): boolean {
  return Array.isArray(badges) && badges.length >= HIGH_SIGNAL_MIN_BADGES;
}
