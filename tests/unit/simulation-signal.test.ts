import { describe, it, expect } from "vitest";
import { signalFor } from "@/app/(dashboard)/fixtures/[id]/_components/simulation-panel";

/** sim_stats com o total de escanteios controlado (metade em cada lado). */
const sim = (corners: number) => ({
  home: { corners: { p50: corners / 2 }, cards: { p50: 1 }, sot: { p50: 4 } },
  away: { corners: { p50: corners / 2 }, cards: { p50: 1 }, sot: { p50: 3 } },
});

describe("signalFor", () => {
  it("devolve − com convicção normal", () => {
    // média 8 ancora na linha 8.5 ⇒ P(under) ≈ 59%: chama, mas sem convicção alta
    const s = signalFor(sim(8), "corners");
    expect(s!.symbol).toBe("−");
    expect(s!.text).toMatch(/menos de/);
  });

  it("devolve −− com convicção alta", () => {
    const s = signalFor(sim(2), "corners");
    expect(s!.symbol).toBe("−−");
    expect(s!.text).toMatch(/menos de/);
  });

  it("devolve ++ quando a projeção passa folgado da linha", () => {
    const s = signalFor(sim(20), "corners");
    expect(s!.symbol).toBe("++");
    expect(s!.text).toMatch(/mais de/);
  });

  it("devolve ≈ na zona morta", () => {
    // média 10 vs a linha mais próxima (9.5) ⇒ P ≈ 0.54, sem chamada
    const s = signalFor(sim(10), "corners");
    expect(s!.symbol).toBe("≈");
    expect(s!.text).toMatch(/sem chamada/);
  });

  it("ancora na linha canônica mais próxima da projeção", () => {
    expect(signalFor(sim(8), "corners")!.text).toMatch(/8\.5/);
    expect(signalFor(sim(20), "corners")!.text).toMatch(/10\.5/);
  });

  it("devolve null pra métrica sem linha canônica", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(signalFor(sim(10), "fouls" as any)).toBeNull();
  });

  it("devolve null quando sim_stats não dá média", () => {
    expect(signalFor(null, "corners")).toBeNull();
    expect(signalFor({ home: { corners: { p50: 5 } } }, "corners")).toBeNull();
  });

  it("percentual mostrado é o do lado chamado, não sempre o de over", () => {
    const under = signalFor(sim(2), "corners")!;
    const m = under.text.match(/(\d+)%/);
    expect(Number(m![1])).toBeGreaterThan(50);
  });
});
