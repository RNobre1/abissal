/**
 * `sim_stats` copiado LITERALMENTE de uma linha de `fixture_simulations` em
 * produção (2026-07-29). Não editar à mão: é a defesa contra a classe de bug
 * "código lê uma chave que o produtor nunca gravou" — a mesma que deixou
 * `sotCrps()` devolvendo null desde que foi escrito.
 *
 * Note a chave `sot` (NÃO `shots_on_target`) e a presença de fouls/tackles/
 * offsides, que não têm linha de mercado.
 *
 * Ver docs/pesquisas/auditoria-shape-produtor-consumidor.md.
 */
export const REAL_SIM_STATS = {
  away: {
    sot: { p10: 0, p50: 2, p90: 4 },
    cards: { p10: 0, p50: 2, p90: 4 },
    fouls: { p10: 3, p50: 10, p90: 22 },
    goals: { p10: 0, p50: 1, p90: 3 },
    corners: {
      p10: 3,
      p50: 6,
      p90: 10,
      p10_1h: 0,
      p10_2h: 0,
      p50_1h: 0,
      p50_2h: 0,
      p90_1h: 0,
      p90_2h: 0,
    },
    tackles: { p10: 1, p50: 4, p90: 11 },
    offsides: { p10: 0, p50: 1, p90: 3 },
  },
  home: {
    sot: { p10: 2, p50: 5, p90: 8 },
    cards: { p10: 0, p50: 1, p90: 4 },
    fouls: { p10: 3, p50: 10, p90: 22 },
    goals: { p10: 0, p50: 1, p90: 3 },
    corners: {
      p10: 3,
      p50: 6,
      p90: 10,
      p10_1h: 0,
      p10_2h: 0,
      p50_1h: 0,
      p50_2h: 0,
      p90_1h: 0,
      p90_2h: 0,
    },
    tackles: { p10: 1, p50: 4, p90: 11 },
    offsides: { p10: 0, p50: 1, p90: 3 },
  },
} as const;
