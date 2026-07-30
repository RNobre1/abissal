import { describe, it, expect } from "vitest";
import { buildForecast, daysBetween } from "./forecast";

/**
 * Regressão (Pacote A item 4): o /forecast montava os pontos da regressão
 * com o ÍNDICE da linha (`[i, s.pl]`). Com buracos de calendário (dias sem
 * aposta resolvida ⇒ sem snapshot), o slope exibido como "BRL/dia" virava
 * BRL/dia-com-aposta — inflado. O eixo x correto é dias CORRIDOS desde o
 * primeiro snapshot da janela.
 */

describe("daysBetween", () => {
  it("dias corridos entre datas ISO", () => {
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
    expect(daysBetween("2026-01-01", "2026-01-02")).toBe(1);
    expect(daysBetween("2026-01-01", "2026-01-11")).toBe(10);
  });
});

describe("buildForecast", () => {
  it("série com menos de 2 pontos → null", () => {
    expect(buildForecast([], 30)).toBeNull();
    expect(buildForecast([{ date: "2026-01-01", pl: 5 }], 30)).toBeNull();
  });

  it("com buracos de calendário, slope é BRL por dia CORRIDO (não por linha)", () => {
    // P/L perfeitamente linear em dias corridos: +10 BRL/dia.
    // As linhas 0,1,2 são consecutivas; a última vem 8 dias depois (buraco).
    const series = [
      { date: "2026-01-01", pl: 0 },
      { date: "2026-01-02", pl: 10 },
      { date: "2026-01-03", pl: 20 },
      { date: "2026-01-11", pl: 100 },
    ];
    const f = buildForecast(series, 30);
    expect(f).not.toBeNull();
    // Regressão por índice daria slope ≈ 31 (BRL/dia-com-aposta) — o bug.
    expect(f!.slopePerDay).toBeCloseTo(10, 1);
    expect(f!.r2).toBeCloseTo(1, 3);
  });

  it("projeção continua a partir do último dia CORRIDO da janela", () => {
    const series = [
      { date: "2026-01-01", pl: 0 },
      { date: "2026-01-02", pl: 10 },
      { date: "2026-01-03", pl: 20 },
      { date: "2026-01-11", pl: 100 },
    ];
    const f = buildForecast(series, 30)!;
    // dia +1 após o último snapshot (x = 11): tendência ≈ 110.
    expect(f.projected[0].day).toBe(1);
    expect(f.projected[0].pl).toBeCloseTo(110, 0);
    expect(f.projected).toHaveLength(30);
    // horizonte final: x = 10 + 30 = 40 ⇒ ≈ 400.
    expect(f.projected[29].pl).toBeCloseTo(400, 0);
  });

  it("sem buracos, mantém o comportamento antigo (índice == dia corrido)", () => {
    const series = [
      { date: "2026-02-01", pl: 0 },
      { date: "2026-02-02", pl: 5 },
      { date: "2026-02-03", pl: 10 },
      { date: "2026-02-04", pl: 15 },
    ];
    const f = buildForecast(series, 10)!;
    expect(f.slopePerDay).toBeCloseTo(5, 3);
    expect(f.projected[0].pl).toBeCloseTo(20, 1);
  });

  it("banda de 95% cresce com sqrt(d) e envolve a tendência", () => {
    const series = [
      { date: "2026-03-01", pl: 0 },
      { date: "2026-03-02", pl: 12 },
      { date: "2026-03-03", pl: 8 },
      { date: "2026-03-04", pl: 25 },
      { date: "2026-03-05", pl: 18 },
    ];
    const f = buildForecast(series, 4)!;
    expect(f.dailyStd).toBeGreaterThan(0);
    for (const p of f.projected) {
      expect(p.lo).toBeLessThan(p.pl);
      expect(p.hi).toBeGreaterThan(p.pl);
    }
    const w1 = f.projected[0].hi - f.projected[0].pl;
    const w4 = f.projected[3].hi - f.projected[3].pl;
    expect(w4 / w1).toBeCloseTo(2, 5); // sqrt(4)/sqrt(1)
  });

  it("expõe média e desvio dos deltas diários e o último P/L", () => {
    const series = [
      { date: "2026-04-01", pl: 0 },
      { date: "2026-04-02", pl: 10 },
      { date: "2026-04-03", pl: 30 },
    ];
    const f = buildForecast(series, 5)!;
    expect(f.lastPl).toBe(30);
    expect(f.dailyMean).toBeCloseTo(15, 6); // deltas 10, 20
  });
});
