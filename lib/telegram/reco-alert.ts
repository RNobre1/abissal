/**
 * lib/telegram/reco-alert.ts
 *
 * Render puro do alerta de recomendações da IA-2 pro Telegram (Wave 1).
 * Sem side-effects/HTTP — testável. Saída em HTML (parse_mode "HTML").
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

const SECONDARY_STAT: Record<string, string> = {
  corners: "Escanteios",
  cards: "Cartões",
  sot: "Finalizações no gol",
};

/**
 * Humaniza (market, side) num rótulo legível em PT-BR.
 *   1x2/home → "Resultado: Casa" · over25/over → "Gols: Over 2.5"
 *   btts/sim → "Ambas marcam: Sim"
 *   corners-under/85 → "Escanteios: Under 8.5" (side = linha ×10)
 * Fallback: "MARKET/SIDE" (uppercase) — nunca quebra.
 */
export function formatPick(market: string, side: string): string {
  if (market === "1x2") {
    const r = side === "home" ? "Casa" : side === "draw" ? "Empate" : side === "away" ? "Fora" : side;
    return `Resultado: ${r}`;
  }
  if (market === "over25") {
    const d = side === "over" ? "Over 2.5" : side === "under" ? "Under 2.5" : side;
    return `Gols: ${d}`;
  }
  if (market === "btts") {
    const b = side === "sim" ? "Sim" : side === "nao" ? "Não" : side;
    return `Ambas marcam: ${b}`;
  }
  const sec = market.match(/^(corners|cards|sot)-(over|under)$/);
  if (sec) {
    const stat = SECONDARY_STAT[sec[1]];
    const dir = sec[2] === "over" ? "Over" : "Under";
    const raw = parseInt(side, 10);
    if (!Number.isNaN(raw)) {
      const line = (raw / 10).toFixed(1);
      return `${stat}: ${dir} ${line}`;
    }
  }
  return `${market}/${side}`.toUpperCase();
}

/**
 * Monta o texto (HTML) do alerta. Retorna `null` quando não há nenhuma aposta —
 * o caller não deve mandar mensagem nesse caso (sem spam de "0 apostas").
 * Deduplica recos do mesmo confronto+mercado+lado (dois runs no dia geram
 * duplicata; mantém a primeira — que vem com maior edge, já que o caller ordena
 * por edge desc).
 */
export function formatRecoAlert({ date, bets, skipCount, maxBets }: RecoAlertInput): string | null {
  const deduped = dedupe(bets);
  if (deduped.length === 0) return null;

  const cap = maxBets ?? DEFAULT_MAX_BETS;
  const shown = deduped.slice(0, cap);
  const hidden = deduped.length - shown.length;

  const header = `🎯 <b>Apostas da IA · ${esc(date)}</b> (${deduped.length} jogo${deduped.length > 1 ? "s" : ""})`;

  const blocks = shown.map((b) => {
    const pick = formatPick(b.market, b.side);
    const stake = b.units != null ? `${formatUnits(b.units)}u` : "—u";
    const odd = b.oddCaptured != null ? ` @ ${b.oddCaptured.toFixed(2)}` : "";
    const edge = b.edgePct != null ? `edge ${formatPct(b.edgePct)}%` : "edge —";
    const conf = `conf ${confidenceLabel(b.confidence)}`;
    return (
      `<b>${esc(b.homeTeam)} × ${esc(b.awayTeam)}</b> · <i>${esc(b.league)}</i>\n` +
      `🟢 ${esc(pick)} — ${stake}${odd}\n` +
      `${edge} · ${conf}`
    );
  });

  const lines = [header, "", blocks.join("\n\n")];

  if (hidden > 0) {
    lines.push("", `… +${hidden} aposta(s) a mais — veja no app.`);
  }
  if (skipCount > 0) {
    lines.push("", `⚪ +${skipCount} jogo(s) sem valor (skip).`);
  }

  return lines.join("\n");
}

function dedupe(bets: RecoBet[]): RecoBet[] {
  const seen = new Set<string>();
  const out: RecoBet[] = [];
  for (const b of bets) {
    const key = `${b.homeTeam}|${b.awayTeam}|${b.market}|${b.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

function confidenceLabel(c: string | null): string {
  if (!c) return "—";
  return CONFIDENCE_LABEL[c] ?? c;
}

/** Escapa os 3 caracteres especiais do parse_mode HTML do Telegram. */
function esc(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** pt-BR, vírgula decimal, 1 casa, com sinal. */
function formatPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return sign + value.toFixed(1).replace(".", ",");
}

/** pt-BR, vírgula decimal, 1 casa (units sempre positivo). */
function formatUnits(value: number): string {
  return value.toFixed(1).replace(".", ",");
}
