import { describe, it, expect } from "vitest";
import { playerMarketHints } from "./player-market-value";

const probs = { p_goal: 0.35, p_card: 0.12, p_sot: 0.6 };

describe("playerMarketHints", () => {
  it("sem odds → [] (degrada gracioso)", () => {
    expect(playerMarketHints(probs, undefined)).toEqual([]);
    expect(playerMarketHints(probs, {})).toEqual([]);
  });

  it("mapeia ANYTIME_SCORER↔gol, TO_BE_CARDED↔cartão, SOT_0.5↔chute no gol", () => {
    const out = playerMarketHints(probs, {
      ANYTIME_SCORER: 3.0,
      TO_BE_CARDED: 6.0,
      PLAYER_OVER_0_5_SHOTS_ON_TARGET: 1.5,
    });
    expect(out.map((h) => h.market)).toEqual(["gol", "cartão", "chute no gol"]);
  });

  it("prob implícita = 1/odd", () => {
    const [gol] = playerMarketHints(probs, { ANYTIME_SCORER: 4.0 });
    expect(gol.implied).toBeCloseTo(0.25, 6); // 1/4
    expect(gol.odd).toBe(4.0);
    expect(gol.simProb).toBe(0.35);
  });

  it("value=true quando sim supera o implícito com folga (>3pp)", () => {
    // gol: sim 0.35 vs implícito 0.25 (odd 4.0) → folga 10pp > buffer 3pp → valor
    const [gol] = playerMarketHints(probs, { ANYTIME_SCORER: 4.0 });
    expect(gol.value).toBe(true);
  });

  it("value=false quando sim não supera o implícito (ou folga < buffer)", () => {
    // gol: sim 0.35 vs implícito 0.357 (odd 2.8) → sim ABAIXO → sem valor
    const [a] = playerMarketHints(probs, { ANYTIME_SCORER: 2.8 });
    expect(a.value).toBe(false);
    // folga de só 1pp (sim 0.35 vs implícito ~0.34, odd 2.94) < buffer 3pp → sem valor
    const [b] = playerMarketHints(probs, { ANYTIME_SCORER: 2.94 });
    expect(b.value).toBe(false);
  });

  it("pula odd inválida (≤1, NaN, ausente) e prob não-finita", () => {
    expect(playerMarketHints(probs, { ANYTIME_SCORER: 1.0 })).toEqual([]);
    expect(playerMarketHints(probs, { ANYTIME_SCORER: Number.NaN })).toEqual([]);
    expect(
      playerMarketHints(
        { p_goal: Number.NaN, p_card: 0.1, p_sot: 0.5 },
        { ANYTIME_SCORER: 4.0, TO_BE_CARDED: 8.0 },
      ).map((h) => h.market),
    ).toEqual(["cartão"]); // gol pulado (prob NaN), cartão entra
  });

  it("ignora mercados não-mapeados (ex.: FIRST_GOALSCORER, ASSIST)", () => {
    const out = playerMarketHints(probs, {
      FIRST_GOALSCORER: 12,
      ANYTIME_ASSIST: 5,
      ANYTIME_SCORER: 3.0,
    });
    expect(out.map((h) => h.market)).toEqual(["gol"]);
  });
});
