import { describe, it, expect, vi } from "vitest";
import {
  runRecommender,
  enforceCaps,
  applySanityGuard,
  parseDecision,
  type AiDecision,
} from "./recommender";

const validDecisionJson = JSON.stringify({
  verdict: "bet",
  market: "btts",
  side: "sim",
  prob_estimated: 0.64,
  units_final: 1.5,
  kelly_pre: 1.8,
  reduction_reason: "lineup incerta",
  confidence: "medio",
  summary_line: "BTTS · 1.5u · 64%",
  reasoning: "Liverpool teve 5 BTTS consecutivos em casa. Tottenham concedeu pelo menos 1 gol em 8/10 visitas. Árbitro permissivo.",
  red_flags: ["3 desfalques no ataque do TOT"],
});

describe("parseDecision", () => {
  it("parseia JSON válido", () => {
    const d = parseDecision(validDecisionJson);
    expect(d).not.toBeNull();
    expect(d!.verdict).toBe("bet");
    expect(d!.market).toBe("btts");
    expect(d!.units_final).toBe(1.5);
  });

  it("aceita JSON envolto em markdown ```json fence", () => {
    const wrapped = "```json\n" + validDecisionJson + "\n```";
    const d = parseDecision(wrapped);
    expect(d!.verdict).toBe("bet");
  });

  it("aceita JSON com texto antes/depois (extrai bloco)", () => {
    const noisy = `Aqui está minha análise:\n${validDecisionJson}\nFim.`;
    const d = parseDecision(noisy);
    expect(d!.verdict).toBe("bet");
  });

  it("retorna null pra JSON inválido (defensivo)", () => {
    expect(parseDecision("não é json")).toBeNull();
    expect(parseDecision("{ broken }")).toBeNull();
    expect(parseDecision("")).toBeNull();
  });

  it("retorna null se faltar 'verdict' (schema mínimo)", () => {
    expect(parseDecision('{"market":"btts"}')).toBeNull();
  });

  it("aceita verdict='skip' sem market/side/units", () => {
    const skipJson = '{"verdict":"skip","reasoning":"sem valor","confidence":"medio","red_flags":[]}';
    const d = parseDecision(skipJson);
    expect(d!.verdict).toBe("skip");
  });
});

describe("enforceCaps", () => {
  it("cap 2.0u liga calibrada", () => {
    const d: AiDecision = { ...JSON.parse(validDecisionJson), units_final: 2.5 };
    expect(enforceCaps(d, true).units_final).toBe(2.0);
  });

  it("cap 0.5u liga não-calibrada", () => {
    const d: AiDecision = { ...JSON.parse(validDecisionJson), units_final: 1.5 };
    expect(enforceCaps(d, false).units_final).toBe(0.5);
  });

  it("não mexe quando units já abaixo do cap", () => {
    const d: AiDecision = { ...JSON.parse(validDecisionJson), units_final: 0.8 };
    expect(enforceCaps(d, true).units_final).toBe(0.8);
  });

  it("verdict='skip' não tem units pra cappear (passa through)", () => {
    const d: AiDecision = { verdict: "skip", confidence: "medio", reasoning: "sem valor" };
    expect(enforceCaps(d, true).verdict).toBe("skip");
  });
});

describe("applySanityGuard", () => {
  it("força skip quando edge>30 + bet + liga NÃO calibrada", () => {
    const d: AiDecision = {
      verdict: "bet",
      market: "btts",
      side: "sim",
      units_final: 0.5,
      prob_estimated: 0.7,
      confidence: "alto",
    };
    const guarded = applySanityGuard(d, { edgePct: 50, leagueCalibrated: false });
    expect(guarded.verdict).toBe("skip");
    expect(guarded.reduction_reason).toBe("edge_suspect_high_in_uncalibrated_league");
    expect(guarded.units_final).toBe(0);
  });

  it("preserva bet quando edge>30 mas liga CALIBRADA", () => {
    const d: AiDecision = {
      verdict: "bet",
      market: "btts",
      side: "sim",
      units_final: 1.5,
      prob_estimated: 0.7,
      confidence: "alto",
    };
    const guarded = applySanityGuard(d, { edgePct: 50, leagueCalibrated: true });
    expect(guarded.verdict).toBe("bet");
    expect(guarded.units_final).toBe(1.5);
    expect(guarded.reduction_reason).not.toBe("edge_suspect_high_in_uncalibrated_league");
  });

  it("preserva bet quando edge<=30 em liga não-calibrada (sob threshold)", () => {
    const d: AiDecision = {
      verdict: "bet",
      market: "btts",
      side: "sim",
      units_final: 0.4,
      prob_estimated: 0.55,
      confidence: "medio",
    };
    const guarded = applySanityGuard(d, { edgePct: 20, leagueCalibrated: false });
    expect(guarded.verdict).toBe("bet");
    expect(guarded.units_final).toBe(0.4);
  });

  it("não mexe em verdict=skip", () => {
    const d: AiDecision = { verdict: "skip", confidence: "baixo", reasoning: "noop" };
    const guarded = applySanityGuard(d, { edgePct: 99, leagueCalibrated: false });
    expect(guarded.verdict).toBe("skip");
    expect(guarded.reduction_reason).toBeUndefined();
  });

  it("threshold é > 30 (exato 30 ainda passa)", () => {
    const d: AiDecision = {
      verdict: "bet",
      market: "btts",
      side: "sim",
      units_final: 0.5,
      prob_estimated: 0.6,
      confidence: "alto",
    };
    const guarded = applySanityGuard(d, { edgePct: 30, leagueCalibrated: false });
    expect(guarded.verdict).toBe("bet");
  });

  it("aplica em edge=30.01 (logo acima)", () => {
    const d: AiDecision = {
      verdict: "bet",
      market: "btts",
      side: "sim",
      units_final: 0.5,
      prob_estimated: 0.6,
      confidence: "alto",
    };
    const guarded = applySanityGuard(d, { edgePct: 30.01, leagueCalibrated: false });
    expect(guarded.verdict).toBe("skip");
  });

  it("edgePct ausente/inválido: passa through (sem decisão de guard)", () => {
    const d: AiDecision = {
      verdict: "bet",
      market: "btts",
      side: "sim",
      units_final: 0.5,
      prob_estimated: 0.6,
      confidence: "alto",
    };
    expect(applySanityGuard(d, { leagueCalibrated: false }).verdict).toBe("bet");
    expect(applySanityGuard(d, { edgePct: NaN, leagueCalibrated: false }).verdict).toBe("bet");
    expect(applySanityGuard(d, { edgePct: null, leagueCalibrated: false }).verdict).toBe("bet");
  });
});

describe("runRecommender + sanity guard", () => {
  it("força skip quando IA retorna bet com edge>30 em liga não-calibrada", async () => {
    const betJson = JSON.stringify({
      verdict: "bet",
      market: "btts",
      side: "sim",
      prob_estimated: 0.7,
      units_final: 0.4,
      kelly_pre: 1.0,
      reduction_reason: null,
      confidence: "alto",
      summary_line: "BTTS",
      reasoning: "...",
      red_flags: [],
    });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: betJson } }],
        usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
      }),
    });
    const result = await runRecommender(
      { system: "s", user: "u" },
      {
        model: "deepseek/deepseek-r1",
        apiKey: "t",
        leagueCalibrated: false,
        edgePct: 114,
        fetchImpl: mockFetch as any,
      },
    );
    expect(result.ok).toBe(true);
    expect(result.decision!.verdict).toBe("skip");
    expect(result.decision!.reduction_reason).toBe("edge_suspect_high_in_uncalibrated_league");
  });
});

describe("runRecommender", () => {
  it("retorna AiDecision quando OpenRouter responde com JSON válido", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: validDecisionJson } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
        model: "deepseek/deepseek-r1",
      }),
    });
    const result = await runRecommender(
      { system: "sys", user: "usr" },
      { model: "deepseek/deepseek-r1", apiKey: "test", leagueCalibrated: true, fetchImpl: mockFetch as any },
    );
    expect(result.ok).toBe(true);
    expect(result.decision!.verdict).toBe("bet");
    expect(result.usage!.total_tokens).toBe(1200);
  });

  it("aplica enforceCaps no resultado", async () => {
    const overCapJson = JSON.stringify({
      verdict: "bet", market: "btts", side: "sim",
      prob_estimated: 0.7, units_final: 3.0, kelly_pre: 3.0, reduction_reason: null,
      confidence: "alto", summary_line: "BTTS 3.0u", reasoning: "...", red_flags: [],
    });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: overCapJson } }],
        usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
      }),
    });
    const result = await runRecommender(
      { system: "s", user: "u" },
      { model: "deepseek/deepseek-r1", apiKey: "t", leagueCalibrated: true, fetchImpl: mockFetch as any },
    );
    expect(result.decision!.units_final).toBe(2.0); // cap aplicado
  });

  it("retorna ok=false quando OpenRouter retorna não-200", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal error",
    });
    const result = await runRecommender(
      { system: "s", user: "u" },
      { model: "deepseek/deepseek-r1", apiKey: "t", leagueCalibrated: true, fetchImpl: mockFetch as any },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
  });

  it("retorna ok=false quando JSON inválido (degrada gracioso)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "isso não é JSON" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
    });
    const result = await runRecommender(
      { system: "s", user: "u" },
      { model: "deepseek/deepseek-r1", apiKey: "t", leagueCalibrated: true, fetchImpl: mockFetch as any },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/parse|JSON|schema/i);
  });
});
