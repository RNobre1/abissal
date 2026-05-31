import type { FixtureDTO } from "./types";
import { groupFixturesByLeague, countryToFlag } from "./leagues";

/**
 * Filtro/ordenação/busca da lista de jogos — TUDO puro e client-side.
 * Os ~48 jogos do dia já vêm carregados no Server Component, então filtrar em
 * memória é instantâneo (sem round-trip / cold-start). Estas funções não têm
 * side-effect nem dependem do DOM — são a fonte da verdade testável que o
 * `FixturesBrowser` consome. Ver spec 2026-05-30-fixtures-browser-filters.
 */

export type SortMode = "kickoff" | "edge" | "signal";
export type ViewMode = "grouped" | "flat";
export type IaFilter = "bet" | "novalue" | "unanalyzed";

export interface FilterState {
  /** keys compostas `league|country` (multi). Vazio = todas. */
  leagues: string[];
  /** categorias de IA (multi). Vazio = todas. */
  ia: IaFilter[];
  /** edge mínimo (%). null = sem filtro de edge. */
  minEdge: number | null;
  /** só fixtures high_signal (>=2 badges). */
  highSignalOnly: boolean;
  /** esconder fixtures sem detail (has_detail=false). */
  hideOff: boolean;
  /** busca por nome de time (substring, sem acento). */
  query: string;
  sort: SortMode;
  view: ViewMode;
}

export const DEFAULT_FILTER_STATE: FilterState = {
  leagues: [],
  ia: [],
  minEdge: null,
  highSignalOnly: false,
  hideOff: false,
  query: "",
  sort: "kickoff",
  view: "grouped",
};

export interface LeagueOption {
  /** key composta `league|country` — casa com `LeagueGroup.key`. */
  key: string;
  league: string;
  country: string | null;
  flag: string;
  count: number;
}

/** lower-case + remove acentos (NFD → tira combining marks). */
export function normalize(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** key composta de uma fixture — espelha `groupFixturesByLeague`. */
export function fixtureLeagueKey(f: FixtureDTO): string {
  const league = f.league && f.league.trim().length > 0 ? f.league : "—";
  const country = f.country ?? null;
  return `${league}|${country ?? "—"}`;
}

/** Categoria de IA da fixture: bet vence novalue vence unanalyzed. */
export function iaCategory(f: FixtureDTO): IaFilter {
  if (f.ai_has_bet === true) return "bet";
  if (f.ai_no_value === true) return "novalue";
  return "unanalyzed";
}

/** Ligas presentes no dia + contagem, na ordem de prioridade dos grupos. */
export function availableLeagues(fixtures: FixtureDTO[]): LeagueOption[] {
  return groupFixturesByLeague(fixtures).map((g) => ({
    key: g.key,
    league: g.league,
    country: g.country,
    flag: g.country ? countryToFlag(g.country) : g.flag,
    count: g.fixtures.length,
  }));
}

function matchesFilters(f: FixtureDTO, s: FilterState): boolean {
  if (s.leagues.length > 0 && !s.leagues.includes(fixtureLeagueKey(f))) return false;
  if (s.ia.length > 0 && !s.ia.includes(iaCategory(f))) return false;
  if (s.minEdge != null) {
    if (f.ai_edge_pct == null || f.ai_edge_pct < s.minEdge) return false;
  }
  if (s.highSignalOnly && f.high_signal !== true) return false;
  if (s.hideOff && f.has_detail !== true) return false;
  const q = normalize(s.query);
  if (q.length > 0) {
    const hay = `${normalize(f.home_team)} ${normalize(f.away_team)}`;
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** kickoff_utc asc, nulls last; tiebreak ko_time asc nulls last, depois id. */
function compareKickoff(a: FixtureDTO, b: FixtureDTO): number {
  const ka = a.kickoff_utc;
  const kb = b.kickoff_utc;
  if (ka !== kb) {
    if (ka === null) return 1;
    if (kb === null) return -1;
    return ka < kb ? -1 : 1;
  }
  const ta = a.ko_time;
  const tb = b.ko_time;
  if (ta !== tb) {
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta < tb ? -1 : 1;
  }
  return a.id - b.id;
}

function signalScore(f: FixtureDTO): number {
  return (f.ai_has_bet === true ? 2 : 0) + (f.high_signal === true ? 1 : 0);
}

function comparator(sort: SortMode): (a: FixtureDTO, b: FixtureDTO) => number {
  if (sort === "edge") {
    return (a, b) => {
      const ea = a.ai_edge_pct ?? Number.NEGATIVE_INFINITY;
      const eb = b.ai_edge_pct ?? Number.NEGATIVE_INFINITY;
      if (ea !== eb) return eb - ea; // desc
      return compareKickoff(a, b);
    };
  }
  if (sort === "signal") {
    return (a, b) => {
      const sa = signalScore(a);
      const sb = signalScore(b);
      if (sa !== sb) return sb - sa; // desc
      return compareKickoff(a, b);
    };
  }
  return compareKickoff;
}

/** Aplica filtros (AND) e ordena. Retorna um novo array (não muta o input). */
export function applyFiltersAndSort(
  fixtures: FixtureDTO[],
  s: FilterState,
): FixtureDTO[] {
  return fixtures.filter((f) => matchesFilters(f, s)).sort(comparator(s.sort));
}
