/**
 * Pipeline Health Card tests (TDD — RED before GREEN)
 *
 * Testa:
 * - PipelineHealthCard renderiza 4 semáforos
 * - Estado verde/amarelo/vermelho por limites corretos
 * - Estado neutro quando dados ausentes
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  PipelineHealthCard,
  type PipelineHealthData,
} from "@/components/calibracao/pipeline-health-card";

const BASE_DATA: PipelineHealthData = {
  lastScrapeAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1h ago
  simsToday: 60,
  lastReconciledAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
  recoPendingPastKickoff: 0,
  topLeagues: [
    { league: "Premier League", count: 42 },
    { league: "La Liga", count: 38 },
    { league: "Serie A", count: 29 },
  ],
};

describe("<PipelineHealthCard />", () => {
  it("renderiza o card sem crashes", () => {
    render(<PipelineHealthCard data={BASE_DATA} />);
    expect(screen.getByRole("region", { name: /saúde do pipeline/i })).toBeInTheDocument();
  });

  it("renderiza 4 semáforos (scrape, sims, reconciler, pending)", () => {
    const { container } = render(<PipelineHealthCard data={BASE_DATA} />);
    const semaforos = container.querySelectorAll("[data-semaforo]");
    expect(semaforos.length).toBe(4);
  });

  it("scrape 1h atrás → verde", () => {
    const { container } = render(<PipelineHealthCard data={BASE_DATA} />);
    const scrape = container.querySelector("[data-semaforo='scrape']");
    expect(scrape?.getAttribute("data-status")).toBe("verde");
  });

  it("scrape 28h atrás → amarelo (26-36h)", () => {
    const data: PipelineHealthData = {
      ...BASE_DATA,
      lastScrapeAt: new Date(Date.now() - 28 * 60 * 60 * 1000).toISOString(),
    };
    const { container } = render(<PipelineHealthCard data={data} />);
    const scrape = container.querySelector("[data-semaforo='scrape']");
    expect(scrape?.getAttribute("data-status")).toBe("amarelo");
  });

  it("scrape 40h atrás → vermelho (>36h)", () => {
    const data: PipelineHealthData = {
      ...BASE_DATA,
      lastScrapeAt: new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString(),
    };
    const { container } = render(<PipelineHealthCard data={data} />);
    const scrape = container.querySelector("[data-semaforo='scrape']");
    expect(scrape?.getAttribute("data-status")).toBe("vermelho");
  });

  it("scrape null → vermelho", () => {
    const data: PipelineHealthData = { ...BASE_DATA, lastScrapeAt: null };
    const { container } = render(<PipelineHealthCard data={data} />);
    const scrape = container.querySelector("[data-semaforo='scrape']");
    expect(scrape?.getAttribute("data-status")).toBe("vermelho");
  });

  it("simsToday=60 → verde (≥50)", () => {
    const { container } = render(<PipelineHealthCard data={BASE_DATA} />);
    const sims = container.querySelector("[data-semaforo='sims']");
    expect(sims?.getAttribute("data-status")).toBe("verde");
  });

  it("simsToday=25 → amarelo (10-50)", () => {
    const data: PipelineHealthData = { ...BASE_DATA, simsToday: 25 };
    const { container } = render(<PipelineHealthCard data={data} />);
    const sims = container.querySelector("[data-semaforo='sims']");
    expect(sims?.getAttribute("data-status")).toBe("amarelo");
  });

  it("simsToday=5 → vermelho (<10)", () => {
    const data: PipelineHealthData = { ...BASE_DATA, simsToday: 5 };
    const { container } = render(<PipelineHealthCard data={data} />);
    const sims = container.querySelector("[data-semaforo='sims']");
    expect(sims?.getAttribute("data-status")).toBe("vermelho");
  });

  it("recoPendingPastKickoff=0 → verde", () => {
    const { container } = render(<PipelineHealthCard data={BASE_DATA} />);
    const pending = container.querySelector("[data-semaforo='pending']");
    expect(pending?.getAttribute("data-status")).toBe("verde");
  });

  it("recoPendingPastKickoff=10 → amarelo (1-20)", () => {
    const data: PipelineHealthData = { ...BASE_DATA, recoPendingPastKickoff: 10 };
    const { container } = render(<PipelineHealthCard data={data} />);
    const pending = container.querySelector("[data-semaforo='pending']");
    expect(pending?.getAttribute("data-status")).toBe("amarelo");
  });

  it("recoPendingPastKickoff=25 → vermelho (>20)", () => {
    const data: PipelineHealthData = { ...BASE_DATA, recoPendingPastKickoff: 25 };
    const { container } = render(<PipelineHealthCard data={data} />);
    const pending = container.querySelector("[data-semaforo='pending']");
    expect(pending?.getAttribute("data-status")).toBe("vermelho");
  });

  it("exibe topLeagues quando fornecido", () => {
    render(<PipelineHealthCard data={BASE_DATA} />);
    expect(screen.getByText(/Premier League/i)).toBeInTheDocument();
  });

  it("topLeagues vazio não quebra", () => {
    const data: PipelineHealthData = { ...BASE_DATA, topLeagues: [] };
    expect(() => render(<PipelineHealthCard data={data} />)).not.toThrow();
  });
});
