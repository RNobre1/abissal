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

/**
 * REGRESSÃO 2026-07-30 (revisão por personas) — a medição precisa ser de UM
 * motor só.
 *
 * `fetchRows` recebia `modelVersion` mas só o usava pra buscar o `distK`; a
 * query principal nunca filtrava por versão. Como `fixture_simulations` guarda
 * versões coexistindo de propósito, o painel media v7 e v8 SOMADOS — inclusive
 * as linhas do motor quebrado (projetava zero em 38% dos jogos) que o bump de
 * ontem existia justamente pra deixar pra trás.
 *
 * É o mesmo erro que a lição B37 registrou: comparar populações diferentes e
 * apresentar como se fossem uma. Todo o resto da calibração (`fit-isotonic`,
 * `fit-temperature`, `fit-dist`) agrupa por `model_version` — esta era a
 * exceção acidental.
 *
 * Custo aceito: nenhuma liga tem 30 resolvidas em v8 hoje (a maior tem 15),
 * então o painel cai pro agregado global até a amostra crescer. Número certo
 * com amostra menor é melhor que número errado com amostra grande.
 */
describe("getLeaguePerformance · filtro por model_version", () => {
  beforeEach(() => __resetGlobalCache());

  function stubVersionado(porVersao: Record<string, unknown[]>) {
    const calls: { table: string; league?: string; modelVersion?: string }[] = [];
    return {
      calls,
      from(table: string) {
        let league: string | undefined;
        let modelVersion: string | undefined;
        const chain = {
          select: () => chain,
          eq: (col: string, val: string) => {
            if (col === "league") league = val;
            if (col === "model_version") modelVersion = val;
            return chain;
          },
          is: () => chain,
          not: () => chain,
          limit: () => chain,
          then: (res: (v: unknown) => void) => {
            calls.push({ table, league, modelVersion });
            const daVersao = modelVersion ? (porVersao[modelVersion] ?? []) : [];
            // O stub precisa respeitar o filtro de liga também, senão a "liga
            // pequena" recebe o universo inteiro e nunca cai no fallback global
            // — que é justamente o caminho sob teste aqui.
            const data = league
              ? daVersao.filter((r) => (r as { league?: string }).league === league)
              : daVersao;
            return Promise.resolve({ data, error: null }).then(res);
          },
        };
        return chain;
      },
    };
  }

  it("filtra a query principal por model_version", async () => {
    const sb = stubVersionado({ "sim-v8": rows(60, "Serie B") });
    await getLeaguePerformance("Serie B", "sim-v8", sb, {});
    const q = sb.calls.find((c) => c.table === "fixture_simulations");
    expect(q?.modelVersion).toBe("sim-v8");
  });

  it("NÃO mistura linhas de outra versão", async () => {
    // v7 tem amostra de sobra, v8 quase nada: o resultado deve refletir só v8.
    const sb = stubVersionado({
      "sim-v7": rows(500, "Serie B"),
      "sim-v8": rows(60, "Serie B"),
    });
    const out = await getLeaguePerformance("Serie B", "sim-v8", sb, {});
    expect(out!.tier).toBe("liga");
    // 60 linhas × mercados: muito abaixo do que 560 linhas produziriam.
    expect(out!.leagueCalls).toBeLessThan(500);
  });

  it("o fallback global também é da MESMA versão", async () => {
    const sb = stubVersionado({
      "sim-v7": rows(500, "X"),
      "sim-v8": rows(80, "X"),
    });
    await getLeaguePerformance("Liga Pequena", "sim-v8", sb, {});
    const globais = sb.calls.filter(
      (c) => c.table === "fixture_simulations" && c.league === undefined,
    );
    expect(globais.length).toBeGreaterThan(0);
    expect(globais.every((c) => c.modelVersion === "sim-v8")).toBe(true);
  });

  it("sem model_version não há medição honesta possível → null", async () => {
    const sb = stubVersionado({ "sim-v8": rows(60, "Serie B") });
    expect(await getLeaguePerformance("Serie B", null, sb, {})).toBeNull();
    expect(await getLeaguePerformance("Serie B", "", sb, {})).toBeNull();
  });

  it("expõe a versão medida (a UI precisa dizer de qual motor é o número)", async () => {
    const sb = stubVersionado({ "sim-v8": rows(60, "Serie B") });
    const out = await getLeaguePerformance("Serie B", "sim-v8", sb, {});
    expect(out!.modelVersion).toBe("sim-v8");
  });

  it("o cache global é por VERSÃO — não vaza medição de uma versão pra outra", async () => {
    const sb = stubVersionado({ "sim-v7": rows(500, "X"), "sim-v8": rows(80, "X") });
    const a = await getLeaguePerformance("Liga Pequena", "sim-v7", sb, {});
    const b = await getLeaguePerformance("Liga Pequena", "sim-v8", sb, {});
    expect(a!.modelVersion).toBe("sim-v7");
    expect(b!.modelVersion).toBe("sim-v8");
    expect(a!.markets[0].calls).not.toBe(b!.markets[0].calls);
  });
});
