import { describe, it, expect } from "vitest";
import { buildPrompt, PROMPT_VERSION, type PromptInput } from "./prompts";

const baseInput: PromptInput = {
  league: "Premier League",
  league_calibrated: true,
  home_team: "Liverpool",
  away_team: "Tottenham",
  kickoff_utc: "2026-05-25T15:00:00Z",
  referee: "Anthony Taylor",
  candidates: [
    { market: "btts", side: "sim", prob_calibrated: 0.64, edge_pct: 12.0, kelly_units: 1.8, odd: 1.75 },
  ],
  context: {
    top_scorelines: [{ score: "2-1", prob: 0.12 }, { score: "1-1", prob: 0.10 }],
    sim_stats_home: { goals: 2.1, corners: 7.2, sot: 5.4 },
    sim_stats_away: { goals: 1.3, corners: 4.8, sot: 3.2 },
    recent_home: "W W D L W (3-1, 2-0, 1-1, 0-2, 1-0)",
    recent_away: "L W L W L (0-1, 2-1, 0-3, 1-0, 0-2)",
    h2h: "Liv 2-1 Tot (2025-11); Tot 0-0 Liv (2025-05); Liv 4-1 Tot (2024-12)",
  },
};

describe("buildPrompt", () => {
  it("PROMPT_VERSION é semver", () => {
    expect(PROMPT_VERSION).toMatch(/^prompt-v\d+\.\d+$/);
  });

  it("retorna {system, user} strings", () => {
    const { system, user } = buildPrompt(baseInput);
    expect(typeof system).toBe("string");
    expect(typeof user).toBe("string");
    expect(system.length).toBeGreaterThan(100);
    expect(user.length).toBeGreaterThan(100);
  });

  it("inclui cap 2.0u no system prompt", () => {
    const { system } = buildPrompt(baseInput);
    expect(system).toMatch(/2\.0u/);
  });

  it("inclui cap 0.5u (liga não-calibrada) no system prompt", () => {
    const { system } = buildPrompt(baseInput);
    expect(system).toMatch(/0\.5u/);
  });

  it("user prompt inclui edge_table formatada", () => {
    const { user } = buildPrompt(baseInput);
    expect(user).toContain("btts");
    expect(user).toMatch(/12\.0|12%/);
    expect(user).toContain("Liverpool");
    expect(user).toContain("Tottenham");
  });

  it("user prompt rotula liga não-calibrada explicitamente", () => {
    const { user } = buildPrompt({ ...baseInput, league_calibrated: false });
    expect(user).toMatch(/N[ÃA]O-calibrada|confian[çc]a baixa/i);
  });

  it("user prompt inclui referee se fornecido", () => {
    const { user } = buildPrompt(baseInput);
    expect(user).toContain("Anthony Taylor");
  });

  it("user prompt usa '—' quando referee ausente", () => {
    const { user } = buildPrompt({ ...baseInput, referee: null });
    expect(user).toMatch(/[Áa]rbitro:\s*—/);
  });

  it("inclui instrução explícita 'não invente'", () => {
    const { system, user } = buildPrompt(baseInput);
    expect((system + user).toLowerCase()).toMatch(/n[ãa]o invente|n[ãa]o inventar/i);
  });

  it("inclui descrição do schema JSON esperado", () => {
    const { system } = buildPrompt(baseInput);
    expect(system).toMatch(/verdict[\s\S]*bet[\s\S]*skip/i);
    expect(system).toContain("market");
    expect(system).toContain("units_final");
  });

  // ── Wave O+E: mercados secundários no prompt ───────────────────────────────

  it("schema JSON inclui mercados secundários (corners, cards, sot)", () => {
    const { system } = buildPrompt(baseInput);
    expect(system).toContain("corners-over");
    expect(system).toContain("cards-over");
    expect(system).toContain("sot-over");
  });

  it("candidato corners-over aparece na edge table formatada", () => {
    const inputWithCorners: PromptInput = {
      ...baseInput,
      candidates: [
        { market: "corners-over", side: "95", prob_calibrated: 0.62, edge_pct: 17.5, kelly_units: 0.8, odd: 1.90 },
      ],
    };
    const { user } = buildPrompt(inputWithCorners);
    expect(user).toContain("corners-over");
    expect(user).toContain("95");
    expect(user).toMatch(/17\.5|17%/);
  });

  it("candidato cards-over aparece na edge table formatada", () => {
    const inputWithCards: PromptInput = {
      ...baseInput,
      candidates: [
        { market: "cards-over", side: "45", prob_calibrated: 0.58, edge_pct: 14.2, kelly_units: 0.6, odd: 1.85 },
      ],
    };
    const { user } = buildPrompt(inputWithCards);
    expect(user).toContain("cards-over");
    expect(user).toContain("45");
  });

  it("heurísticas contextuais incluídas no system prompt (corners, cards, sot)", () => {
    const { system } = buildPrompt(baseInput);
    // Heurísticas devem guiar o R1 quando tomar decisões sobre mercados secundários
    expect(system.toLowerCase()).toMatch(/corner|cantos/i);
    expect(system.toLowerCase()).toMatch(/cart[aã]o|card/i);
  });

  it("PROMPT_VERSION bumpeado para prompt-v1.1 após Wave O+E", () => {
    expect(PROMPT_VERSION).toBe("prompt-v1.1");
  });
});
