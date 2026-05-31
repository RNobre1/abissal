/**
 * Frequências empíricas por-tempo sobre as partidas recentes de um time
 * (perspectiva "for" = o próprio time). Operam sobre `NormalizedRecentMatch[]`
 * já normalizado por `deriveRecentMatchStats(raw, perspectiveTeam)` — que
 * resolve casa/fora por partida histórica.
 *
 * São base-rates de CONFERÊNCIA pro humano (sidecar dos scans + painel do
 * dashboard), NÃO entram em modelo/calibração. Cobertura honesta:
 *   - gols por tempo (HT): ~100% de fill no choistats;
 *   - escanteios por tempo: ~53% (metade dos jogos vem sem o split) → cada
 *     função reporta `eligible` separado de `made` pra UI mostrar "X de Y" em
 *     vez de fingir denominador cheio.
 */

import type { NormalizedRecentMatch } from "./detail-json-types";

export type Half = "1h" | "2h";

export interface RateOverEligible {
  /** jogos que satisfazem a condição. */
  made: number;
  /** jogos onde a condição PÔDE ser avaliada (inputs não-null). */
  eligible: number;
  /** `made/eligible`, ou `null` quando `eligible === 0` (honesto "sem dados"). */
  rate: number | null;
}

function rateOf(made: number, eligible: number): RateOverEligible {
  return { made, eligible, rate: eligible > 0 ? made / eligible : null };
}

/**
 * Fração de jogos recentes em que o time teve ≥`threshold` escanteios em
 * AMBOS os tempos. Elegível = jogos com os dois valores por-tempo presentes
 * (o subset ~53%).
 */
export function corners2PlusBothHalvesRate(
  matches: NormalizedRecentMatch[],
  threshold = 2,
): RateOverEligible {
  let made = 0;
  let eligible = 0;
  for (const m of matches) {
    if (m.corners_1h_for == null || m.corners_2h_for == null) continue;
    eligible++;
    if (m.corners_1h_for >= threshold && m.corners_2h_for >= threshold) made++;
  }
  return rateOf(made, eligible);
}

/** Fração de jogos em que o time fez ≥`threshold` gols no tempo dado. */
export function goals2PlusInHalfRate(
  matches: NormalizedRecentMatch[],
  half: Half,
  threshold = 2,
): RateOverEligible {
  const field = half === "1h" ? "goals_1h_for" : "goals_2h_for";
  return countThreshold(matches, field, threshold);
}

/** Fração de jogos em que o time teve ≥`threshold` escanteios no tempo dado. */
export function corners2PlusInHalfRate(
  matches: NormalizedRecentMatch[],
  half: Half,
  threshold = 2,
): RateOverEligible {
  const field = half === "1h" ? "corners_1h_for" : "corners_2h_for";
  return countThreshold(matches, field, threshold);
}

function countThreshold(
  matches: NormalizedRecentMatch[],
  field: keyof NormalizedRecentMatch,
  threshold: number,
): RateOverEligible {
  let made = 0;
  let eligible = 0;
  for (const m of matches) {
    const v = m[field];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    eligible++;
    if (v >= threshold) made++;
  }
  return rateOf(made, eligible);
}

/**
 * Duplo-green empírico (PARCIAL): fração de jogos em que o time abriu ≥2 de
 * vantagem **no intervalo (HT)** e NÃO venceu (empate/derrota). Elegível =
 * jogos com placar de HT + resultado presentes (~100%).
 *
 * É um piso, não o evento completo: a fonte não tem timeline de gols, então
 * vantagens abertas SÓ no 2º tempo não aparecem aqui. Por isso é só sidecar —
 * o ranking real é a prob da simulação.
 */
export function blewHalftime2LeadRate(
  matches: NormalizedRecentMatch[],
  lead = 2,
): RateOverEligible {
  let made = 0;
  let eligible = 0;
  for (const m of matches) {
    if (
      m.goals_1h_for == null ||
      m.goals_1h_against == null ||
      m.result == null
    ) {
      continue;
    }
    eligible++;
    const ledByLead = m.goals_1h_for - m.goals_1h_against >= lead;
    if (ledByLead && m.result !== "W") made++;
  }
  return rateOf(made, eligible);
}
