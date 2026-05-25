import { describe, it, expect } from "vitest";
import { fitLeagueParams } from "@/lib/calibracao/league-params";

describe("fitLeagueParams", () => {
  it("pula liga com < minSamples (30) entries", () => {
    const samples = Array.from({ length: 20 }, () => ({
      league: "PL",
      home_goals: 1,
      away_goals: 1,
    }));
    expect(fitLeagueParams(samples)).toEqual([]);
  });

  it("calcula MoM corretamente em dataset simétrico", () => {
    // 36 amostras: home cicla 0,1,2,3 (mcm 4 → média exata 1.5) e away
    // cicla 0,1,2 (mcm 3 → média exata 1.0). 36 é múltiplo de ambos os
    // ciclos, garantindo médias inteiras sem viés de borda.
    const samples = Array.from({ length: 36 }, (_, i) => ({
      league: "PL",
      home_goals: i % 4, // 0,1,2,3,0,1,2,3...
      away_goals: i % 3, // 0,1,2,0,1,2...
    }));
    const [p] = fitLeagueParams(samples);
    expect(p.league).toBe("PL");
    expect(p.n).toBe(36);
    expect(p.avg_goals_home).toBeCloseTo(1.5, 6);
    expect(p.avg_goals_away).toBeCloseTo(1.0, 6);
    expect(p.avg_goals_for).toBeCloseTo((1.5 + 1.0) / 2, 6);
    expect(p.avg_goals_for).toEqual(p.avg_goals_ag);
    expect(p.rho).toBeGreaterThanOrEqual(-0.3);
    expect(p.rho).toBeLessThanOrEqual(0.05);
  });

  it("agrupa por liga, ignora ligas sem nome", () => {
    const samples = [
      ...Array.from({ length: 35 }, () => ({
        league: "PL",
        home_goals: 1,
        away_goals: 1,
      })),
      ...Array.from({ length: 32 }, () => ({
        league: "La Liga",
        home_goals: 2,
        away_goals: 0,
      })),
      ...Array.from({ length: 5 }, () => ({
        league: "",
        home_goals: 1,
        away_goals: 1,
      })),
    ];
    const out = fitLeagueParams(samples);
    expect(out.map((x) => x.league)).toEqual(["PL", "La Liga"]);
  });

  it("clampa rho em [-0.3, 0.05]", () => {
    // força correlation perfeita negativa
    const samples = Array.from({ length: 40 }, (_, i) => ({
      league: "X",
      home_goals: i % 2 === 0 ? 3 : 0,
      away_goals: i % 2 === 0 ? 0 : 3,
    }));
    const [p] = fitLeagueParams(samples);
    expect(p.rho).toBeCloseTo(-0.3, 6);
  });

  it("dataset vazio devolve []", () => {
    expect(fitLeagueParams([])).toEqual([]);
  });

  it("ordena saída por n decrescente", () => {
    const samples = [
      ...Array.from({ length: 31 }, () => ({
        league: "Small",
        home_goals: 1,
        away_goals: 1,
      })),
      ...Array.from({ length: 60 }, () => ({
        league: "Big",
        home_goals: 2,
        away_goals: 1,
      })),
    ];
    const out = fitLeagueParams(samples);
    expect(out.map((x) => x.league)).toEqual(["Big", "Small"]);
  });

  it("usa DEFAULT_RHO quando variância é zero (todas as linhas iguais)", () => {
    const samples = Array.from({ length: 30 }, () => ({
      league: "Y",
      home_goals: 1,
      away_goals: 1,
    }));
    const [p] = fitLeagueParams(samples);
    expect(p.rho).toBeCloseTo(-0.1, 6);
  });

  it("respeita minSamples customizado", () => {
    const samples = Array.from({ length: 10 }, () => ({
      league: "PL",
      home_goals: 1,
      away_goals: 1,
    }));
    expect(fitLeagueParams(samples, 5)).toHaveLength(1);
    expect(fitLeagueParams(samples, 30)).toEqual([]);
  });

  it("ignora rows com gols não-finitos", () => {
    const samples = [
      ...Array.from({ length: 30 }, () => ({
        league: "PL",
        home_goals: 1,
        away_goals: 1,
      })),
      { league: "PL", home_goals: NaN, away_goals: 1 },
      { league: "PL", home_goals: 1, away_goals: NaN },
    ];
    const [p] = fitLeagueParams(samples);
    expect(p.n).toBe(30);
  });

  describe("priorityLeagues override", () => {
    it("liga prioritária com 26 amostras passa quando override é 20", () => {
      const samples = Array.from({ length: 26 }, (_, i) => ({
        league: "Major League Soccer",
        home_goals: i % 3,
        away_goals: i % 2,
      }));
      const out = fitLeagueParams(samples, 30, {
        priorityLeagues: new Map([["Major League Soccer", 20]]),
      });
      expect(out).toHaveLength(1);
      expect(out[0].league).toBe("Major League Soccer");
      expect(out[0].n).toBe(26);
    });

    it("liga prioritária ainda abaixo do override é pulada", () => {
      const samples = Array.from({ length: 18 }, () => ({
        league: "Major League Soccer",
        home_goals: 1,
        away_goals: 1,
      }));
      const out = fitLeagueParams(samples, 30, {
        priorityLeagues: new Map([["Major League Soccer", 20]]),
      });
      expect(out).toEqual([]);
    });

    it("liga não-prioritária continua sob o default mesmo com override de outra", () => {
      const samples = [
        ...Array.from({ length: 22 }, () => ({
          league: "Premier League",
          home_goals: 1,
          away_goals: 1,
        })),
        ...Array.from({ length: 22 }, () => ({
          league: "Some Random League",
          home_goals: 1,
          away_goals: 1,
        })),
      ];
      const out = fitLeagueParams(samples, 30, {
        priorityLeagues: new Map([["Premier League", 20]]),
      });
      expect(out.map((x) => x.league)).toEqual(["Premier League"]);
    });

    it("low_confidence=true quando n < STRICT_THRESHOLD (30)", () => {
      const samples = Array.from({ length: 26 }, () => ({
        league: "Major League Soccer",
        home_goals: 1,
        away_goals: 1,
      }));
      const [p] = fitLeagueParams(samples, 30, {
        priorityLeagues: new Map([["Major League Soccer", 20]]),
      });
      expect(p.low_confidence).toBe(true);
    });

    it("low_confidence=false quando n >= 30, mesmo se prioritária", () => {
      const samples = Array.from({ length: 33 }, () => ({
        league: "Premier League",
        home_goals: 1,
        away_goals: 1,
      }));
      const [p] = fitLeagueParams(samples, 30, {
        priorityLeagues: new Map([["Premier League", 20]]),
      });
      expect(p.low_confidence).toBe(false);
    });

    it("sem priorityLeagues, low_confidence=false (path antigo, n sempre >= 30)", () => {
      const samples = Array.from({ length: 40 }, () => ({
        league: "PL",
        home_goals: 1,
        away_goals: 1,
      }));
      const [p] = fitLeagueParams(samples);
      expect(p.low_confidence).toBe(false);
    });
  });
});
