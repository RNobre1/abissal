/* eslint-disable @typescript-eslint/no-explicit-any -- fakes de supabase no teste */
import { describe, it, expect } from "vitest";
import { parseScorelineCal, getScorelineCal } from "./scoreline-cal-repository";

const payload = {
  temperature: 1.4,
  drawFactor: 0.9,
  n: 882,
  raw: { top1Hit: 0.102, top1Pred: 0.147, drawReal: 0.237, drawPred: 0.268 },
  cal: { top1Pred: 0.133, drawPred: 0.255 },
};

describe("parseScorelineCal", () => {
  it("extrai params + resumo do objeto pairs", () => {
    const p = parseScorelineCal(payload)!;
    expect(p.temperature).toBe(1.4);
    expect(p.drawFactor).toBe(0.9);
    expect(p.raw.top1Hit).toBe(0.102);
    expect(p.cal.top1Pred).toBe(0.133);
  });

  it("aceita string JSON", () => {
    const p = parseScorelineCal(JSON.stringify(payload))!;
    expect(p.temperature).toBe(1.4);
  });

  it("retorna null pra array (curva isotônica) ou lixo", () => {
    expect(parseScorelineCal([[0.5, 0.45]])).toBeNull();
    expect(parseScorelineCal("não-json")).toBeNull();
    expect(parseScorelineCal({ foo: 1 })).toBeNull();
    expect(parseScorelineCal(null)).toBeNull();
  });
});

describe("getScorelineCal", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function fakeSb(rows: any[] | null, error: unknown = null): any {
    const b: any = {
      select: () => b,
      eq: () => b,
      is: () => b,
      limit: () => Promise.resolve({ data: rows, error }),
    };
    return { from: () => b };
  }

  it("lê a linha ativa e parseia", async () => {
    const p = await getScorelineCal("v7", fakeSb([{ pairs: payload, n: 882 }]));
    expect(p?.temperature).toBe(1.4);
    expect(p?.n).toBe(882);
  });

  it("modelVersion vazio → null (sem query)", async () => {
    expect(await getScorelineCal("", fakeSb([{ pairs: payload }]))).toBeNull();
    expect(await getScorelineCal(null, fakeSb([{ pairs: payload }]))).toBeNull();
  });

  it("erro/ausência → null", async () => {
    expect(await getScorelineCal("v7", fakeSb(null, { message: "x" }))).toBeNull();
    expect(await getScorelineCal("v7", fakeSb([]))).toBeNull();
  });
});
