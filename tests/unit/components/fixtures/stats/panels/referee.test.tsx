import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Referee } from "@/components/fixtures/stats/panels/referee";
import type { RefereeRecord } from "@/lib/fixtures/stats/detail-json-types";

function ref(over: Partial<RefereeRecord> = {}): RefereeRecord {
  return {
    name: "Anthony Taylor",
    completed: 18,
    fixtures_count: 22,
    avg_total_booking_points: 48.3,
    avg_home_booking_points: 21.5,
    avg_away_booking_points: 26.8,
    total_yellow_reds: 3,
    ...over,
  };
}

describe("<Referee />", () => {
  it("renders null when record is null", () => {
    const { container } = render(<Referee record={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the referee name", () => {
    render(<Referee record={ref()} />);
    expect(screen.getByText("Anthony Taylor")).toBeDefined();
  });

  it("renders the avg total booking points (1 decimal digit)", () => {
    render(<Referee record={ref()} />);
    expect(screen.getByText("48.3")).toBeDefined();
  });

  it("highlights BP when avg > 45 (vermelho token)", () => {
    const { container } = render(<Referee record={ref({ avg_total_booking_points: 50 })} />);
    const big = container.querySelector("[data-bp-headline]") as HTMLElement | null;
    expect(big).not.toBeNull();
    expect(big?.style.color).toContain("color-vermelho");
  });

  it("does NOT highlight BP when avg <= 45", () => {
    const { container } = render(<Referee record={ref({ avg_total_booking_points: 40 })} />);
    const big = container.querySelector("[data-bp-headline]") as HTMLElement | null;
    expect(big).not.toBeNull();
    expect(big?.style.color).not.toContain("color-vermelho");
  });

  it("renders home/away BP splits and total yellow-reds", () => {
    render(<Referee record={ref()} />);
    expect(screen.getByText("21.5")).toBeDefined();
    expect(screen.getByText("26.8")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });
});

// ── campos ricos (28/07) ───────────────────────────────────────────────────
// O widget do árbitro sempre trouxe cartões por lado, faltas e a distribuição
// por jogo; guardávamos só booking points, que é uma métrica composta
// (amarelo=10, vermelho=25) e esconde a forma da distribuição.
describe("<Referee /> — perfil de cartões", () => {
  function rich(over: Partial<RefereeRecord> = {}): RefereeRecord {
    return {
      ...ref(),
      avg_home_cards: 2.4,
      avg_away_cards: 2.9,
      avg_total_cards: 5.3,
      pct_home_2plus_cards: 72.2,
      pct_away_2plus_cards: 83.3,
      pct_both_2plus_cards: 61.1,
      avg_home_fouls: 11.4,
      avg_away_fouls: 12.8,
      avg_total_fouls: 24.2,
      cards_dispersion: 1.35,
      cards_over_pct: { "2.5": 88.9, "3.5": 77.8, "4.5": 55.6, "5.5": 38.9, "6.5": 22.2 },
      ...over,
    };
  }

  it("mostra a média de CARTÕES por jogo, não só booking points", () => {
    render(<Referee record={rich()} />);
    expect(screen.getByText("5.3")).toBeDefined();
  });

  it("mostra % de jogos com 2+ cartões para casa e fora", () => {
    const { container } = render(<Referee record={rich()} />);
    const el = container.querySelector("[data-cards-2plus]");
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("72");
    expect(el?.textContent).toContain("83");
  });

  it("mostra a % de jogos em que AMBOS os times levaram 2+", () => {
    const { container } = render(<Referee record={rich()} />);
    expect(container.querySelector("[data-both-2plus]")?.textContent).toContain("61");
  });

  it("mostra a distribuição empírica de over do total de cartões", () => {
    const { container } = render(<Referee record={rich()} />);
    const rows = container.querySelectorAll("[data-card-line]");
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(container.textContent).toContain("4.5");
    expect(container.textContent).toContain("55.6");
  });

  it("mostra faltas por jogo (driver causal do cartão)", () => {
    const { container } = render(<Referee record={rich()} />);
    expect(container.querySelector("[data-fouls]")?.textContent).toContain("24.2");
  });

  it("sinaliza dispersão alta (var/média > 1.15 = over-disperso)", () => {
    const { container } = render(<Referee record={rich({ cards_dispersion: 1.4 })} />);
    const d = container.querySelector("[data-dispersion]");
    expect(d).not.toBeNull();
    expect(d?.getAttribute("data-dispersion")).toBe("over");
  });

  it("classifica dispersão baixa como sub-disperso", () => {
    const { container } = render(<Referee record={rich({ cards_dispersion: 0.6 })} />);
    expect(container.querySelector("[data-dispersion]")?.getAttribute("data-dispersion")).toBe("sub");
  });

  // Retenção de 4 dias + payloads antigos: a maioria dos registros gravados
  // antes de 28/07 não tem os campos novos. O painel não pode quebrar nem
  // exibir zeros inventados.
  it("não quebra e não inventa zeros quando o registro é do formato antigo", () => {
    const { container } = render(<Referee record={ref()} />);
    expect(screen.getByText("48.3")).toBeDefined();
    expect(container.querySelector("[data-cards-2plus]")).toBeNull();
    expect(container.querySelector("[data-fouls]")).toBeNull();
    expect(container.querySelector("[data-card-line]")).toBeNull();
  });
});
