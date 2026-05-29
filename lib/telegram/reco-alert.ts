/**
 * lib/telegram/reco-alert.ts
 *
 * Render puro do alerta de recomendações da IA-2 pro Telegram (Wave 1).
 * Sem side-effects/HTTP — testável e portável.
 *
 * Política (2026-05-29): alerta TODA reco `verdict=bet`, QUALQUER confiança.
 * A calibração mostrou que a IA acerta MAIS em confiança média/baixa (ROI
 * +12,6%/+29,3%) do que alta (−25,0%) — filtrar por confiança esconderia as
 * boas. O alerta mostra a confiança como contexto, não como filtro.
 */

export interface RecoBet {
  homeTeam: string;
  awayTeam: string;
  league: string;
  market: string;
  side: string;
  edgePct: number | null;
  confidence: string | null;
  units: number | null;
  oddCaptured?: number | null;
}

export interface RecoAlertInput {
  /** Rótulo de data, ex. "29/05". */
  date: string;
  bets: RecoBet[];
  /** Quantos jogos a IA viu sem valor (skip) — contexto no rodapé. */
  skipCount: number;
  /** Teto de apostas exibidas (Telegram limita msg a 4096 chars). Default 25. */
  maxBets?: number;
}

/** Teto default de apostas no digest — folga sob o limite de 4096 chars. */
const DEFAULT_MAX_BETS = 25;

const CONFIDENCE_LABEL: Record<string, string> = {
  alto: "alta",
  medio: "média",
  baixo: "baixa",
};

/**
 * Monta o texto do alerta. Retorna `null` quando não há nenhuma aposta —
 * o caller não deve mandar mensagem nesse caso (sem spam de "0 apostas").
 */
export function formatRecoAlert({ date, bets, skipCount, maxBets }: RecoAlertInput): string | null {
  if (bets.length === 0) return null;

  const cap = maxBets ?? DEFAULT_MAX_BETS;
  const shown = bets.slice(0, cap);
  const hidden = bets.length - shown.length;

  const header = `🎯 IA viu valor em ${bets.length} jogo(s) hoje (${date}):`;

  const blocks = shown.map((b) => {
    const market = `${b.market}/${b.side}`.toUpperCase();
    const edge = b.edgePct != null ? `edge ${formatPct(b.edgePct)}%` : "edge —";
    const conf = `conf ${confidenceLabel(b.confidence)}`;
    const units = b.units != null ? `${formatUnits(b.units)}u` : "—u";
    const odd = b.oddCaptured != null ? ` @ ${b.oddCaptured.toFixed(2)}` : "";
    return (
      `⚽ ${b.homeTeam} × ${b.awayTeam} (${b.league})\n` +
      `   ${market} · ${edge} · ${conf} · ${units}${odd}`
    );
  });

  const lines = [header, "", blocks.join("\n\n")];

  if (hidden > 0) {
    lines.push("", `+${hidden} aposta(s) a mais — veja no app.`);
  }

  if (skipCount > 0) {
    lines.push("", `+${skipCount} jogo(s) sem valor (skip).`);
  }

  return lines.join("\n");
}

function confidenceLabel(c: string | null): string {
  if (!c) return "—";
  return CONFIDENCE_LABEL[c] ?? c;
}

/** pt-BR, vírgula decimal, 1 casa, com sinal. */
function formatPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return sign + value.toFixed(1).replace(".", ",");
}

/** pt-BR, vírgula decimal, 1 casa (units não leva sinal — sempre positivo). */
function formatUnits(value: number): string {
  return value.toFixed(1).replace(".", ",");
}
