/**
 * F4 — Briefing matinal ("Abissal Daily"): núcleo puro, SEM I/O.
 *
 * Responsabilidades:
 *  - `composeBriefingPrompt` — monta {system, user} a partir dos dados do dia
 *    (recos verdict=bet, contagem de skips, ligas não-calibradas, acerto por
 *    mercado). Todo número que o briefing pode citar PRECISA estar aqui —
 *    o system proíbe inventar qualquer coisa fora dos dados fornecidos.
 *  - `parseBriefingText` — parse tolerante da resposta do LLM (fence
 *    markdown, JSON com chave textual, texto cru, aspas envolventes).
 *  - `buildBriefingValue` / `parseBriefingValue` / `isBriefingFresh` —
 *    forma e validação do value persistido em `app_settings` (key
 *    `daily_briefing`), lido pelo card <BriefingDoDia /> no /painel.
 *
 * Consumidores: scripts/briefing/generate-daily.ts (escreve) e
 * components/painel/briefing-do-dia.tsx (lê). Puro por design — testável
 * sem Supabase, sem fetch, sem React.
 */

export const DAILY_BRIEFING_KEY = "daily_briefing";

export interface BriefingBet {
  homeTeam: string;
  awayTeam: string;
  league: string | null;
  market: string | null;
  side: string | null;
  edgePct: number | null;
  oddCaptured: number | null;
  unitsFinal: number | null;
  confidence: string | null;
  leagueCalibrated: boolean;
}

/** Resumo compacto de acerto por mercado (de lib/calibracao/market-accuracy). */
export interface BriefingAccuracy {
  /** Ex.: "escanteios · menos de 9.5". */
  label: string;
  /** Taxa de acerto observada (0..1). */
  rate: number;
  /** Taxa-base (chutar o lado majoritário; 1/3 no 1x2). */
  baseRate: number;
  /** Nº de chamadas que sustentam a taxa. */
  calls: number;
}

export interface BriefingInput {
  /** Rótulo do dia em BRT, ex.: "30/07". */
  dateLabel: string;
  bets: BriefingBet[];
  skipCount: number;
  accuracies: BriefingAccuracy[];
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

function betLine(b: BriefingBet, idx: number): string {
  const parts: string[] = [];
  const league = b.league ? ` (${b.league})` : "";
  parts.push(`${idx + 1}. ${b.homeTeam} vs ${b.awayTeam}${league}`);
  const call: string[] = [];
  if (b.market) call.push(b.side ? `${b.market}/${b.side}` : b.market);
  if (typeof b.oddCaptured === "number") call.push(`@${b.oddCaptured.toFixed(2)}`);
  if (typeof b.edgePct === "number") {
    call.push(`edge ${b.edgePct >= 0 ? "+" : ""}${b.edgePct.toFixed(1)}%`);
  }
  if (typeof b.unitsFinal === "number") call.push(`${b.unitsFinal}u`);
  if (b.confidence) call.push(`confiança ${b.confidence}`);
  call.push(b.leagueCalibrated ? "liga calibrada" : "liga NÃO-calibrada");
  return `${parts.join("")} — ${call.join(", ")}`;
}

/**
 * Monta o prompt do briefing. O user prompt é um dossiê factual do dia;
 * o system fixa formato (um parágrafo PT-BR, 100-140 palavras) e a regra
 * inegociável: nada fora dos dados.
 */
export function composeBriefingPrompt(input: BriefingInput): {
  system: string;
  user: string;
} {
  const system = [
    "Você escreve o briefing matinal do Abissal, uma plataforma pessoal de análise de apostas esportivas.",
    "Escreva UM único parágrafo em português (PT-BR), entre 100 e 140 palavras.",
    "Tom direto e honesto, de analista que respeita o leitor: conecte os dados do dia e aponte as ressalvas reais (ligas não-calibradas, amostras pequenas, mercados onde o modelo historicamente erra).",
    'Exemplo de tom: "3 oportunidades hoje, mas 2 em ligas não-calibradas — historicamente o modelo rende menos nelas."',
    "NUNCA invente números, jogos, ligas ou estatísticas fora dos dados fornecidos. Se um dado não foi fornecido, não o mencione.",
    "Não use markdown, listas, títulos ou emojis. Responda somente com o parágrafo.",
  ].join("\n");

  const betsSection =
    input.bets.length === 0
      ? "Nenhuma oportunidade (verdict=bet) hoje."
      : input.bets.map(betLine).join("\n");

  const uncalibrated = input.bets.filter((b) => !b.leagueCalibrated).length;
  const uncalibratedLine =
    input.bets.length === 0
      ? null
      : `Apostas em liga não-calibrada: ${uncalibrated} de ${input.bets.length}.`;

  const accSection =
    input.accuracies.length === 0
      ? "(sem dados de acerto disponíveis)"
      : input.accuracies
          .map(
            (a) =>
              `- ${a.label}: acerto ${pct(a.rate)} (taxa-base ${pct(a.baseRate)}, n=${a.calls})`,
          )
          .join("\n");

  const user = [
    `Data: ${input.dateLabel}`,
    "",
    `Oportunidades do dia (recomendações verdict=bet): ${input.bets.length}`,
    betsSection,
    ...(uncalibratedLine ? [uncalibratedLine] : []),
    `Jogos analisados e descartados (skip): ${input.skipCount}`,
    "",
    "Acerto histórico do modelo por mercado (resultados reais reconciliados):",
    accSection,
    "",
    "Escreva o briefing de hoje a partir EXCLUSIVAMENTE dos dados acima.",
  ].join("\n");

  return { system, user };
}

/** Chaves textuais aceitas quando o LLM devolve JSON em vez de texto puro. */
const TEXT_KEYS = ["text", "briefing", "texto", "paragraph", "content"] as const;

/** Abaixo disso não é um briefing — é eco/ruído. */
const MIN_TEXT_LENGTH = 20;

/**
 * Parse tolerante da resposta do LLM. Aceita texto cru, fence ``` / ```json,
 * JSON com chave textual e aspas envolventes; colapsa whitespace para um
 * parágrafo único. Nunca lança — lixo vira `null`.
 */
export function parseBriefingText(content: unknown): string | null {
  if (typeof content !== "string") return null;
  let cleaned = content.trim();
  if (cleaned.length === 0) return null;

  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) cleaned = fence[1].trim();

  // JSON com chave textual (ex.: {"text": "..."}). Falha silenciosa ⇒ texto cru.
  if (cleaned.startsWith("{")) {
    try {
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        const found = TEXT_KEYS.map((k) => parsed[k]).find(
          (v) => typeof v === "string",
        );
        // JSON válido é um contrato: sem chave textual utilizável, é lixo.
        if (typeof found !== "string") return null;
        cleaned = found.trim();
      }
    } catch {
      // não era JSON — segue como texto cru
    }
  }

  // Aspas envolventes (o modelo às vezes cita o próprio parágrafo).
  const quoted = cleaned.match(/^"([\s\S]*)"$/);
  if (quoted) cleaned = quoted[1].trim();

  // Um parágrafo: colapsa qualquer whitespace interno (inclusive \n) em espaço.
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned.length >= MIN_TEXT_LENGTH ? cleaned : null;
}

/** Shape persistido em `app_settings.value` sob a key `daily_briefing`. */
export interface DailyBriefingValue {
  /** Dia BRT coberto pelo briefing, "YYYY-MM-DD". */
  date: string;
  text: string;
  model: string;
  /** ISO timestamp da geração. */
  generated_at: string;
  n_bets: number;
  n_skips: number;
}

export function buildBriefingValue(args: {
  date: string;
  text: string;
  model: string;
  nBets: number;
  nSkips: number;
  now?: Date;
}): DailyBriefingValue {
  return {
    date: args.date,
    text: args.text,
    model: args.model,
    generated_at: (args.now ?? new Date()).toISOString(),
    n_bets: args.nBets,
    n_skips: args.nSkips,
  };
}

function asCount(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Valida o value lido de `app_settings`. `date` + `text` são obrigatórios;
 * o resto degrada pra defaults (tolerância a versões antigas do shape).
 */
export function parseBriefingValue(raw: unknown): DailyBriefingValue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.date !== "string" || o.date.length === 0) return null;
  if (typeof o.text !== "string" || o.text.length === 0) return null;
  return {
    date: o.date,
    text: o.text,
    model: typeof o.model === "string" ? o.model : "",
    generated_at: typeof o.generated_at === "string" ? o.generated_at : "",
    n_bets: asCount(o.n_bets),
    n_skips: asCount(o.n_skips),
  };
}

/** Briefing só vale pro dia que cobre — stale não renderiza. */
export function isBriefingFresh(
  value: DailyBriefingValue,
  todayIsoDate: string,
): boolean {
  return value.date === todayIsoDate;
}

/**
 * Dia BRT (UTC-3 fixo, mesma convenção de scripts/telegram/send-reco-alerts)
 * como "YYYY-MM-DD". O dia vira às 03:00 UTC (meia-noite BRT).
 */
export function brtDateIso(now: Date = new Date()): string {
  const brt = new Date(now.getTime() - 3 * 3600 * 1000);
  const y = brt.getUTCFullYear();
  const m = String(brt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(brt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
