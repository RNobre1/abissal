import { describe, it, expect, beforeEach } from "vitest";
import {
  getLeaguePerformance,
  __resetGlobalCache,
} from "@/lib/calibracao/league-accuracy-repository";

const SIM = {
  home: { corners: { p50: 7 }, cards: { p50: 1 }, sot: { p50: 4 } },
  away: { corners: { p50: 7 }, cards: { p50: 1 }, sot: { p50: 3 } },
};

function rows(n: number, league: string) {
  return Array.from({ length: n }, () => ({
    league,
    sim_stats: SIM,
    p_home: 0.5,
    p_draw: 0.25,
    p_away: 0.25,
    p_over_25: 0.6,
    p_btts: 0.5,
    actual_home_goals: 2,
    actual_away_goals: 1,
    actual_corners_home: 12,
    actual_corners_away: 4,
    actual_cards_home: 2,
    actual_cards_away: 1,
    actual_sot_home: 5,
    actual_sot_away: 4,
    actual_btts: true,
    correct_winner: true,
    kickoff_utc: "2026-07-01T00:00:00Z",
  }));
}

/**
 * Stub mínimo do supabase-js: registra se o filtro por liga foi para o
 * Postgres (o ponto do teste) e devolve a fatia correspondente.
 */
function stub(byLeague: Record<string, unknown[]>, all: unknown[], fail = false) {
  // `table` importa: getDistK também consulta (model_calibration) sem filtro de
  // liga, e contá-la junto mascararia o teste de memoização do agregado global.
  const calls: { table: string; league?: string }[] = [];
  const client = {
    calls,
    from(table: string) {
      let pickedLeague: string | undefined;
      const chain = {
        select: () => chain,
        eq: (col: string, val: string) => {
          if (col === "league") pickedLeague = val;
          return chain;
        },
        is: () => chain,
        not: () => chain,
        limit: () => chain,
        then: (res: (v: unknown) => void) => {
          calls.push({ table, league: pickedLeague });
          const payload = fail
            ? { data: null, error: { message: "boom" } }
            : {
                data: pickedLeague ? (byLeague[pickedLeague] ?? []) : all,
                error: null,
              };
          return Promise.resolve(payload).then(res);
        },
      };
      return chain;
    },
  };
  return client;
}

describe("getLeaguePerformance", () => {
  beforeEach(() => __resetGlobalCache());

  it("usa o número da própria liga quando há chamadas suficientes", async () => {
    const sb = stub({ "Serie B": rows(60, "Serie B") }, rows(200, "X"));
    const out = await getLeaguePerformance("Serie B", "sim-v7", sb);
    expect(out!.tier).toBe("liga");
    expect(out!.league).toBe("Serie B");
    expect(out!.markets.every((m) => m.sampleTier === "liga")).toBe(true);
    expect(out!.markets.length).toBeGreaterThan(0);
  });

  it("cai pro global quando a liga tem menos de 30 chamadas", async () => {
    const sb = stub({ "Liga Pequena": rows(2, "Liga Pequena") }, rows(200, "X"));
    const out = await getLeaguePerformance("Liga Pequena", "sim-v7", sb);
    expect(out!.tier).toBe("global");
    expect(out!.leagueCalls).toBeLessThan(30);
    expect(out!.markets.every((m) => m.sampleTier === "global")).toBe(true);
  });

  it("filtra por liga NO POSTGRES, não em memória", async () => {
    const sb = stub({ "Serie B": rows(60, "Serie B") }, rows(200, "X"));
    await getLeaguePerformance("Serie B", "sim-v7", sb);
    expect(
      sb.calls.some((c) => c.table === "fixture_simulations" && c.league === "Serie B"),
    ).toBe(true);
  });

  it("memoiza o agregado global entre chamadas", async () => {
    const sb = stub({ A: rows(2, "A"), B: rows(2, "B") }, rows(200, "X"));
    await getLeaguePerformance("A", "sim-v7", sb);
    const globais = () =>
      sb.calls.filter(
        (c) => c.table === "fixture_simulations" && c.league === undefined,
      ).length;
    const antes = globais();
    await getLeaguePerformance("B", "sim-v7", sb);
    const depois = globais();
    expect(depois).toBe(antes);
  });

  it("expõe a janela de medição", async () => {
    const sb = stub({ "Serie B": rows(60, "Serie B") }, rows(200, "X"));
    const out = await getLeaguePerformance("Serie B", "sim-v7", sb);
    expect(out!.window.from).toBe("2026-07-01T00:00:00Z");
    expect(out!.window.to).toBe("2026-07-01T00:00:00Z");
  });

  it("devolve null quando não há liga", async () => {
    const sb = stub({}, []);
    expect(await getLeaguePerformance(null, "sim-v7", sb)).toBeNull();
    expect(await getLeaguePerformance("", "sim-v7", sb)).toBeNull();
  });

  it("degrada pra null sem lançar quando a query falha", async () => {
    const sb = stub({}, [], true);
    expect(await getLeaguePerformance("Serie B", "sim-v7", sb)).toBeNull();
  });

  it("não lança quando o cliente explode", async () => {
    const boom = {
      from() {
        throw new Error("conexão morreu");
      },
    };
    expect(await getLeaguePerformance("Serie B", "sim-v7", boom)).toBeNull();
  });
});

/**
 * A página do jogo precisa do MESMO distK que este repositório usa: ela calcula
 * as chamadas do jogo (pra cruzar com o histórico) e alimenta a tabela da
 * simulação. Sem poder injetar, seriam duas idas a `model_calibration` por
 * request — e o Worker deste projeto tem histórico de cair por peso (B12/B21/
 * B23). Injetar também garante que as duas superfícies não divirjam.
 */
describe("getLeaguePerformance · distK injetado", () => {
  beforeEach(() => __resetGlobalCache());

  it("não consulta model_calibration quando o distK vem pronto", async () => {
    const sb = stub({ "Serie B": rows(60, "Serie B") }, rows(200, "X"));
    await getLeaguePerformance("Serie B", "sim-v7", sb, { corners: 1.1 });
    expect(sb.calls.some((c) => c.table === "model_calibration")).toBe(false);
  });

  it("consulta normalmente quando não vem", async () => {
    const sb = stub({ "Serie B": rows(60, "Serie B") }, rows(200, "X"));
    await getLeaguePerformance("Serie B", "sim-v7", sb);
    expect(sb.calls.some((c) => c.table === "model_calibration")).toBe(true);
  });

  it("usa o k injetado no cálculo (não o vazio)", async () => {
    const sb = stub({ "Serie B": rows(60, "Serie B") }, rows(200, "X"));
    // O SIM do fixture projeta 14 escanteios: chama `over` em todas as linhas
    // canônicas (8.5/9.5/10.5). Só um k que derrube a média abaixo delas
    // inverte o lado — k=0.4 leva 14 pra 5.6. (Um k ALTO não provaria nada
    // aqui: já estava over.)
    const semK = await getLeaguePerformance("Serie B", "sim-v7", sb, {});
    const comK = await getLeaguePerformance("Serie B", "sim-v7", sb, { corners: 0.4 });
    const linha = (p: typeof semK) => p!.markets.find((m) => m.market === "corners");
    expect(linha(semK)?.dominantSide).toBe("over");
    expect(linha(comK)?.dominantSide).toBe("under");
  });
});
