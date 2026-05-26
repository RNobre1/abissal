/**
 * computeDefaultStake — calcula a stake sugerida em BRL para o AposteiModal.
 *
 * Regra (Wave B fix #1):
 *   stake = units_final × (bankroll × units_per_bankroll / 100)
 *
 * Onde `units_per_bankroll` é a porcentagem da banca que representa 1 unit
 * (ex: 2 = 2% da banca = 1 unit).
 *
 * Fallback quando `bankrollSettings` é null ou inválido:
 *   stake = units_final × (DEFAULT_BANKROLL × DEFAULT_UNIT_PCT / 100)
 *
 * Retorna 0 quando `units_final` é null, 0, ou inválido.
 *
 * Sem I/O, sem mocks — puro. Chamado pelo AiRecoPanel no SSR.
 */

/** Banca padrão quando o usuário ainda não configurou bankroll_settings. */
export const DEFAULT_BANKROLL = 1000;

/** 1 unit = 1% da banca por default. */
const DEFAULT_UNIT_PCT = 1;

export interface BankrollSettings {
  /** Valor total da banca em BRL. */
  bankroll: number;
  /** Porcentagem da banca que representa 1 unit (ex: 2 = 2% = 1 unit). */
  units_per_bankroll: number;
}

/**
 * Computa o stake default em BRL para `units_final` units.
 *
 * @param unitsFinal — número de units recomendados pela IA (ex: 1.5). null/0 → retorna 0.
 * @param settings   — configurações de banca do usuário. null → usa fallback.
 * @returns stake em BRL arredondado a 2 casas decimais.
 */
export function computeDefaultStake(
  unitsFinal: number | null,
  settings: BankrollSettings | null,
): number {
  if (unitsFinal == null || !Number.isFinite(unitsFinal) || unitsFinal <= 0) {
    return 0;
  }

  let bankroll: number;
  let unitPct: number;

  if (
    settings !== null &&
    Number.isFinite(settings.bankroll) &&
    settings.bankroll > 0 &&
    Number.isFinite(settings.units_per_bankroll) &&
    settings.units_per_bankroll > 0
  ) {
    bankroll = settings.bankroll;
    unitPct = settings.units_per_bankroll;
  } else {
    // Fallback: banca default + 1% por unit
    bankroll = DEFAULT_BANKROLL;
    unitPct = DEFAULT_UNIT_PCT;
  }

  const unitValue = (bankroll * unitPct) / 100;
  return Math.round(unitsFinal * unitValue * 100) / 100;
}
