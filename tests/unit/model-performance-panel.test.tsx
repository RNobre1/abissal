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
    modelVersion: "sim-v1-poisson-dc-nb-mc10k-v8",
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

/**
 * A ponte entre o painel (histórico da liga, medido POR LINHA) e o jogo aberto.
 *
 * Sem isso o número era um fato solto: o Pilot via "cartões · mais de 3.5 ·
 * 75%" e não tinha como saber se o jogo na tela tinha chamado essa mesma linha
 * ou outra. E quando ancora em outra, o 75% simplesmente NÃO se aplica — são
 * medições de linhas diferentes, não do mesmo mercado.
 */
describe("ModelPerformancePanel · chamada do jogo aberto", () => {
  it("marca a linha que ESTE jogo chamou quando bate com a medida", () => {
    const { container } = render(
      <ModelPerformancePanel
        perf={perf()}
        gameCalls={[{ market: "corners", line: 9.5, side: "under" }]}
      />,
    );
    expect(container.textContent).toMatch(/este jogo/i);
  });

  it("avisa quando o jogo ancorou em OUTRA linha (o número não se aplica)", () => {
    const { container } = render(
      <ModelPerformancePanel
        perf={perf()}
        gameCalls={[{ market: "corners", line: 10.5, side: "over" }]}
      />,
    );
    // precisa dizer a linha do jogo, não só "difere"
    expect(container.textContent).toMatch(/10\.5/);
    expect(container.textContent).not.toMatch(/este jogo chamou esta linha/i);
  });

  it("não marca nada quando o jogo não chamou aquele mercado", () => {
    const { container } = render(
      <ModelPerformancePanel perf={perf()} gameCalls={[]} />,
    );
    expect(container.textContent).not.toMatch(/este jogo/i);
  });

  it("não marca quando o jogo ficou em cima do muro (side null)", () => {
    const { container } = render(
      <ModelPerformancePanel
        perf={perf()}
        gameCalls={[{ market: "corners", line: 9.5, side: null }]}
      />,
    );
    expect(container.textContent).not.toMatch(/este jogo/i);
  });

  it("marca a linha certa quando há vários mercados", () => {
    const p = perf({
      markets: [
        market(),
        market({ market: "cards", shortLabel: "cartões", line: 3.5, dominantSide: "over" }),
      ],
    });
    const { container } = render(
      <ModelPerformancePanel
        perf={p}
        gameCalls={[{ market: "cards", line: 3.5, side: "over" }]}
      />,
    );
    const linhas = [...container.querySelectorAll("tbody tr")];
    expect(linhas[0].textContent).not.toMatch(/este jogo/i);
    expect(linhas[1].textContent).toMatch(/este jogo/i);
  });

  it("segue funcionando sem gameCalls (prop opcional)", () => {
    const { container } = render(<ModelPerformancePanel perf={perf()} />);
    expect(container.querySelectorAll("tbody tr").length).toBe(1);
  });
});

/**
 * A medição é de UM motor. Depois que o filtro por `model_version` entrou, o
 * painel pode legitimamente cair pro agregado global por semanas (nenhuma liga
 * tinha 30 jogos resolvidos na v8 quando isso foi escrito). O usuário precisa
 * ver de qual motor é o número — senão "todas as ligas · 207" vira um número
 * sem procedência, que é o problema que o filtro veio resolver.
 */
describe("ModelPerformancePanel · procedência da medição", () => {
  it("mostra a versão do motor medido", () => {
    const { container } = render(
      <ModelPerformancePanel perf={perf({ modelVersion: "sim-v1-poisson-dc-nb-mc10k-v8" })} />,
    );
    expect(container.textContent).toMatch(/v8/);
  });

  it("encurta o nome longo do motor (não joga o slug inteiro na tela)", () => {
    const { container } = render(
      <ModelPerformancePanel perf={perf({ modelVersion: "sim-v1-poisson-dc-nb-mc10k-v8" })} />,
    );
    expect(container.textContent).not.toMatch(/poisson-dc-nb-mc10k/);
  });
});

/**
 * Amostra fraca por mercado.
 *
 * O gate `MIN_LEAGUE_CALLS = 30` soma TODOS os mercados, então uma liga passa
 * com ~5 jogos e cada mercado individual fica com ~10 chamadas. Depois que a
 * medição passou a filtrar por `model_version` (30/07), isso deixou de ser
 * hipótese: a Serie A exibia "cartões 91%" apoiado em n=11.
 *
 * A regra de honestidade do painel diz que o acerto nunca aparece sozinho —
 * mas n=11 com destaque visual de 91% é exatamente aparecer sozinho, só que
 * pior, porque parece medido. O `n` já está na tabela; o que falta é dizer que
 * aquele número específico não sustenta conclusão.
 */
describe("ModelPerformancePanel · amostra fraca", () => {
  it("marca o mercado cuja amostra não sustenta o número", () => {
    const { container } = render(
      <ModelPerformancePanel perf={perf({ markets: [market({ calls: 11 })] })} />,
    );
    const linha = container.querySelector("tbody tr");
    expect(linha?.getAttribute("data-amostra")).toBe("fraca");
  });

  it("não marca quando a amostra sustenta", () => {
    const { container } = render(
      <ModelPerformancePanel perf={perf({ markets: [market({ calls: 60 })] })} />,
    );
    const linha = container.querySelector("tbody tr");
    expect(linha?.getAttribute("data-amostra")).not.toBe("fraca");
  });

  it("explica o que a marca significa, em vez de só decorar", () => {
    const { container } = render(
      <ModelPerformancePanel perf={perf({ markets: [market({ calls: 11 })] })} />,
    );
    expect(container.textContent).toMatch(/poucos jogos|amostra/i);
  });
});
