import { describe, it, expect } from "vitest";
import { anchoredCall, MARKET_LINES } from "@/lib/calibracao/market-accuracy";

/** sim_stats com o total controlado (metade em cada lado). */
const sim = (total: number, metric: "corners" | "cards" | "sot" = "corners") => ({
  home: { [metric]: { p50: total / 2 } },
  away: { [metric]: { p50: total / 2 } },
});

/**
 * `anchoredCall` é a lógica que estava presa dentro do `signalFor` (que devolve
 * strings de UI). Extraída porque o painel de desempenho por liga precisa saber
 * QUAL linha este jogo ancorou pra dizer se o histórico que ele mostra é o
 * mesmo — comparar "cartões mais de 3.5 · 75%" com um jogo que ancorou em 5.5
 * seria juntar duas medições diferentes.
 */
describe("anchoredCall", () => {
  it("ancora na linha canônica mais próxima da projeção", () => {
    // cartões: linhas 3.5 / 4.5 / 5.5
    expect(anchoredCall(sim(4, "cards"), "cards")?.line).toBe(3.5);
    expect(anchoredCall(sim(6, "cards"), "cards")?.line).toBe(5.5);
  });

  it("devolve o lado chamado e a convicção", () => {
    const c = anchoredCall(sim(4, "cards"), "cards");
    expect(c?.side).toBe("over");
    expect(c?.prob).toBeGreaterThan(0.5);
  });

  it("chama under quando a projeção fica abaixo da linha", () => {
    const c = anchoredCall(sim(2, "corners"), "corners");
    expect(c?.side).toBe("under");
  });

  it("devolve side null na zona morta, mas ainda informa a linha", () => {
    // média 10 vs a linha mais próxima (9.5) ⇒ P ≈ 0.54, sem convicção
    const c = anchoredCall(sim(10), "corners");
    expect(c).not.toBeNull();
    expect(c?.side).toBeNull();
    expect(c?.line).toBe(9.5);
  });

  it("devolve null quando não há projeção", () => {
    expect(anchoredCall(null, "corners")).toBeNull();
    expect(anchoredCall({ home: { corners: { p50: 5 } } }, "corners")).toBeNull();
  });

  it("aplica o dist-k antes de escolher o lado", () => {
    // média crua 8 na linha 8.5 chama under; com k=1.3 vira 10.4 e chama over
    expect(anchoredCall(sim(8), "corners")?.side).toBe("under");
    expect(anchoredCall(sim(8), "corners", { corners: 1.3 })?.side).toBe("over");
  });

  it("só ancora em linha que a casa realmente oferece", () => {
    for (const metric of ["corners", "cards", "sot"] as const) {
      const c = anchoredCall(sim(7, metric), metric);
      expect(MARKET_LINES[metric]).toContain(c!.line);
    }
  });
});
