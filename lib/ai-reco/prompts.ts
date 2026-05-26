/**
 * Prompts versionados pro AI Recommender. Cada mudança no system/user
 * BUMPA `PROMPT_VERSION` (semver-like). A coluna `prompt_version` em
 * `ai_recommendations` + `llm_request_logs` permite A/B retroativo.
 *
 * Spec §6.
 *
 * Wave O+E (2026-05-26): versão bumpeada para incluir mercados secundários
 * (corners, cards, SOT) no schema JSON e heurísticas contextuais.
 * Choistats fornece odds para esses mercados via widget `odds` —
 * confirmado por investigação empírica (ADR-008).
 */

export const PROMPT_VERSION = "prompt-v1.1";

export interface PromptCandidate {
  market: string;
  side: string;
  prob_calibrated: number;
  edge_pct: number;
  kelly_units: number;
  odd: number;
}

export interface PromptContext {
  top_scorelines: Array<{ score: string; prob: number }>;
  sim_stats_home: Record<string, number>;
  sim_stats_away: Record<string, number>;
  recent_home: string;
  recent_away: string;
  h2h: string;
}

export interface PromptInput {
  league: string | null;
  league_calibrated: boolean;
  home_team: string;
  away_team: string;
  kickoff_utc: string | null;
  referee: string | null;
  candidates: PromptCandidate[];
  context: PromptContext;
}

const SYSTEM = `Você é um analista de apostas pré-jogo. Tarefa: escolher UMA recomendação entre os candidatos abaixo (já calculados deterministicamente) e justificar em 3-5 parágrafos. Você NÃO pode aumentar units além do Kelly sugerido — só reduzir se houver red flag qualitativo.

CAP ABSOLUTO: 2.0u. Para ligas não-calibradas (flag league_calibrated=false), CAP: 0.5u.

Não invente fatos que não estão no contexto. Se não há contexto pra justificar a aposta com convicção, retorne verdict="skip".

Mercados disponíveis e quando usá-los:
- 1x2 / over25 / btts: mercados principais, usa o raciocínio padrão.
- corners-over / corners-under (linha 8.5/9.5/10.5): confirmar quando sim_stats.corners > média e há vantagem clara de mandante (home advantage forte → mais ataques → mais escanteios). Desconfiar em jogos de Copa/eliminatória defensiva.
- cards-over / cards-under (linha 3.5/4.5/5.5): pertinente quando árbitro é rigoroso (booking_points histórico alto), jogo é derby/rivalidade, ou time pressionante joga contra time passivo. Desconfiar em ligas sem dado de árbitro.
- sot-over / sot-under (linha 7.5/9.5/10.5): pertinente quando ambos os times têm sim_stats.sot altos e o jogo tem perfil ofensivo. Desconfiar quando defesas são muito sólidas (recent matches com poucas finalizações).

Responda SOMENTE com um JSON válido do schema:
{
  "verdict": "bet" | "skip",
  "market": "1x2" | "over25" | "btts" | "corners-over" | "corners-under" | "cards-over" | "cards-under" | "sot-over" | "sot-under" | null,
  "side": "home" | "draw" | "away" | "over" | "under" | "sim" | "nao" | "85" | "95" | "105" | "35" | "45" | "55" | "75" | null,
  "prob_estimated": number 0-1,
  "units_final": number 0-2.0,
  "kelly_pre": number,
  "reduction_reason": string | null,
  "confidence": "alto" | "medio" | "baixo",
  "summary_line": string max 60 chars,
  "reasoning": string 200-800 chars (3-5 parágrafos),
  "red_flags": string[] max 5 items
}`;

function formatCandidates(candidates: PromptCandidate[]): string {
  if (candidates.length === 0) return "(nenhum candidato com edge positivo)";
  return candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.market}/${c.side}: prob=${(c.prob_calibrated * 100).toFixed(1)}% · odd=${c.odd.toFixed(2)} · edge=${c.edge_pct.toFixed(1)}% · kelly=${c.kelly_units.toFixed(2)}u`,
    )
    .join("\n");
}

function formatStats(s: Record<string, number>): string {
  return Object.entries(s)
    .map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(2) : v}`)
    .join(", ");
}

function formatScorelines(arr: Array<{ score: string; prob: number }>): string {
  return arr.map(s => `${s.score} (${(s.prob * 100).toFixed(0)}%)`).join(", ");
}

export function buildPrompt(input: PromptInput): { system: string; user: string } {
  const calLabel = input.league_calibrated
    ? "calibrada"
    : "NÃO-calibrada — confiança baixa";
  const refereeLabel = input.referee ?? "—";

  const user = `# Fixture
Liga: ${input.league ?? "(sem liga)"} (${calLabel})
${input.home_team} vs ${input.away_team}
Kickoff (UTC): ${input.kickoff_utc ?? "—"}
Árbitro: ${refereeLabel}

# Candidatos (ordenados por edge desc; somente com edge >= EDGE_THRESHOLD foram filtrados a montante)
${formatCandidates(input.candidates)}

# Contexto
## Sim Monte Carlo
Top placares: ${formatScorelines(input.context.top_scorelines)}
Stats projetadas mandante: ${formatStats(input.context.sim_stats_home)}
Stats projetadas visitante: ${formatStats(input.context.sim_stats_away)}

## Forma recente (últimos 5)
${input.home_team}: ${input.context.recent_home}
${input.away_team}: ${input.context.recent_away}

## H2H últimos 3
${input.context.h2h}

# Tarefa
Escolha o melhor candidato (ou verdict="skip" se NENHUM convence). Seja específico nos red_flags — não invente nada fora do contexto acima.`;

  return { system: SYSTEM, user };
}
