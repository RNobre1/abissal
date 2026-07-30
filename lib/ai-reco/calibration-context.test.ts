/**
 * TDD — extração dos helpers de calibração da rota /api/ai-reco/compute
 * pra lib compartilhada (F2 advogado do diabo reusa a MESMA fiação:
 * curvas isotônicas por métrica + detecção de liga calibrada).
 *
 * O comportamento é o que a rota já tinha inline — estes testes fixam o
 * contrato pra extração não regredir nada.
 */
import { describe, expect, it } from "vitest";
import { buildIsotonicLookup, isLeagueCalibrated } from "./calibration-context";

// ── mock supabase mínimo ────────────────────────────────────────────────────

function calibrationClient(rows: Array<{ metric: string | null; pairs: unknown }>) {
  return {
    from(table: string) {
      if (table !== "model_calibration") throw new Error(`unexpected table ${table}`);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.is = () => Promise.resolve({ data: rows, error: null });
      return chain;
    },
  };
}

function leagueParamsClient(rows: Array<{ league: string }>) {
  return {
    from(table: string) {
      if (table !== "league_parameters") throw new Error(`unexpected table ${table}`);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.is = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
      return chain;
    },
  };
}

// ── buildIsotonicLookup ─────────────────────────────────────────────────────

describe("buildIsotonicLookup", () => {
  it("constrói uma fn por métrica que aplica a curva", async () => {
    const lookup = await buildIsotonicLookup(
      "v8",
      calibrationClient([
        { metric: "1x2-home", pairs: [[0, 0], [1, 0.8]] },
        { metric: "over25", pairs: [[0, 0.1], [1, 0.9]] },
      ]),
    );
    expect(typeof lookup["1x2-home"]).toBe("function");
    expect(typeof lookup["over25"]).toBe("function");
    // Curva linear 0→0, 1→0.8: p=0.5 → 0.4
    expect(lookup["1x2-home"]!(0.5)).toBeCloseTo(0.4, 5);
  });

  it("ignora métricas '-dist' (são fatores do getDistK, não curvas)", async () => {
    const lookup = await buildIsotonicLookup(
      "v8",
      calibrationClient([{ metric: "corners-dist", pairs: [[10, 11]] }]),
    );
    expect(lookup["corners-dist"]).toBeUndefined();
  });

  it("ignora pairs malformados e métricas vazias", async () => {
    const lookup = await buildIsotonicLookup(
      "v8",
      calibrationClient([
        { metric: "btts", pairs: "not-an-array" },
        { metric: null, pairs: [[0, 0], [1, 1]] },
      ]),
    );
    expect(Object.keys(lookup)).toHaveLength(0);
  });

  it("devolve {} sem model_version", async () => {
    const lookup = await buildIsotonicLookup(null, calibrationClient([]));
    expect(lookup).toEqual({});
  });
});

// ── isLeagueCalibrated ──────────────────────────────────────────────────────

describe("isLeagueCalibrated", () => {
  it("true quando existe row efetiva em league_parameters", async () => {
    expect(
      await isLeagueCalibrated("Premier League", leagueParamsClient([{ league: "Premier League" }])),
    ).toBe(true);
  });

  it("false sem row / sem liga", async () => {
    expect(await isLeagueCalibrated("Obscure League", leagueParamsClient([]))).toBe(false);
    expect(await isLeagueCalibrated(null, leagueParamsClient([]))).toBe(false);
  });

  it("false quando o client lança (degradação graciosa)", async () => {
    const throwing = {
      from() {
        throw new Error("boom");
      },
    };
    expect(await isLeagueCalibrated("X", throwing)).toBe(false);
  });
});
