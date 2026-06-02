import { describe, it, expect } from "vitest";
import { getDistK, type DistKMap } from "./dist-k-repository";

// Fake supabase client cujo .from().select().eq().is() resolve `rows`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeSupabase(rows: any[] | null, error: unknown = null): any {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    is() { return Promise.resolve({ data: rows, error }); },
  };
  return { from: () => builder };
}

describe("getDistK", () => {
  it("monta { stat: k } das linhas *-dist (k = meanActual/meanPred)", async () => {
    const sb = fakeSupabase([
      { metric: "corners-dist", pairs: [[8.95, 9.53]] },
      { metric: "cards-dist", pairs: [[3.43, 3.87]] },
      { metric: "sot-dist", pairs: [[7.71, 8.26]] },
    ]);
    const k: DistKMap = await getDistK("sim-v7", sb);
    expect(k.corners).toBeCloseTo(9.53 / 8.95, 6);
    expect(k.cards).toBeCloseTo(3.87 / 3.43, 6);
    expect(k.sot).toBeCloseTo(8.26 / 7.71, 6);
  });

  it("ignora métricas que não são *-dist", async () => {
    const sb = fakeSupabase([
      { metric: "1x2-home", pairs: [[0.5, 0.45], [0.8, 0.55]] },
      { metric: "corners-dist", pairs: [[10, 11]] },
    ]);
    const k = await getDistK("sim-v7", sb);
    expect(k.corners).toBeCloseTo(1.1, 6);
    expect(k.cards).toBeUndefined();
  });

  it("descarta meanPred não-positivo e pairs malformado", async () => {
    const sb = fakeSupabase([
      { metric: "corners-dist", pairs: [[0, 9.5]] },
      { metric: "cards-dist", pairs: "lixo" },
      { metric: "sot-dist", pairs: [[7, 7.5]] },
    ]);
    const k = await getDistK("sim-v7", sb);
    expect(k.corners).toBeUndefined();
    expect(k.cards).toBeUndefined();
    expect(k.sot).toBeCloseTo(7.5 / 7, 6);
  });

  it("model_version vazio → {} (sem chamar supabase)", async () => {
    const k = await getDistK("", fakeSupabase(null));
    expect(k).toEqual({});
  });

  it("erro de DB → {} (degrada gracioso)", async () => {
    const sb = fakeSupabase(null, { message: "boom" });
    expect(await getDistK("sim-v7", sb)).toEqual({});
  });
});
