/**
 * F4 — Briefing matinal ("Abissal Daily"): núcleo puro.
 *
 * `lib/briefing/compose.ts` é o núcleo SEM I/O do gerador de briefing:
 *  - monta o prompt {system, user} a partir dos dados do dia (recos bet,
 *    contagem de skips, ligas não-calibradas, acerto por mercado);
 *  - parse tolerante da resposta do LLM (fence, JSON, texto cru);
 *  - forma/validação do value persistido em app_settings.daily_briefing.
 *
 * O prompt DEVE conter os números reais — o briefing não pode inventar nada
 * fora dos dados, então tudo que ele pode citar precisa estar no user prompt.
 */
import { describe, it, expect } from "vitest";
import {
  DAILY_BRIEFING_KEY,
  composeBriefingPrompt,
  parseBriefingText,
  buildBriefingValue,
  parseBriefingValue,
  isBriefingFresh,
  brtDateIso,
  type BriefingInput,
} from "@/lib/briefing/compose";

const INPUT: BriefingInput = {
  dateLabel: "30/07",
  bets: [
    {
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      league: "Premier League",
      market: "1x2",
      side: "home",
      edgePct: 12.3,
      oddCaptured: 1.85,
      unitsFinal: 0.5,
      confidence: "medio",
      leagueCalibrated: true,
    },
    {
      homeTeam: "Kolding IF",
      awayTeam: "Viborg",
      league: "1. Division",
      market: "corners",
      side: "over",
      edgePct: 8.1,
      oddCaptured: 1.9,
      unitsFinal: 0.1,
      confidence: "baixo",
      leagueCalibrated: false,
    },
  ],
  skipCount: 14,
  accuracies: [
    { label: "escanteios · menos de 9.5", rate: 0.62, baseRate: 0.55, calls: 120 },
    { label: "resultado (1x2)", rate: 0.41, baseRate: 1 / 3, calls: 300 },
  ],
};

describe("composeBriefingPrompt", () => {
  it("user prompt contém os números do dia (times, edge, odd, skips)", () => {
    const { user } = composeBriefingPrompt(INPUT);
    expect(user).toContain("30/07");
    expect(user).toContain("Arsenal");
    expect(user).toContain("Chelsea");
    expect(user).toContain("+12.3%");
    expect(user).toContain("@1.85");
    expect(user).toContain("Kolding IF");
    expect(user).toMatch(/14/); // skips
  });

  it("user prompt marca quantas apostas caíram em liga NÃO-calibrada", () => {
    const { user } = composeBriefingPrompt(INPUT);
    expect(user).toMatch(/1 de 2/); // 1 das 2 bets em liga não-calibrada
    expect(user).toMatch(/não[- ]calibrada/i);
  });

  it("user prompt inclui o acerto por mercado com taxa, base e amostra", () => {
    const { user } = composeBriefingPrompt(INPUT);
    expect(user).toContain("escanteios · menos de 9.5");
    expect(user).toMatch(/62(\.0)?%/);
    expect(user).toMatch(/55(\.0)?%/);
    expect(user).toMatch(/n=120/);
  });

  it("system prompt exige PT-BR, 100-140 palavras e proíbe inventar dados", () => {
    const { system } = composeBriefingPrompt(INPUT);
    expect(system).toMatch(/100/);
    expect(system).toMatch(/140/);
    expect(system).toMatch(/português|PT-BR/i);
    expect(system).toMatch(/invent/i); // "não invente" / "nunca inventar"
  });

  it("sem apostas: user prompt diz que não há oportunidade e mantém os skips", () => {
    const { user } = composeBriefingPrompt({ ...INPUT, bets: [] });
    expect(user).toMatch(/nenhuma/i);
    expect(user).toMatch(/14/);
  });

  it("sem dados de acerto: sinaliza indisponibilidade em vez de omitir a seção", () => {
    const { user } = composeBriefingPrompt({ ...INPUT, accuracies: [] });
    expect(user).toMatch(/sem dados/i);
  });
});

describe("parseBriefingText", () => {
  const LONG = "Três oportunidades hoje, mas duas em ligas não-calibradas — cautela extra nelas.";

  it("texto cru passa (trim)", () => {
    expect(parseBriefingText(`  ${LONG}  `)).toBe(LONG);
  });

  it("tolera fence ```json com objeto {text}", () => {
    const raw = "```json\n" + JSON.stringify({ text: LONG }) + "\n```";
    expect(parseBriefingText(raw)).toBe(LONG);
  });

  it("tolera fence ``` sem json com texto puro", () => {
    expect(parseBriefingText("```\n" + LONG + "\n```")).toBe(LONG);
  });

  it("tolera JSON solto com chave briefing", () => {
    expect(parseBriefingText(JSON.stringify({ briefing: LONG }))).toBe(LONG);
  });

  it("colapsa quebras de linha internas — o briefing é UM parágrafo", () => {
    expect(parseBriefingText("linha um do briefing\ncom continuação na linha dois")).toBe(
      "linha um do briefing com continuação na linha dois",
    );
  });

  it("remove aspas envolventes", () => {
    expect(parseBriefingText(`"${LONG}"`)).toBe(LONG);
  });

  it("vazio, curto demais ou não-string ⇒ null", () => {
    expect(parseBriefingText("")).toBeNull();
    expect(parseBriefingText("   \n ")).toBeNull();
    expect(parseBriefingText("ok.")).toBeNull();
    expect(parseBriefingText(JSON.stringify({ text: 42 }))).toBeNull();
  });
});

describe("value de app_settings.daily_briefing", () => {
  it("buildBriefingValue monta o shape {date, text, model, generated_at, n_bets, n_skips}", () => {
    const v = buildBriefingValue({
      date: "2026-07-30",
      text: "Um briefing honesto sobre o dia de hoje nas ligas calibradas.",
      model: "deepseek/deepseek-v3.2",
      nBets: 3,
      nSkips: 14,
      now: new Date("2026-07-30T10:50:00Z"),
    });
    expect(v).toEqual({
      date: "2026-07-30",
      text: "Um briefing honesto sobre o dia de hoje nas ligas calibradas.",
      model: "deepseek/deepseek-v3.2",
      generated_at: "2026-07-30T10:50:00.000Z",
      n_bets: 3,
      n_skips: 14,
    });
  });

  it("parseBriefingValue aceita o shape completo e defaults tolerantes", () => {
    const full = parseBriefingValue({
      date: "2026-07-30",
      text: "Texto do briefing do dia, longo o bastante pra valer.",
      model: "m",
      generated_at: "2026-07-30T10:50:00.000Z",
      n_bets: 3,
      n_skips: 14,
    });
    expect(full?.date).toBe("2026-07-30");
    expect(full?.n_bets).toBe(3);

    const minimal = parseBriefingValue({
      date: "2026-07-30",
      text: "Texto mínimo válido do briefing matinal de hoje.",
    });
    expect(minimal).not.toBeNull();
    expect(minimal?.n_bets).toBe(0);
    expect(minimal?.n_skips).toBe(0);
  });

  it("parseBriefingValue rejeita lixo (null, sem text, date não-string)", () => {
    expect(parseBriefingValue(null)).toBeNull();
    expect(parseBriefingValue("str")).toBeNull();
    expect(parseBriefingValue({ date: "2026-07-30" })).toBeNull();
    expect(parseBriefingValue({ date: 20260730, text: "briefing válido qualquer" })).toBeNull();
  });

  it("isBriefingFresh compara a data BRT do value com a de hoje", () => {
    const v = buildBriefingValue({
      date: "2026-07-30",
      text: "x".repeat(30),
      model: "m",
      nBets: 0,
      nSkips: 0,
    });
    expect(isBriefingFresh(v, "2026-07-30")).toBe(true);
    expect(isBriefingFresh(v, "2026-07-31")).toBe(false);
  });

  it("brtDateIso vira o dia às 03:00 UTC (meia-noite BRT)", () => {
    expect(brtDateIso(new Date("2026-07-30T02:59:00Z"))).toBe("2026-07-29");
    expect(brtDateIso(new Date("2026-07-30T03:00:00Z"))).toBe("2026-07-30");
  });

  it("chave canônica exportada", () => {
    expect(DAILY_BRIEFING_KEY).toBe("daily_briefing");
  });
});
