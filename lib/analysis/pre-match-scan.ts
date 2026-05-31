/**
 * Ranking puro dos "scans" pré-jogo sobre as simulações persistidas.
 *
 * Fonte do ranking = escalares da sim (`fixture_simulations`, migration 0046),
 * NÃO os edges da IA. Um fixture sem o escalar (NULL — linha antiga ou
 * `per_half_available=false` no caso dos escanteios) é EXCLUÍDO do ranking
 * (honesto: não rankear o que não foi computado), nunca tratado como 0.
 *
 * O sidecar empírico (base-rate das partidas recentes) é anexado pelo runner
 * a partir do `detail_json` e só serve de conferência — não entra no sort.
 */

import type { RateOverEligible } from "@/lib/fixtures/stats/empirical-halves";

export interface ScanFixture {
  fixtureId: number | null;
  homeTeam: string;
  awayTeam: string;
  league: string | null;
  kickoffUtc: string | null;
  perHalfAvailable: boolean;
  /** Escalares da sim (0..1) — NULL quando não computado. */
  pDuploGreen: number | null;
  pDuploGreenHome: number | null;
  pDuploGreenAway: number | null;
  pBoth2CornersBothHalves: number | null;
}

export interface DuploGreenSidecar {
  /** "abriu 2 no HT e não venceu" — mandante. */
  home: RateOverEligible;
  /** idem — visitante. */
  away: RateOverEligible;
}

export interface CornersSidecar {
  /** 2+ escanteios em ambos os tempos — mandante (subset ~53%). */
  home: RateOverEligible;
  /** idem — visitante. */
  away: RateOverEligible;
}

export interface RankedScan<TSidecar> {
  fixture: ScanFixture;
  /** valor que rankeou (0..1). */
  prob: number;
  sidecar: TSidecar | null;
}

function byProbDescStable<T>(
  items: Array<{ prob: number; fixture: ScanFixture; sidecar: T | null }>,
): Array<RankedScan<T>> {
  return [...items].sort((a, b) => {
    if (b.prob !== a.prob) return b.prob - a.prob;
    // desempate determinístico
    const h = a.fixture.homeTeam.localeCompare(b.fixture.homeTeam);
    if (h !== 0) return h;
    return a.fixture.awayTeam.localeCompare(b.fixture.awayTeam);
  });
}

/**
 * Top-N por `p_duplo_green` (qualquer time abre +2 e não vence). Exclui
 * fixtures sem o escalar.
 */
export function rankDuploGreen(
  fixtures: ScanFixture[],
  sidecars: Map<string, DuploGreenSidecar> = new Map(),
  limit = 10,
): Array<RankedScan<DuploGreenSidecar>> {
  const eligible = fixtures
    .filter((f) => typeof f.pDuploGreen === "number")
    .map((f) => ({
      fixture: f,
      prob: f.pDuploGreen as number,
      sidecar: sidecars.get(scanKey(f)) ?? null,
    }));
  return byProbDescStable(eligible).slice(0, limit);
}

/**
 * Top-N por `p_both_2corners_both_halves` (ambos os times 2+ escanteios em
 * ambos os tempos). Exclui fixtures sem o escalar (inclui os com
 * `per_half_available=false`).
 */
export function rankCornersBothHalves(
  fixtures: ScanFixture[],
  sidecars: Map<string, CornersSidecar> = new Map(),
  limit = 10,
): Array<RankedScan<CornersSidecar>> {
  const eligible = fixtures
    .filter((f) => typeof f.pBoth2CornersBothHalves === "number")
    .map((f) => ({
      fixture: f,
      prob: f.pBoth2CornersBothHalves as number,
      sidecar: sidecars.get(scanKey(f)) ?? null,
    }));
  return byProbDescStable(eligible).slice(0, limit);
}

/** Chave estável de um fixture pro mapa de sidecars. */
export function scanKey(f: {
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string | null;
}): string {
  const day = (f.kickoffUtc ?? "").slice(0, 10);
  return `${f.homeTeam}|${f.awayTeam}|${day}`;
}
