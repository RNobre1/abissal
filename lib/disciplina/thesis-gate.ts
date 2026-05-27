/**
 * lib/disciplina/thesis-gate.ts
 *
 * Determina se o "thesis gate" deve ser exibido antes de confirmar aposta.
 *
 * Gatilho (OR):
 *   - hora BRT atual >= 22h  → é tarde
 *   - drawdown_3d >= 10%     → risco de tilt por sequência negativa
 *
 * Kill switches (ordem):
 *   1. env var FRICAO_THESIS_GATE_ENABLED === "false" → gate desabilitado
 *   2. userEnabled === false (disciplina_settings.thesis_gate_enabled) → desabilitado
 *   3. caso contrário, avalia os gatilhos
 */

export interface ThesisGateInput {
  /** Hora atual em BRT (0-23) */
  hourBrt: number;
  /** Drawdown das últimas 72h em % (0-100) */
  drawdown3d: number;
  /** User opt-in via disciplina_settings.thesis_gate_enabled. `undefined` = trata como ligado (compat) */
  userEnabled?: boolean;
}

const LATE_HOUR_BRT = 22;
const DRAWDOWN_THRESHOLD_PCT = 10;

/**
 * Função pura — sem side-effects, sem I/O.
 * Lê process.env no momento da chamada pra suportar vi.stubEnv em testes.
 */
export function shouldRequireThesis({ hourBrt, drawdown3d, userEnabled }: ThesisGateInput): boolean {
  const enabled = process.env.FRICAO_THESIS_GATE_ENABLED;
  if (enabled === "false") return false;
  if (userEnabled === false) return false;

  const isLate = hourBrt >= LATE_HOUR_BRT;
  const isHighDrawdown = drawdown3d >= DRAWDOWN_THRESHOLD_PCT;

  return isLate || isHighDrawdown;
}

/**
 * Microcopy contextual para o textarea do thesis gate.
 */
export function thesisGateCopy({ hourBrt, drawdown3d }: ThesisGateInput): string {
  const isLate = hourBrt >= LATE_HOUR_BRT;
  const isHighDrawdown = drawdown3d >= DRAWDOWN_THRESHOLD_PCT;

  if (isLate && isHighDrawdown) {
    return "É tarde e o drawdown está alto. Confirma a tese em 1 frase.";
  }
  if (isLate) {
    return "É tarde. Qual sua tese em 1 frase?";
  }
  return "Drawdown alto. Confirma a tese.";
}
