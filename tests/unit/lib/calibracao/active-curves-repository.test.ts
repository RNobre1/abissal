import { describe, it, expect, vi } from "vitest";
import { getActiveCurves } from "@/lib/calibracao/active-curves-repository";

/**
 * `model_calibration` reader — devolve as 4 curvas isotônicas ATIVAS
 * (`effective_until IS NULL`) pro `model_version` pedido.
 *
 * Contrato (F3-prod):
 *   - UMA query, escopada por `model_version` + `effective_until IS NULL`;
 *   - degrada graciosamente em qualquer erro/exceção (devolve curvas vazias);
 *   - `model_version` vazio/nulo curtocircuita sem nem chamar supabase;
 *   - `meta.n` = max(n) das curvas devolvidas, `meta.appliedAt` = max(effective_from).
 *
 * Mock supabase é uma chain mínima `.from(...).select(...).eq(...).is(...)`
 * que devolve `{ data, error }` direto (não tem `.maybeSingle()` aqui — a
 * query devolve uma LISTA de até 4 rows, não single).
 */

interface CapturedQuery {
  table?: string;
  select?: string;
  eqs: Array<{ column: string; value: unknown }>;
  is: Array<{ column: string; value: unknown }>;
}

function buildMock(opts: {
  rows?: Array<Record<string, unknown>> | null;
  error?: { message: string } | null;
  throwOnFrom?: boolean;
}) {
  const queries: CapturedQuery[] = [];
  const fromSpy = vi.fn((table: string) => {
    if (opts.throwOnFrom) {
      throw new Error('relation "model_calibration" does not exist');
    }
    const cap: CapturedQuery = { table, eqs: [], is: [] };
    queries.push(cap);
    const chain = {
      select(arg: string) {
        cap.select = arg;
        return this;
      },
      eq(column: string, value: unknown) {
        cap.eqs.push({ column, value });
        return this;
      },
      is(column: string, value: unknown) {
        cap.is.push({ column, value });
        // Terminal — devolve a promise direto.
        return Promise.resolve(
          opts.error
            ? { data: null, error: opts.error }
            : { data: opts.rows ?? [], error: null },
        );
      },
    };
    return chain;
  });

  const client = { from: fromSpy };
  return { client, queries, fromSpy };
}

const MODEL_V = "sim-v7-poisson-dc-nb-mc10k";

const curveHome: Array<[number, number]> = [
  [0.1, 0.08],
  [0.5, 0.46],
  [0.9, 0.91],
];
const curveDraw: Array<[number, number]> = [
  [0.1, 0.12],
  [0.3, 0.28],
];
const curveAway: Array<[number, number]> = [
  [0.1, 0.09],
  [0.5, 0.52],
];
const curveOver: Array<[number, number]> = [
  [0.2, 0.18],
  [0.7, 0.75],
];

describe("getActiveCurves — leitura das curvas isotônicas ativas", () => {
  it("carrega 4 curvas ativas pro model_version pedido", async () => {
    const { client, queries } = buildMock({
      rows: [
        { metric: "1x2-home", pairs: curveHome, n: 320, effective_from: "2026-05-20T10:00:00Z" },
        { metric: "1x2-draw", pairs: curveDraw, n: 320, effective_from: "2026-05-20T10:00:00Z" },
        { metric: "1x2-away", pairs: curveAway, n: 320, effective_from: "2026-05-20T10:00:00Z" },
        { metric: "over25", pairs: curveOver, n: 320, effective_from: "2026-05-20T10:00:00Z" },
      ],
    });

    const { curves, meta } = await getActiveCurves(MODEL_V, client);

    expect(curves.oneX2Home).toEqual(curveHome);
    expect(curves.draw).toEqual(curveDraw);
    expect(curves.away).toEqual(curveAway);
    expect(curves.over25).toEqual(curveOver);
    expect(meta.n).toBe(320);
    expect(meta.appliedAt).toBe("2026-05-20T10:00:00Z");

    // Uma única query, à tabela certa, com os filtros certos.
    expect(queries.length).toBe(1);
    expect(queries[0].table).toBe("model_calibration");
    expect(queries[0].eqs).toEqual([{ column: "model_version", value: MODEL_V }]);
    expect(queries[0].is).toEqual([{ column: "effective_until", value: null }]);
  });

  it("ignora curvas inativas (effective_until != null) — o filtro .is faz isso", async () => {
    // O mock só devolve o que a query "pediu"; o que verificamos é que a query
    // FAZ o filtro `is("effective_until", null)`. Aqui simulamos o caso real:
    // o DB já filtrou e devolveu só as ATIVAS.
    const { client, queries } = buildMock({
      rows: [
        { metric: "1x2-home", pairs: curveHome, n: 200, effective_from: "2026-05-20T10:00:00Z" },
      ],
    });
    const { curves } = await getActiveCurves(MODEL_V, client);
    expect(curves.oneX2Home).toEqual(curveHome);
    expect(curves.draw).toBeUndefined();
    expect(queries[0].is).toEqual([{ column: "effective_until", value: null }]);
  });

  it("ignora curvas de outro model_version — o filtro .eq faz isso", async () => {
    const { client, queries } = buildMock({ rows: [] });
    await getActiveCurves("sim-v7-poisson-dc-nb-mc10k", client);
    expect(queries[0].eqs).toEqual([
      { column: "model_version", value: "sim-v7-poisson-dc-nb-mc10k" },
    ]);
  });

  it("metric desconhecido é ignorado silenciosamente", async () => {
    const { client } = buildMock({
      rows: [
        { metric: "1x2-home", pairs: curveHome, n: 100, effective_from: "2026-05-01T00:00:00Z" },
        // Métrica futura/typo — deve ser ignorada sem crash.
        { metric: "btts", pairs: [[0.5, 0.5]], n: 99, effective_from: "2026-05-01T00:00:00Z" },
        { metric: "weird-new-metric", pairs: [[0.1, 0.1]], n: 50, effective_from: "2026-05-01T00:00:00Z" },
      ],
    });
    const { curves, meta } = await getActiveCurves(MODEL_V, client);
    expect(curves.oneX2Home).toEqual(curveHome);
    expect(curves.draw).toBeUndefined();
    expect(curves.away).toBeUndefined();
    expect(curves.over25).toBeUndefined();
    // Apenas as métricas RECONHECIDAS contam pro meta.n.
    expect(meta.n).toBe(100);
  });

  it("supabase erro → devolve vazio (degradação graciosa)", async () => {
    const { client } = buildMock({ error: { message: "table does not exist" } });
    const { curves, meta } = await getActiveCurves(MODEL_V, client);
    expect(curves).toEqual({});
    expect(meta.n).toBeNull();
    expect(meta.appliedAt).toBeNull();
  });

  it("supabase throw em .from → devolve vazio sem crash", async () => {
    const { client } = buildMock({ throwOnFrom: true });
    const { curves, meta } = await getActiveCurves(MODEL_V, client);
    expect(curves).toEqual({});
    expect(meta.n).toBeNull();
    expect(meta.appliedAt).toBeNull();
  });

  it("modelVersion vazio → não chama supabase", async () => {
    const { client, fromSpy } = buildMock({ rows: [] });
    const { curves, meta } = await getActiveCurves("", client);
    expect(fromSpy).not.toHaveBeenCalled();
    expect(curves).toEqual({});
    expect(meta.n).toBeNull();
    expect(meta.appliedAt).toBeNull();
  });

  it("modelVersion null → não chama supabase", async () => {
    const { client, fromSpy } = buildMock({ rows: [] });
    // Cobertura defensiva — caller pode passar `sim.model_version` direto que é nullable.
    const { curves } = await getActiveCurves(
      null as unknown as string,
      client,
    );
    expect(fromSpy).not.toHaveBeenCalled();
    expect(curves).toEqual({});
  });

  it("modelVersion undefined → não chama supabase", async () => {
    const { client, fromSpy } = buildMock({ rows: [] });
    const { curves } = await getActiveCurves(
      undefined as unknown as string,
      client,
    );
    expect(fromSpy).not.toHaveBeenCalled();
    expect(curves).toEqual({});
  });

  it("meta.n = max(n) entre as curvas; meta.appliedAt = max(effective_from)", async () => {
    const { client } = buildMock({
      rows: [
        { metric: "1x2-home", pairs: curveHome, n: 150, effective_from: "2026-05-18T10:00:00Z" },
        { metric: "1x2-draw", pairs: curveDraw, n: 420, effective_from: "2026-05-22T10:00:00Z" },
        { metric: "1x2-away", pairs: curveAway, n: 380, effective_from: "2026-05-19T10:00:00Z" },
        { metric: "over25", pairs: curveOver, n: 410, effective_from: "2026-05-21T10:00:00Z" },
      ],
    });
    const { meta } = await getActiveCurves(MODEL_V, client);
    expect(meta.n).toBe(420);
    expect(meta.appliedAt).toBe("2026-05-22T10:00:00Z");
  });

  it("select lista exatamente as 4 colunas necessárias — sem detail_json", async () => {
    // Guardrail extra: o T5 (repository-payload-guard) escaneia
    // lib/**/*repository*.ts; este arquivo cai no escopo. O select DEVE
    // listar APENAS metric, pairs, n, effective_from.
    const { client, queries } = buildMock({ rows: [] });
    await getActiveCurves(MODEL_V, client);
    const sel = queries[0].select ?? "";
    expect(sel).not.toContain("detail_json");
    const cols = sel.split(",").map((c) => c.trim()).filter(Boolean);
    expect(cols.sort()).toEqual(
      ["effective_from", "metric", "n", "pairs"].sort(),
    );
  });
});
