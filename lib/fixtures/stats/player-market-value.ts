/**
 * Caça-valor manual de mercados de jogador (anytime scorer / cartão / SOT).
 *
 * Cruza a probabilidade do SIMULADOR por jogador (`player_events`: p_goal/
 * p_card/p_sot) com a ODD do mercado (`detail_json.player_extra.
 * outcome_odds_by_player`). NÃO é recomendação da IA, NÃO é calibrado e NÃO
 * usa histórico — é só um espelho pro humano enxergar onde o sim discorda do
 * mercado. A prob implícita = 1/odd e INCLUI a margem da casa (o "valor" real
 * exige folga sobre ela; por isso o flag exige uma margem mínima).
 *
 * As odds de jogador são esparsas (só ~10% dos fixtures as têm) — quando
 * faltam, retorna [] e a UI degrada pra mostrar só as probs do sim.
 */

/** odds[outcomeType] = decimalOdds. Ex.: { ANYTIME_SCORER: 3.3, TO_BE_CARDED: 6 }. */
export type PlayerOdds = Record<string, number>;
/** Mapa nome-do-jogador → suas odds. */
export type PlayerOddsMap = Record<string, PlayerOdds>;

export interface PlayerMarketHint {
  /** Rótulo curto pt-BR do mercado. */
  market: "gol" | "cartão" | "chute no gol";
  /** Prob do simulador (0..1). */
  simProb: number;
  /** Odd decimal da casa. */
  odd: number;
  /** Prob implícita pela odd = 1/odd (inclui a margem da casa). */
  implied: number;
  /** True quando o sim vê valor com folga sobre a margem (simProb > implied + buffer). */
  value: boolean;
}

/** Margem mínima do sim sobre a prob implícita pra sinalizar "valor" (absorve parte da vig). */
const VALUE_BUFFER = 0.03;

const MARKETS: ReadonlyArray<{
  outcome: string;
  label: PlayerMarketHint["market"];
  prob: "p_goal" | "p_card" | "p_sot";
}> = [
  { outcome: "ANYTIME_SCORER", label: "gol", prob: "p_goal" },
  { outcome: "TO_BE_CARDED", label: "cartão", prob: "p_card" },
  { outcome: "PLAYER_OVER_0_5_SHOTS_ON_TARGET", label: "chute no gol", prob: "p_sot" },
];

/**
 * Hints de valor pra um jogador. `probs` vêm do `player_events`; `odds` do
 * `outcome_odds_by_player[name]` (pode ser undefined). Pula mercados sem odd
 * válida (odd finita > 1) ou sem prob finita.
 */
export function playerMarketHints(
  probs: { p_goal: number; p_card: number; p_sot: number },
  odds: PlayerOdds | undefined,
): PlayerMarketHint[] {
  if (!odds) return [];
  const out: PlayerMarketHint[] = [];
  for (const m of MARKETS) {
    const odd = odds[m.outcome];
    if (typeof odd !== "number" || !Number.isFinite(odd) || odd <= 1) continue;
    const simProb = probs[m.prob];
    if (typeof simProb !== "number" || !Number.isFinite(simProb)) continue;
    const implied = 1 / odd;
    out.push({
      market: m.label,
      simProb,
      odd,
      implied,
      value: simProb > implied + VALUE_BUFFER,
    });
  }
  return out;
}
