import { describe, it, expect } from "vitest";
import { cornersCrps, cardsCrps, sotCrps } from "./sim-reliability";
import { REAL_SIM_STATS } from "./market-accuracy.fixtures";
import type { ResolvedSimRowSecondary } from "./sim-reliability";

/**
 * Regressão do bug de shape (auditoria 2026-07-29): `sotCrps` lia
 * `sim_stats.*.shots_on_target`, mas o produtor grava `sot`
 * (ai_recommender_runner.rb:488). O acesso devolvia undefined, a função
 * degradava pra null, e a métrica de finalizações no alvo em /calibracao ficou
 * vazia desde que foi escrita — sem erro, sem log, sem teste vermelho.
 *
 * A fixture vem de uma linha REAL de produção justamente pra travar isso.
 */
function resolvedRow(): ResolvedSimRowSecondary {
  return {
    league: "Serie B",
    sim_stats: REAL_SIM_STATS,
    p_home: 0.4,
    p_draw: 0.3,
    p_away: 0.3,
    p_over_25: 0.5,
    p_btts: 0.5,
    market_anchor: null,
    actual_home_goals: 1,
    actual_away_goals: 1,
    actual_resolved_at: "2026-07-01T00:00:00Z",
    actual_btts: true,
    actual_corners_home: 6,
    actual_corners_away: 5,
    actual_cards_home: 2,
    actual_cards_away: 1,
    actual_sot_home: 4,
    actual_sot_away: 3,
  };
}

describe("CRPS dos mercados secundários contra o shape real", () => {
  it("corners produz número", () => {
    expect(cornersCrps([resolvedRow()])).not.toBeNull();
  });

  it("cards produz número", () => {
    expect(cardsCrps([resolvedRow()])).not.toBeNull();
  });

  it("sot produz número (regressão: lia shots_on_target)", () => {
    expect(sotCrps([resolvedRow()])).not.toBeNull();
  });

  it("os três degradam pra null quando o actual falta", () => {
    const semActual = {
      ...resolvedRow(),
      actual_corners_home: null,
      actual_cards_home: null,
      actual_sot_home: null,
    };
    expect(cornersCrps([semActual])).toBeNull();
    expect(cardsCrps([semActual])).toBeNull();
    expect(sotCrps([semActual])).toBeNull();
  });
});
