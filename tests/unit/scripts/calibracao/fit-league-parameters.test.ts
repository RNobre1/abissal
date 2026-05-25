/**
 * Testes da camada de discovery do script
 * `scripts/calibracao/fit-league-parameters.ts`.
 *
 * Após a expansão de 5 ligas hardcoded → discovery dinâmico (todas as
 * ligas com n >= MIN_SAMPLES), o "discovery" é simplesmente
 * `fitLeagueParams(samples, MIN_SAMPLES)`: a função pura já agrupa por
 * liga, filtra por threshold e devolve apenas as elegíveis.
 *
 * Estes testes validam a contract de discovery sob a perspectiva do
 * script — não duplicam a cobertura de `league-params.test.ts` (que cobre
 * a matemática MoM/rho/etc.).
 */
import { describe, it, expect } from "vitest";
import { fitLeagueParams } from "@/lib/calibracao/league-params";

const MIN_SAMPLES = 20;

describe("fit-league-parameters script — discovery", () => {
  it("descobre apenas ligas com n >= 20 (mock 3 ligas: 30 / 10 / 25)", () => {
    // Cenário do task: 3 ligas no DB resolvidas; só duas devem ser
    // calibradas após o threshold universal de 20.
    const samples = [
      ...Array.from({ length: 30 }, (_, i) => ({
        league: "Premier League",
        home_goals: i % 3,
        away_goals: i % 2,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        league: "Some Tiny League",
        home_goals: i % 3,
        away_goals: i % 2,
      })),
      ...Array.from({ length: 25 }, (_, i) => ({
        league: "Eliteserien",
        home_goals: i % 3,
        away_goals: i % 2,
      })),
    ];

    const fits = fitLeagueParams(samples, MIN_SAMPLES);
    const names = fits.map((f) => f.league).sort();

    expect(names).toEqual(["Eliteserien", "Premier League"]);
    expect(fits.find((f) => f.league === "Premier League")?.n).toBe(30);
    expect(fits.find((f) => f.league === "Eliteserien")?.n).toBe(25);
  });

  it("liga com n entre 20 e 29 é calibrada mas marcada low_confidence", () => {
    // Risco do task: ligas 20-29 são "low confidence" — UI deve sinalizar.
    const samples = Array.from({ length: 22 }, (_, i) => ({
      league: "Obos-Ligaen",
      home_goals: i % 3,
      away_goals: i % 2,
    }));

    const [fit] = fitLeagueParams(samples, MIN_SAMPLES);

    expect(fit).toBeDefined();
    expect(fit.league).toBe("Obos-Ligaen");
    expect(fit.n).toBe(22);
    expect(fit.low_confidence).toBe(true);
  });

  it("liga com n >= 30 é calibrada sem low_confidence", () => {
    const samples = Array.from({ length: 54 }, (_, i) => ({
      league: "Major League Soccer",
      home_goals: i % 3,
      away_goals: i % 2,
    }));

    const [fit] = fitLeagueParams(samples, MIN_SAMPLES);

    expect(fit.low_confidence).toBe(false);
    expect(fit.n).toBe(54);
  });

  it("liga sem nenhuma amostra suficiente é silently pulada", () => {
    const samples = Array.from({ length: 19 }, () => ({
      league: "Mini League",
      home_goals: 1,
      away_goals: 1,
    }));

    expect(fitLeagueParams(samples, MIN_SAMPLES)).toEqual([]);
  });
});
