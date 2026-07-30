/**
 * F2 — "Advogado do diabo do bilhete": lib pura (sem I/O, sem React).
 *
 * Responsabilidades:
 *  - normalizar mercado/lado das pernas do bilhete pro vocabulário do
 *    `lib/ai-reco/edge-calculator.ts` (fonte única de mercado/side);
 *  - montar o OddsInput de UMA perna (a odd vem do usuário, não do banco —
 *    o edge da perna é prob calibrada × odd informada − 1);
 *  - montar o prompt do crítico (system com os fatos MEDIDOS do modelo);
 *  - parsear a resposta JSON do LLM de forma robusta (nunca lança).
 *
 * Motivação (memória 09/06): os bilhetes de 01-02/06 foram todos RED, 5/7
 * furos em pernas 1x2 por EMPATE (empate real 26,8% vs 23,7% previsto —
 * viés conhecido do modelo, +3,1pp). O guardrail existia só numa skill de
 * terminal; este módulo o traz pro produto.
 */
import type { Market, OddsInput, Side } from "@/lib/ai-reco/edge-calculator";
import type { MarketAccuracy } from "@/lib/calibracao/market-accuracy";

export const CRITIC_PROMPT_VERSION = "bilhete-critic-v1";

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface NormalizedLegMarket {
  market: Market;
  side: Side;
}

/** Contexto do NOSSO modelo pra uma perna; `null` = sem dados do modelo. */
export interface CriticLegModel {
  probCalibrated: number | null;
  edgePct: number | null;
  leagueCalibrated: boolean;
  league: string | null;
  accuracyLine: string | null;
}

export interface CriticLegContext {
  home: string;
  away: string;
  market: string;
  side: string;
  odd: number;
  model: CriticLegModel | null;
}

export type CriticVerdict = "ok" | "atencao" | "fuga";

export interface CriticLegVerdict {
  verdict: CriticVerdict;
  why: string;
}

export interface CriticOverall {
  summary: string;
  correlation_flags: string[];
  ev_comment: string;
}

export interface CriticResult {
  legs: CriticLegVerdict[];
  overall: CriticOverall;
}

// ── Normalização de mercado/lado ────────────────────────────────────────────

const SIDE_ALIASES: Record<string, Side> = {
  home: "home",
  casa: "home",
  "1": "home",
  draw: "draw",
  empate: "draw",
  x: "draw",
  away: "away",
  fora: "away",
  "2": "away",
};

const BTTS_ALIASES: Record<string, Side> = {
  sim: "sim",
  yes: "sim",
  nao: "nao",
  não: "nao",
  no: "nao",
};

/** Linhas canônicas por família — as MESMAS do edge-calculator. */
const SECONDARY_LINES: Record<string, readonly string[]> = {
  corners: ["85", "95", "105"],
  cards: ["35", "45", "55"],
  sot: ["75", "95", "105"],
};

/**
 * Normaliza `(market, side)` livres (bet slip / OCR) pro vocabulário do
 * edge-calculator. Devolve `null` quando não há mapeamento — a perna segue
 * pro prompt como "sem dados do modelo".
 */
export function normalizeLegMarket(
  market: string,
  side: string,
): NormalizedLegMarket | null {
  const m = market.trim().toLowerCase();
  const s = side.trim().toLowerCase();

  if (m === "1x2" || m === "result" || m === "resultado") {
    const mapped = SIDE_ALIASES[s];
    return mapped ? { market: "1x2", side: mapped } : null;
  }

  if (m === "over25" || m === "over/under 2.5" || m === "over_under_25") {
    if (s === "over" || s === "mais") return { market: "over25", side: "over" };
    if (s === "under" || s === "menos") return { market: "over25", side: "under" };
    return null;
  }

  if (m === "btts" || m === "ambos marcam") {
    const mapped = BTTS_ALIASES[s];
    return mapped ? { market: "btts", side: mapped } : null;
  }

  // Secundários: corners-over/under, cards-over/under, sot-over/under com a
  // linha no side ("9.5" ou "95").
  const secMatch = m.match(/^(corners|cards|sot)-(over|under)$/);
  if (secMatch) {
    const family = secMatch[1] as keyof typeof SECONDARY_LINES;
    const line = s.replace(".", "");
    if (!SECONDARY_LINES[family].includes(line)) return null;
    return { market: m as Market, side: line as Side };
  }

  return null;
}

/**
 * OddsInput com SOMENTE a chave da perna — o edge-calculator ignora mercados
 * sem odd, então a edge table resultante tem exatamente o candidato da perna.
 * Sem blending aqui (blendAlpha default 1.0): com uma odd só não existe devig
 * honesto do mercado; o edge é prob calibrada × odd do usuário.
 */
export function buildLegOdds(leg: NormalizedLegMarket, odd: number): OddsInput {
  const { market, side } = leg;
  if (market === "1x2") {
    if (side === "home") return { home: odd };
    if (side === "draw") return { draw: odd };
    return { away: odd };
  }
  if (market === "over25") {
    return side === "over" ? { over25: odd } : { under25: odd };
  }
  if (market === "btts") {
    return side === "sim" ? { btts_sim: odd } : { btts_nao: odd };
  }
  // Secundários: chave `${stat}_${over|under}_${linha}`.
  const [stat, dir] = market.split("-");
  const key = `${stat}_${dir}_${side}` as keyof OddsInput;
  return { [key]: odd } as OddsInput;
}

// ── Histórico por mercado ───────────────────────────────────────────────────

const MARKET_TO_ACCURACY: Record<string, string> = {
  "1x2": "1x2",
  over25: "goals",
  btts: "btts",
  "corners-over": "corners",
  "corners-under": "corners",
  "cards-over": "cards",
  "cards-under": "cards",
  "sot-over": "sot",
  "sot-under": "sot",
};

/**
 * Linha compacta de histórico real do mercado (de `market-accuracy.ts`) pra
 * entrar no prompt. `null` quando o mercado não tem medição.
 */
export function accuracyLineFor(
  markets: MarketAccuracy[],
  market: Market,
): string | null {
  const key = MARKET_TO_ACCURACY[market];
  if (!key) return null;
  const acc = markets.find((m) => m.market === key);
  if (!acc) return null;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const lift = acc.lift >= 0 ? `+${(acc.lift * 100).toFixed(1)}` : (acc.lift * 100).toFixed(1);
  return (
    `${acc.label}: acerto ${pct(acc.rate)} (n=${acc.calls}, ` +
    `base ${pct(acc.baseRate)}, lift ${lift}pp, amostra ${acc.sampleTier})`
  );
}

// ── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM = `Você é o ADVOGADO DO DIABO de bilhetes de aposta múltipla. Sua tarefa é criticar cada perna contra a NOSSA simulação calibrada e o histórico real de acerto — não é vender o bilhete, é achar onde ele fura.

Fatos MEDIDOS do nosso modelo (use-os, não invente outros):
- Viés de EMPATE no 1x2: o empate real acontece +3,1pp acima do que o modelo prevê. Pernas 1x2 em favoritos moderados furam por empate com frequência (5 de 7 furos dos últimos bilhetes RED foram assim).
- corners-under: historicamente ROI negativo nas nossas apostas — desconfie por padrão.
- BTTS: o modelo NÃO tem skill medida (acerto abaixo da taxa-base) — confiança baixa.
- Liga não-calibrada (league_calibrated=false): probabilidade com ruído alto — confiança baixa mesmo com edge aparente.
- Perna marcada "sem dados do modelo": não há simulação nossa; critique qualitativamente e deixe claro que não há número.

Regras da crítica:
- Multiplicativa: cada perna extra multiplica o risco. Aponte correlações entre pernas (mesmo jogo, mesmo tipo de mercado, mesma tese) — elas reduzem a diversificação real.
- Edge negativo vs a nossa prob calibrada é sinal forte de "fuga".
- Não invente fatos fora do contexto fornecido.

Responda SOMENTE com um JSON válido do schema (uma entrada em "legs" POR PERNA, NA MESMA ORDEM):
{
  "legs": [{ "verdict": "ok" | "atencao" | "fuga", "why": "1-2 frases" }],
  "overall": {
    "summary": "veredicto do bilhete em 1-3 frases",
    "correlation_flags": ["correlações/duplicidades encontradas"],
    "ev_comment": "comentário sobre o EV combinado"
  }
}`;

export interface CriticPromptInput {
  legs: CriticLegContext[];
  stakeTotal?: number | null;
  oddCombined?: number | null;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtEdge(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function legBlock(leg: CriticLegContext, idx: number): string {
  const head = `PERNA ${idx + 1}: ${leg.home} × ${leg.away} — ${leg.market}/${leg.side} @ ${leg.odd.toFixed(2)}`;
  if (!leg.model) {
    return `${head}\n  SEM DADOS DO MODELO — sem simulação pra este jogo; critique qualitativamente.`;
  }
  const m = leg.model;
  const lines = [head];
  lines.push(
    `  prob calibrada (nosso modelo): ${
      m.probCalibrated != null ? fmtPct(m.probCalibrated) : "—"
    } | edge vs odd informada: ${m.edgePct != null ? fmtEdge(m.edgePct) : "—"}`,
  );
  lines.push(
    `  liga: ${m.league ?? "?"} (${m.leagueCalibrated ? "calibrada" : "NÃO calibrada"})`,
  );
  lines.push(
    `  histórico real do mercado: ${m.accuracyLine ?? "sem histórico suficiente"}`,
  );
  return lines.join("\n");
}

export function buildCriticPrompt(input: CriticPromptInput): {
  system: string;
  user: string;
} {
  const header: string[] = [
    `# Bilhete múltipla — ${input.legs.length} perna(s)`,
  ];
  if (typeof input.oddCombined === "number" && Number.isFinite(input.oddCombined)) {
    header.push(`Odd combinada: ${input.oddCombined.toFixed(2)}`);
  }
  if (typeof input.stakeTotal === "number" && Number.isFinite(input.stakeTotal)) {
    header.push(`Valor total apostado: R$ ${input.stakeTotal.toFixed(2)}`);
  }

  const blocks = input.legs.map((leg, i) => legBlock(leg, i));

  const user = [
    header.join("\n"),
    "",
    blocks.join("\n\n"),
    "",
    "Critique perna a perna e o bilhete como um todo. Responda só o JSON.",
  ].join("\n");

  return { system: SYSTEM, user };
}

// ── Parse da resposta do LLM ────────────────────────────────────────────────

const VERDICTS = new Set<CriticVerdict>(["ok", "atencao", "fuga"]);

function normalizeVerdict(raw: unknown): CriticVerdict | null {
  if (typeof raw !== "string") return null;
  const v = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return VERDICTS.has(v as CriticVerdict) ? (v as CriticVerdict) : null;
}

function extractJson(content: string): unknown | null {
  let cleaned = content.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) cleaned = fence[1].trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through — tenta o primeiro bloco { ... }
  }
  const block = cleaned.match(/\{[\s\S]*\}/);
  if (!block) return null;
  try {
    return JSON.parse(block[0]);
  } catch {
    return null;
  }
}

/**
 * Parse robusto da resposta do crítico. Regras:
 *  - JSON cru, fenced ou embutido em prosa;
 *  - `legs` precisa ter PELO MENOS `legCount` entradas válidas (excedentes
 *    são cortadas — o LLM às vezes ecoa uma extra); menos que isso é resposta
 *    inválida (não dá pra atribuir veredicto por perna);
 *  - verdict normalizado sem acento ("atenção" → "atencao");
 *  - `overall.summary` é obrigatório; flags/ev_comment defaultam vazios.
 * Nunca lança; null = inválido (caller devolve erro limpo).
 */
export function parseCriticResponse(
  content: string,
  legCount: number,
): CriticResult | null {
  if (!content || typeof content !== "string") return null;
  const raw = extractJson(content);
  if (!raw || typeof raw !== "object") return null;

  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.legs)) return null;

  const legs: CriticLegVerdict[] = [];
  for (const item of obj.legs.slice(0, legCount)) {
    if (!item || typeof item !== "object") return null;
    const verdict = normalizeVerdict((item as Record<string, unknown>).verdict);
    const why = (item as Record<string, unknown>).why;
    if (!verdict || typeof why !== "string" || why.length === 0) return null;
    legs.push({ verdict, why });
  }
  if (legs.length !== legCount) return null;

  const overallRaw = obj.overall;
  if (!overallRaw || typeof overallRaw !== "object") return null;
  const o = overallRaw as Record<string, unknown>;
  if (typeof o.summary !== "string" || o.summary.length === 0) return null;

  const flags = Array.isArray(o.correlation_flags)
    ? o.correlation_flags.filter((f): f is string => typeof f === "string")
    : [];

  return {
    legs,
    overall: {
      summary: o.summary,
      correlation_flags: flags,
      ev_comment: typeof o.ev_comment === "string" ? o.ev_comment : "",
    },
  };
}
