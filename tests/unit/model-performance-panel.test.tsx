import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModelPerformancePanel } from "@/components/fixtures/model-performance-panel";
import type { LeaguePerformance } from "@/lib/calibracao/league-accuracy-repository";
import type { MarketAccuracy } from "@/lib/calibracao/market-accuracy";

function market(over: Partial<MarketAccuracy> = {}): MarketAccuracy {
  return {
    market: "corners",
    label: "escanteios · menos de 9.5",
    shortLabel: "escanteios",
    line: 9.5,
    dominantSide: "under",
    calls: 52,
    hits: 33,
    rate: 0.635,
    baseRate: 0.54,
    lift: 0.095,
    ci95: { lo: 0.5, hi: 0.75 },
    sampleTier: "liga",
    ...over,
  };
}

function perf(over: Partial<LeaguePerformance> = {}): LeaguePerformance {
  return {
    league: "Serie B",
    tier: "liga",
    leagueCalls: 104,
    markets: [market()],
    window: { from: "2026-05-18T00:00:00Z", to: "2026-07-29T00:00:00Z" },
    ...over,
  };
}

describe("ModelPerformancePanel", () => {
  it("mostra o mercado, o n e o acerto", () => {
    const { container } = render(<ModelPerformancePanel perf={perf()} />);
    const celulas = [...container.querySelectorAll("tbody td")].map(
      (td) => td.textContent,
    );
    expect(celulas[0]).toMatch(/escanteios/);
    expect(celulas[1]).toBe("52");
    expect(celulas[2]).toMatch(/6[34]%/);
  });

  it("mostra o lift ao lado do acerto, nunca o acerto sozinho", () => {
    render(<ModelPerformancePanel perf={perf()} />);
    expect(screen.getByText(/\+(9|10)pp/)).toBeTruthy();
  });

  it("avisa quando caiu pro global por amostra baixa", () => {
    render(<ModelPerformancePanel perf={perf({ tier: "global", leagueCalls: 12 })} />);
    expect(screen.getByText(/poucos jogos/i)).toBeTruthy();
    expect(screen.getByText(/12/)).toBeTruthy();
  });

  it("não mostra o aviso de amostra baixa quando o tier é da liga", () => {
    render(<ModelPerformancePanel perf={perf()} />);
    expect(screen.queryByText(/poucos jogos/i)).toBeNull();
  });

  it("mostra lift negativo em vez de esconder o mercado ruim", () => {
    render(
      <ModelPerformancePanel
        perf={perf({ markets: [market({ rate: 0.49, baseRate: 0.55, lift: -0.06 })] })}
      />,
    );
    expect(screen.getByText(/−6pp/)).toBeTruthy();
  });

  it("não renderiza nada sem dado", () => {
    const { container } = render(<ModelPerformancePanel perf={null} />);
    expect(container.textContent?.trim()).toBe("");
  });

  it("não renderiza nada com lista de mercados vazia", () => {
    const { container } = render(
      <ModelPerformancePanel perf={perf({ markets: [] })} />,
    );
    expect(container.textContent?.trim()).toBe("");
  });

  it("declara a janela de medição", () => {
    render(<ModelPerformancePanel perf={perf()} />);
    expect(screen.getByText(/18\/05.*29\/07/)).toBeTruthy();
  });

  it("resume na manchete o que vai bem e o que vai mal", () => {
    const { container } = render(
      <ModelPerformancePanel
        perf={perf({
          markets: [
            market({
              market: "corners",
              label: "escanteios",
              shortLabel: "escanteios",
              lift: 0.12,
            }),
            market({
              market: "cards",
              label: "cartões",
              shortLabel: "cartões",
              lift: -0.15,
            }),
          ],
        })}
      />,
    );
    const manchete = container.querySelector("summary")!.textContent!;
    expect(manchete).toMatch(/vai bem em escanteios/i);
    expect(manchete).toMatch(/fraco em cartões/i);
  });

  it("expõe o IC95 sem poluir o corpo da tabela", () => {
    const { container } = render(<ModelPerformancePanel perf={perf()} />);
    const linha = container.querySelector("tbody tr");
    expect(linha?.getAttribute("title")).toMatch(/50%.*75%/);
  });
});

describe("affordance de expansão", () => {
  /**
   * Sem indicação de que abre, o card lê como rótulo de seção e o usuário rola
   * direto por ele — foi o que aconteceu no mobile, onde ele fica 1,2 tela
   * abaixo entre o momentum e o divisor técnico.
   */
  it("mostra seta e convite explícito quando recolhido", () => {
    const { container } = render(<ModelPerformancePanel perf={perf()} />);
    const summary = container.querySelector("summary")!;
    expect(summary.textContent).toMatch(/▸/);
    expect(summary.textContent).toMatch(/toque para ver/i);
  });
});
